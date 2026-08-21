# Building ffmpeg from source

## Behavior

`vendor/ffmpeg` is the official FFmpeg repository, pinned as a git submodule at commit
`a1d17fdd28ba9e53c2257e782fd509fbf4848254`. Exactly like yt-dlp, ffmpeg and ffprobe are **built
from that pinned source** rather than downloaded as prebuilt binaries — nothing in this project's
installer traces back to a third-party binary distributor. The build produces native Windows
`ffmpeg.exe` and `ffprobe.exe` and copies them into `vendor/bin/`, the same location the earlier
downloaded binaries used to occupy, so nothing downstream (packaging, the app's runtime binary
resolution) needs to change to consume them.

## Toolchain

Building ffmpeg from source on Windows means compiling with MinGW-w64 GCC rather than MSVC,
because ffmpeg's build system (`configure` plus `make`) is a Unix-shaped toolchain. This project
uses **MSYS2**, which provides both the POSIX shell environment `configure`/`make` expect and the
`mingw-w64-x86_64-*` package set that supplies the actual cross-compiler, assembler, and codec
libraries.

`download-dependencies.bat` bootstraps this: it checks for an existing MSYS2 install at
`C:\msys64` first (this is the default install location, and it is what GitHub's `windows-latest`
Actions runner image already ships — the release workflow reuses that copy rather than installing
a second one), installs MSYS2 via `winget install --id MSYS2.MSYS2` when none is found, and then
runs `pacman -S --needed` for the specific package list recorded in `vendor/dependencies.json`
under `msys2.mingwPackages`. `pacman -S --needed` is idempotent: packages already present are
skipped, so re-running the bootstrap costs nothing on a warm machine.

`build-ffmpeg.bat` then invokes `vendor/ffmpeg/configure`, `make`, and `make install` inside an
`MSYSTEM=MINGW64` MSYS2 shell, targeting `--target-os=mingw32 --arch=x86_64`, and copies the
resulting `ffmpeg.exe`/`ffprobe.exe` into `vendor/bin/`.

## Licensing: this is an LGPL build

ffmpeg's own `configure` gates functionality behind two flags, and which flags are passed
determines what obligations attach to distributing the resulting binary:

- **Default (this project's choice): LGPL.** No `--enable-gpl`, no `--enable-nonfree`.
- `--enable-gpl` allows linking against components `configure` classifies as GPL-only (see
  `EXTERNAL_LIBRARY_GPL_LIST` in `vendor/ffmpeg/configure`, which includes `libx264`, `libx265`,
  `libvidstab`, `frei0r`, and others) and re-licenses the *combined work* under the GPL, which
  carries source-availability obligations for anything linked against it.
- `--enable-nonfree` pulls in components whose licences are not free at all (`libfdk_aac` being
  the usual example, see `EXTERNAL_LIBRARY_NONFREE_LIST`) — a binary built with this flag **is
  not legally redistributable**, full stop.

**This project ships the ffmpeg binary inside a distributed installer, so it deliberately never
passes `--enable-nonfree`, and never enables any library in `configure`'s GPL/GPLv3/nonfree
lists.** `configure` enforces this itself: enabling a listed library without the matching
`--enable-gpl`/`--enable-version3`/`--enable-nonfree` flag makes `configure` `die` immediately
with a message of the form `<lib> is gpl and --enable-gpl is not specified.` — so a build that
would violate the LGPL claim simply cannot succeed; the two never silently diverge.

**Every `--enable-lib*` flag below was checked, by hand, against
`EXTERNAL_LIBRARY_GPL_LIST`/`EXTERNAL_LIBRARY_GPLV3_LIST`/`EXTERNAL_LIBRARY_VERSION3_LIST`/
`EXTERNAL_LIBRARY_NONFREE_LIST` in `vendor/ffmpeg/configure`, and against whether the
remux/merge/extract-audio/embed-metadata workload yt-dlp actually asks ffmpeg to perform needs
it.** `libx264` and `libvpx` were both dropped from an earlier draft of this build for exactly
that reason: `libx264` sits in `EXTERNAL_LIBRARY_GPL_LIST` (confirmed against the pinned
submodule commit), and yt-dlp never asks ffmpeg to *encode* H.264 or VP8/VP9 — it stream-copies
already-encoded video during a remux or merge, which needs no encoder library at all. Neither
earned its place, and both would have either broken the build (`libx264`, without
`--enable-gpl`) or added weight for a code path that is never exercised (`libvpx`).

**The corresponding-source obligation the LGPL imposes is already satisfied by this repository.**
The LGPL requires that anyone receiving the binary can obtain the exact source it was built from.
Because ffmpeg's source lives in this repository as a pinned public git submodule
(`vendor/ffmpeg`, commit recorded in `vendor/bin/ffmpeg.build.json`), that source is already
public, exact, and permanently associated with the binary that shipped — no separate source
distribution step is needed.

## Configure flags

`build-ffmpeg.bat` passes, verbatim:

```
--target-os=mingw32 --arch=x86_64 --disable-debug --disable-doc --disable-ffplay
--disable-shared --enable-static --pkg-config-flags=--static --extra-ldflags=-static
--disable-autodetect --enable-gnutls --enable-zlib --enable-libmp3lame --enable-libopus
--enable-libvorbis
```

The feature set is deliberately modest, matching what yt-dlp actually calls ffmpeg/ffprobe for
rather than ffmpeg's full default feature surface (which pulls in many more external libraries
and takes considerably longer to build):

