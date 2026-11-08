# Maintaining Tracearr HA

Back to the [README](../README.md) · [Changelog](../CHANGELOG.md)

## Publish an update

Tracearr HA is in the HACS catalog since [hacs/default#13306](https://github.com/hacs/default/pull/13306) was merged. **Publishing an update does not require a new catalog submission.**

1. Prepare and test the changes on a development branch, with the same version in `custom_components/tracearr_ha/manifest.json`, the Lovelace resource cache (`frontend.py`), and the banner at the top of the JavaScript file.
2. Update the release notes in `CHANGELOG.md` and keep the historical sections. Summarize only the main changes in `README.md`.
3. Run the Python tests, JavaScript tests, HACS, and hassfest checks through [GitHub Actions](https://github.com/Moosketair/home-assistant-tracearr/actions).
4. To publish a public version, merge the verified code into `main` with a commit titled exactly `release: vX.Y.Z`. The `publish-release.yml` workflow validates the repository again, then creates the tag and the GitHub Release on that same commit.
5. **After publishing, confirm** that the tag and the Release point at the right SHA. HACS downloads the code from the tag, not only from the Release "Target" field.
6. HACS can take a little time to offer the new version after Releases sync. Restart Home Assistant after installing, and refresh the page so the JavaScript reloads.

For a **prerelease**, use a separate branch and manifest (for example `0.1.15b1`), create the tag on the correct commit, publish a Release marked **Pre-release**, and check the tag before installing. Prereleases do not automatically replace stable releases for users who have not enabled them.

### Local checks

```bash
python -m compileall -q custom_components
python -m pytest -q tests
node --check custom_components/tracearr_ha/frontend/tracearr-card.js
node --test tests/test_carousel.cjs
```

## Trademark, license, and affiliation

This project is under the [MIT License](../LICENSE). It is not maintained or endorsed by Tracearr, Home Assistant, Plex, Jellyfin, or Emby. The Tracearr repository states an AGPL-3.0 license for its software. **That license does not automatically allow using its logo as the identity of a third-party project.**

Tracearr HA keeps its own icon (a cyan house, a play mark, and a progress bar) in `custom_components/tracearr_ha/brand/icon.png` and `icon@2x.png`. It does not claim to use the official Tracearr or Home Assistant logo.

## Icon display in HACS

On Home Assistant versions that support local integration icons (notably 2026.3+), the icon appears in **Settings → Devices & services**. Some HACS versions still show "icon not available" because their lists use other brand sources than the local icons. The issue is tracked in [hacs/integration#5223](https://github.com/hacs/integration/issues/5223) and [hacs/integration#5402](https://github.com/hacs/integration/issues/5402).

Do not add files or change the domain name only to hide that symptom without understanding the cause and the official HACS requirements.

## Tracking changes

Shipped changes are recorded in [CHANGELOG.md](../CHANGELOG.md) and in the [GitHub Releases](https://github.com/Moosketair/home-assistant-tracearr/releases). Future improvements and bugs should be tracked as [GitHub issues](https://github.com/Moosketair/home-assistant-tracearr/issues). The README stays an installation and usage guide, not a task list.
