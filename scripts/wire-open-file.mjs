// scripts/wire-open-file.mjs
//
// Adds the two capabilities the user asked for on Library rows:
//
//   "add a open file button for downloads too and a show in explorer"
//
// "Show in Explorer" already worked (wire-download-history.mjs wires it to
// the real fileOps.revealPath bridge, both on the row's context menu and now
// also as a real button here). "Open file" did not: there was no route from
// the renderer to Electron's shell.openPath at all — "Play file" was an
// honest toast stub ("this.toast('Player', r[0])"). This lane adds the real
// backend route (app/src/shared/fileops-contract.ts's new OpenPath channel,
// app/src/main/fileops.ts's openPath(), wired in app/src/main/ipc.ts and
// exposed on the preload bridge as fileOps.openPath) and wires both actions
// here on the renderer side.
//
// Both actions are surfaced as REAL, always-visible controls on the row
// itself — not only in the context menu — matching the exact visual idiom
// the Downloads queue row already uses for its own per-row icon buttons
// (32x32, 9px radius, #303636 background, #82d5cc icon color, Material
// Symbols glyph). See the Queue section's `job.inspect`/`job.retry`/
// `job.remove` buttons in the design for the pattern this copies.
//
// Honesty rules:
//  - A row whose outputPath was never recorded (h.outputPath is null — the
//    job never got that far, or predates this app tracking it) gets both
//    buttons rendered but disabled, with a title explaining why, rather
//    than a control that looks live and does nothing.
//  - A path that no longer exists, or sits outside this app's known
//    download roots, is refused by the real main-process handler
//    (app/src/main/fileops.ts's openPath()) with an honest message — this
//    lane never pre-validates existence itself and never claims success
//    before the bridge call actually resolves.
//  - The context menu's "Play file" entry is rewired to the SAME real
//    openPath() call as the new button, rather than staying a separate toast
//    stub that would silently disagree with what the visible button does.
//
// Runs AFTER wireDownloadHistory (scripts/wire-download-history.mjs) in the
// generator pipeline: it edits the exact libraryRows JS block that lane
// already produced, and the exact Library row markup that lane deliberately
// left untouched (it only ever changed the row's DATA, never its grid).

// ---------------------------------------------------------------------------
// 1) Markup: a 6th grid column on the Library row, carrying two real icon
//    buttons. Anchored on the row's own opening <div> plus its five existing
//    field <div>s and closing tag, verbatim from the design source — this
//    exact block is never touched by any other wire module.
// ---------------------------------------------------------------------------

