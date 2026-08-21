# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Design reference for the desktop application and the browser companion extension
  (`design/`), including the full ~250-flag catalog transcribed from yt-dlp's own
  documentation.
- yt-dlp pinned as a git submodule at `81ecd58b1394793e6da9998cc19fdb45657f1685`
  (version `2026.08.19`).
- Electron + Vite + React 19 + TypeScript application scaffold (`app/`).
- Project documentation: `README.md`, `AGENTS.md`, `ROADMAP.md`, `HANDOFF.md`, and the
  categorized feature documentation under `docs/`.
- GitHub Actions release workflow (`.github/workflows/release.yml`) that builds yt-dlp from
  the pinned submodule, packages a Squirrel.Windows installer, and publishes a GitHub Release
  on every push. The workflow runs no automated tests or lint checks; see
  [`AGENTS.md`](AGENTS.md) for why.

### Known gaps

- No automated test suite exists yet.
- No screenshots or captures of the running application exist yet.
- The large majority of the design reference's feature contract (language modes, ADHD modes,
  command palette, browser-style tabs, appearance editor, unlock ladder, local AI suite
  manager, and more) is not yet implemented — see [`ROADMAP.md`](ROADMAP.md).
