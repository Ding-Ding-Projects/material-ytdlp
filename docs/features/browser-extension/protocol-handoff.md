# The `ytdlp-studio://` protocol handoff

## Behavior

`app/src/main/protocol.ts` is the desktop half of the handoff from the
[Companion extension](companion-extension.md): it registers yt-dlp Studio as the handler for a
custom `ytdlp-studio://` URL scheme, receives a link the extension sends, validates it, and
delivers it to the renderer.

**Why a custom protocol, and not the two more obvious routes:**

- **Native messaging** needs a host manifest listing the extension's ID in `allowed_origins`, and
  a *stable* ID for an *unpacked* extension requires pinning a `key` field in its
  `manifest.json` — which means generating and shipping an extension signing key pair. Code
  signing (browser-extension signing explicitly included) is permanently prohibited in this
  project, so native messaging was never an option.
- **A local HTTP server** inside the app would work, but means opening a listening port on the
  user's machine for a feature that does not need one.

A registered custom protocol needs neither: Chrome/Edge prompt once ("Open yt-dlp Studio?"),
remember the choice, and nothing here touches a key or a port.

**Registration.** `app.setAsDefaultProtocolClient('ytdlp-studio')` is called with no explicit
path — Electron resolves `process.execPath` itself — every time the app starts normally
(`initProtocolHandling()`, called from `index.ts` right after Squirrel lifecycle handling decides
this is an ordinary launch). Doing this on every launch, rather than only at install time, keeps
the registered path current across a Squirrel update, which moves the running executable into a
new `app-<version>` folder on every release.

**Single-instance delivery.** Windows starts a **brand new process** for a `ytdlp-studio://…`
click; it does not deliver an event into an already-running one. `index.ts` therefore calls
`app.requestSingleInstanceLock()` for an ordinary launch (never for a Squirrel lifecycle event,
where failing the lock must never skip shortcut creation/removal), and `protocol.ts` wires the
resulting `'second-instance'` event: the new process's `argv` is scanned for a `ytdlp-studio://`
entry, the existing window is focused and restored if minimized, and the link — once validated —
is delivered to it. Without the lock, clicking a link while the app is already open would just
open a second, useless copy of the app.

**Cold start.** If the very first launch of the app *is* the user clicking a link (no instance
running yet), the link arrives as this process's own `process.argv`, which
`initProtocolHandling()` also scans on startup. It is queued (`pendingIncomingUrl`) until
`attachProtocolBridge()` has a window whose page has actually finished loading, so it is never
silently dropped.

**Validation.** `parseIncomingProtocolUrl(raw)` treats the link as fully untrusted — it arrives
from whatever page the extension happened to be looking at, forwarded through the OS shell — and
accepts nothing by assumption:

1. Parse `raw` as a `URL`; reject if it doesn't parse.
2. Require `protocol === 'ytdlp-studio:'` and `hostname === 'download'`; reject anything else.
3. Read the `url` query parameter, parse *that* as a `URL` too, and require its protocol to be
   `http:` or `https:`. Reject everything else (including a second `ytdlp-studio://`, a
   `file://`, a `javascript:`, or a malformed value).

Only the fully-validated, decoded `http(s)` string ever leaves this function, and it stays a
plain string the whole way through — nothing here or downstream (`ytdlp.ts`'s spawn call, which
already builds an argv array) ever passes it through a shell.

**Delivery to the renderer, and why it needs its own preload.** The main preload script
(`app/src/preload/index.ts`) is owned by other work in this project and was out of this feature's
edit lane, so `protocol.ts` registers a **second, small, self-contained preload** at runtime via
Electron's session-level `session.defaultSession.registerPreloadScript()` API — not by editing
that file. Its source is a short, plain-CommonJS template string
(`BRIDGE_PRELOAD_SOURCE`) written to `<userData>/extension-bridge-preload.js` on every startup
(via the same `atomicWriteFile()` helper `store.ts` already uses, which retries the
Windows rename-onto-an-open-destination race) and exposes exactly one namespace,
`window.ytdlpStudioExtension`:

| Call | Purpose |
| --- | --- |
| `getInstallInfo()` | Returns `{ folderPath, exists }` for the real, on-disk extension folder — the guided-install dialog's "load this folder" text. |
| `openExtensionFolder()` | Opens that folder in the OS file manager (`shell.openPath`). |
| `onIncomingUrl(handler)` | Subscribes to incoming links; returns an unsubscribe function, mirroring the `subscribe()` pattern the main preload already uses for `jobs.onProgress` etc. |

electron-vite's `main`/`preload` build only bundles the two entry files declared in
`electron.vite.config.ts` — a sibling source file under `src/main/` that nothing statically
imports would never be copied into `out/` and would not exist on disk at runtime. Generating it
at startup and writing it into `userData` sidesteps that entirely, and behaves identically in
`electron-vite dev`/`preview` and in the packaged app.

