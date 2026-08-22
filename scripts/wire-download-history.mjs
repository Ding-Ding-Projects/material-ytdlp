// wire-download-history.mjs
//
// Makes the Library view real.
//
// ---------------------------------------------------------------------------
// The design's Library surface ("Completed media / Library and archive /
// Everything downloaded, the archive ids behind it, and the info.json each
// file was written from") shipped six fabricated "already downloaded" rows
// at fake D:\media\... paths, with a menu item that opened a destructive
// confirmation for a delete that never actually happened. zeroDemoState (in
// build-renderer-from-design.mjs) already stripped the fabricated rows down
// to a correct, honest EMPTY array — so out of the box the view rendered
// "0 of 0 files", which is honest but useless, because nothing ever filled
// it back in with real data.
//
// The real data source already exists and needed no new IPC surface at all:
// YtDlpManager (app/src/main/ytdlp.ts) now appends a real JobHistoryEntry to
// Store's job-history.json every time a job reaches a terminal state (done/
// error/cancelled), captured from yt-dlp's own `--print after_move:...`
// output — the real title, uploader, extractor, duration, and final output
// path, honestly null wherever yt-dlp did not report one. That store is
// already reachable from the renderer via the preload bridge's existing
// `window.ytdlpStudio.store.getJobHistory()` (app/src/preload/index.ts),
// registered against IpcChannel.StoreGetJobHistory
// (app/src/main/ipc.ts) since before this file existed. This lane only
// wires the Library view to read it.
//
// Deliberately NOT the separate app/src/main/history.ts / HistoryStore
// pipeline the design's Version History surface already uses
// (state.historyCommits / state.historySnapshot, wired in
// build-renderer-from-design.mjs's wireHistory + this project's
// wire-truth.mjs): that is a different feature (a Git-backed, undo/restore-
// capable commit log of the download LIST), its own HistoryDownloadRecord
// shape carries no real title/uploader/extractor/duration today (nothing
// populates those fields there), and reusing its state keys here would be
// exactly the kind of second competing store this project's own history has
// already paid for elsewhere. job-history.json is the real source for what
// was actually downloaded; history.ts's Git log is the real source for the
// download list's own edit history. Different questions, different stores.
//
// Honesty rules kept intentionally narrow:
//  - Library only ever lists jobs whose JobHistoryEntry.state is 'done'.
//    A failed or cancelled run is not "completed media".
//  - The recorded output path is shown as last reported, never re-verified
//    against the filesystem here (no existence-check IPC exists yet, and
//    silently probing every row's path on every render is its own kind of
//    dishonesty risk if that probe is ever wrong). Existence is instead
//    proven the moment the user actually acts on it: "Show in Explorer"
//    below calls the REAL fileOps.revealPath bridge (already registered,
//    already used elsewhere in this generated file), which itself checks
//    the path with fs.existsSync before doing anything and reports "Nothing
//    exists at ..." plainly when the file is gone. That is genuine
//    action-time honesty rather than a proactive claim this lane cannot back.
//  - "Delete file from disk" used to open a destructive-confirmation dialog
//    with no real delete behind it — Authorize would show "Authorized" and
//    delete nothing, which is exactly the decorative-control shape this
//    project treats as a defect. There is no delete-a-real-file IPC
//    surface today (that would need a new main-process capability outside
//    this lane's owned files), so it is left as an honest "Not implemented"
//    toast instead, matching the existing "Remove archive id" stub already
//    a few lines above it in the same menu.
//  - "Play file", "Open .info.json", "Re-download with current options" and
//    "Re-run post-processing only" were already honest toast stubs (they
//    never claimed to succeed) and are left untouched — genuinely wiring
//    those up is a separate feature.
// ---------------------------------------------------------------------------

export function wireDownloadHistory(html, replaceExact) {
  html = addHistoryState(html, replaceExact)
  html = hydrateOnMount(html, replaceExact)
  html = reloadOnJobFinish(html, replaceExact)
  html = wireLibraryRows(html, replaceExact)
  return html
}

// 1. New state field, initialized empty — real data only arrives once the
//    bridge responds, same pattern as every other `bridge.*` hydration in
//    this file (e.g. _hydrateDownloadFolder).
function addHistoryState(html, replaceExact) {
  const needle = `    fieldSearch: '', librarySearch: '', siteSearch: '', configSearch: '', historySearch: '',`
  const replacement = `    fieldSearch: '', librarySearch: '', siteSearch: '', configSearch: '', historySearch: '',
    jobHistory: [],`
  return replaceExact(html, needle, replacement)
}

// 2. Load job-history.json once on mount. Anchored on
//    `_wireExtensionUrlBridge();` (a unique, already-generated call from an
//    earlier lane) rather than `_wireHistoryBridge();` or
//    `_hydrateDownloadFolder();`, which are both already used as anchors by
//    other lanes.
function hydrateOnMount(html, replaceExact) {
  const needle = `    this._wireExtensionUrlBridge();`
  const replacement = `    this._wireExtensionUrlBridge();
    this._hydrateJobHistory();`
  html = replaceExact(html, needle, replacement)

  const methodAnchor = `  _hydrateBinaryVersions() {`
  const methodReplacement = `  // Real job-history.json (app/src/main/store.ts's JobHistoryEntry list),
  // appended to by YtDlpManager.finish() (app/src/main/ytdlp.ts) every time
  // a job reaches a terminal state. Powers the Library view below.
  _hydrateJobHistory() {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.store) return;
    bridge.store.getJobHistory().then(entries => {
      this.setState({ jobHistory: Array.isArray(entries) ? entries : [] });
    }).catch(() => {
      // The Library view already renders an honest "0 completed downloads"
      // from an empty jobHistory; a background refresh failing is not worth
      // interrupting the user with a toast for.
    });
  }

  ${methodAnchor}`
  return replaceExact(html, methodAnchor, methodReplacement)
}

