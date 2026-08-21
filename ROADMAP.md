# Roadmap

A living checklist. Ticked items are genuinely done and verified working in the current tree;
unticked items are not — see [`docs/completeness-inventory.md`](docs/completeness-inventory.md)
for the per-feature evidence table and [`HANDOFF.md`](HANDOFF.md) for the current honest
verification status of everything in this repository.

## Phase 0 — Foundation

- [x] Design reference checked in (`design/yt-dlp Studio.dc.html`,
      `design/yt-dlp Companion (Chrome).dc.html`, `design/ytdlp-flags.js`, `design/HANDOFF.md`)
- [x] yt-dlp pinned as a git submodule (`vendor/yt-dlp`)
- [x] Electron + Vite + React 19 + TypeScript scaffold

## Phase 1 — Core build and process layer (in progress)

- [ ] `download-dependencies.bat` / `.sh`
- [ ] `build-ytdlp.bat` — builds `yt-dlp.exe` from the pinned submodule with PyInstaller
- [ ] `build.bat` — one-click dev build
- [ ] `build-installer.bat` — Squirrel.Windows installer build
- [ ] Main-process layer: spawn yt-dlp with argv arrays, parse `--progress-template` output
- [ ] Renderer shell wired to real IPC (currently design-only mock handlers)
- [ ] Flag catalog (Expert mode) wired to the ~250-flag catalog in `design/ytdlp-flags.js`
- [ ] Queue with real progress, pause/resume, retry
- [ ] Console with real stdout/stderr and error-repair wizards

## Phase 2 — Core desktop feature contract (not started)

- [ ] Language modes (English / Cantonese / bilingual) with persisted selection
- [ ] Both per-language funny-level sliders, wired to rendered copy
- [ ] Emoji-in-dialogs toggle
- [ ] School mode (shared, renameable, unlock-gated)
- [ ] ADHD modes (Focus, Low stimulation, Time awareness, One thing at a time, Momentum)
- [ ] Spoken narrator (TTS), off by default, with voice/rate/pitch selection
- [ ] Scheduled settings surface (language/theme/etc. on a schedule or external source)
- [ ] Command palette (`Ctrl+Shift+F`) with live inline controls and teleport-to-element
- [ ] Browser-style tabs with docking, overflow, reordering, pinning, groups, and the four
      tab-discovery searches
- [ ] Per-element appearance editor (Word-depth typography, infinite color picker + translator,
      named presets, export/import)
- [ ] Regex builder anchored to every search field, dropdown, and context menu
- [ ] Non-blocking notification center with history
- [ ] Two-key + slider destructive-action confirmation gate
- [ ] Local, Git-backed version history for user-owned records
- [ ] Changelog viewer (date filter, search, commit links, export)
- [ ] Export in every applicable format on every list/record
- [ ] Bulk actions on every list

## Phase 3 — Security and locks (not started)

- [ ] Unlock ladder (dim sum → sums → whack-a-mole → clock) for any lockout surface
- [ ] Per-element toy locks with independent password/OTP credentials
- [ ] Built-in TOTP authenticator with QR-code pairing
- [ ] Support Tickets recovery surface

## Phase 4 — Extended feature contract (not started)

- [ ] Universal local file converter
- [ ] Local Ollama suite manager
- [ ] Local version history manager (full UI: diff, restore, retention, export)
- [ ] Personal-vocabulary JSON upload
- [ ] App-mark / logo customization
- [ ] Browser companion extension (Chrome) — popup, injected page controls, options page, and
      its own full feature contract independent of the desktop app
- [ ] Documentation site (GitHub Pages) with the same tabbed/searchable/appearance-customizable
      contract as the app
- [ ] Automatic updates (Squirrel feed, unsigned-artifact disclosure)

## Phase 5 — Quality (not started)

- [ ] Automated test coverage (this release pass deliberately shipped without one)
- [ ] Screenshot/capture evidence from the real built application (this release pass
      deliberately shipped without one)
