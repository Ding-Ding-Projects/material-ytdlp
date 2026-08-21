# yt-dlp Studio

![status](https://img.shields.io/badge/status-in%20development-yellow)
![platform](https://img.shields.io/badge/platform-Windows-blue)
![license](https://img.shields.io/badge/license-Unlicense-lightgrey)
![build](https://img.shields.io/badge/build-Squirrel.Windows-informational)
![signed](https://img.shields.io/badge/code%20signing-none%20(intentional)-orange)

A Material Design 3 desktop application for [yt-dlp](https://github.com/yt-dlp/yt-dlp) on
Windows. yt-dlp Studio gives yt-dlp's enormous flag surface a guided, searchable interface —
Easy mode for a one-click download, Expert mode for every option grouped and explained, and
Plain mode for typing raw arguments — plus a queue, a live console with error-repair wizards,
and a companion browser extension.

**No separate installs.** The Windows installer bundles yt-dlp itself (built from the pinned
source in `vendor/yt-dlp`) together with pinned `ffmpeg`/`ffprobe` binaries. A user who installs
yt-dlp Studio does not need Python, yt-dlp, or ffmpeg on their machine.

- Documentation: see [`docs/`](docs/README.md) for the full feature index.
- Design reference: see [`design/`](design/) and [`design/HANDOFF.md`](design/HANDOFF.md).

## Quick start

```bat
:: builds a runnable app in the checkout
build.bat

:: builds the distributable Windows installer
build-installer.bat
```

Both scripts install every dependency they need themselves and support a silent `/s` mode for
unattended use. See [`docs/features/build-and-packaging/`](docs/features/build-and-packaging/README.md).

<details>
<summary><b>What it does</b></summary>

- **Easy mode** — paste a URL, pick quality and destination, download.
- **Expert mode** — every yt-dlp CLI option (~250 flags across 16 groups), searchable, with
  plain-language help for each one and a live command preview.
- **Plain mode** — a raw argument editor for people who already know the flags they want.
- **Queue** — batch downloads with per-item progress parsed from yt-dlp's
  `--progress-template` output, pause/resume, retry, and reordering.
- **Console** — live stdout/stderr with color-coded lines; errors surface a guided repair
  wizard matched against known yt-dlp failure patterns.
- **Companion extension** — a Chrome extension that hands the current page's video URL to the
  desktop app, with its own popup, injected page controls, and options page.

</details>

<details>
<summary><b>The bundled-binaries story</b></summary>

`vendor/yt-dlp` is the official yt-dlp source, pinned as a git submodule at a fixed commit and
version. The build compiles a Windows executable from that source with PyInstaller and bundles
it into the installer alongside pinned `ffmpeg.exe`/`ffprobe.exe` builds. Nothing is downloaded
at runtime and nothing needs to be pre-installed by the user. See
[`docs/features/build-and-packaging/bundled-binaries.md`](docs/features/build-and-packaging/bundled-binaries.md)
and
[`docs/features/build-and-packaging/building-yt-dlp-from-source.md`](docs/features/build-and-packaging/building-yt-dlp-from-source.md).

</details>

<details>
<summary><b>Architecture</b></summary>

- **App shell:** Electron + Vite + React 19 + TypeScript.
- **Process layer:** the Electron main process spawns the bundled `yt-dlp.exe` with an argv
  array built from the selected flags, and parses its `--progress-template` output into
  structured job state rather than scraping the human-readable progress bar.
- **Packaging:** Squirrel.Windows (`Setup.exe`, `RELEASES`, full `.nupkg`, delta packages).
  Code signing is permanently out of scope for this project; installers are unsigned and will
  trigger the Windows unknown-publisher warning. See
  [`docs/features/build-and-packaging/squirrel-packaging.md`](docs/features/build-and-packaging/squirrel-packaging.md).
- **Design reference:** the `design/` folder holds the checked-in Claude Design export that the
  interface is being wired against — see
  [`docs/features/design-reference/design-reference-parity.md`](docs/features/design-reference/design-reference-parity.md).

</details>

<details>
<summary><b>Project status (read this before assuming anything is finished)</b></summary>

This repository is under active development. The design reference, the yt-dlp submodule pin,
and the Electron/Vite/React scaffold are in place. The build scripts, the main-process
integration with yt-dlp, and the renderer wiring for the flag catalog, queue, and console are
in progress. A large list of features described in the design reference — language modes,
narrator, School mode, the command palette, browser-style tabs, the appearance editor, the
local-AI suite manager, and more — are **not yet implemented**. See
[`ROADMAP.md`](ROADMAP.md) for the authoritative checklist and
[`docs/completeness-inventory.md`](docs/completeness-inventory.md) for the per-feature status
table.

**This pass shipped without an automated test suite and without screenshot/capture evidence,**
on the maintainer's explicit instruction, in order to ship quickly. See
[`HANDOFF.md`](HANDOFF.md) for the exact, honest verification status of everything in this
repository. Nothing in this README, in `docs/`, or in release notes should be read as claiming
a test passed or a screenshot was taken unless it says so explicitly.

</details>

<details>
<summary><b>Screenshots</b></summary>

Screenshots of the built application are pending. Real captures from the running application
will be added here once a build exists to capture. Until then, see the design reference files
in [`design/`](design/) for the intended interface — those are design exports, not captures of
the running app, and are labeled as such.

</details>

<details>
<summary><b>Contributing, security, license</b></summary>

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md),
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and [`AGENTS.md`](AGENTS.md) (engineering rules for
contributors and agents working in this repository). Licensed under
[The Unlicense](LICENSE), matching yt-dlp's own license choice.

</details>
