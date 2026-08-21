# Completeness inventory

A hand-written table, one row per canonical feature named in [`ROADMAP.md`](../ROADMAP.md).
This is hand-written deliberately: an auto-generated list can only report on features it
already knows to look for, and cannot detect a feature that is missing entirely. Every row
below was written by reading the roadmap and checking the current tree, not derived from a
script.

Legend: **Impl.** = implementation path · **Docs** = documentation article · **i18n** =
localized copy · **Tests** = automated tests · **Capture** = screenshot/capture evidence.

| Feature | Impl. | Docs | i18n | Tests | Capture |
|---|---|---|---|---|---|
| Design reference (Studio + Companion) | `design/` | [design-reference-parity.md](features/design-reference/design-reference-parity.md) | n/a (reference only) | none | none — reference is not the running app |
| yt-dlp submodule pin | `vendor/yt-dlp` | [building-yt-dlp-from-source.md](features/build-and-packaging/building-yt-dlp-from-source.md) | n/a | none | none |
| Electron/Vite/React scaffold | `app/` | — | n/a | none | none |
| Build scripts (`download-dependencies`, `build-ytdlp`, `build`, `build-installer`) | not implemented (owned by another lane) | [build-and-packaging/README.md](features/build-and-packaging/README.md) | n/a | none | none |
| Bundled yt-dlp/ffmpeg/ffprobe binaries | not implemented | [bundled-binaries.md](features/build-and-packaging/bundled-binaries.md) | n/a | none | none |
| Squirrel.Windows packaging | not implemented | [squirrel-packaging.md](features/build-and-packaging/squirrel-packaging.md) | n/a | none | none |
| Main-process ↔ yt-dlp process layer | not implemented | [progress-parsing.md](features/downloading/progress-parsing.md) | n/a | none | none |
| Queue with real progress | not implemented | [progress-parsing.md](features/downloading/progress-parsing.md) | not implemented | none | none |
| Console + error-repair wizards | not implemented | [progress-parsing.md](features/downloading/progress-parsing.md) | not implemented | none | none |
| Flag catalog (Expert mode) | not implemented | — | not implemented | none | none |
| Language modes (EN / Cantonese / bilingual) | not implemented | — | not implemented — this pass shipped without them | none — this pass shipped without them | none — this pass shipped without them |
| Funny-level sliders (both languages) | not implemented | — | not implemented | none — this pass shipped without them | none — this pass shipped without them |
| Emoji-in-dialogs toggle | not implemented | — | not implemented | none | none |
| School mode | not implemented | — | not implemented | none | none |
| ADHD modes | not implemented | — | not implemented | none | none |
| Spoken narrator (TTS) | not implemented | — | not implemented | none | none |
| Scheduled settings | not implemented | — | not implemented | none | none |
| Command palette (`Ctrl+Shift+F`) | not implemented | — | not implemented | none | none |
| Browser-style tabs + groups | not implemented | — | not implemented | none | none |
| Per-element appearance editor + infinite color picker | not implemented | [material-design-3-conformance.md](features/appearance/material-design-3-conformance.md) | not implemented | none | none |
| Regex builder on every search field | not implemented | — | not implemented | none | none |
| Notification center | not implemented | — | not implemented | none | none |
| Destructive-action two-key + slider gate | not implemented | — | not implemented | none | none |
| Local version history | not implemented | — | not implemented | none | none |
| Changelog viewer | not implemented | — | not implemented | none | none |
| Export in every format | not implemented | — | n/a | none | none |
| Bulk actions on every list | not implemented | — | n/a | none | none |
| Unlock ladder | not implemented | — | not implemented | none | none |
| Per-element toy locks | not implemented | — | not implemented | none | none |
| Built-in TOTP authenticator | not implemented | — | not implemented | none | none |
| Support Tickets | not implemented | — | not implemented | none | none |
| Universal file converter | not implemented | — | not implemented | none | none |
| Local Ollama suite manager | not implemented | — | not implemented | none | none |
| Local history manager (full UI) | not implemented | — | not implemented | none | none |
| Personal-vocabulary JSON upload | not implemented | — | n/a | none | none |
| App-mark / logo customization | not implemented | — | n/a | none | none |
| Browser companion extension | not implemented | — | not implemented | none | none |
| Documentation site (GitHub Pages) | not implemented | — | not implemented | none | none |
| Automatic updates | not implemented | [squirrel-packaging.md](features/build-and-packaging/squirrel-packaging.md) | not implemented | none | none |
| Automated test coverage | none — this pass shipped without it | [AGENTS.md](../AGENTS.md) | n/a | n/a | n/a |
| Screenshot/capture evidence | none — this pass shipped without it | [README.md](../README.md) | n/a | n/a | n/a |

**Every "none" and "not implemented" above is an honest current-state report, not a placeholder
to be filled in mechanically.** Update this table in the same commit that changes any of these
facts.
