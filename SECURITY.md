# Security Policy

## Reporting a vulnerability

Please open a GitHub issue describing the problem, or use GitHub's private vulnerability
reporting feature for this repository if you believe the issue should not be public
immediately. Include reproduction steps, the affected version/commit, and your assessment of
impact where possible.

## Scope

- The application itself (`app/`), the code that builds and bundles yt-dlp/ffmpeg/ffprobe, and
  the release pipeline are in scope.
- Vulnerabilities in upstream `yt-dlp` (the pinned submodule under `vendor/yt-dlp`) should be
  reported to the [upstream yt-dlp project](https://github.com/yt-dlp/yt-dlp) directly; this
  project will pick up the fix by bumping its pin once one is available.

## A note on unsigned installers

Releases are **intentionally unsigned** — this is a deliberate, permanent project policy, not
a security gap awaiting a fix. See [`AGENTS.md`](AGENTS.md) and
[`docs/features/build-and-packaging/squirrel-packaging.md`](docs/features/build-and-packaging/squirrel-packaging.md)
for why. Please do not file "the installer is unsigned" as a vulnerability report; it is
expected behavior. If you believe a *specific* release artifact was tampered with or does not
match the source it claims to come from, that is worth reporting.
