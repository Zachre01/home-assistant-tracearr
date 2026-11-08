# Card configuration

Back to the [README](../README.md) · [Changelog](../CHANGELOG.md)

This guide collects the detailed settings. New and older versions are documented in `CHANGELOG.md`. The options below describe current use.

### Carousel and presentation

The carousel can be dragged with the mouse, the same way as a touch interface, in addition to the optional arrows. Its horizontal scrollbar is **always hidden**. The outer frame follows the native Home Assistant theme. Each stream panel has its own background (a light contrast, transparent, or a blurred poster). Progress and badges share one palette.

| Setting | Values |
|---|---|
| Layout | `list`, `grid`, `carousel` |
| Grid columns | `columns: auto`, or `1` to `4` |
| Streams visible in the carousel | `carousel_visible: 1` to `4` |
| Autoplay | `carousel_autoplay: true` / `false` |
| Time before the next stream | `carousel_interval: 3` to `120` seconds |
| Transition | `slide`, `fade`, `zoom`, `flip` (3D), `none` |
| Transition duration | `carousel_transition_speed: 100` to `3000` milliseconds |
| Horizontal scrollbar | Always hidden, including for older configurations |
| Show arrows | `carousel_show_arrows: true` / `false` |
| Mouse drag | `carousel_mouse_drag: true` / `false` |
| Video/audio icons | `show_transcode_icons: true` / `false` |
| Font size | `font_size: 10` to `28` (pixels) |
| Inner background | `stream_surface: soft` / `transparent` / `blur` |
| Poster blur | `stream_blur: 0` to `50` (pixels, default 26) |
| Poster dimming | `stream_overlay: 25` to `95` (percent, default 72) |
| Left accent | `stream_accent_style: rounded` / `straight` / `none` |
| Accent thickness | `stream_accent_width: 2` to `8` (pixels, default 4) |
| Poster size | `poster_size: 50` to `200` (percent; default `100`) |
| Shared palette (progress and badges) | `accent_color_mode: theme`, `server`, or `custom` |
| Custom color | `accent_custom_color: "#00BCD4"` |
| Pause when the pointer is over the card | `carousel_pause_on_hover: true` / `false` |

Autoplay pauses when the page is hidden or the browser requests reduced motion. Pause-on-hover can be enabled separately (off by default). The **time between changes** (`carousel_interval`) is separate from the **animation duration** (`carousel_transition_speed`).

## Lovelace examples

**Vertical list:**

```yaml
type: custom:tracearr-streams-card
mode: list
show_header: true
title: Media activity
header_show_streams: true
header_show_bandwidth: true
header_show_video: true
header_show_audio: true
header_show_both: true
header_show_transcodes_total: true
header_show_server_counts: true
show_progress: true
show_quality: true
show_paused: true
```

**Adaptive grid, two columns, with a blurred background:**

```yaml
type: custom:tracearr-streams-card
mode: grid
columns: 2
stream_surface: blur
show_poster: true
```

`columns: auto` fits as many columns as the card width allows, with a minimum of 290px (210px in compact mode). A card narrower than 520px always uses one column. Saved `mode: list` and `mode: carousel` cards stay as they are.

**Automatic carousel, two visible streams, zoom, and mouse navigation:**

```yaml
type: custom:tracearr-streams-card
mode: carousel
carousel_visible: 2
carousel_autoplay: true
carousel_interval: 8
carousel_transition: zoom
carousel_transition_speed: 800
carousel_show_arrows: true
carousel_mouse_drag: true
header_show_server_counts: true
show_transcode_icons: true
accent_color_mode: server
stream_surface: soft
font_size: 15
```

**Compact list:**

```yaml
type: custom:tracearr-streams-card
mode: list
compact: true
show_poster: false
show_bitrate: true
show_codecs: true
```

**One stream for a user:**

```yaml
type: custom:tracearr-stream-card
selection: account
selected_account: plex:alice
show_poster: true
```

The same settings are available in the **Lovelace visual editor**.

### Size and layout

On a **Sections** dashboard, set height and width in **Edit dashboard → Card → Layout**, using Home Assistant's own controls. Poster size is independent, in **General display → Poster size (%)** (`poster_size`, 50 to 200 percent, default 100), including individual cards and compact mode. The old `grid_columns`, `grid_rows`, and `height` fields are no longer offered and are ignored. On other dashboard types, size comes from the Home Assistant layout and its containers. Tracearr does not force a CSS card size.

