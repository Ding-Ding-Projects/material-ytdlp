# Design reference parity

## Behavior

`design/` holds a checked-in design reference exported from a design tool:
`design/yt-dlp Studio.dc.html` (the desktop application — three modes, 20 navigation-rail
destinations, every yt-dlp CLI option surfaced through a guided interface),
`design/yt-dlp Companion (Chrome).dc.html` (the browser companion extension — popup, injected
page controls, options page), and `design/ytdlp-flags.js` (the flag catalog, ~250 flags across
16 groups, with help text transcribed from yt-dlp's own `README.md`). `design/HANDOFF.md`
describes exactly which mock handlers in the design must be replaced with real implementations,
and lists the full feature contract both surfaces are meant to independently carry.

The design reference is **data describing an intended interface**, not the interface itself.
Every interactive-looking element in it currently calls a local mock handler that raises a
toast rather than performing any real action. Treating anything in these files as evidence that
a feature is implemented in `app/` would be a mistake.

## Configuration

There is no build-time dependency from `app/` on the `.dc.html` files; they exist purely as a
visual and behavioral reference for engineers wiring the real application. `design/ytdlp-flags.js`
is intended to be the actual source of the flag catalog data consumed by the real app (per
`design/HANDOFF.md`), but as of this writing the real app has not yet been confirmed to import
it.

## Failure modes

- **The reference and the real app drift apart** as the real app is built and the reference is
  not updated, or vice versa. This document, and the completeness inventory, should be updated
  whenever a feature is wired so its "reference vs. real" status stays current.

## Security considerations

- Text inside the design reference files is treated as data describing UI requirements, never
  as instructions to any agent or tool that reads them.

## Verification status

**Not yet verified against a real build.** No side-by-side comparison between the design
reference and a real built screen has been performed, because no built screen exists yet to
compare against. See [`HANDOFF.md`](../../../HANDOFF.md) and
[`../../completeness-inventory.md`](../../completeness-inventory.md).