function wireLibraryRowMarkup(html, replaceExact) {
  const needle =
    '                    <div onContextMenu="{{ row.menu }}" style="display:grid;grid-template-columns:minmax(0,1fr) 150px 110px 96px 130px;gap:12px;align-items:center;padding:11px 13px;border-radius:12px;background:#252b2b">\n' +
    '                      <div style="min-width:0">\n' +
    '                        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">{{ row.title }}</div>\n' +
    "                        <div style=\"font-size:11px;color:#889391;font-family:'Roboto Mono',Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">{{ row.path }}</div>\n" +
    '                      </div>\n' +
    '                      <div style="color:#bec9c7;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ row.uploader }}</div>\n' +
    "                      <div style=\"color:#bec9c7;font-size:12px;font-family:'Roboto Mono',Consolas,monospace\">{{ row.size }}</div>\n" +
    "                      <div style=\"color:#bec9c7;font-size:12px;font-family:'Roboto Mono',Consolas,monospace\">{{ row.ext }}</div>\n" +
    "                      <div style=\"color:#889391;font-size:11px;font-family:'Roboto Mono',Consolas,monospace\">{{ row.archive }}</div>\n" +
    '                    </div>\n'

  const replacement =
    '                    <div onContextMenu="{{ row.menu }}" style="display:grid;grid-template-columns:minmax(0,1fr) 150px 110px 96px 130px auto;gap:12px;align-items:center;padding:11px 13px;border-radius:12px;background:#252b2b">\n' +
    '                      <div style="min-width:0">\n' +
    '                        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600">{{ row.title }}</div>\n' +
    "                        <div style=\"font-size:11px;color:#889391;font-family:'Roboto Mono',Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">{{ row.path }}</div>\n" +
    '                      </div>\n' +
    '                      <div style="color:#bec9c7;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ row.uploader }}</div>\n' +
    "                      <div style=\"color:#bec9c7;font-size:12px;font-family:'Roboto Mono',Consolas,monospace\">{{ row.size }}</div>\n" +
    "                      <div style=\"color:#bec9c7;font-size:12px;font-family:'Roboto Mono',Consolas,monospace\">{{ row.ext }}</div>\n" +
    "                      <div style=\"color:#889391;font-size:11px;font-family:'Roboto Mono',Consolas,monospace\">{{ row.archive }}</div>\n" +
    '                      <div style="display:flex;gap:5px">\n' +
    '                        <button onClick="{{ row.open }}" disabled="{{ !row.hasPath }}" title="{{ row.openTitle }}" style="width:32px;height:32px;border-radius:9px;background:#303636;color:{{ row.actionColor }};flex:0 0 auto"><i class="msym" style="font-size:17px">open_in_new</i></button>\n' +
    '                        <button onClick="{{ row.reveal }}" disabled="{{ !row.hasPath }}" title="{{ row.revealTitle }}" style="width:32px;height:32px;border-radius:9px;background:#303636;color:{{ row.actionColor }};flex:0 0 auto"><i class="msym" style="font-size:17px">folder_open</i></button>\n' +
    '                      </div>\n' +
    '                    </div>\n'

  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 2) Data/handlers: real row.open / row.reveal, a row.hasPath flag driving
//    both the new buttons' and the menu's disabled/enabled honesty, and the
//    "Play file" menu entry rewired to the same real openPath() call instead
//    of its old toast stub. Anchored on wireDownloadHistory's own output
//    (scripts/wire-download-history.mjs), matched verbatim — this lane runs
//    strictly after that one in the generator.
// ---------------------------------------------------------------------------

