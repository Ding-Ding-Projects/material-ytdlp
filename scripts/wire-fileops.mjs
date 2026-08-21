/**
 * wireFileOps(html, replaceExact) — file-operations wiring lane.
 *
 * Owned files: app/src/main/fileops.ts, app/src/shared/fileops-contract.ts,
 * this script, plus surgical additions to app/src/main/ipc.ts and
 * app/src/preload/index.ts (registering the `window.ytdlpStudio.fileOps`
 * bridge). This module does NOT read or write files itself — it is pure
 * string transformation, imported and called by
 * scripts/build-renderer-from-design.mjs, which owns the overall build
 * order and passes in its own asserted `replaceExact(source, needle,
 * replacement, expected = 1)` helper.
 *
 * Scope note: build-renderer-from-design.mjs already wires exportConf,
 * saveConf and validateConfig itself (via its own `_wire` object, see the
 * "validate / export / save config" section of that script) — those three
 * are that lane's, not this one's, and are deliberately left untouched
 * here to avoid a needle collision with edits already made to that exact
 * text. Every needle below targets text those edits do not touch.
 *
 * Every replacement is asserted to occur EXACTLY ONCE (or the stated exact
 * count) against the design source, taken byte-exact from
 * `design/yt-dlp Studio.dc.html`. If the design changes such that a needle
 * no longer matches, this throws loudly rather than shipping a half-wired
 * app.
 */

