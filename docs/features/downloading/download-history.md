# Download history

## Behavior

Every job run that reaches a terminal state (`done`, `error`, or `cancelled`) is appended as one
`JobHistoryEntry` to a persisted, on-disk job history (`job-history.json` in the app's user-data
directory, via `Store.appendJobHistory` in `app/src/main/store.ts`). The write happens inside
`YtDlpManager.finish()` (`app/src/main/ytdlp.ts`) and never blocks or fails the job it is
recording — a history-write failure is logged to the console and otherwise swallowed.

Beyond the job's own id/url/argv/state/exitCode, an entry carries real metadata captured from
yt-dlp's own output at its `after_move` hook (i.e. **after** any merge/post-processing step has
already written the final file), never invented:

- `title`, `uploader`, `extractor`, `videoId` — yt-dlp's own `%(title)s` / `%(uploader)s` /
  `%(extractor)s` / `%(id)s` for the item.
- `durationSec` — yt-dlp's `%(duration)s`, rounded to whole seconds.
- `outputPath` — yt-dlp's `%(filepath)s`, i.e. the real path of the file it wrote, exactly as
  yt-dlp reported it. This is **not** re-verified against the filesystem by this feature — see
  "Failure modes" below.
- `sizeLabel` — the last human-readable size string (`"1.42GiB"`) seen in job progress before the
  run finished. This is a display convenience, not a verified byte count of the final file.

Any field yt-dlp did not report for a given run (extraction never started, the extractor omits a
field, the job was cancelled before `after_move` fired) is stored as `null` rather than a guessed
value. Because a **playlist or channel** job fires the `after_move` hook once per completed item,
this layer keeps only the metadata from the **last** item completed before the process exited —
one `JobHistoryEntry` per job run, describing its most recently finished item, not a full
per-item history. A genuine per-item download history is future work.

### The Library view

The design's Library surface (`isLibrary` / "Completed media") reads this history through
`window.ytdlpStudio.store.getJobHistory()` (already registered in `app/src/main/ipc.ts` and
exposed by `app/src/preload/index.ts` before this feature existed), filtered to entries whose
`state` is `'done'`. It is hydrated once on mount and re-read the moment any job reaches a
terminal state, so a just-finished download appears without waiting for the next launch. The
existing search box and its regex builder (`librarySearch` / `openRegexLibrary`) filter these real
rows exactly as they filtered the design's original (now-removed) fabricated ones.

**"Show in Explorer"** on a row calls the real `fileOps.revealPath` bridge with the entry's
recorded `outputPath`. **"Delete file from disk"** is an honest `"Not implemented"` toast — there
is no main-process capability to delete an arbitrary file today, so the menu item does not pretend
to gate a delete that would not actually happen. "Play file", "Open .info.json", and the two
re-run items remain the design's original informational toast stubs; they were never claimed to
succeed and wiring them up is a separate feature.

## Why this is a *different* store from the Version History surface

`app/src/main/history.ts` / `app/src/shared/history-contract.ts` (`HistoryStore`,
`HistoryDownloadRecord`) is a **separate**, already-real, Git-backed, undo/restore-capable commit
log of the download *list* — every add/start/complete/fail/cancel is its own append-only commit,
and it is what the design's Version History surface (`state.historyCommits`,
`_wireHistoryBridge()`) already reads. `recordFromJobRecord` in `app/src/main/ipc.ts` populates a
`HistoryDownloadRecord` on every job state change too, but today only its `url`, `state`,
`sizeBytes` (a rough parse of the last progress size string), `addedAt`, and `updatedAt` are ever
real — nothing populates its `title`, `filename`, `ext`, `extractor`, or `durationSec` fields, so
it cannot back a genuinely informative Library view on its own.

