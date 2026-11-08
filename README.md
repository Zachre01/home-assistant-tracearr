# Tracearr HA

[![GitHub Actions validation](https://github.com/Moosketair/home-assistant-tracearr/actions/workflows/validate.yml/badge.svg)](https://github.com/Moosketair/home-assistant-tracearr/actions/workflows/validate.yml)
[![HACS](https://img.shields.io/badge/HACS-Default%20repository-41BDF5)](https://github.com/hacs/default/pull/13306)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Watch Plex, Jellyfin, and Emby playback in Home Assistant with data from Tracearr.** The integration includes sensors, a live connection, and two customizable Lovelace cards (grouped streams, or a single stream).

**Current version: 0.1.17** · Available in the official HACS catalog after the release is published. This is a community project that is still evolving. Test the sensors before using them for critical automations.

## What's new in 0.1.17

- **Adaptive grid is back:** grouped cards can show streams in an automatic or fixed column grid (`mode: grid`, `columns: auto` or `1`–`4`). Cards narrower than 520px collapse to one column. Home Assistant Sections still controls the card's width and height.
- **English interface:** the Lovelace cards, options-flow labels, and documentation are in English. A French Home Assistant language still uses `translations/fr.json` for the static configuration screens.

### Recent improvements (0.1.16)

- **Compact centered badge:** the center group is only as wide as its badges and stays exactly centered. On small screens, the left, center, and right groups stay on one line whenever there is room.

### Recent improvements (0.1.15)

- **Truly centered badge:** when a badge is centered, the header uses equal side tracks and centers the middle content, regardless of how long the side badges are. On a very narrow card, the center group can wrap to its own line.

### Recent improvements (0.1.14)

- **Cinema background:** a blurred poster behind each stream, with adjustable blur and dimming, falling back to a dark surface when the image is missing.
- **Improved accent:** a colored edge that follows the rounded corners, with adjustable thickness, or the older straight bar, or hidden.
- **More reliable posters:** sizes from 50 to 200 percent, signed URLs applied as soon as they arrive, and three retries after a load error.
- **Custom header badges:** Tracearr statistics and Home Assistant entities can each align left, center, or right, with a custom name, icon, hide-at-zero, blink, and zero color.
- **Mobile layout:** left and right badges share a row when the width allows it, with no empty center column.

See the [full changelog](CHANGELOG.md) for earlier improvements and fixes.

## Install with HACS

1. In **HACS**, search for **Tracearr HA** and choose **Download**.
2. **Restart Home Assistant** after installing or updating.
3. Open **Settings → Devices & services → Add integration → Tracearr HA**.
4. Enter your Tracearr server address and the public API key `trr_pub_...` from **Tracearr → Settings → Data & API → API**.
5. On a dashboard, use **Edit → Add card**, then search for **Tracearr**.

Normal updates keep existing card settings and the Home Assistant configuration entry. After an update, reload the browser with `Ctrl + F5` (or refresh the page on mobile).

**Card missing from Lovelace?** In **Settings → Dashboards → Resources**, confirm there is only one JavaScript module resource for `/tracearr_ha/tracearr-card.js?v=0.1.17`. In YAML mode, add that resource yourself.

## What Tracearr HA provides

- **Live playback** with SSE updates and a REST fallback.
- **Sensors** for active streams, direct plays, transcode types, estimated bitrate, and server availability.
- **Two cards:** `custom:tracearr-streams-card` (list, grid, or carousel) and `custom:tracearr-stream-card` (one stream).
- **Carousel:** optional autoplay, transition effects, arrows, and touch, keyboard, and mouse navigation.
- **Customization:** titles and episodes, posters, avatars, progress, remaining time, estimated end time, badges, per-server colors, and compact mode.
- **Local and remote devices:** manual classification by user or device, with bitrate filtering.
- **Native Home Assistant layout:** size comes from the Sections layout, without a forced card size.

## Quick examples

**Grouped streams with a blurred background and badges:**

```yaml
type: custom:tracearr-streams-card
mode: grid
columns: auto
stream_surface: blur
stream_blur: 26
stream_overlay: 72
stream_accent_style: rounded
show_header: true
header_show_streams: true
header_show_transcodes_total: true
header_metric_settings:
  streams:
    align: left
  transcodes_total:
    align: right
```

**One stream (the latest active session):**

```yaml
type: custom:tracearr-stream-card
selection: recent
show_poster: true
poster_size: 110
show_end_time: true
```

Use the visual editor to pick a user or server without typing identifiers. Existing settings stay compatible.

## Customization and documentation

The main settings are in the visual editor. For YAML values, full examples, and specific behavior:

- [Card and options guide](docs/CONFIGURATION.md)
- [Version history](CHANGELOG.md)
- [Maintenance, HACS publishing, and trademark notes](docs/MAINTENANCE.md)

## Compatibility and limits

- Home Assistant **2025.6+**. Tracearr with the **public API v2** (SSE from Tracearr 2.7.0; otherwise periodic polling).
- Recent Chromium, Firefox, and Safari browsers.
- The public API used here cannot tell whether a stream is local or remote. Those matches have to be configured manually.
- Stopping a stream remotely is not implemented.
- The integration shows what Tracearr sends. That information can be incomplete or delayed.

## Quick troubleshooting

- **No sensors:** check the URL, the API key, and **Settings → System → Logs**.
- **Missing card or an old interface:** confirm the single JavaScript resource above, restart Home Assistant, and reload the browser cache.
- **Missing poster:** confirm Tracearr provides `poster_url` and check network errors and logs. The cinema background stays dark without a poster.
- **Carousel does not move:** check the number of visible streams, autoplay, animation preferences, and pause-on-hover.

**MIT License.** Independent community project, with no affiliation or official endorsement from Tracearr, Home Assistant, Plex, Jellyfin, or Emby. Its icon is a separate design.