export function wireFileOps(html, replaceExact) {
  // -------------------------------------------------------------------
  // 1. Generalize `toast()` itself: every "Copied" toast in the design
  //    (~40 call sites) already carries the real text to copy as its
  //    `body` argument, and both "Explorer" toasts already carry the
  //    real path. Rather than touching every call site individually,
  //    patch the single `toast()` definition to actually perform the
  //    real clipboard write / real reveal before showing the same toast
  //    UI as before. A clipboard failure is swallowed (clipboard access
  //    can be denied by the OS for reasons outside the app's control and
  //    is not worth interrupting the user over); a reveal failure raises
  //    a second, honest toast naming what went wrong, since "the path
  //    does not exist" is exactly the kind of thing this file must never
  //    silently paper over.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `  toast(title, body) {
    const id = Math.random();
    this.setState(s => ({ toasts: [...s.toasts, { id, title, body }] }));
    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3600);
  }`,
    `  toast(title, body) {
    if (title === 'Copied' && typeof body === 'string' && typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(body).catch(() => {});
    } else if (title === 'Explorer' && typeof body === 'string' && window.ytdlpStudio && window.ytdlpStudio.fileOps) {
      window.ytdlpStudio.fileOps.revealPath({ path: body }).then(res => {
        if (!res.ok) this._toastRaw('Could not open in Explorer', res.error || 'Unknown error');
      }).catch(err => this._toastRaw('Could not open in Explorer', String(err && err.message ? err.message : err)));
    }
    this._toastRaw(title, body);
  }
  _toastRaw(title, body) {
    const id = Math.random();
    this.setState(s => ({ toasts: [...s.toasts, { id, title, body }] }));
    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3600);
  }`,
  )

  // -------------------------------------------------------------------
  // 2. External editor handoff (settingAction 'editor'). Opens the
  //    active config file's real path (portable location, absent a more
  //    specific selection) in the user's real editor.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `    else if (key === 'editor') this.toast('Handed off', 'yt-dlp.conf opened in your editor — saved changes reload live');`,
    `    else if (key === 'editor') {
      const bridge = window.ytdlpStudio;
      if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio.fileOps is missing'); return; }
      bridge.fileOps.listConfigFiles().then(files => {
        const target = (files || []).find(f => f.exists) || (files || [])[0];
        if (!target) { this.toast('No config file', 'No configuration location could be resolved'); return; }
        return bridge.fileOps.openInEditor({ path: target.path }).then(res => {
          if (!res.ok) { this.toast('Could not open editor', res.error || 'Unknown error'); return; }
          this.toast('Handed off', target.path + ' opened' + (res.method === 'vscode' ? ' in VS Code' : ' in your default editor'));
        });
      }).catch(err => this.toast('Could not open editor', String(err && err.message ? err.message : err)));
    }`,
  )

  // -------------------------------------------------------------------
  // 3. Download-archive compaction (dedupe the real file on disk).
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `      historyCompact: () => this.toast('Compacted', 'history.jsonl rewritten · 482 KiB → 301 KiB'),`,
    `      historyCompact: () => {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio.fileOps is missing'); return; }
        const archivePath = s.values['--download-archive'] || null;
        bridge.fileOps.compactArchive(archivePath).then(res => {
          if (!res.ok) { this.toast('Compaction failed', res.error || 'Unknown error'); return; }
          this.toast('Compacted', res.path + ' rewritten · removed ' + res.removedDuplicates + ' duplicate id(s) · ' + res.beforeBytes + 'B → ' + res.afterBytes + 'B');
        }).catch(err => this.toast('Compaction failed', String(err && err.message ? err.message : err)));
      },`,
  )

  // -------------------------------------------------------------------
  // 4. Add / remove download-archive ids. The design's demo grid has no
  //    real per-row extractor id backing these, so this reads/reports the
  //    real archive file's line count rather than pretending to mutate
  //    a specific id it was never actually given.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `        { glyph: '⊕', label: 'Add to download archive', run: () => this.toast('Archive', '1 id appended') },`,
    `        { glyph: '⊕', label: 'Add to download archive', run: () => {
          const bridge = window.ytdlpStudio;
          if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio.fileOps is missing'); return; }
          const archivePath = s.values['--download-archive'] || null;
          bridge.fileOps.readArchive(archivePath).then(res => {
            if (res.error) { this.toast('Archive unavailable', res.error); return; }
            this.toast('Archive', (res.path || 'No --download-archive path is set') + ' · ' + res.lineCount + ' id(s) on disk');
          }).catch(err => this.toast('Archive unavailable', String(err && err.message ? err.message : err)));
        } },`,
  )
  html = replaceExact(
    html,
    `          { glyph: '⊖', label: 'Remove archive id', color: '#ffb4ab', run: () => this.toast('Archive', r[5] + ' removed') },`,
    `          { glyph: '⊖', label: 'Remove archive id', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Removing a single id from the download archive needs a real per-row extractor id, which this list does not carry yet') },`,
  )

  // -------------------------------------------------------------------
  // 5. Reveal in file manager (real path, not a demo string — reports
  //    honestly when nothing exists there, exactly as `toast('Explorer',
  //    ...)` now does generically via the patch in step 1).
  // -------------------------------------------------------------------
  // (no additional needle needed here: both `toast('Explorer', ...)`
  // call sites — 'Open containing folder' and 'Show in Explorer' — are
  // now real via the generalized toast() patch above.)

  // -------------------------------------------------------------------
  // 6. Per-config-file-row menu: open the real file in the real editor,
  //    and export a real .conf built from the current config lines.
  //    ('Copy path' is covered generically by step 1.)
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `          { glyph: '↗', label: 'Open in the editor', run: () => this.setState({ configFile: id }) },`,
    `          { glyph: '↗', label: 'Open in the editor', run: () => {
            this.setState({ configFile: id });
            const bridge = window.ytdlpStudio;
            if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio.fileOps is missing'); return; }
            bridge.fileOps.openInEditor({ path }).then(res => {
              if (!res.ok) { this.toast('Could not open editor', res.error || 'Unknown error'); return; }
              this.toast('Handed off', path + ' opened' + (res.method === 'vscode' ? ' in VS Code' : ' in your default editor'));
            }).catch(err => this.toast('Could not open editor', String(err && err.message ? err.message : err)));
          } },`,
  )
  html = replaceExact(
    html,
    `          { glyph: '▤', label: 'Export as .conf', run: () => this.toast('Exported', label + '.conf') },`,
    `          { glyph: '▤', label: 'Export as .conf', run: () => {
            const bridge = window.ytdlpStudio;
            if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio.fileOps is missing'); return; }
            const text = confLines.map(l => (l.on ? '' : '# ') + l.flag + (l.value ? ' ' + l.value : '')).join('\\n');
            bridge.fileOps.exportContent({ suggestedName: label + '.conf', contents: text, formatLabel: 'yt-dlp config' }).then(res => {
              if (res.cancelled) return;
              if (!res.ok) { this.toast('Export failed', res.error || 'Unknown error'); return; }
              this.toast('Exported', res.path);
            }).catch(err => this.toast('Export failed', String(err && err.message ? err.message : err)));
          } },`,
  )

  return html
}
