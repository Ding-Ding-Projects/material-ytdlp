# Smoke testing the built application

## Behavior

`scripts/smoke-test.mjs` launches the real packaged application — the exact `.exe` produced by
`build-installer.bat`, at `app/dist/win-unpacked/yt-dlp Studio.exe` — and drives it over the
Chrome DevTools Protocol to prove it actually starts and renders, rather than only that its
source compiled.

This project deliberately runs **no lint job, no type-check gate, and no test gate** in CI (see
`AGENTS.md` and the comments at the top of `.github/workflows/release.yml`) — those are opinions
about code style, and the checking that matters happens on the contributor's own machine before
pushing. This script is different in kind, and it is intentionally the one thing in the release
workflow that CAN and SHOULD fail the release: it answers whether the artifact about to be
handed to a user actually works. **An installer whose application will not launch is worse than
no release at all**, and letting a broken one publish quietly defeats the purpose of shipping
software in the first place.

The gap this closes is not hypothetical. Twice already this project shipped something that
looked entirely correct in source, passed every human read-through, and was dead on arrival at
runtime:

- A dynamically-linked `ffmpeg.exe` that only worked on the machine that had built it, because
  it depended on toolchain DLLs that do not exist on an ordinary user's PC.
- A dialog built on `window.prompt()`, which Electron's renderer process does not implement —
  the call silently does nothing, so the feature simply never worked, for anyone, from the day it
  shipped.

Neither defect is visible by reading code, and neither a linter nor a type checker has any way
to catch them — the code is syntactically and structurally fine in both cases. Only actually
running the built application catches this class of failure, which is what this script does.

### What it checks

1. **The packaged app exists** at `app/dist/win-unpacked/yt-dlp Studio.exe`. If not, it fails
   with the exact path and what should have produced it.
2. **The three bundled binaries** (`resources/bin/yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`)
   exist and actually run (`--version` / `-version`, must exit 0). This is the check that would
   have caught the dynamically-linked ffmpeg regression.
3. **The app launches** with `--remote-debugging-port=<port>` and a **fresh, disposable
   `--user-data-dir`** created under the OS temp directory — never a real user profile.
4. **A page target appears** over the Chrome DevTools Protocol (`GET /json/list`), within a
   bounded 60-second wait. If nothing appears, the script fails with the real reason rather than
   hanging.
5. Once connected over CDP (`Runtime.evaluate`, `Runtime.exceptionThrown`,
   `Network.requestWillBeSent`), it asserts:
   - `#dc-root` exists in the DOM and has at least one child element (proof the renderer
     mounted something, not just that the window opened).
   - `document.title` is exactly `"yt-dlp Studio"`.
   - The body text contains recognisable shell copy (`"Paste a link"`, `"Pick a quality"`,
     `"Download"`).
   - **Zero uncaught exceptions** fired during startup and initial render.
   - **Zero external network requests** were made — every request URL must be `file://`,
     `devtools://`, or `data:`. The app is meant to work fully offline; this assertion is what
     keeps that claim honest instead of aspirational.
   - **No known-fabricated data** appears on a fresh profile (for example, a certain
     well-known open-source animated short's title, which used to render as a fake queue row
     even with no downloads ever started). The app ships with no seeded data, so a fresh profile
     must show a genuinely empty state.
6. **Always tears down**, in a `finally` block: kills the process tree with
   `taskkill /pid <pid> /T /F` (killing only the parent process leaves Electron's child
   processes running) and deletes the temporary profile directory, even if an assertion above
   failed.
7. **Prints every assertion and a final PASS/FAIL summary**, and exits `0` on a clean pass or
   non-zero on any failure.

### Why a hand-rolled WebSocket client

Node's built-in `WebSocket` global was observed hanging indefinitely on Chromium's CDP
handshake in this environment — the TCP connection opens, the HTTP upgrade response arrives, and
no `open` event ever fires. `scripts/smoke-test.mjs` therefore speaks the RFC 6455 handshake and
frame format directly over a raw `net.Socket`, which was verified to connect and exchange CDP
messages reliably. If Node's `WebSocket` is later fixed here, the hand-rolled client can be
replaced, but it is the working path today.

### Why not `performance.getEntriesByType('resource')` for the network check

Chromium does not populate the Resource Timing API for `file://`-loaded documents, so that call
always returns an empty array for this app — regardless of whether an external request was
actually made. That emptiness looks exactly like proof of "no network activity" and is not. The
script instead subscribes to the CDP `Network.requestWillBeSent` event directly, which reports
every request the renderer actually issues.

## Configuration

No configuration is exposed. The script always targets
`app/dist/win-unpacked/yt-dlp Studio.exe` and picks the first free port from a small fixed
candidate list (`9333`–`9337`) so a leftover process from a previous run does not fail the whole
script outright.

Run it directly:

```
node scripts/smoke-test.mjs
```

## CI integration

`.github/workflows/release.yml` runs it as a dedicated **"Smoke test the built application"**
step, placed after **"Build installer"** and before **"Compute release tag"** — after there is a
packaged app to test, and before any release artifacts or tags are produced from a build that
has not been proven to actually run. It is **not** `continue-on-error`: a failed smoke test
stops the release exactly as a failed build does.

The workflow's `if: ${{ always() }}` artifact collector at the end still runs when the smoke test
fails, so the installer and its logs are preserved for inspection — which is exactly what is
needed to diagnose why a build did not pass.

## Failure modes

- **The packaged app path does not exist**: the build or packaging step did not run, or
  produced output somewhere else. The script names the exact expected path.
- **No CDP page target appears within 60 seconds**: the app crashed on startup, hung before
  creating a window, or the debugging port was blocked. The script reports the last
  `/json/list` response it saw.
- **A bundled binary is missing or fails `--version`/`-version`**: packaging did not actually
  copy the binary, or it was built in a way that does not run standalone on this machine (the
  dynamically-linked ffmpeg regression this test exists to catch).
- **An uncaught exception fires during startup**: a renderer-side bug that a syntax or type
  check cannot see, because the code is valid — it simply throws when actually executed.
- **An external network request is observed**: something in the renderer is reaching the
  network when it should be operating entirely on local, bundled resources.
- **A known-fabricated string is found on a fresh profile**: the app is seeding fake state
  instead of showing a genuinely empty one.

## Verification

Run `node scripts/smoke-test.mjs` against a locally built `app/dist/win-unpacked/` and read its
PASS/FAIL summary and exit code. To confirm the test can actually fail — a check nobody has
watched fail proves nothing — temporarily change one of its expected values (for example
`EXPECTED_TITLE`) to something wrong, confirm the run reports a failure and exits non-zero, then
restore the original value and confirm it passes again.
