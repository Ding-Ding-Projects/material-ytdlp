# Opening a downloaded file, and the studio popover fix

## Behavior

Every Library row (`isLibrary` / "Completed media") now carries two real, always-visible controls
next to its title/uploader/size/ext/archive columns, in addition to its existing right-click menu:

- **Open file** (`open_in_new` glyph) — opens the row's recorded output file with the operating
  system's default application for that file type, via Electron's `shell.openPath`.
- **Show in Explorer** (`folder_open` glyph) — reveals the file in the OS file manager, already
  wired before this feature (`fileOps.revealPath`); it is now also a real row button rather than
  only a context-menu entry.

Both buttons render **disabled**, with a title of `"No output path recorded for this download yet"`,
on any row whose `JobHistoryEntry.outputPath` is `null` (the job never got far enough for yt-dlp to
report a final path, or the entry predates this app tracking it). A disabled control never claims
to be able to do something it cannot.

The context menu's **"Play file"** entry, previously an honest toast stub
(`this.toast('Player', r[0])`), now calls the exact same real `open` handler as the new button —
so the menu and the button can never disagree about what "Play file" / "Open file" actually does.

## The backend route

- `app/src/shared/fileops-contract.ts` — `FileOpsIpcChannel.OpenPath`, `OpenPathRequest`
  (`{ path: string }`), `OpenPathResult` (`{ ok: boolean; error: string | null }`), mirroring the
  existing `RevealPath` pair's shape exactly.
- `app/src/main/fileops.ts` — `openPath(req)`. Electron's `shell.openPath` **returns an error
  string on failure rather than throwing** — that return value is always checked; an empty string
  means success, anything else is reported back verbatim rather than assumed to have worked.
- `app/src/main/ipc.ts` — registers `ipcMain.handle(FileOpsIpcChannel.OpenPath, ...)` beside the
  existing `RevealPath` handler.
- `app/src/preload/index.ts` — exposes `window.ytdlpStudio.fileOps.openPath(req)` using the same
  `invokeWithDeadline` idiom (and `MEDIUM` timeout) as `revealPath`/`openInEditor`.
- `scripts/wire-open-file.mjs` — the renderer-generation lane. Adds the row's 6th grid column with
  the two buttons (matching the exact visual idiom the Downloads queue row already uses for its own
  per-row icon buttons: 32×32, 9px radius, `#303636` background, `#82d5cc` icon color, Material
  Symbols glyph), and rewires `libraryRows`' data/handlers to real `open`/`reveal` functions plus a
  `hasPath` flag.

## Security: known-roots refusal

`openPath` refuses to open a path outside this app's own known download locations, so the renderer
can never hand the bridge an arbitrary filesystem path and have it opened. "Known roots" is
computed per call as the union of:

1. The **current** configured download folder (`Store.getLastPaths().downloadFolder` —
   `app/src/main/store.ts`; defaults to `<Downloads>/yt-dlp Studio`).
2. The directory of every `outputPath` recorded in `Store.getJobHistory()` — files this app has
   genuinely downloaded before, even if the download folder setting has since changed.

A path resolving outside every one of those directories is refused with an honest message
(`"<path>" is outside this app's known download folders and was not opened.`) **before** the
filesystem is even touched — deliberately checked ahead of the existence check, so this app never
uses file existence as an oracle for an arbitrary path outside its own domain.

## Honest failure states

- **Empty/missing path** → `"No path was given."`
- **Outside known roots** → the refusal message above.
- **Path no longer exists** → `"Nothing exists at "<path>" anymore."` (checked only after the
  known-roots gate passes).
- **`shell.openPath` itself fails** (no registered handler for the file type, OS-level failure,
  etc.) → the exact string `shell.openPath` returned.

Every one of these renders as a real toast via the row's `open`/`reveal` handlers
(`this.toast('Could not open', ...)`), never a silent no-op.

## Verification

Verified against a fresh `electron-vite build` output (`app/out`), launched directly with a
`--remote-debugging-port` and driven over CDP (the same technique as `scripts/probe-progress.mjs`
and `scripts/drive-app.mjs`) — not the stale packaged `app/dist-verify/win-unpacked` build, and
`electron-builder` was never invoked.

- Seeded `state.jobHistory` with two rows (one with a real, non-existent `outputPath`; one with
  `outputPath: null`) and confirmed via `logic.renderVals()` that `hasPath`, `actionColor`,
  `openTitle`, `open`, and `reveal` compute correctly for both.
- Confirmed via the real DOM: the no-path row's two buttons render `disabled: true`; the
  with-path row's buttons render `disabled: false` with the correct `open_in_new` glyph text.
- Clicked the real, enabled "Open file" button for a path that is **not** under the app's actual
  (real, IPC-backed — not the seeded renderer state) known download folder or job history. Got
  back the exact honest refusal: `"C:/nonexistent/probe-output.mp4" is outside this app's known
  download folders and was not opened.`
- Created a real file inside the app's actual default download folder
  (`<Downloads>/yt-dlp Studio/probe-open-file-test.txt`) and called `fileOps.openPath` on it
  directly through the live bridge: got back `{"ok":true,"error":null}` — the positive path
  (Notepad opening the file) genuinely works, not only the refusal path. Cleaned up afterward
  (deleted the probe file, killed the spawned `notepad.exe`).
- `cd app && npm run typecheck` — exit 0.

## What was NOT changed

"Open .info.json", "Re-download with current options", "Re-run post-processing only", and "Remove
archive id" remain the design's original honest toast stubs — wiring those up is separate work.
"Delete file from disk" remains an honest `"Not implemented"` toast; there is still no main-process
capability to delete an arbitrary file.

