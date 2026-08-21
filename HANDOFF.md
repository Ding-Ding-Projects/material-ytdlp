# Handoff

The current, factual state of this repository, written for whoever picks it up next. Everything
below was verified by running it unless the line says otherwise.

## What genuinely works, and how it was checked

### Both bundled binaries are built from pinned source

Nothing shipped is a downloaded binary of unknown provenance.

| | Value | How it was checked |
| --- | --- | --- |
| yt-dlp | `2026.08.19` from submodule `81ecd58b` | ran `yt-dlp.exe --version` |
| ffmpeg / ffprobe | `8.0.git` from submodule `a1d17fdd`, LGPL | ran `-version` on both |
| ffmpeg SHA-256 | `8bed4b8ed56dce2be23a1c1dbdd7ff28262f9e6e6dc8f2588a8eef4cfd3e06cd` | read off the file |
| ffprobe SHA-256 | `8ebf0b3bc2ed122b0dc7a25591a579e637a3d91c93aee561ecc41a27fd515f67` | read off the file |

**Self-containment is proved, not assumed.** `objdump -p` on both ffmpeg binaries reports only
Windows system DLLs — ADVAPI32, AVICAP32, CRYPT32, GDI32, KERNEL32, OLEAUT32, SHELL32, SHLWAPI,
USER32, WS2_32, msvcrt, ncrypt, ole32 — and no mingw runtime or codec DLL. That check now lives
inside `build-ffmpeg.bat` as a hard failure.

**End-to-end proof:** a download of separate video and audio streams was merged into a playable
14.7 MB `.mkv` by these binaries. Not a claim; an observation.

### The installer builds

`app/dist/squirrel-windows/` produces `Setup.exe`, `RELEASES` and a full `.nupkg`. The setup
executable reports `NotSigned`, which is intended and permanent. All three binaries are genuinely
present inside the package at `resources/bin/`, confirmed by listing the unpacked directory rather
than by trusting the packaging log.

### The site is live

<https://ding-ding-projects.github.io/material-ytdlp/> — self-contained, no CDN, verified working
at a 375px viewport with zero off-screen controls.

## What is in flight

**The renderer is being replaced.** The hand-written React renderer implemented roughly a third of
the design contract — `docs/design-parity.md` measures it at 8 partial and 25 missing of 33 rows.
It is being replaced by the checked-in design component itself, which carries its own runtime and
renders as-is inside Chromium. This was proven before it was started: React 18.3.1 loads from local
files, `#dc-root` renders the full shell, and there are zero external requests. `design/` remains
byte-identical and is generated from, never edited.

Once that lands, the old React components under `app/src/renderer/` are dead code and must be
deleted rather than left looking live.

## What is NOT true

Read this section before believing anything else.

- **No release has been published.** Nothing has shipped.
- **There are no automated tests.** None. This was a deliberate instruction in order to ship
  quickly, and it is stated here rather than implied away. The repository's CI builds and
  publishes; it gates on nothing.
- **The screenshots in `docs/screenshots/` are of the superseded React renderer**, captured from a
  real build at that time. They do not show the design-component renderer and must be recaptured
  once it lands.
- **Most of the feature contract is unbuilt** — language modes, playfulness sliders, narrator,
  School mode, ADHD modes, command palette, appearance editors, file converter, model suite, toy
  locks, the companion extension, automatic updates. `README.md` lists them under a heading that
  says plainly they do not ship, and `ROADMAP.md` leaves them unticked.
- **The Windows pause is not a suspend.** There is no `SIGSTOP` on Windows, so the process layer
  reports `pauseMode: 'stop-continue'` and resumes with `--continue`.

## Traps this repository has already fallen into

Worth reading before changing the build, because each of these cost real time and none of them
announced itself.

- **A built ffmpeg that runs here and dies everywhere else.** The first from-source build linked the
  toolchain's own DLLs. Packaging succeeded and the installer got smaller. Only `objdump` caught it.
- **`signAndEditExecutable: false` strips the icon.** It skips code signing *and* resource editing,
  so the executable ships unbranded while the build reports success. `signExecutable: false` is the
  key that skips only signing.
- **electron-builder fails a build it already finished.** With no publish target configured it hunts
  for one in `.git/config` at the end of a successful run and reports `Cannot cleanup`. Setting
  `publish: null` stops it looking.
- **`cmd` will not search the current directory on the CI runner.** `NoDefaultCurrentDirectoryInExePath`
  makes a bare `foo.bat` fail with "is not recognized" even when the file is right there. Invoke
  batch files through an explicit path.
- **Two batch traps found only by running the scripts:** a chained `if A if B (…) else (…)` binds the
  `else` to the inner `if`, and `exit /b` inside a `call`ed subroutine returns only from the
  subroutine — so a failing run printed `FAILED` and then announced success on the next line.
- **`libx264` is GPL-only.** ffmpeg's `configure` refuses it without `--enable-gpl`, which would
  change the licence of everything in the installer. It was dropped.
- **yt-dlp's progress percentage is per-fragment.** On a 123-fragment download it reaches 100% and
  resets 123 times. Progress must be aggregated over `fragment_index`/`fragment_count` and clamped.
  `size` and `eta` are legitimately `null` on fragmented downloads.

## Vendored dependencies track upstream

Both submodules follow `master`, and committed hooks in `.githooks/` advance them on every pull and
checkout. yt-dlp breaks whenever a site changes and is fixed upstream within days, so a frozen pin
is a downloader that quietly stops working.

The cost, stated plainly: two checkouts of the same commit of this repository can build different
binaries. Every build writes a stamp (`vendor/bin/*.build.json`) recording the exact submodule
commit it used, so an artifact stays traceable even though the pin moves.

Run `node scripts/enable-hooks.mjs` once in a fresh clone; the build scripts call it too.

## Next actions, in order

1. Finish the design-component renderer and delete the superseded React components.
2. Recapture `docs/screenshots/` from the new renderer and refresh the README gallery.
3. Update `docs/design-parity.md` — the drop-in should move most rows to `matches`.
4. Publish the first release once CI is green.
5. Start on the feature contract in `ROADMAP.md`, and add tests.
