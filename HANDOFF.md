# Handoff

Current, factual state of this repository, written for whoever picks this up next.

## What genuinely exists right now

- **Design reference**, checked in under `design/`: `yt-dlp Studio.dc.html` (the desktop app —
  three modes, 20 rail destinations, every CLI option surfaced), `yt-dlp Companion
  (Chrome).dc.html` (the browser extension), `ytdlp-flags.js` (the ~250-flag catalog across 16
  groups), and `design/HANDOFF.md` (the wiring contract describing exactly which handlers the
  real app must implement to replace the design's mock handlers).
- **`vendor/yt-dlp`**, official yt-dlp pinned as a git submodule at commit
  `81ecd58b1394793e6da9998cc19fdb45657f1685` (version `2026.08.19`). In *this* worktree the
  submodule directory is intentionally empty — this worktree was deliberately created without
  submodule contents for lane isolation during parallel development. That is correct here and
  is not a defect to "fix" in this worktree.
- **`app/`**, an Electron + Vite + React 19 + TypeScript scaffold, under active development by
  another lane of this same effort.
- Root build scripts (`download-dependencies.bat`, `build-ytdlp.bat`, `build.bat`,
  `build-installer.bat`) are being written by another lane and are not authored in this
  document; see those scripts directly for their current state.

## Verification status — read this before trusting anything above

**This release pass deliberately shipped without an automated test suite and without any
screenshot or capture evidence, on the maintainer's explicit instruction, in order to ship
quickly.** Concretely:

- No unit, integration, or end-to-end tests have been written or run against `app/` as part of
  this pass.
- No screenshots or recordings of the built, running application exist. The images in
  `design/screenshots/` are design-tool exports of the reference mockup, not captures of the
  real running app, and are labeled that way wherever they are referenced.
- No installer has been built and run end-to-end as part of this documentation pass. The build
  scripts referenced above are the responsibility of a different lane; this document does not
  claim they have been executed successfully.
- The GitHub Actions release workflow (`.github/workflows/release.yml`) has not been run in
  this repository as of this handoff. Its correctness is asserted from careful reading, not
  from a green run.

Nowhere in this repository's documentation should "implemented" be read as "tested," and
nowhere should a description of intended behavior be read as a claim that the behavior has been
observed working.

## Open items for the next owner

- Wire the real Electron main-process ↔ yt-dlp process layer per `design/HANDOFF.md`'s
  "What the host has to provide" section: process control, progress parsing from
  `--progress-template`, console streaming, file pickers, cookie/login flow, config file I/O,
  authenticator credential storage, toy-lock credential storage, preferences persistence, and
  the Squirrel update feed.
- Everything listed as unticked in `ROADMAP.md` — the full universal feature contract (language
  modes, ADHD modes, command palette, tabs, appearance editor, unlock ladder, local AI suite
  manager, and the rest) is not yet implemented in `app/`.
- Build and run the app end to end at least once, then replace the "screenshots pending" note
  in `README.md` with real captures.
- Write and run the first tests, and update this file's verification status honestly once that
  happens — do not backfill a claim of testing into an earlier, untested commit's description.

## Submodule pin

- Repository: `yt-dlp/yt-dlp` (upstream)
- Commit: `81ecd58b1394793e6da9998cc19fdb45657f1685`
- Version tag: `2026.08.19`