- `--disable-doc`, `--disable-ffplay` — yt-dlp never invokes the documentation build or the
  interactive player; both are dropped to cut build time. `ffprobe` is **not** disabled — it is
  required (yt-dlp uses it to inspect downloaded/merged media).
- `--disable-autodetect` — avoids `configure` silently picking up whatever optional library
  happens to be on the build machine and producing a binary whose feature set depends on what
  else was installed. Every library actually needed is enabled explicitly below instead.
- `--enable-static` / `--disable-shared` — a single self-contained `ffmpeg.exe`/`ffprobe.exe`
  with no separate DLLs to bundle or resolve at runtime. Note that `--disable-shared`/
  `--enable-static` alone only controls how ffmpeg's *own* libraries (libavcodec,
  libavformat, etc.) are built; it does not force static linking of the external codec
  libraries below. MSYS2's mingw-w64 packages ship both `.a` (static) and `.dll.a`
  (import library for the shared `.dll`) for each of them, and the linker prefers the
  shared one unless told otherwise -- confirmed by running `objdump -p ffmpeg.exe | grep
  "DLL Name"` on an early build of this binary, which showed it depending on
  `libgnutls-30.dll`, `libmp3lame-0.dll`, `libopus-0.dll`, `libvorbis-0.dll`,
  `libvorbisenc-2.dll`, `libwinpthread-1.dll`, and `zlib1.dll` at runtime, and failing to
  start at all outside an MSYS2 shell with exit code `0xC0000135`
  (`STATUS_DLL_NOT_FOUND`) as a result.
- `--extra-ldflags=-static` -- the actual fix: passes `-static` to the linker, which makes
  it prefer each library's `.a` archive over its `.dll.a` import library, producing a
  genuinely self-contained executable with no MSYS2/mingw-w64 runtime DLLs to bundle or
  resolve.

Each explicitly enabled library, why it is there, and why it is LGPL-compatible:

| Flag | Why yt-dlp needs it | Licence check |
| --- | --- | --- |
| `--enable-gnutls` | TLS for ffmpeg's own network protocol handlers, used when ffmpeg itself fetches a stream over HTTPS (for example as yt-dlp's external downloader for some HLS/DASH cases) rather than remuxing an already-downloaded local file. | LGPL. Not in any of `configure`'s GPL/GPLv3/version3/nonfree lists. |
| `--enable-zlib` | Optional zlib-compressed content some containers use (for example embedded PNG thumbnails, some compressed subtitle atoms) that yt-dlp's embed-metadata/thumbnail postprocessors rely on ffmpeg to write. | zlib licence. Not GPL/nonfree-listed. |
| `--enable-libmp3lame` | Encoder for yt-dlp's `--extract-audio --audio-format mp3`, one of the most common postprocessing options. | LGPL. Not GPL/nonfree-listed. |
| `--enable-libopus` | Encoder for `--audio-format opus`. | BSD-style licence. Not GPL/nonfree-listed. |
| `--enable-libvorbis` | Encoder for `--audio-format vorbis`. | BSD-style/LGPL-compatible licence. Not GPL/nonfree-listed. |