`JobHistoryEntry` / `job-history.json` is therefore not a redundant second history feature: it is
the one place the rich per-download metadata (title, uploader, extractor, duration, real output
path) actually gets captured, from yt-dlp's own real output rather than left permanently `null`.
The Library view was wired to this store rather than to `HistoryDownloadRecord` for that reason.
Enriching `HistoryDownloadRecord` itself (so the two stores agree) would require changing
`app/src/main/ipc.ts`'s `recordFromJobRecord`, which this feature deliberately left untouched.

## Configuration

Nothing user-configurable yet. History is capped at the 500 most recent entries
(`MAX_JOB_HISTORY` in `app/src/main/store.ts`, pre-existing) with no retention/export controls of
its own — the separate Version History surface already has retention and export, but those do not
apply to this store.

## Failure modes

- **A history write fails** (disk full, permissions): the job it describes is unaffected; the
  failure is logged to the console (`[job-history] appendJobHistory failed:`) and the entry is
  simply missing from the Library view rather than the app crashing or the download failing.
- **The recorded `outputPath` no longer points at a real file** (the user moved or deleted it
  after the fact): the Library view does **not** proactively check this — there is no
  "does this path exist" IPC surface today, and probing every row's path on every render was
  judged riskier than not probing at all. The truth surfaces honestly the moment the user actually
  acts on the row: "Show in Explorer" calls the real `fileOps.revealPath`, which checks the path
  with `fs.existsSync` before doing anything and reports `Nothing exists at "<path>"` plainly when
  it is gone, rather than silently doing nothing or claiming success.
- **A playlist/channel job**: only the last completed item's metadata is recorded for that job's
  entry, as described above — not a per-item breakdown.
- **An entry written before this feature shipped**: `job-history.json` entries written by an
  earlier build lack `title`/`uploader`/`extractor`/`videoId`/`durationSec`/`outputPath`/
  `sizeLabel` entirely (`undefined` at runtime, not `null`). Every reader treats that the same as
  `null` rather than assuming presence; nothing crashes on an old-shape entry.
- **yt-dlp's `after_move` hook never fires** (the job failed before producing a file, or was
  cancelled early): every metadata field stays `null`, which correctly excludes the entry from the
  Library view's `state === 'done'` filter in the ordinary case; an entry can only reach `'done'`
  after `after_move` has already run.

## Security considerations

The six extra `--print after_move:...` flags are appended to the same argv array already
passed to `spawn()` with `shell: false` — no new shell-interpretation surface. Each is parsed from
its own single line via a unique marker prefix (`[[HIST_TITLE]]`, etc.) rather than one
pipe-delimited line, specifically so a title/uploader/path containing a literal `|` character
cannot corrupt a neighboring field's value.

## Verification status

**Typechecked, not yet run end-to-end against a real download.**

- `cd app && npm run typecheck` — real exit code `0`.
- The renderer wiring (`scripts/wire-download-history.mjs`) was temporarily registered in
  `scripts/build-renderer-from-design.mjs`, run via `node scripts/build-renderer-from-design.mjs`
  (real exit code `0`, meaning every `replaceExact` anchor matched exactly once), and the
  resulting generated `<script type="text/x-dc">` block was extracted and checked with
  `node --check` (real exit code `0`) — confirmed to actually fail (exit `1`) against a
  deliberately corrupted copy first, so this is a real syntax check rather than a vacuous pass.
  The registration was then reverted and the renderer regenerated again; `git diff` on both
  `scripts/build-renderer-from-design.mjs` and `app/src/renderer/index.html` is empty, confirming
  neither was left changed by this test.
- **Not yet verified**: an actual `yt-dlp.exe` run's real `after_move` output has not been
  captured and fed through `parseHistoryMetaLine`/`applyHistoryMetaField` against a live process,
  and the Library view has not been screenshotted from the running packaged app with a real
  completed download in it. yt-dlp's `after_move` hook and `%(filepath)s` field are used per their
  documented behavior but have not been independently re-verified against the bundled binary's
  exact version in this repository.