---

# The studio popover ("dialogs not popping up")

## The report

Pressing the small open-in-new arrow buttons on option rows — "Picture quality", "File type",
"File names" — appeared to do nothing. No dialog appeared, and the renderer logged no error.

## What looked correct, and was

The full chain from click to state was already correct and remains untouched:

- The button's `onClick` is bound to `{{ flag.gotoSurface }}`.
- `gotoSurface` calls `this.openStudio(e, f.f, val, ...)` when the flag has a guide.
- `openStudio` computes `left`/`top` from the button's own `getBoundingClientRect()` and calls
  `this.setState({ studio: { flag, value, initial, apply, x, y }, ... })`.
- The popover markup is gated by `<sc-if value="{{ hasStudio }}">`, and `hasStudio: !!s.studio`.

Driving the packaged app over CDP (`SMOKE_APP_DIR=... node scripts/drive-app.mjs`-style harness,
adapted from `scripts/probe-progress.mjs`'s CDP-attach approach) confirmed every step of this:
calling `logic.openStudio(fakeEvent, '--handler-test-flag', 'val', () => {})` with a synthetic
event carrying a real `currentTarget.getBoundingClientRect` correctly set `state.studio`, and
`logic.renderVals().hasStudio` correctly computed `true` immediately afterward. No console error,
no exception, no `.sc-has-error` render-error boundary anywhere in the DOM.

And yet: zero elements with an inline `position:fixed` style existed anywhere in the document, and
the popover's own text never appeared in `document.body.textContent`. The render was being asked
to happen, and never happened, and nothing said why.

## The actual defect

Walking the generated HTML's `<sc-if>`/`</sc-if>` nesting by hand (matching every open against its
close, tracking depth) found the cause: at the point the studio popover's own `<sc-if>` opens, the
nesting depth was **2**, not 0 — the popover, and everything else physically below it in the
document (including the toy-lock wizard), was an unintended descendant of an *earlier*,
still-open, currently-**false** `<sc-if value="{{ hasWizard }}">`.

The generated HTML contained this doubled opening tag, with no closing tag between the two copies:

```html
<sc-if value="{{ hasWizard }}" hint-placeholder-val="{{ false }}">  <sc-if value="{{ hasWizard }}" hint-placeholder-val="{{ false }}">
```

Browsers do not auto-close an unrecognized custom element like `<sc-if>`, so this is a genuine
extra, unclosed level of nesting — not a cosmetic duplicate. `hasWizard` computes `true` only while
the auto-fix wizard dialog is open; the rest of the time (always, for this reproduction) it gates
its entire subtree closed. `hasStudio` computed `true` correctly the whole time — the DOM node tree
it would render into was simply a child of a currently-closed ancestor.

### Root cause

`wireSchoolDialog()` in `scripts/wire-tools-modes.mjs` (not owned by this lane) anchors on the
literal opening tag of the (unrelated) auto-fix-wizard block:

```js
const ANCHOR = '  <sc-if value="{{ hasWizard }}" hint-placeholder-val="{{ false }}">'
const DIALOG = /* School mode enable/disable dialogs */ ... + '\n' + ANCHOR
return replaceExact(html, ANCHOR, DIALOG + ANCHOR)
```

`DIALOG` already ends with `+ ANCHOR` (the same idiom `wireTicketsDialogMarkup` in
`scripts/wire-settings-actions.mjs` uses *correctly* — inserting new dialog markup immediately
before the wizard block, then restoring the anchor once). But `wireSchoolDialog`'s own `return`
statement **also** appends `+ ANCHOR`, doubling it. Because `wireSettingsActions` runs before
`wireToolsModes` in the pipeline (`scripts/build-renderer-from-design.mjs`), the anchor is still
present exactly once when `wireSchoolDialog` runs, so its own `replaceExact` assertion (expects
exactly one match) passes — the bug is entirely in the *replacement text*, not the match.

## The fix

This lane does not own `wire-tools-modes.mjs`, so the fix runs after it instead:
`scripts/wire-dialog-fix.mjs` (registered to run immediately after `wireToolsModes` in
`scripts/build-renderer-from-design.mjs`) collapses the doubled anchor back down to one occurrence,
via the same asserted-`replaceExact` discipline every other wire module uses — if a future change
to `wire-tools-modes.mjs` fixes the root cause directly, this needle stops matching and the build
fails loudly instead of silently doing nothing.

## Verification

- Registered `wireDialogFix` (and `wireOpenFile`) in `scripts/build-renderer-from-design.mjs`,
  ran the generator (`node scripts/build-renderer-from-design.mjs`) — exit 0 — and confirmed
  `grep -c "hasWizard" app/src/renderer/index.html` dropped from 2 (one line holding the doubled
  tag, one holding the `renderVals` field) down to the expected single occurrence of the opening
  tag.
- Built and launched a fresh `electron-vite build` output over CDP, called
  `logic.openStudio(...)` through the real handler, and confirmed the popover now genuinely
  renders: a `position:fixed` element containing the target flag name appears in the DOM, and
  `document.body.textContent` includes the flag's real guide title ("Picture quality" for
  `--format`).
- Unregistered both lanes again and re-ran the generator to confirm `build-renderer-from-design.mjs`
  and the shared generated output return to their pre-registration state — `grep -c "hasWizard"`
  showed the doubled tag was back, proving the fix is genuinely coming from the registered lane and
  not some incidental side effect.
- `cd app && npm run typecheck` — exit 0.
