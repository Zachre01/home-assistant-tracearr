"""Artwork proxy regression tests without importing Home Assistant."""
import ast
import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientSession, ClientTimeout, web


SOURCE = Path(__file__).resolve().parents[1] / "custom_components/tracearr_ha/frontend.py"


def load_artwork_view():
    module = ast.parse(SOURCE.read_text())
    node = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == "TracearrArtworkView")
    namespace = {
        "HomeAssistantView": object,
        "KEY_HASS": "hass",
        "DOMAIN": "tracearr_ha",
        "urlsplit": urlsplit,
        "web": web,
        "ClientError": ClientError,
        "ClientTimeout": ClientTimeout,
        "_LOGGER": logging.getLogger(__name__),
        "MAX_ARTWORK_BYTES": 8_000_000,
    }
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(SOURCE), "exec"), namespace)
    return namespace["TracearrArtworkView"]


def test_artwork_proxy_uses_image_accept_and_accepts_octet_stream():
    async def scenario():
        seen = []
        png = b"\x89PNG\r\n\x1a\n" + b"test image bytes"

        async def image(request):
            seen.append((request.headers.get("Accept"), request.headers.get("Authorization")))
            return web.Response(body=png, content_type="application/octet-stream")

        app = web.Application()
        app.router.add_get("/api/v1/images/proxy", image)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            async with ClientSession() as session:
                base = f"http://127.0.0.1:{port}"
                client = SimpleNamespace(base_url=base, session=session,
                    headers={"Authorization": "Bearer test", "Accept": "application/json"})
                coord = SimpleNamespace(client=client,
                    streams={"s": {"poster_url": f"{base}/api/v1/images/proxy?key=abc"}})
                hass = SimpleNamespace(data={"tracearr_ha": {"e": coord}})
                req = SimpleNamespace(app={"hass": hass})
                view = load_artwork_view()()
                response = await view.get(req, "e", "s", "poster")
                assert response.status == 200
                assert response.content_type == "image/png"
                assert response.body == png
                assert seen == [("image/avif,image/webp,image/*,*/*;q=0.8", "Bearer test")]
                # Reject an arbitrary external URL even if the stream references it.
                coord.streams["s"]["poster_url"] = "https://example.org/api/v1/images/proxy"
                assert (await view.get(req, "e", "s", "poster")).status == 404
                assert len(seen) == 1
        finally:
            await runner.cleanup()

    asyncio.run(scenario())


def test_artwork_proxy_rejects_non_images():
    async def scenario():
        async def bad_image(request):
            return web.Response(body=b"<html>not an image</html>", content_type="application/octet-stream")

        app = web.Application()
        app.router.add_get("/api/v1/images/proxy", bad_image)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            async with ClientSession() as session:
                base = f"http://127.0.0.1:{port}"
                client = SimpleNamespace(base_url=base, session=session, headers={})
                coord = SimpleNamespace(client=client, streams={"s":{"poster_url":"/api/v1/images/proxy"}})
                req = SimpleNamespace(app={"hass": SimpleNamespace(data={"tracearr_ha":{"e":coord}})})
                assert (await load_artwork_view()().get(req,"e","s","poster")).status == 415
        finally:
            await runner.cleanup()

    asyncio.run(scenario())


async def _serve(handler):
    app = web.Application()
    app.router.add_get("/api/v1/images/proxy", handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return runner, f"http://127.0.0.1:{port}"


def test_artwork_proxy_assembles_chunked_image():
    """A poster split across packets must be forwarded whole.

    StreamReader.read(n) returns only the bytes already buffered. The proxy
    used to stop after that first chunk, so larger titles never decoded.
    """
    png = b"\x89PNG\r\n\x1a\n" + b"poster-payload-must-arrive-intact"

    async def scenario():
        started = asyncio.Event()
        release = asyncio.Event()

        async def image(request):
            response = web.StreamResponse(headers={"Content-Type": "application/octet-stream"})
            await response.prepare(request)
            # Stop before the PNG signature is complete, so a one-chunk read
            # cannot sniff the type or return the bytes the browser needs.
            await response.write(png[:4])
            started.set()
            await release.wait()
            await response.write(png[4:])
            await response.write_eof()
            return response

        runner, base = await _serve(image)
        try:
            async with ClientSession() as session:
                client = SimpleNamespace(base_url=base, session=session, headers={})
                coord = SimpleNamespace(client=client, streams={"s": {"poster_url": "/api/v1/images/proxy?key=chunked"}})
                req = SimpleNamespace(app={"hass": SimpleNamespace(data={"tracearr_ha": {"e": coord}})})
                task = asyncio.create_task(load_artwork_view()().get(req, "e", "s", "poster"))
                await asyncio.wait_for(started.wait(), timeout=2)
                # Let the proxy consume the first packet. A correct reader is
                # still waiting for the rest; the old one has already returned.
                for _ in range(20):
                    await asyncio.sleep(0)
                done, _pending = await asyncio.wait({task}, timeout=0.5)
                assert not done, "proxy returned before the rest of the image was sent"
                release.set()
                response = await asyncio.wait_for(task, timeout=2)
                assert response.status == 200
                assert response.content_type == "image/png"
                assert response.body == png
        finally:
            release.set()
            await runner.cleanup()

    asyncio.run(scenario())


def test_artwork_proxy_rejects_oversized_stream_without_content_length():
    async def scenario():
        async def image(request):
            response = web.StreamResponse(headers={"Content-Type": "image/png"})
            await response.prepare(request)
            try:
                for _ in range(20):
                    await response.write(b"\x89PNG\r\n\x1a\n" + b"0123456789")
                await response.write_eof()
            except (Exception, asyncio.CancelledError):
                return response
            return response

        runner, base = await _serve(image)
        try:
            async with ClientSession() as session:
                client = SimpleNamespace(base_url=base, session=session, headers={})
                coord = SimpleNamespace(client=client, streams={"s": {"poster_url": "/api/v1/images/proxy"}})
                req = SimpleNamespace(app={"hass": SimpleNamespace(data={"tracearr_ha": {"e": coord}})})
                view_cls = load_artwork_view()
                view_cls.get.__globals__["MAX_ARTWORK_BYTES"] = 64
                response = await view_cls().get(req, "e", "s", "poster")
                assert response.status == 413
        finally:
            await runner.cleanup()

    asyncio.run(scenario())
