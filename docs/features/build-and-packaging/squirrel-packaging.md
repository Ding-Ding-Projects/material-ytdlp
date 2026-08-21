# Squirrel.Windows packaging

## Behavior

yt-dlp Studio's Windows installer is built with Squirrel.Windows, producing a `Setup.exe`, a
`RELEASES` index file, the full `.nupkg` package, and (where available) delta packages for
efficient updates between versions. This is the project's chosen Windows installer path in
preference to NSIS, a portable build, or a ZIP-only distribution.

## Configuration

Packaging is driven by `build-installer.bat` at the repository root and the app's packaging
configuration under `app/`, both outside this document's ownership.

## Failure modes

- **Missing feed configuration**: an update feed URL that is unset or unreachable is a release
  blocker, not silently ignored.
- **Packaging schema rejects an unexpected configuration key**: `electron-builder`'s Squirrel
  target validates its configuration strictly; an unsupported or legacy key (for example, older
  NSIS-specific keys) will fail packaging outright rather than being ignored.

## Security considerations — read this before assuming the installer is signed

**This installer is unsigned, on purpose, permanently.** Code signing is out of scope for this
project under a standing policy documented in [`AGENTS.md`](../../../AGENTS.md): no signing
certificate is requested, stored, or invoked anywhere in the build or release pipeline.

Consequences a user should expect:

- **Windows SmartScreen and the "unknown publisher" warning will appear** when running
  `Setup.exe`. This is expected and does not indicate the installer is corrupted or malicious —
  it indicates it is unsigned, which is a deliberate project choice, not an oversight.
- **This project never claims signature verification anywhere** — not in release notes, not in
  in-app update copy, not in documentation. If you see such a claim anywhere for this project,
  it is wrong and should be corrected.
- Automatic updates (once implemented) will rely on HTTPS transport and package hash
  verification for integrity, but will not and cannot claim a code-signing-based authenticity
  guarantee.

## Verification status

**Not yet verified.** No Squirrel.Windows build has been produced and inspected as part of this
documentation pass to confirm the artifact set (`Setup.exe`, `RELEASES`, full `.nupkg`) is
actually produced and that each reports as unsigned as expected. See
[`HANDOFF.md`](../../../HANDOFF.md).
