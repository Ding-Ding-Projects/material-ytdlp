# Design parity inventory

The checked-in design under [`design/`](../design/) is a **contract**, not an illustration. This
file is the hand-written, per-surface list of what that contract requires and what the built
application currently does. It is hand-written on purpose: a check that only inspects the surfaces
it can already find will happily report success on a surface that was never built at all.

**Reference:** `design/yt-dlp Studio.dc.html` plus `design/screenshots/*.png`.
**Built application:** `app/src/renderer/**`, captured from the packaged build.

Status values are deliberately blunt. `missing` means the surface does not exist. `partial` means
something is there but does not match the reference. `matches` means it does.

## Shell chrome

| # | Contract | Reference evidence | Status |
| --- | --- | --- | --- |
| 1 | Application mark in the header | `m3-rail.png` top-left | **partial** — renders a placeholder letter, not the real mark |
| 2 | Title with a version subtitle line (`2026.08.14 · ffmpeg 7.1 · aria2c 1.37`) | `m3-rail.png` | **missing** |
| 3 | Global search bar across flags, jobs, sites, config and history | `m3-rail.png`, `guided-studio.png` | **missing** |
| 4 | Regex-builder button anchored in that search bar (`.*`) | `m3-rail.png` | **missing** |
| 5 | Command-palette button in the header (`⌘`) | `m3-rail.png` | **missing** |
| 6 | Easy / Expert / Plain as a segmented control at top right | `guided-studio.png` | **partial** — exists as plain tabs in the content area, not as the header segmented control |
| 7 | Status bar: active count, transfer rate, queued, failed, active config, cookie source, extractor count | `m3-rail.png`, `picker.png` bottom | **partial** — shows a job count and the command only |
| 8 | Command bar (`CMD`) with the full command line and its own horizontal scrollbar | `m3-rail.png`, `picker.png` | **partial** — command is shown but does not scroll and has no `CMD` gutter |

## Navigation rail

| # | Contract | Reference evidence | Status |
| --- | --- | --- | --- |
| 9 | Dock indicator chip (`Docked left`) | `guided-studio.png` | **missing** |
| 10 | Primary `+ New` action | `m3-rail.png` | **missing** |
| 11 | Rail filter field with its own regex-builder button | `m3-rail.png` | **missing** |
| 12 | Destinations as a stacked icon-above-label column | `m3-rail.png` | **partial** — currently icon beside label |
| 13 | Rail scrolls when the destination list overflows | `m3-rail.png` shows a rail scrollbar | **missing** |
| 14 | Selected destination carries a filled indicator | `m3-rail.png` (`Download`) | **partial** |

## Browser-style tabs

| # | Contract | Reference evidence | Status |
| --- | --- | --- | --- |
| 15 | Tab strip of open surfaces above the content | `m3-rail.png`, `picker.png` | **missing** |
| 16 | Per-tab close control | all reference captures | **missing** |
| 17 | Pinned-tab indicator | `m3-rail.png` (`Download` carries a pin) | **missing** |
| 18 | Tab overflow when the strip runs out of width | `picker.png` shows a tab cut at the edge | **missing** |

## Content surfaces

| # | Contract | Reference evidence | Status |
| --- | --- | --- | --- |
| 19 | Update banner stating the version and that the artifact is unsigned | `m3-rail.png` | **missing** |
| 20 | Section header with a one-line description under the tab strip | `m3-rail.png` (`Download` + description) | **missing** |
| 21 | Card layout with a small-caps card title (`INTAKE`, `CONFIG FILES`, `SESSION`) | all reference captures | **missing** |
| 22 | Quick-action chips on a card (`-t mp3`, `-t aac`, `-t mp4`, `-t mkv`, `-t sleep`) | `m3-rail.png` | **missing** |
| 23 | Multi-URL intake textarea with a real count in the action (`Add 3 to queue`) | `m3-rail.png` | **missing** |
| 24 | Secondary intake actions: batch file, `--load-info-json`, browser sign-in | `m3-rail.png` | **missing** |
| 25 | Session panel with live `ACTIVE` and `QUEUED` figures | `m3-rail.png` | **missing** |
| 26 | Config-files surface listing the five standard locations | `guided-studio.png`, `picker.png` | **missing** |

## Anchored popovers

| # | Contract | Reference evidence | Status |
| --- | --- | --- | --- |
| 27 | Option picker anchored to its field, titled with the flag it edits | `picker.png` (`--cookies-from-browser`) | **missing** |
| 28 | That picker carries its own search field with a regex-builder button | `picker.png` | **missing** |
| 29 | Options as radio rows with a name and a plain-language description | `picker.png` | **missing** |
| 30 | Picker footer showing the current value with `Clear` and `Done` | `picker.png` | **missing** |
| 31 | Plain-language guide popover for a flag, with its own choice search | `guided-studio.png` (`Picture quality`) | **missing** |
| 32 | Guide choices as cards with a heading and an explanation | `guided-studio.png` | **missing** |
| 33 | Popovers clamp to the viewport and expand/close from their own header | `guided-studio.png` | **missing** |

## How this is verified

Reference and built application are captured under one identical tuple — same screen, same state,
same theme, same viewport, same scale — through an off-screen desktop, and the two are compared
side by side. Captures of the built application live in `docs/screenshots/`.

**Current honest state:** 8 of 33 rows are `partial`, 25 are `missing`, 0 are `matches`. The built
application is a working subset of the contract, not the contract.