Two libraries considered and **deliberately dropped**, because neither earns its place for a
remux-and-merge workload and one would have broken the build outright:

- **`libx264`** — an H.264 *encoder*. `configure` lists it in `EXTERNAL_LIBRARY_GPL_LIST`, so
  enabling it without `--enable-gpl` makes `configure` `die` immediately with `libx264 is gpl
  and --enable-gpl is not specified.` yt-dlp stream-copies already-encoded video during a remux
  or merge; it never asks ffmpeg to encode H.264. Enabling this flag would have both broken the
  build and, had `--enable-gpl` been added to work around it, silently turned the shipped binary
  GPL.
- **`libvpx`** — a VP8/VP9 *encoder* (ffmpeg decodes VP8/VP9 natively without it). Not
  GPL-listed, so it would have built, but it is dead weight: yt-dlp never asks ffmpeg to
  re-encode into VP8/VP9 either, and a smaller build that actually configures beats a fuller one
  that does not.

## Reproducibility and the build stamp

`build-ffmpeg.bat` is idempotent, exactly like `build-ytdlp.bat`: after a successful build it
writes `vendor/bin/ffmpeg.build.json` recording the submodule commit, the built version string
from `ffmpeg -version`, the SHA-256 of each binary, the exact configure flags used, and the
licence. On the next run, if the recorded `submoduleSha` still matches `vendor/ffmpeg`'s current
commit, the rebuild is skipped. Bumping the pinned submodule commit forces a rebuild.

## Build duration

Building ffmpeg from source is **slow** compared to building yt-dlp — expect it to take
significantly longer than the PyInstaller-based yt-dlp build, even with the deliberately modest
feature set above. `configure` alone probes a large number of optional features; `make -j` uses
all available cores, but ffmpeg's codebase is large. Budget real wall-clock time for this step in
CI and when running `build.bat` locally; it is not a quick step to add to a tight iteration loop.

## Failure modes

- **MSYS2 not found and winget unavailable**: `download-dependencies.bat` reports this exact
  blocker and stops rather than silently falling back to a downloaded binary.
- **A required mingw-w64 package fails to install**: `pacman` output is surfaced directly; the
  bootstrap does not continue with a partial toolchain.
- **`configure` fails** (a missing library, an incompatible MSYS2 package version): `build-ffmpeg.bat`
  reports the exact exit code and leaves the full `configure`/`make` output visible above the
  failure line, exactly as `build-ytdlp.bat` does for PyInstaller failures.
- **Submodule not initialized**: a checkout without submodule contents cannot build ffmpeg;
  `build-ffmpeg.bat` detects the missing `vendor/ffmpeg/configure` and reports it before
  attempting anything else.
- **Submodule pin drifts to a commit with new build requirements**: FFmpeg's own build
  requirements evolve; bumping the pin should include a fresh local build to confirm the
  configure flags above still apply, and updating this document if they do not.

## Security considerations

- Building from a pinned commit (rather than tracking a branch) makes the exact source that
  produced any given release reproducible and auditable — identical to the yt-dlp build.
- The pin should only be bumped deliberately, checked against the official `FFmpeg/FFmpeg`
  repository's own commit history and release notes.
- No `--enable-nonfree` component is ever built, so the binary is legally redistributable as
  shipped.

## Verification

After a successful build, `build-ffmpeg.bat` runs `ffmpeg.exe -version` and `ffprobe.exe -version`
and requires real output before recording success — a file existing on disk is not treated as
proof it runs. The printed version string and the SHA-256 of each binary are also written into
`vendor/bin/ffmpeg.build.json`, and the release workflow reads that file to publish the same
provenance in each GitHub Release's notes.

## Suggested articles

- [Building yt-dlp from source](building-yt-dlp-from-source.md)
- [Bundled binaries](bundled-binaries.md)
- [Squirrel packaging](squirrel-packaging.md)