### Header

**Header and badges** can hide the whole header (`show_header: false`), show a custom title (`title`), or keep only some indicators. Each badge (a Tracearr statistic or a Home Assistant entity) has an **Alignment**: automatic, left, center, or right. When a center group exists, its column is exactly as wide as its badges, and the two side columns share the remaining space so the center stays exact. On a phone or tablet the badges can stay on one line when there is room. On an extremely narrow card, the center group can move to another line. Groups are created only when they contain visible badges: with nothing in the center, no center column is reserved. Left and right groups stay side by side when their width allows it, and wrap only when they need to. Groups keep the order from `header_badge_order`. Under **Tracearr statistics**, the visibility switches stay available, and each statistic can be opened to set its name, MDI icon, hide-at-zero, animation, duration, and zero color. Those values are stored in `header_metric_settings`. Older cards keep their previous settings. You can show each of these independently:

| Setting | Display |
|---|---|
| `header_show_streams` | Total visible streams |
| `header_show_bandwidth` | Combined bitrate in Mb/s |
| `header_show_direct` | Direct plays |
| `header_show_paused` | Paused streams |
| `header_show_video` | Video-only transcodes |
| `header_show_audio` | Audio-only transcodes |
| `header_show_both` | Video and audio transcodes |
| `header_show_transcodes_total` | Total transcodes |
| `header_show_server_counts` | One counter for each Plex, Jellyfin, or Emby server that has at least one visible stream |

The counters match the streams still visible after the card's filters. They do not include streams hidden by those settings. The title is optional (`show_title`). When it is hidden, badges align to the left automatically.

### Titles, seasons, episodes, and years

**Titles, seasons, and years** keeps movies and series separate:

- **Movies:** show or hide the title (`movie_show_title`) and year (`movie_show_year`), and choose their order (`movie_field_order`).
- **Series:** show or hide the **series title** (`series_show_title`), the **episode name** (`series_show_episode_title`), the **season** (`series_show_season`), the **episode number** (`series_show_episode_number`), and the **year** (`series_show_year`), each on its own.
- **Season/episode format:** `series_episode_style: short` shows `S01E02`; `long` shows `Season 1 · Episode 2`.
- **Free order:** in the visual editor, use the up and down buttons to rearrange each field. The first visible field is the larger title line. The rest appear below it, in the chosen order. Order still works when some fields are hidden.

YAML example (the same settings are in the editor):

```yaml
type: custom:tracearr-streams-card
mode: carousel
movie_show_title: true
movie_show_year: false
movie_field_order: title,year
series_show_title: true
series_show_episode_title: true
series_show_season: true
series_show_episode_number: true
series_show_year: true
series_episode_style: long
series_field_order: series,season,episode_number,episode,year
```

**Important:** the year comes from the `year` field Tracearr provides. Depending on the server, that can be the episode year rather than the first year the whole series aired.

### Home Assistant badges in the header

In **Header and badges → Home Assistant entity badges**, choose **Add a badge**, then pick an entity with Home Assistant's search. You can add a custom name or leave the entity name. Its value and unit update on every state change, without rebuilding the carousel.

You can select **any Home Assistant entity**, for example `counter.requests`, `sensor.living_room_temperature`, or an `input_number`. Unavailable entities show "Unavailable". The color follows the existing header-badge setting. A card can have up to 20 badges.

Optional YAML:

```yaml
header_entity_badges:
  - entity: counter.requests
    label: Seerr requests
  - entity: sensor.living_room_temperature
    label: Living room
```

### Local and remote bitrate

In **Local / remote bitrate**, choose **All bitrates**, **Local streams only**, or **Remote streams only**. This affects both the individual bitrate badges and the combined header bitrate.

**Important limit:** the Tracearr public API v2 used by this integration does not provide the client IP address or a LAN/WAN status. Local and remote streams cannot be detected automatically from that API. The card uses **manual** matches, one per line:

```yaml
bitrate_scope: remote
network_locations: |
  plex:alice=remote
  device:Apple TV=local
  player:Plex for Android=remote
```

