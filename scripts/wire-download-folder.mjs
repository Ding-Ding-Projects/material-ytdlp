// wire-download-folder.mjs
//
// Downloads must land in a real folder, and the queue must not accept a job
// with nothing to download.
//
// ---------------------------------------------------------------------------
// DEFECT 1 -- the download folder was empty, so downloads went nowhere fixed.
//
// The design ships `easyFolder: ''`, and the real argv only passes -P when that
// value is non-empty. So out of the box no -P was sent at all and yt-dlp wrote
// relative to whatever working directory the packaged app inherited -- which
// depends on how it was launched and is not necessarily writable.
//
// When it is not writable, yt-dlp's Python reports it as
// "[Errno 28] No space left on device". Observed on a disk with 2.5 TB free,
// which sends whoever reads it looking at disk space, not at paths. That single
// misleading message is the reason this defect is worth this much comment.
//
// The main process now defaults the stored folder to the user's own Downloads
// directory (app/src/main/store.ts). This hydrates the renderer from it, and
// remembers any folder the user picks afterwards.
//
// ---------------------------------------------------------------------------
// DEFECT 2 -- a job could be queued with no URL.
//
// An exported queue from a real session contained a row reading "(no URL)" in
// the error state at 0%. Starting a download with nothing to download can only
// ever fail, so it should never have become a queue row: it costs the user a
// failed job and a confusing error instead of a straight answer.

export function wireDownloadFolder(html, replaceExact) {
  // 1. Hydrate the folder from the store on mount. Anchored on the last line of
  //    _wireBridge()'s body rather than its opening, because the lifecycle
  //    repair lane owns that opening and two lanes anchoring on one needle is
  //    exactly the collision that has already cost this project eleven repairs.
  html = replaceExact(
    html,
    `    this._wireHistoryBridge();`,
    `    this._hydrateDownloadFolder();
    this._wireHistoryBridge();`,
  )

  // 2. The hydration itself, plus persistence. Only fills an EMPTY field, so a
  //    folder the user has already chosen in this session is never overwritten
  //    by a slower store read landing after they typed.
  html = replaceExact(
    html,
    `  _wireHistoryBridge() {`,
    `  _hydrateDownloadFolder() {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.store) return;
    bridge.store.getLastPaths().then(paths => {
      const folder = paths && paths.downloadFolder;
      if (!folder) return;
      // Do not clobber a folder the user has already set while this was in flight.
      this.setState(st => (st.easyFolder ? null : { easyFolder: folder }));
    }).catch(() => {
      // A missing default is not worth a toast: the folder field is visible and
      // editable, and the picker beside it still works. Staying quiet here beats
      // an error the user can neither act on nor dismiss meaningfully.
    });
  }

  _rememberDownloadFolder(folder) {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.store || !folder) return;
    bridge.store.getLastPaths()
      .then(paths => bridge.store.setLastPaths({ ...paths, downloadFolder: folder }))
      .catch(() => {});
  }

  _wireHistoryBridge() {`,
  )

  // 3. Remember whatever the user types or picks, so the next launch opens on it.
  html = replaceExact(
    html,
    `      easyFolder: s.easyFolder, setEasyFolder: e => this.setState({ easyFolder: e.target.value }),`,
    `      easyFolder: s.easyFolder, setEasyFolder: e => { const v = e.target.value; this.setState({ easyFolder: v }); this._rememberDownloadFolder(v); },`,
  )

  // 4. Refuse a job with nothing to download. Returns null so the existing call
  //    sites -- which already handle a null id from the no-bridge case -- treat
  //    it the same way, rather than needing to learn a new failure shape.
  //
  //    The empty-argv internal calls (a raw command run, where the URL is inside
  //    the argv itself) pass '' deliberately, so only a job with an empty URL
  //    AND no argv is refused.
  html = replaceExact(
    html,
    `  _startJob(comp, url, argv) {`,
    `  _startJob(comp, url, argv) {
    if (!String(url || '').trim() && !(argv && argv.length)) {
      comp.toast('Nothing to download', 'Paste a link first — an empty job can only fail.');
      return null;
    }`,
  )

  // 5. The output template. Two things it has to get right, both verified
  //    against the real binary with --print filename rather than assumed:
  //
  //    - The FIRST path segment must never be empty. `%(playlist_title|)s/...`
  //      looks reasonable and is a trap: with no playlist that segment collapses
  //      to nothing, the template then STARTS with a separator, the path becomes
  //      absolute, -P is ignored entirely, and the download is aimed at the root
  //      of the drive. Measured:
  //          C:\2021-Present Primetime Theme  Jeopardy! [BU7AjL9-Avw].webm
  //      Writing there fails, and yt-dlp's Python surfaces it as
  //      "[Errno 28] No space left on device" -- on a disk with 2.5 TB free,
  //      which sends anyone reading it looking at disk space instead of paths.
  //
  //    - A path separator cannot be injected through a field replacement.
  //      `%(playlist_title&{}/|)s` is sanitised away, because yt-dlp strips
  //      separators out of field VALUES so a crafted title cannot escape the
  //      output folder. Measured: the playlist name and the video title came
  //      back concatenated with no separator at all.
  //
  //    Leading with a non-empty field solves both, and yt-dlp then collapses the
  //    empty middle segment itself -- so a single video gains no stray folder
  //    while a playlist or channel nests one level per playlist. Verified:
  //      single video -> <folder>\Game Show Cues\<title>.webm
  //      playlist     -> <folder>\Game Show Cues\Uploads from Game Show Cues\<title>
  //
  //    This is also the exact template the design already specifies as its
  //    Expert-mode default, so Easy mode now organises files the same way rather
  //    than inventing a second convention beside it.
  html = replaceExact(
    html,
    `        if (s.easyFolder) argv.push('-P', s.easyFolder);`,
    `        if (s.easyFolder) argv.push('-P', s.easyFolder);
        argv.push('-o', '%(uploader)s/%(playlist|)s/%(title)s [%(id)s].%(ext)s');`,
  )

  return html
}
