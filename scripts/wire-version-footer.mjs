// wire-version-footer.mjs
//
// The rail footer shipped a hard-coded version line:
//
//     2026.08.14 · ffmpeg 7.1 · aria2c 1.37
//
// Every part of it was wrong in a different way, and all three matter:
//
//   - The yt-dlp version was a fixed string, so it would stay frozen at that
//     date no matter which binary was actually bundled. The real one is built
//     from the pinned submodule and reports 2026.08.19.
//   - ffmpeg 7.1 is not what ships. The bundled build reports 8.0.git.
//   - aria2c is not bundled AT ALL. Naming a version for a tool that is not in
//     the package is the worst of the three: it invites a user to rely on a
//     downloader that is not there, and no amount of careful work elsewhere
//     survives an interface that states something untrue about what it contains.
//
// The real versions are already available -- bridge.binaries.resolveAll()
// returns a version per binary, and has since the resolver was written. Nothing
// was ever wired to it, so the design's placeholder simply stayed on screen.

export function wireVersionFooter(html, replaceExact) {
  // 1. Bind the footer to state instead of a literal.
  html = replaceExact(
    html,
    `<div style="font-size:11px;color:#889391;letter-spacing:.4px">2026.08.14 · ffmpeg 7.1 · aria2c 1.37</div>`,
    `<div title="{{ binaryVersionsTitle }}" style="font-size:11px;color:#889391;letter-spacing:.4px">{{ binaryVersionsLine }}</div>`,
  )

  // 2. Hydrate from the real resolver, beside the download-folder hydration
  //    that already runs at the same point in the mount.
  html = replaceExact(
    html,
    `    this._hydrateDownloadFolder();`,
    `    this._hydrateDownloadFolder();
    this._hydrateBinaryVersions();`,
  )

  // 3. The hydration. Reports what is actually resolved, including the
  //    unhappy cases -- a missing binary says so rather than being silently
  //    omitted, which would read as "it is fine, just not listed".
  html = replaceExact(
    html,
    `  _hydrateDownloadFolder() {`,
    `  _hydrateBinaryVersions() {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.binaries) return;
    bridge.binaries.resolveAll().then(all => {
      const label = (key, prefix) => {
        const b = all && all[key];
        if (!b || !b.path) return prefix + ' missing';
        // A resolved binary whose --version could not be read is a real state
        // and is worth showing as itself, not as a blank.
        return prefix + ' ' + (b.version || 'version unknown');
      };
      // yt-dlp leads with its bare version, the way the design had it.
      const ytdlp = all && all['yt-dlp'];
      const head = !ytdlp || !ytdlp.path
        ? 'yt-dlp missing'
        : (ytdlp.version || 'yt-dlp version unknown');
      const line = [head, label('ffmpeg', 'ffmpeg'), label('ffprobe', 'ffprobe')].join(' · ');
      // The tooltip carries where each one was resolved from, so "missing" is
      // actionable instead of merely alarming.
      const origins = ['yt-dlp', 'ffmpeg', 'ffprobe'].map(k => {
        const b = all && all[k];
        return k + ': ' + (b && b.path ? (b.origin || 'resolved') + ' — ' + b.path : 'not found');
      }).join('\\n');
      this.setState({ binaryVersionsLine: line, binaryVersionsTitle: origins });
    }).catch(err => {
      this.setState({
        binaryVersionsLine: 'versions unavailable',
        binaryVersionsTitle: String(err && err.message ? err.message : err),
      });
    });
  }

  _hydrateDownloadFolder() {`,
  )

  // 4. Honest initial state. "checking…" rather than a plausible-looking
  //    version that happens to be a lie for the first few hundred milliseconds.
  html = replaceExact(
    html,
    `      easyFolder: s.easyFolder, setEasyFolder:`,
    `      binaryVersionsLine: s.binaryVersionsLine || 'checking bundled tools…',
      binaryVersionsTitle: s.binaryVersionsTitle || 'Resolving the bundled yt-dlp, ffmpeg and ffprobe.',
      easyFolder: s.easyFolder, setEasyFolder:`,
  )

  return html
}
