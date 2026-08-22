# Media player and queue

## Behavior

An always-visible transport bar sits at the bottom of the main content area, in every tab/mode,
next to the existing status bar — the same "always rendered regardless of tab" placement the
status bar itself already uses. It is always rendered, even with an empty queue, on purpose: the
bar's own "Queue" button is the only way to open the drawer that lets the user add the *first*
item, so gating the bar behind "the queue already has something in it" would make the feature
unreachable the first time.

Two ways to add something to the queue:

1. **A completed download.** The Library view's "Play file" row menu item (previously an honest
   toast stub — see `docs/features/downloading/download-history.md`) now calls
   `this._mediaAddLocal(path, title)` with the row's already-real, already-displayed recorded
   output path.
2. **A pasted link.** The queue drawer (opened from the bar's "Queue" button) has its own paste
   field and two buttons — "Queue video" and "Queue audio" — so the user chooses up front whether
   they want to watch or just listen; see `remote-link-playback.md` for what happens when "video"
   turns out not to be possible for a given link.

The queue supports add, remove, reorder (move up/down — see "Why buttons, not drag" below), and
clear. Adding the very first item auto-plays it; adding a second or later item while something is
already playing only queues it. Transport: play/pause, previous/next, seek (a native `<input
type="range">`, disabled until the current item has reported a real duration), and volume/mute.
The position/duration readout comes from the real `<video>`/`<audio>` element's own
`timeupdate`/`loadedmetadata` events — this feature never estimates or fakes a duration.

**Audio-only means no video surface.** A `kind: 'audio'` item never touches the `<video>` element
at all — it plays through a separate `<audio>` element that has no visual presentation. The
`<video>` element is a small (36×36) inline preview, shown only while a genuinely video-kind item
is actually ready to play; it is not a full viewer, which is a scope boundary this article states
plainly rather than leaving implicit (see "What this deliberately does not do" below).

**Honest states, not silent failure.** Every queue item and the bar itself show one of: `queued`,
`resolving`, `ready` (renamed to "Playing"/"Paused"/"Buffering" at the bar level once real
playback events fire), `unavailable`, `file-missing`, or `expired-retrying`. A failure always
carries the real reason string from the main process (`app/src/main/media.ts`) — never a generic
"something went wrong." See `remote-link-playback.md` for the expired-link retry mechanism.

## Why lookup-by-id, not a React ref

Nothing anywhere in the design file (`design/yt-dlp Studio.dc.html`) uses a ref-based DOM handle —
verified by search before writing this feature, since guessing wrong here would mean playback
silently doing nothing. Both media elements carry a stable DOM `id` instead
(`ytdlp-video-el` / `ytdlp-audio-el`), looked up fresh via `document.getElementById(...)` at the
moment each is needed (matching how the design's own `componentDidMount` already attaches a
`keydown` listener directly to `window`, imperatively, rather than through a framework
abstraction). Both elements are **always mounted** — never behind an `sc-if` — specifically so
that lookup never races a mount/unmount.

## Why buttons, not drag-to-reorder

The queue drawer's reorder controls are explicit "move up" / "move down" buttons per row, not
pointer-drag. Pointer-drag reordering exists elsewhere in the design (the rail's own
`startDragRail`), but reimplementing that same drag-physics machinery for a second, unrelated list
was judged not worth the risk this pass, when two buttons give the same outcome with far less
surface area to get wrong. Each button is independently keyboard-reachable
(`disabled` at the first/last position rather than silently doing nothing).

## Why the queue does not persist across restarts

The queue lives entirely in renderer component state (`mediaQueue`, `mediaCurrentId`, etc. — see
`app/src/main/index.ts`'s "wireVals" object as extended by `scripts/wire-media-player.mjs`). It is
not written to `Store` (`app/src/main/store.ts`) or any other persisted location. This is a stated
scope boundary, not an oversight: persisting a queue whose entries can reference a *resolved
stream token* that has already expired (see `remote-link-playback.md`) would need its own
re-resolution-on-restore logic, and the simpler, honest choice for this pass was an in-memory
queue that is exactly as long-lived as the window it lives in.

## What this deliberately does not do

- **No large video viewer.** The `<video>` element is a fixed 36×36 inline preview inside the
  transport bar. A full-size "now watching" surface would need real layout space this pass did not
  have design ownership to create without redesigning shared chrome outside this feature's owned
  files.
- **No rich metadata for a pasted link.** A remote queue item's displayed title is the pasted URL
  itself until (never) enriched — `app/src/main/media.ts`'s `resolveRemote()` deliberately does not
  make a second yt-dlp call just to fetch a title, to avoid doubling process-spawn overhead per
  resolve. `app/src/main/probes.ts` already has a cheap `probeUrl()` that could supply this; wiring
  it in is a reasonable follow-up, not done here to keep this pass's main-process surface to
  exactly what streaming needs.
- **Local-file playback assumes the recorded path still exists.** If the user moved or deleted a
  completed download after downloading it, the item surfaces as `file-missing` the moment the user
  tries to play it (matching the same "surface the truth at the moment of action, not
  proactively" philosophy `download-history.md` already documents for "Show in Explorer").

## Configuration

None. There is no setting for default volume, queue size limit, or auto-advance behavior in this
pass.

## Failure modes

- **`window.ytdlpStudioMedia` is missing** (running the renderer outside the packaged app, or the
  bridge preload failed to register — see `remote-link-playback.md`'s Security section): every
  queue-add action reports this plainly via a toast rather than silently doing nothing.
- **A local file's recorded path no longer exists**: `unavailable`/`file-missing`, with the exact
  path named in the message (see `app/src/main/media.ts`'s `resolveLocal`).
- **The user removes the currently-resolving item from the queue**: the resolve's result is
  discarded via a stale-request guard (`this.state.mediaCurrentId !== id`) rather than applied to
  whatever item happens to occupy that slot afterward; the in-flight main-process `--get-url`
  child process is also explicitly cancelled (`window.ytdlpStudioMedia.cancel(...)`).
- **Playback reaches the end of the queue**: the bar returns to an honest `idle` state
  ("Nothing queued" is never shown while items exist — the label reflects the real current
  status) rather than looping or silently stopping with stale controls still showing "Playing."

## Security considerations

See `remote-link-playback.md` for the full security design of stream resolution and serving (the
part that actually reads a file or spawns a process). This article's own surface — the queue and
UI — never receives a filesystem path from anywhere except a Library row's already-displayed,
already-real `outputPath`, and never receives a stream URL from anywhere except this app's own
`ytdlp-media://` protocol responses.

## Verification status

**Typechecked and syntax-verified; not yet run end-to-end against a real packaged build.**

- `cd app && npm run typecheck` — real exit code `0`, covering `app/src/main/media.ts`,
  `app/src/shared/media-contract.ts`, and the surgical edit to `app/src/main/index.ts`.
- `scripts/wire-media-player.mjs` was temporarily registered in
  `scripts/build-renderer-from-design.mjs` and run via
  `node scripts/build-renderer-from-design.mjs` against the real, current
  `design/yt-dlp Studio.dc.html` (real exit code `0` — every `replaceExact` anchor matched exactly
  once). The resulting `<script type="text/x-dc">` block (state + every method + `renderVals()`,
  4,614 lines) was extracted and checked with `node --check` (real exit code `0`), then confirmed
  to actually fail (`node --check` exit `1`, "Unexpected token 'if'") against a deliberately
  corrupted copy of the same extraction, so this is a real syntax check rather than a vacuous pass.
  Separately, every one of the file's 1,392 `{{ ... }}` template bindings (not just this feature's
  own ~60) was extracted and parsed as a standalone JS expression via `new Function(...)` — 0
  failures. The temporary lane registration was then reverted and the renderer regenerated again;
  `app/src/renderer/index.html` was byte-diffed against its pre-test content and confirmed
  identical, and `git diff` on `scripts/build-renderer-from-design.mjs` shows only the permanent,
  intentional CSP `media-src` addition.
- **Not yet verified**: the app has not actually been launched (packaged or via `electron-vite
  dev`) with this feature wired in, so no screenshot exists of the transport bar, the queue drawer,
  or a real local/remote item actually playing. A stale packaged build already existed at
  `app/dist-verify/win-unpacked` (built before this feature's source existed) and was not rebuilt,
  per this task's explicit "do not build one yourself" constraint — using it would only have
  proven the harness works, not this feature. The DOM `id`-based element lookup, the `<input
  type="range">` seek/volume bindings, and the queue drawer's fixed-position layout have not been
  visually confirmed against the running app.
