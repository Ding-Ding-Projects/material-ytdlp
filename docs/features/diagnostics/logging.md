# Local logging

## Behavior

Before this feature, main-process code that hit a startup or lifecycle failure caught it into
`console.error` (see `history.ts`, `squirrel-startup.ts`, `ipc.ts`) — and in a packaged build
there is no console anyone is watching, so those lines went nowhere. On the renderer side, a
single error was observed throwing 476 times in one reload with nothing visible on screen and
nothing left behind afterward. This feature closes that gap: every source below writes to one
real, rotating text file on disk, so a user (or whoever is helping them) can find out what
happened after the app has already closed.

**Log file:** `<userData>/logs/main.log`, where `<userData>` is Electron's
`app.getPath('userData')` — on Windows this is normally
`%APPDATA%\yt-dlp Studio\logs\main.log` (the exact folder name under `%APPDATA%` follows
whatever the packaged app's display name resolves to). The bridge's `logging.getPath()` call
returns the exact resolved path at runtime rather than requiring anyone to guess it, and
`logging.openFolder()` opens that folder directly in the OS file manager (Explorer on Windows).

**Format:** one line per entry, `<ISO-8601 timestamp> [<LEVEL>] [<source>] <message>`, where
`<source>` is `main` or `renderer`. A `meta` object, when supplied, is appended as JSON after
the message on the same line. A captured `Error` is serialized explicitly (`err.stack ??
"${err.name}: ${err.message}"`) rather than passed through `JSON.stringify`, which yields `"{}"`
for a real `Error` and would otherwise produce a log line that tells you nothing.

**Rotation:** capped at 5 MiB per generation, two backup generations kept
(`main.log` → `main.log.1` → `main.log.2`, oldest dropped). Rotation is checked before each
write and is best-effort: if the rename itself fails (locked file, permissions), the current
file is kept and appended to rather than losing the entry that triggered the check.

**Failure sources captured, and where each is wired:**

| Source | Mechanism | Wired in |
| --- | --- | --- |
| Main process uncaught exception | `process.on('uncaughtException')` | `logging.ts` → `initLogging()` |
| Main process unhandled rejection | `process.on('unhandledRejection')` | `logging.ts` → `initLogging()` |
| Renderer process crashed/killed/OOM | `app.on('render-process-gone')` | `logging.ts` → `initLogging()` |
| A child process (GPU, utility, …) crashed/killed | `app.on('child-process-gone')` | `logging.ts` → `initLogging()` |
| Every `console.log`/`warn`/`error` call the page makes, **and** Chromium's own "Uncaught ..." text for an unhandled page exception | `webContents.on('console-message')` | `logging.ts` → `attachWebContentsLogging()`, called from `index.ts` right after each `BrowserWindow` is created |
| A preload script itself throwing | `webContents.on('preload-error')` | same as above |
| Renderer `window.onerror` | `window.addEventListener('error', ...)` in the preload script, forwarded via `ipcRenderer.send` | `preload/index.ts` |
| Renderer `window.onunhandledrejection` | `window.addEventListener('unhandledrejection', ...)` in the preload script, forwarded via `ipcRenderer.send` | `preload/index.ts` |
| Explicit application-code logging from the renderer | `window.ytdlpStudio.logging.write(level, message, meta?)` | `preload/index.ts` bridge → `logging.ts` → `handleRendererWrite()` |

**Why `console-message` rather than patching `window.console` from preload:** the console
capture is deliberately implemented from the *main process*, against the real `WebContents`
(`webContents.on('console-message', ...)`), not by monkey-patching `console.error`/`console.warn`
inside the preload script. Under `contextIsolation: true` (which this app uses — see
`createWindow()` in `index.ts`), the preload script's `window` is a *different object* from the
page's own `window`; overriding a property on the preload's copy would not touch the page's
console at all, and would be exactly the kind of change that looks like it forwards output but
silently captures nothing. `webContents.on('console-message', ...)` has no such problem — it is
Electron's own supported mechanism for observing a page's console output from the main process,
and it does not require the renderer's own code to cooperate. It is also why this one path alone
already accounts for most of what the 476-throws-per-reload bug would have produced: Chromium
routes an uncaught exception's own "Uncaught TypeError: ..." text through the same console
mechanism, so it shows up here even without any renderer code calling `console.error` explicitly.

The renderer-side `window.onerror`/`window.onunhandledrejection` listeners in the preload script
are a second, belt-and-suspenders layer on top of that, not a replacement for it. They use
native `window.addEventListener`, which — unlike a direct property assignment — does observe
events dispatched on the shared browsing-context `Window` even from an isolated preload world.
Because both mechanisms can fire for the same underlying uncaught exception, a single renderer
crash can produce more than one log line for it; that duplication is an accepted trade for not
depending on a single, unverified code path for something this feature exists specifically to
catch.

## Configuration

Nothing here is currently user-configurable — there is no settings surface, level filter, or
opt-out. It runs unconditionally from app startup.

## Failure modes

- **The `logs/` directory can't be created, or the log file can't be written** (permissions,
  disk full, a locked file on Windows): every write function is wrapped so this degrades to a
  silent no-op rather than throwing into the caller it exists to diagnose. `initLogging()`
  itself returns whatever paths it computed even when directory creation failed, so callers
  never receive `undefined`.
- **Rotation itself fails** (rename refused): the check falls through and keeps appending to the
  existing file, so a rotation failure loses no entries — it only means the file can grow past
  its 5 MiB target until the next successful rotation.
- **`initLogging()` is called more than once:** idempotent — the second call is a no-op and
  returns the already-established paths, so nothing double-registers the `process.on(...)` /
  `app.on(...)` listeners.
- **A call to the bridge arrives before `initLogging()` has run:** `getLogPath()` falls back to
  computing the expected path directly from `app.getPath('userData')` rather than returning an
  empty string; this should not be reachable in practice since `initLogging()` runs as the very
  first statement in `index.ts`, before Squirrel lifecycle handling and before IPC registration.

## Security considerations

- **Redaction is by field name, never by pattern-matching text.** `meta` objects passed to
  `logging.write(...)` (and internal `logMain(...)` calls) are walked recursively, and any key
  matching `password`, `token`, `cookie`(s), `secret`, `authorization`, `credential`(s),
  `apiKey`, `sessionId`, `privateKey`, `pin`, or a close variant (case- and separator-
  insensitive) has its *value* replaced with `"[redacted]"` before the object is serialized.
  This is a deliberate choice over scanning message text for anything secret-shaped: pattern
  matching a free-text string is guesswork, and it is exactly as likely to eat a legitimate URL
  as it is to catch a real secret.
- **URLs are logged, on purpose.** This app downloads user-supplied URLs; a log with every URL
  redacted would be useless for the exact failures it exists to help diagnose. A `url` field is
  never a redaction target.
- **Cookie *files*** (see `cookies.ts`) are validated by content but their contents are never
  passed through this logging feature; nothing here reads a cookies file.
- **Logs are plain, unencrypted text on local disk**, exactly like every other file this app
  writes under `userData`. They are not synced anywhere and this feature makes no network
  request. Because logs get pasted into GitHub issues, the redaction above exists specifically
  so a user copying `main.log` into a bug report does not also paste a live credential.

## Verification status

**Typecheck verified; not yet runtime-verified against this change.** `cd app && npm run
typecheck` passes cleanly (`tsc --noEmit -p tsconfig.json`, exit code 0) with this feature's
files included. No automated test exercises the rotation logic, the redaction walk, or the
IPC round trip yet, and no capture of the log file actually being written by a running,
packaged build exists as of this writing — the only built package available at the time this
was implemented (`app/dist-verify/win-unpacked/`) predates this change and was left untouched
per the task's file-ownership boundary, so it could only ever demonstrate the *absence* of this
feature, not its behavior. Building and running a fresh package to observe `main.log` actually
being written and rotated is the next verification step.