// 3. Re-read job-history.json the moment a job actually finishes, so a
//    completed download shows up in the Library view without waiting for
//    the next app launch. Appends to the existing onState subscription
//    rather than adding a second one, so there is exactly one place that
//    reacts to a job's terminal state.
function reloadOnJobFinish(html, replaceExact) {
  const needle = `    this._offState = bridge.jobs.onState(ev => {
      const stateMap = { queued: 'queued', running: 'downloading', paused: 'queued', done: 'done', error: 'error', cancelled: 'error' };
      this.setState(st => ({ jobs: st.jobs.map(j => j.id === ev.id ? { ...j, state: stateMap[ev.state] || j.state } : j) }));
    });`
  const replacement = `    this._offState = bridge.jobs.onState(ev => {
      const stateMap = { queued: 'queued', running: 'downloading', paused: 'queued', done: 'done', error: 'error', cancelled: 'error' };
      this.setState(st => ({ jobs: st.jobs.map(j => j.id === ev.id ? { ...j, state: stateMap[ev.state] || j.state } : j) }));
      // YtDlpManager.finish() (app/src/main/ytdlp.ts) has just appended a
      // real JobHistoryEntry for this run — pick it up now rather than on
      // the next launch.
      if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') this._hydrateJobHistory();
    });`
  return replaceExact(html, needle, replacement)
}

// 4. The Library view itself: real rows derived from state.jobHistory,
//    filtered to completed downloads, feeding the SAME two-stage
//    filter/map shape the design already used (array-tuple -> row object),
//    so the existing search predicate (`this.match(r.join(' '), ...)`) and
//    the regex builder wired to it keep working unchanged.
function wireLibraryRows(html, replaceExact) {
  const needle = `      librarySearch: s.librarySearch, setLibrarySearch: e => this.setState({ librarySearch: e.target.value }),
      openRegexLibrary: () => this.setState({ dialog: 'regex', regexTarget: 'library' }),
      libraryRows: [

      ].filter(r => this.match(r.join(' '), s.librarySearch)).map(r => ({
        title: r[0], path: r[1], uploader: r[2], size: r[3], ext: r[4], archive: r[5],
        menu: e => this.openMenu(e, r[0], [
          { glyph: '▶', label: 'Play file', run: () => this.toast('Player', r[0]) },
          { glyph: '⌂', label: 'Show in Explorer', run: () => this.toast('Explorer', r[1]) },
          { glyph: '{}', label: 'Open .info.json', run: () => this.toast('info.json', r[0]) },
          { glyph: '↻', label: 'Re-download with current options', run: () => this.toast('Queued', r[0]) },
          { glyph: '⚙', label: 'Re-run post-processing only', run: () => this.toast('Post-processing', r[0]) },
          { glyph: '⊖', label: 'Remove archive id', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Removing a single id from the download archive needs a real per-row extractor id, which this list does not carry yet') },
          { glyph: '×', label: 'Delete file from disk', color: '#ffb4ab', run: () => this.askDestructive('Delete from disk?', 'The file is removed permanently. The download archive entry stays unless you remove it separately.') },
        ]),
      })),
      libraryCount: '0 of 0 files · — archive ids',`

  const replacement = `      librarySearch: s.librarySearch, setLibrarySearch: e => this.setState({ librarySearch: e.target.value }),
      openRegexLibrary: () => this.setState({ dialog: 'regex', regexTarget: 'library' }),
      libraryRows: (s.jobHistory || []).filter(h => h.state === 'done').slice().reverse().map(h => ([
        h.title || h.url,
        h.outputPath || '(output path not recorded)',
        h.uploader || '—',
        h.sizeLabel || '—',
        (h.outputPath || '').split('.').pop() || '—',
        h.extractor ? (h.extractor + (h.videoId ? ' ' + h.videoId : '')) : '—',
      ])).filter(r => this.match(r.join(' '), s.librarySearch)).map(r => ({
        title: r[0], path: r[1], uploader: r[2], size: r[3], ext: r[4], archive: r[5],
        menu: e => this.openMenu(e, r[0], [
          { glyph: '▶', label: 'Play file', run: () => this.toast('Player', r[0]) },
          { glyph: '⌂', label: 'Show in Explorer', run: () => {
            const bridge = window.ytdlpStudio;
            if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
            bridge.fileOps.revealPath({ path: r[1] }).then(res => {
              if (!res || !res.ok) this.toast('Could not open', (res && res.error) || 'Unknown error');
            }).catch(err => this.toast('Could not open', String(err && err.message ? err.message : err)));
          } },
          { glyph: '{}', label: 'Open .info.json', run: () => this.toast('info.json', r[0]) },
          { glyph: '↻', label: 'Re-download with current options', run: () => this.toast('Queued', r[0]) },
          { glyph: '⚙', label: 'Re-run post-processing only', run: () => this.toast('Post-processing', r[0]) },
          { glyph: '⊖', label: 'Remove archive id', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Removing a single id from the download archive needs a real per-row extractor id, which this list does not carry yet') },
          { glyph: '×', label: 'Delete file from disk', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Deleting a real file needs a dedicated main-process delete capability, which is not wired up yet — nothing on disk is touched by this menu item.') },
        ]),
      })),
      libraryCount: (() => {
        const doneCount = (s.jobHistory || []).filter(h => h.state === 'done').length;
        return doneCount + (doneCount === 1 ? ' completed download' : ' completed downloads');
      })(),`

  return replaceExact(html, needle, replacement)
}
