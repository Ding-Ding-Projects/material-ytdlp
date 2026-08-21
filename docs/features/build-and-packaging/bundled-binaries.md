# Bundled binaries

## Behavior

yt-dlp Studio's installer bundles everything the app needs to run yt-dlp downloads: a
`yt-dlp.exe` built from the pinned submodule source (see
[building-yt-dlp-from-source.md](building-yt-dlp-from-source.md)), plus pinned `ffmpeg.exe` and
`ffprobe.exe` binaries used for merging separate audio/video streams and format conversion. None
of these are downloaded at first run and none require the user to have Python, yt-dlp, or
ffmpeg already installed.

## Configuration

The exact bundling mechanism (packaging these binaries as Electron extra resources vs. an
installer-side copy step) is owned by the build scripts (`download-dependencies.bat`,
`build-ytdlp.bat`, `build-installer.bat`) and the app's packaging configuration, both outside
this document's ownership. This article will be updated with the exact resource paths once
those scripts are finalized.

## Failure modes

- **A bundled binary is present in the installer but the app cannot find it at runtime**: this
  is a known failure class in Electron apps that bundle native binaries — the packaging step
  can succeed while the resource path resolution at runtime is wrong, silently. The app must
  resolve binary paths from the packaged resources directory and report every location it
  searched if none is found, rather than only showing a not-found message with no detail. This
  has not yet been implemented or verified.
- **A pinned ffmpeg/ffprobe version has a known CVE**: the pin should be bumped promptly; this
  is a manual process at present.

## Security considerations

- All three binaries are bundled from builds this project controls (yt-dlp built from the
  pinned submodule; ffmpeg/ffprobe from pinned, verified upstream releases), never fetched at
  runtime from an unauthenticated source.
- Code signing is permanently out of scope for this project (see [`AGENTS.md`](../../../AGENTS.md)).
  None of these bundled binaries are signed, and neither is the installer that carries them.

## Verification status

**Not yet verified.** No build has been run end to end and inspected as of this writing to
confirm the bundled binaries are present in the packaged installer and resolvable by the running
app. See [`HANDOFF.md`](../../../HANDOFF.md).
