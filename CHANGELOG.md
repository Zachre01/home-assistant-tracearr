# Changelog

Changes are grouped by public version. Prereleases and older notes remain below. [GitHub Releases](https://github.com/Moosketair/home-assistant-tracearr/releases) can download a specific version.

## 0.1.18 — 2026-11-08

- Posters are assembled from the whole Tracearr response. A poster that arrived in more than one network chunk used to be cut off, so only some titles showed artwork.
- Playback bitrate samples no longer rebuild list and grid cards, so an in-progress poster is not cancelled on every progress update. The bitrate chip and header total still update in place.
- An image error from a poster that has already been removed does not discard its signed URL or use up a retry.

## 0.1.17 — 2026-11-08

- Adaptive stream grid is available again: `mode: grid` with `columns` set to `auto` or `1`–`4`. Cards narrower than 520px use one column. Saved list and carousel cards are unchanged.
- Home Assistant Sections still owns card width and height. Legacy `height`, `grid_columns`, and `grid_rows` stay ignored.
- Lovelace card copy, card-picker names, and dynamic options-flow labels are in English. Static French configuration strings remain in `translations/fr.json`.
- Documentation (README, configuration guide, maintenance notes, and this changelog) is in English.

## 0.1.16 — 2026-11-05

- Centered badge with an intrinsic width: the center column uses `max-content` instead of a fixed third of the header. The two side columns share the rest, which keeps the badge in the middle.
- The center group no longer always wraps below 440px. On very narrow cards (under 260px), wrapping is still possible so the badges stay readable.
- No change to saved settings. Responsive regression tests were added.

## 0.1.15 — 2026-11-05

- Centered badge alignment: three equal columns when the center is used, with the center badge stretched and its content centered.
- On narrow screens, the center group gets a centered line while the left and right groups keep their compact layout.
- No change to saved settings. Customizations and older cards stay compatible.

## 0.1.14 — 2026-11-05

### Display and customization

- Cinema background using the blurred poster behind each stream, with adjustable strength and dimming. Falls back to a dark surface when the poster is missing.
- Colored accent that follows the rounded corners of the stream panel, with adjustable thickness, the older straight bar, or hidden.
- Poster size from 50 to 200 percent on grouped and individual cards, including compact mode.
- Independent **left, center, or right** alignment for each Tracearr and Home Assistant badge. Empty groups reserve no space on mobile.
- Per-statistic customization (name, icon, hide at zero, blink, duration, and zero color), in addition to the global settings.

### Images and reliability

- Signed URLs are applied to posters immediately, without rebuilding the carousel.
- Up to three retries after a load failure (2s, 5s, 15s), with a fallback element.
- Improved image proxy: format negotiation, a 20s timeout, an 8 MB maximum, and a content-type check.
- Existing configurations kept by default, with regression tests.

## 0.1.14 prereleases — kept for history

### 0.1.14b4 — 2026-11-05

- Prerelease validated with the mobile alignment fix and every customization option from b2.
- A new branch and tag were created so the bad Git target of the b3 tag would not be reused.

### 0.1.14b3 — 2026-11-05

- Planned fix: remove empty badge columns and avoid two unnecessary lines on mobile.
- **Publishing incident:** the published Git tag `v0.1.14b3` pointed at the b1 code by mistake. The real fix was published in b4.

### 0.1.14b2 — 2026-11-05

- Alignment per badge (statistic or Home Assistant entity), separately left, center, or right.
- New per-statistic settings: name, icon, hide when the value is zero, blink, and zero color.

### 0.1.14b1 / initial 0.1.14 preparation — 2026-11-05

- Blurred cinema background, rounded accent, poster size, and more reliable poster loading.
- Badges align to the left automatically when the title is hidden.

## 0.1.13 Alpha (2026-11-04)

- Moved the list/carousel choice into "General display" for the grouped card, and removed the separate "Layout" category.
- In "Header and badges → Tracearr statistics", returned to simple checkboxes for each counter, without an individual sub-panel.
- No change to saved values, the other sections, the sensors, or the existing icon.

## 0.1.12 Alpha (2026-11-04)

- Visual selection for the individual card: active session, user, server, or most recent stream. A user selection stays valid for later playback.
- Removed the adaptive grid (existing cards were migrated to the vertical list). Restored in 0.1.17.
- Removed size controls from the editor. Width and height are controlled only by the native Home Assistant Sections layout.
- Grouped forms for LAN/WAN locations by device and for user aliases. Previously saved values are prefilled and kept.
- Optional fetch of up to 500 history records so inactive devices can be identified, in addition to active and already configured devices.
- Lovelace editor reorganized with a General display category and collapsible panels per header badge.
- No change to the approved icon, existing avatar settings, or API sensors.

## 0.1.11 Alpha (2026-11-04)

- Replaced the local integration icon with the approved minimal variant: a cyan house, a play button, and a progress bar, at 256 and 512 pixels.
- Does not reuse the official Tracearr logo or the protected Home Assistant logo.
- Documented the known HACS issue: no icon in HACS lists even when Home Assistant integrations show it.
- Updated the version and resource loading. No functional change to the API or the cards.

## 0.1.10 Alpha (2026-11-04)

- Clock: elapsed / remaining grouped on the left; "Ends at HH:mm" aligned on the right.
- "Paused" stays visible next to the elapsed time. No estimated end time while playback is paused.
- Added HACS and hassfest validation to GitHub Actions, in preparation for the HACS catalog.
- Kept the independent icon for now. Using the official Tracearr logo would need a check of reuse rights and trademarks.

## 0.1.8 — Alpha (2026-11-03)

- Elapsed and remaining clocks calculated from the same whole number of seconds, in one update, so rounding no longer drifts.
- Estimated end time (HH:mm), hidden while paused, and independent of the progress bar.
- New original video-clapper and speaker icons, without reusing graphics that require attribution.
- Header badges: hide zero values, blink above zero with an adjustable period, a specific zero color, and optional names.
- Per Home Assistant entity badge: sensor icon, optional name, visibility when the value is positive, animation, duration, and a custom zero color.
- Honors `prefers-reduced-motion` so blinking is not forced.

## 0.1.7 — Alpha (2026-11-03)

- Separate "Show season" and "Show episode number" switches, with the customizable order and the `S01E02` / `Season 1 · Episode 2` formats. Compatible with the older `series_show_season_episode` setting.
- Bitrate badge and total bitrate filter: All, Local, or Remote. Classification uses explicit account and device matches, because Tracearr v2 does not provide IPs or LAN/WAN status in `/streams`.
- Header badges bound to arbitrary Home Assistant entities, with the native picker, an optional name, and a live value and unit, up to 20 badges per card. A sensor update does not rebuild the carousel.
- Three behaviors when there is no stream: a custom message, the header only, or a fully hidden card. The older `hide_empty` setting is kept.
- JavaScript tests for migration, episode display and order, Home Assistant counters, unclassified networks, header updates, and empty states.

## 0.1.6 — Alpha (2026-11-03)

- Separate options for movie and series titles and years, the episode title, and the season/episode number.
- Season/episode format: `S01E02` or `Season 1 · Episode 2`.
- Free order of the fields (including the year) with up/down buttons in the visual editor, separately for movies and series.
- Independent header-badge color: shared palette, Home Assistant theme, Plex/Jellyfin/Emby colors, or a custom color, with automatic contrast.
- Carousel no longer jumps when SSE updates state, bitrate, or metadata. Cards update in place without interrupting the container scroll.
- The displayed stream is kept if the list changes and that stream still exists. The scroll interval resets after manual navigation.
- New regression tests for order, visibility filters, the badge palette, and carousel stability.

## 0.1.5 — Alpha (2026-11-03)

- Fixed playback and remaining-time oscillation on the cards. Slightly late SSE positions no longer reset the clock every two seconds.
- Local monotonic clock for the 250ms animation, with a soft sync (200ms maximum per new sample) and no rewind during normal playback.
- Detects intentional seeks of several seconds and syncs to the new position immediately.
- Card rebuilds keep each session's clock. Pause freezes the counters, and resume starts them again.
- Regression tests with irregular SSE samples, pause/resume, and intentional seeks.

## 0.1.4 — Alpha (2026-11-03)

- Restored the native `ha-card` outer frame: background, border, radius, and shadow come from the Home Assistant theme. Inner panels keep a slightly contrasted background, or transparent if chosen.
- Header can be turned off entirely, the title can be customized, and statistics can be enabled separately: stream total, total bitrate, direct plays, paused, video-only / audio-only / both transcodes, total transcodes, and streams per server.
- Header statistics match the streams actually shown after filters, including single-user views.
- One color for progress, resolution/bitrate badges, and statistics: Home Assistant theme, Plex/Jellyfin/Emby color, or a custom hex color. White or black text is chosen for contrast.
- Posters stay vertically centered when the footer wraps onto several lines. A useless separator chip is no longer shown when codecs are missing.
- Visual editor grouped into collapsible categories.
- Migration of the older `show_counter`, `show_transcodes`, `progress_color_mode`, and `progress_custom_color` settings so existing dashboards are preserved.
- New tests for contrast, metrics, older configurations, card style, and editor grouping.

## 0.1.3 — Alpha (2026-11-03)

- Carousel horizontal scrollbar hidden permanently.
- Navigation buttons can be shown or hidden without disabling touch drag.
- Mouse drag and keyboard navigation. Mouse drag can be turned off.
- Two separate icons (video and audio): green for direct play, orange for transcode, gray when unknown. The older per-stream text transcode badges are gone.
- Paused playback: a pause symbol on the poster, and orange "Paused" in place of the remaining time, without dimming the whole card.
- Transparent card backgrounds, white information text, and a customizable font size (10 to 28px).
- Progress color: Home Assistant theme, server color, or a custom color (hex validated).
- An explicit height and size limits so native vertical resize works on Sections dashboards. The native grid takes priority over CSS height.
- Extra tests for colors, pause states, sizing, and navigation.

## 0.1.2 — Alpha (2026-11-03)

- Autoplay fix: streams advance in order and return to the first after the last, even with frequent SSE updates.
- Carousel position is kept when only media progress changes.
- Adjustable transition duration (100 to 3000ms).
- Five effects: slide, fade, zoom, 3D flip, and no animation.
- A setting to hide the carousel's horizontal scrollbar.
- Server-colored accent: Plex (yellow/orange), Jellyfin (purple), Emby (green).
- GitHub documentation was written in French at this point. It is in English from 0.1.17.
- New JavaScript tests for navigation, animation, colors, and display.

## 0.1.1 — Alpha (2026-11-03)

- Startup fix on recent Home Assistant versions (`LovelaceData.resource_mode` instead of `mode`).
- Compatibility with older versions is kept.
- Lovelace resource refresh and regression tests.

## 0.1.0 — Alpha (2026-11-03)

- First Home Assistant integration of the Tracearr public API v2.
- One SSE connection and a REST fallback sync.
- Sensors for active streams, separate transcodes, and server availability.
- Two Lovelace cards: grouped and individual; list, grid, and carousel.
- Visual editor, filters, progress, images, aliases, and avatars.

**Alpha note: full validation across several Home Assistant installations was still required at this point.**