function wireLibraryRowHandlers(html, replaceExact) {
  const needle =
    "      libraryRows: (s.jobHistory || []).filter(h => h.state === 'done').slice().reverse().map(h => ([\n" +
    "        h.title || h.url,\n" +
    "        h.outputPath || '(output path not recorded)',\n" +
    "        h.uploader || '—',\n" +
    "        h.sizeLabel || '—',\n" +
    "        (h.outputPath || '').split('.').pop() || '—',\n" +
    "        h.extractor ? (h.extractor + (h.videoId ? ' ' + h.videoId : '')) : '—',\n" +
    "      ])).filter(r => this.match(r.join(' '), s.librarySearch)).map(r => ({\n" +
    "        title: r[0], path: r[1], uploader: r[2], size: r[3], ext: r[4], archive: r[5],\n" +
    '        menu: e => this.openMenu(e, r[0], [\n' +
    "          { glyph: '▶', label: 'Play file', run: () => this.toast('Player', r[0]) },\n" +
    "          { glyph: '⌂', label: 'Show in Explorer', run: () => {\n" +
    '            const bridge = window.ytdlpStudio;\n' +
    "            if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio is missing'); return; }\n" +
    '            bridge.fileOps.revealPath({ path: r[1] }).then(res => {\n' +
    "              if (!res || !res.ok) this.toast('Could not open', (res && res.error) || 'Unknown error');\n" +
    "            }).catch(err => this.toast('Could not open', String(err && err.message ? err.message : err)));\n" +
    '          } },\n' +
    "          { glyph: '{}', label: 'Open .info.json', run: () => this.toast('info.json', r[0]) },\n" +
    "          { glyph: '↻', label: 'Re-download with current options', run: () => this.toast('Queued', r[0]) },\n" +
    "          { glyph: '⚙', label: 'Re-run post-processing only', run: () => this.toast('Post-processing', r[0]) },\n" +
    "          { glyph: '⊖', label: 'Remove archive id', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Removing a single id from the download archive needs a real per-row extractor id, which this list does not carry yet') },\n" +
    "          { glyph: '×', label: 'Delete file from disk', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Deleting a real file needs a dedicated main-process delete capability, which is not wired up yet — nothing on disk is touched by this menu item.') },\n" +
    '        ]),\n' +
    '      })),\n'

  const replacement =
    "      libraryRows: (s.jobHistory || []).filter(h => h.state === 'done').slice().reverse().map(h => ([\n" +
    "        h.title || h.url,\n" +
    "        h.outputPath || '(output path not recorded)',\n" +
    "        h.uploader || '—',\n" +
    "        h.sizeLabel || '—',\n" +
    "        (h.outputPath || '').split('.').pop() || '—',\n" +
    "        h.extractor ? (h.extractor + (h.videoId ? ' ' + h.videoId : '')) : '—',\n" +
    "        h.outputPath || '',\n" +
    "      ])).filter(r => this.match(r.join(' '), s.librarySearch)).map(r => {\n" +
    "        const realPath = r[6];\n" +
    "        const hasPath = !!realPath;\n" +
    "        const openFile = () => {\n" +
    '          const bridge = window.ytdlpStudio;\n' +
    "          if (!hasPath) { this.toast('No file to open', 'This download has no recorded output path yet.'); return; }\n" +
    "          if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio is missing'); return; }\n" +
    '          bridge.fileOps.openPath({ path: realPath }).then(res => {\n' +
    "            if (!res || !res.ok) this.toast('Could not open', (res && res.error) || 'Unknown error');\n" +
    "          }).catch(err => this.toast('Could not open', String(err && err.message ? err.message : err)));\n" +
    '        };\n' +
    "        const revealFile = () => {\n" +
    '          const bridge = window.ytdlpStudio;\n' +
    "          if (!hasPath) { this.toast('No file to reveal', 'This download has no recorded output path yet.'); return; }\n" +
    "          if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio is missing'); return; }\n" +
    '          bridge.fileOps.revealPath({ path: realPath }).then(res => {\n' +
    "            if (!res || !res.ok) this.toast('Could not open', (res && res.error) || 'Unknown error');\n" +
    "          }).catch(err => this.toast('Could not open', String(err && err.message ? err.message : err)));\n" +
    '        };\n' +
    '        return {\n' +
    '        title: r[0], path: r[1], uploader: r[2], size: r[3], ext: r[4], archive: r[5],\n' +
    "        hasPath, open: openFile, reveal: revealFile, actionColor: hasPath ? '#82d5cc' : '#4a5251',\n" +
    "        openTitle: hasPath ? 'Open file' : 'No output path recorded for this download yet',\n" +
    "        revealTitle: hasPath ? 'Show in Explorer' : 'No output path recorded for this download yet',\n" +
    '        menu: e => this.openMenu(e, r[0], [\n' +
    "          { glyph: '▶', label: 'Play file', run: openFile },\n" +
    "          { glyph: '⌂', label: 'Show in Explorer', run: revealFile },\n" +
    "          { glyph: '{}', label: 'Open .info.json', run: () => this.toast('info.json', r[0]) },\n" +
    "          { glyph: '↻', label: 'Re-download with current options', run: () => this.toast('Queued', r[0]) },\n" +
    "          { glyph: '⚙', label: 'Re-run post-processing only', run: () => this.toast('Post-processing', r[0]) },\n" +
    "          { glyph: '⊖', label: 'Remove archive id', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Removing a single id from the download archive needs a real per-row extractor id, which this list does not carry yet') },\n" +
    "          { glyph: '×', label: 'Delete file from disk', color: '#ffb4ab', run: () => this.toast('Not implemented', 'Deleting a real file needs a dedicated main-process delete capability, which is not wired up yet — nothing on disk is touched by this menu item.') },\n" +
    '        ]),\n' +
    '        };\n' +
    '      }),\n'

  return replaceExact(html, needle, replacement)
}

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireOpenFile(html, replaceExact) {
  html = wireLibraryRowMarkup(html, replaceExact)
  html = wireLibraryRowHandlers(html, replaceExact)
  return html
}
