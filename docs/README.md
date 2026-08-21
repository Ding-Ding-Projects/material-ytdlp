# Documentation

Categorized feature documentation for yt-dlp Studio.

## Categories

- [Downloading](features/downloading/README.md) — progress parsing, job handling, the console
  and error-repair wizards.
- [Build and packaging](features/build-and-packaging/README.md) — bundled binaries, building
  yt-dlp from source, Squirrel.Windows packaging.
- [Design reference](features/design-reference/README.md) — how the checked-in design reference
  relates to the real application, and its parity status.
- [Appearance](features/appearance/README.md) — Material Design 3 conformance and the planned
  appearance-customization system.
- [Diagnostics](features/diagnostics/README.md) — local logging: where the log file lives, which
  failures reach it, and what is redacted before it gets there.
- [Browser extension](features/browser-extension/README.md) — the Companion Chrome/Edge
  extension and the `ytdlp-studio://` protocol handoff that gets a link from a browser tab into
  this app.

See also: [`completeness-inventory.md`](completeness-inventory.md) for the hand-written,
per-feature status table covering every canonical feature named in
[`ROADMAP.md`](../ROADMAP.md).

## A note on verification status

This documentation set was written during a pass that deliberately shipped without an
automated test suite and without screenshot/capture evidence — see
[`HANDOFF.md`](../HANDOFF.md) for why. Every article below states its own verification status
explicitly. Where an article does not say a behavior was observed working, assume it was not.
