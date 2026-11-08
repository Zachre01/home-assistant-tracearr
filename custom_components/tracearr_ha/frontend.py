"""Expose the bundled dashboard cards and a credential-protected image proxy."""
from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientTimeout, web
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.components.http import KEY_HASS

from .const import DOMAIN, FRONTEND_URL

_LOGGER = logging.getLogger(__name__)
MAX_ARTWORK_BYTES = 8_000_000


async def async_register_frontend(hass):
    path = str(Path(__file__).parent / "frontend" / "tracearr-card.js")
    await hass.http.async_register_static_paths([StaticPathConfig(FRONTEND_URL, path, False)])
    hass.http.register_view(TracearrArtworkView())
    # Register as a Lovelace resource in storage mode, so loading is ordered
    # after the Home Assistant UI's custom-elements registry is initialized.
    # Unlike add_extra_js_url, this avoids a race observed in some 2026 HA builds.
    lovelace = hass.data.get("lovelace")
    # Home Assistant 2026 exposes resource_mode, not mode, on LovelaceData.
    # Keep the older attribute as a fallback for previous Core versions.
    resource_mode = (
        getattr(lovelace, "resource_mode", None)
        or getattr(lovelace, "mode", None)
    )
    if resource_mode == "storage":
        resources = lovelace.resources
        if not resources.loaded:
            await resources.async_load()
        base_path = FRONTEND_URL
        wanted = FRONTEND_URL + "?v=0.1.17"
        existing = [item for item in resources.async_items() if item["url"].split("?")[0] == base_path]
        if not existing:
            await resources.async_create_item({"res_type": "module", "url": wanted})
        elif existing[0]["url"] != wanted:
            await resources.async_update_item(existing[0]["id"], {"res_type": "module", "url": wanted})
    # YAML-managed Lovelace resources are read-only and must be added manually.


class TracearrArtworkView(HomeAssistantView):
    """Serve only images referenced by an active stream, never arbitrary URLs."""
    url = "/api/tracearr_ha/image/{entry_id}/{session_id}/{kind}"
    name = "api:tracearr_ha:image"
    requires_auth = True

    async def get(self, request, entry_id, session_id, kind):
        if kind not in ("poster", "avatar"):
            return web.Response(status=404)
        hass = request.app[KEY_HASS]
        coord = hass.data.get(DOMAIN, {}).get(entry_id)
        if not coord:
            return web.Response(status=404)
        item = coord.streams.get(session_id)
        if not item:
            return web.Response(status=404)
        uri = item.get("poster_url" if kind == "poster" else "user_avatar_url")
        if not isinstance(uri, str) or not uri:
            return web.Response(status=404)
        parsed = urlsplit(uri)
        origin = urlsplit(coord.client.base_url)
        # Prevent SSRF: fetch only Tracearr's own image-proxy endpoint.
        if parsed.scheme and (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
            return web.Response(status=404)
        if parsed.path != "/api/v1/images/proxy":
            return web.Response(status=404)
        url = f"{coord.client.base_url}{parsed.path}?{parsed.query}"
        try:
            # Tracearr's normal API client advertises JSON; the artwork proxy
            # needs image content negotiation instead.
            headers = {**coord.client.headers, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"}
            async with coord.client.session.get(url, headers=headers,
                    timeout=ClientTimeout(total=20), allow_redirects=False) as response:
                if response.status != 200:
                    _LOGGER.debug("Tracearr artwork returned HTTP %s", response.status)
                    return web.Response(status=502 if response.status >= 500 else 404)
                if response.content_length and response.content_length > MAX_ARTWORK_BYTES:
                    return web.Response(status=413)
                data = await response.content.read(MAX_ARTWORK_BYTES + 1)
                if len(data) > MAX_ARTWORK_BYTES:
                    return web.Response(status=413)
                content_type = response.headers.get("Content-Type", "")
                safe_type = content_type.split(";", 1)[0].strip().lower()
                if safe_type in ("image/jpg", "image/pjpeg"):
                    safe_type = "image/jpeg"
                if safe_type == "application/octet-stream":
                    # Some image backends omit the MIME type; accept only
                    # recognized image signatures, never HTML/JSON/SVG.
                    if data.startswith(b"\xff\xd8\xff"):
                        safe_type = "image/jpeg"
                    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
                        safe_type = "image/png"
                    elif data.startswith((b"GIF87a", b"GIF89a")):
                        safe_type = "image/gif"
                    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
                        safe_type = "image/webp"
                    elif data[4:8] == b"ftyp" and b"avif" in data[8:32]:
                        safe_type = "image/avif"
                if safe_type not in ("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"):
                    return web.Response(status=415)
                return web.Response(body=data, content_type=safe_type,
                                    headers={"Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff"})
        except (ClientError, TimeoutError) as exc:
            _LOGGER.debug("Tracearr artwork request failed: %s", type(exc).__name__)
            return web.Response(status=502)