Rules can use `serverId:user`, `plex:user`, `jellyfin:user`, `device:Name`, `player:Name`, or only the username. Set `local` or `remote`. A rule for a user or device is a hint and does not follow the device if it moves. In local or remote mode, unclassified streams **are not counted**. All-bitrate mode does not use the matches.

### When nothing is playing

Choose **Custom message**, **Header only**, or **Hide the card**. `empty_message` is the text when nobody is watching. If Tracearr is disconnected, "Tracearr unavailable" takes priority.

```yaml
empty_mode: header_only  # message, header_only, hide
empty_message: Nothing to watch right now
```

`hide_empty: true` is still read as `empty_mode: hide` for older cards, unless the newer mode is already set.

### Native background and color palette

The card shell uses Home Assistant's colors, borders, and shadows. For stream panels, `stream_surface` accepts `soft` (a light contrast with the background), `transparent`, or `blur` (a cinema background from the poster Tracearr already provided). Blur strength (`stream_blur`) and dimming (`stream_overlay`) are in **General display**, along with the left accent style and thickness. Older cards keep their contrasted background and rounded accent until you change them. A missing poster gives a dark background with no image. No new external image source is contacted.

**Shared color palette** sets the progress bar and the quality and bitrate badges. Header badges use that palette unless you choose another:

- `accent_color_mode: theme`: the Home Assistant theme accent.
- `accent_color_mode: server`: Plex orange, Jellyfin purple, Emby green. General statistics keep the theme accent, while each server counter uses that server's color.
- `accent_color_mode: custom`: `accent_custom_color` as `#RRGGBB`.

**Badge color** (in **Header and badges**) can be independent: `header_badge_color_mode: inherit` (shared palette), `theme`, `server` (each server counter uses its color; general metrics use the theme), or `custom` with `header_badge_custom_color: "#223344"`.

Text on each colored badge is black or white, whichever contrasts better. The video/audio status icons (green for direct, orange for transcode) and the "Paused" message keep their status colors.

The visual editor uses **collapsible sections**: General display, Playback and filters, Carousel navigation, Header and badges, Titles/seasons/years, Stream details, Local / remote bitrate, and Per-card settings. Each card instance has its own settings.

Settings saved by older versions are still supported (`show_counter`, `show_transcodes`, `progress_color_mode`, `progress_custom_color`) and converted when the card loads. The legacy `show_year` switch is applied to both newer year switches unless one of them was already customized. From 0.1.6, use the separate settings.

The carousel scrollbar stays hidden. Navigation is optional arrows, touch drag, optional mouse drag, and the keyboard. **SSE events for progress, pause, transcode, bitrate, or server health no longer rebuild the carousel container**, so the current transition continues. A stream appearing or disappearing refreshes the list, but keeps the visible stream if it still exists. After manual navigation, the autoplay interval starts over. Text and inner panels follow the theme.

## Customize users

In **Settings → Devices & services → Tracearr HA → Configure → Edit all user display names**, there is one field per detected account (Plex, Jellyfin, and Emby). Saved names are **prefilled**. You can edit several accounts and save once. The original identifiers are not changed. An advanced editor can still set avatars one at a time.

To customize only one card, use the alias field, one match per line:

```text
alice=Alice at home
plex:alice=Alice on Plex
<server_id>:alice=Alice in the living room
```

Avatars can be replaced the same way with HTTPS image URLs the browser can load.

## Clocks and playback time

Elapsed and remaining time are calculated locally from one monotonic clock, using the same whole-second value so the two numbers stay in step. Small SSE drift is corrected gradually without rewinding the clock. Intentional seeks are applied. While paused, time stays frozen.

On the card, **elapsed / remaining** appears on the left. `show_end_time: true` shows **Ends at** with the local time on the right. While paused, that estimate disappears and "Paused" is shown. The time can stay approximate if Tracearr reports a buffer update late.

Header badges can use `header_positive_only`, `header_blink_positive`, `header_blink_seconds`, `header_show_names`, `header_zero_color_mode`, and `header_zero_custom_color`. Each entity badge in `header_entity_badges`, or statistic in `header_metric_settings`, can override its behavior with `align`, `show_name`, `show_icon`, `only_positive`, `blink_positive`, `blink_seconds`, `zero_color_mode`, and `zero_custom_color`. Statistics can also set a custom name and MDI icon.

Blink animations are disabled when the system requests reduced motion.