**The guided-install dialog**, added by `scripts/wire-extension-install.mjs` to the generated
renderer, is reachable from the command palette (`Ctrl+Shift+F`, search "extension" or "Browser
extension"). It shows the three real install steps, the extension's real folder path (from
`getInstallInfo()`), an **Open folder** button, and a **Copy path** button. Chrome and Edge both
refuse to let an external app open `chrome://extensions` / `edge://extensions` for them, so those
addresses are offered as copy-to-clipboard text (reusing the app's existing
`toast('Copied', text)` → `navigator.clipboard.writeText(text)` idiom) rather than a button that
would silently do nothing.

**Receiving a link while the app is open.** `_wireExtensionUrlBridge()` (added to the generated
renderer's `_wireBridge()` alongside every other startup subscription) calls
`onIncomingUrl(url => …)`, which pre-fills Easy mode's URL field, switches to Easy mode, dismisses
any open dialog, runs the same `probeEasyUrl` the user's own typing already triggers, and shows a
toast confirming the link arrived. **It deliberately never auto-starts the download** — the user
still presses Download, exactly as if they had pasted the link themselves, so a link from the
browser is exactly as safe as one typed by hand.

## Configuration

Nothing here is user-configurable. Registration, validation, and delivery are unconditional; the
one real setting in this whole feature (the extension's "confirm before sending" toggle) lives on
the extension side — see [companion-extension.md](companion-extension.md).

## Failure modes

- **A malformed or unrecognized `ytdlp-studio://` link** (wrong host, missing `url` parameter, a
  decoded target that isn't `http(s)`) is logged (`console.error`, which reaches
  `app/logging/main.log` per the [local logging](../diagnostics/logging.md) feature) and
  discarded — never delivered to the renderer, never causes a crash.
- **The bridge preload fails to write or register** (disk full, permissions): caught and logged;
  the rest of the app still starts. The guided-install dialog and incoming-link handoff would be
  unavailable, but that must never take startup down with it.
- **The extension folder is missing from a build** (a packaging regression):
  `openExtensionFolder()` checks `existsSync()` first and returns an honest
  `{ ok: false, error: '…This build may not have bundled it.' }` rather than a generic OS error.
- **A link arrives with no window yet** (true cold start, page still loading): queued in
  `pendingIncomingUrl` and flushed on the window's `did-finish-load`, never dropped.
- **The single-instance lock is lost** (another instance is already running): this process quits
  immediately via `app.quit()`, and the *other* (already-running) instance's `'second-instance'`
  handler receives the new process's `argv` and handles the link instead.

## Security considerations

- **Every incoming link is attacker-influenced input and is treated that way.** It arrives from
  whatever page an extension happened to be looking at, forwarded through the OS shell to this
  process's `argv` — nothing about its shape, host, or query is trusted implicitly. Only the
  exact `ytdlp-studio://download?url=` shape this app defines is accepted; the decoded target is
  independently re-validated as a genuine `http:`/`https:` URL before it is used for anything.
- **Never passed through a shell.** The validated URL stays a plain JavaScript string end to end;
  `ytdlp.ts`'s process-spawning path already uses an argv array, not shell interpolation.
- **No new listening port, no new native-messaging host, no signing key** — see the "why a custom
  protocol" section above.
- **The second preload exposes exactly three calls**, none of which accept an arbitrary path from
  the renderer: `getInstallInfo()` and `openExtensionFolder()` both resolve the extension folder
  themselves (`resolveExtensionFolderPath()`), never from a caller-supplied argument, so a
  compromised renderer cannot use this bridge to open an arbitrary directory.
- **Single-instance-lock is requested only for an ordinary launch**, never during a Squirrel
  lifecycle event — losing the lock during `--squirrel-install`/`--squirrel-updated` must never
  skip shortcut creation or removal, which is exactly the bug `squirrel-startup.ts`'s own header
  comment describes at length.

## Verification status

**Typecheck-verified; not yet runtime-verified as a whole running app.** `cd app && npm run
typecheck` (`tsc --noEmit -p tsconfig.json`) passes cleanly with `protocol.ts` and the surgical
`index.ts` changes included. `scripts/build-renderer-from-design.mjs` was temporarily patched to
register `wireExtensionInstall`, run once to confirm every `replaceExact` assertion in
`wire-extension-install.mjs` matches exactly (it did, on the first run), and then reverted to be
byte-identical to how it was found (`git diff` on that file is empty) — the generated
`app/src/renderer/index.html` was regenerated back to its prior baseline afterward so no stray
build artifact was left behind reflecting an unregistered lane.

**Not yet verified:** the app itself has not been built and launched with the extension actually
sending it a link — that would require building the packaged (or `electron-vite dev`) app,
installing/loading the extension, registering the protocol handler with the OS, and watching a
real click reach Easy mode. That was outside this pass's scope (this project had an
`electron-builder` run already in flight, and this feature's own ownership lane explicitly
excluded running it). The extension side of the handoff *was* verified against a real Chrome —
see [companion-extension.md](companion-extension.md)'s verification section — which confirms the
link the app receives is built correctly; what remains unverified is everything from
`second-instance`/cold-start argv parsing onward inside a running instance of the app.
