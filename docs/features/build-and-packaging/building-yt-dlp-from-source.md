# Building yt-dlp from source

## Behavior

`vendor/yt-dlp` is the official yt-dlp repository, pinned as a git submodule at commit
`81ecd58b1394793e6da9998cc19fdb45657f1685` (version `2026.08.19`). Rather than depending on a
system-installed Python and yt-dlp package, the build compiles a standalone `yt-dlp.exe` from
that pinned source using PyInstaller, so the resulting binary has no runtime dependency on a
Python interpreter being present on the end user's machine.

## Configuration

The build is driven by `build-ytdlp.bat` at the repository root (owned by a different part of
this project, not by this documentation pass). It is expected to fetch a pinned Python
toolchain if one is not already available, install yt-dlp's own build dependencies, and invoke
PyInstaller against the pinned submodule checkout, producing `yt-dlp.exe`.

## Failure modes

- **Submodule not initialized**: a worktree without submodule contents (as this one is,
  deliberately, for lane isolation — see `HANDOFF.md`) cannot build yt-dlp. `build-ytdlp.bat`
  should detect and report this clearly rather than failing deep in the PyInstaller invocation.
- **Submodule pin drifts from a supported PyInstaller/Python combination**: yt-dlp's own build
  requirements can change between versions; bumping the pin should include checking yt-dlp's
  own build documentation for the pinned commit.
- **PyInstaller produces a binary flagged by antivirus software**: this is a known, common
  false-positive class for PyInstaller-built executables and is not something this project can
  fully control; it is not a code-signing issue and code signing remains out of scope regardless.

## Security considerations

- Building from a pinned commit (rather than tracking a branch) means the exact source that
  produced any given release is always reproducible and auditable.
- The pin should only be bumped deliberately, with the new commit's provenance checked against
  the official `yt-dlp/yt-dlp` repository.

## Verification status

**Not yet verified.** No build of `yt-dlp.exe` from this submodule pin has been performed and
confirmed working as part of this documentation pass. See [`HANDOFF.md`](../../../HANDOFF.md).
