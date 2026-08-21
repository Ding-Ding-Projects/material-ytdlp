/**
 * wireExports(html, replaceExact) — export-button wiring lane.
 *
 * Owned files: this script only. Reuses the existing
 * `window.ytdlpStudio.fileOps.exportContent` bridge (app/src/main/fileops.ts)
 * for every real Save As… + atomic write — it already runs
 * `dialog.showSaveDialog`, writes atomically, and reports the real path or
 * a real error, so nothing here builds a second export pipeline.
 *
 * This module does NOT read or write files itself — it is pure string
 * transformation, imported and called by
 * scripts/build-renderer-from-design.mjs (LAST, after fileops, settings-
 * actions and probes), which owns the overall build order and passes in
 * its own asserted `replaceExact(source, needle, replacement,
 * expected = 1)` helper. Because it runs last, every needle below is taken
 * from the fully generated `app/src/renderer/index.html`, not the raw
 * design source, so it targets text the earlier lanes have already left
 * alone.
 *
 * Scope note: the design's `exportConf` call (Export current UI as .conf)
 * and the config-file "Export as .conf" menu item are owned by the
 * orchestrator script and by scripts/wire-fileops.mjs respectively — both
 * already perform a real write through `fileOps.exportContent` and are
 * deliberately left untouched here.
 *
 * Every `this.toast('Exported', ...)` call site the design leaves behind
 * raises a toast and writes nothing. This module wires each one to
 * assemble real content from live state and write it through
 * `fileOps.exportContent`, or — where a site is a fully generic, decorative
 * menu item with no bound content in scope — leaves it as an honest
 * `toast('Not implemented', ...)` rather than a stub that claims to have
 * exported something.
 */

// A single shared export helper (Save As… + atomic write + honest
// toasts) plus a shared multi-format serializer, inserted once as new
// methods on the root component class. Every wired site below calls
// `this._exportRecords(...)` / `this._exportSerialize(...)`.
const EXPORT_HELPERS = `  get _wire() {
    const self = this;
    return {`

const EXPORT_HELPERS_REPLACEMENT = `  _exportRecords(suggestedName, contents, formatLabel) {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.fileOps) { this.toast('Not connected', 'window.ytdlpStudio.fileOps is missing'); return; }
    bridge.fileOps.exportContent({ suggestedName, contents, formatLabel }).then(res => {
      if (res.cancelled) return;
      if (!res.ok) { this.toast('Export failed', res.error || 'Unknown error'); return; }
      this.toast('Exported', res.path);
    }).catch(err => this.toast('Export failed', String(err && err.message ? err.message : err)));
  }
  // Serializes an array of plain-object rows (in the given column order)
  // into the text format the user's export-format picker currently holds.
  // Every branch states scope/generation facts as a header — a comment
  // line for source-shaped formats, a blockquote for Markdown, a leading
  // metadata record for JSONL. The four exotic source-generator formats
  // (go/rs/proto/schema.json) do not get a faithful language-specific
  // serializer here; rather than silently substituting something that
  // looks native, the file says so and carries the same data as JSON.
  _exportSerialize(format, meta, columns, rows) {
    const esc = v => (v === null || v === undefined) ? '' : String(v);
    const now = meta.generatedAt || new Date().toISOString();
    const headerLines = [meta.title, 'Scope: ' + meta.scope, 'Generated: ' + now];
    const plain = () => rows.map(r => { const o = {}; columns.forEach(c => { o[c] = r[c]; }); return o; });
    switch (format) {
      case 'json':
        return JSON.stringify({ title: meta.title, scope: meta.scope, generatedAt: now, rows: plain() }, null, 2);
      case 'jsonl': {
        const lines = [JSON.stringify({ meta: { title: meta.title, scope: meta.scope, generatedAt: now } })];
        plain().forEach(o => lines.push(JSON.stringify(o)));
        return lines.join('\\n');
      }
      case 'csv':
      case 'tsv': {
        const sep = format === 'tsv' ? '\\t' : ',';
        const q = v => { const s = esc(v); return /["\\n\\t,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const out = headerLines.map(l => '# ' + l);
        out.push(columns.join(sep));
        rows.forEach(r => out.push(columns.map(c => q(r[c])).join(sep)));
        return out.join('\\n');
      }
      case 'yaml': {
        const yv = v => { const s = esc(v); return s !== '' && /^[\\w.\\-:/ ]*$/.test(s) ? s : JSON.stringify(s); };
        const out = headerLines.map(l => '# ' + l);
        out.push('rows:');
        rows.forEach(r => { out.push('  -' + (columns.length ? '' : '')); columns.forEach((c, i) => out.push((i === 0 ? '    ' : '    ') + c + ': ' + yv(r[c]))); });
        return out.join('\\n');
      }
      case 'toml': {
        const out = headerLines.map(l => '# ' + l);
        rows.forEach(r => { out.push(''); out.push('[[rows]]'); columns.forEach(c => out.push(c + ' = ' + JSON.stringify(esc(r[c])))); });
        return out.join('\\n');
      }
      case 'xml': {
        const xv = v => esc(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<!-- ' + headerLines.join(' | ').replace(/--/g, '—') + ' -->', '<export>'];
        rows.forEach(r => { out.push('  <row>'); columns.forEach(c => out.push('    <' + c + '>' + xv(r[c]) + '</' + c + '>')); out.push('  </row>'); });
        out.push('</export>');
        return out.join('\\n');
      }
      case 'html': {
        const hv = v => esc(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const out = ['<!doctype html>', '<!-- ' + headerLines.join(' | ') + ' -->', '<table>', '<thead><tr>' + columns.map(c => '<th>' + hv(c) + '</th>').join('') + '</tr></thead>', '<tbody>'];
        rows.forEach(r => out.push('<tr>' + columns.map(c => '<td>' + hv(r[c]) + '</td>').join('') + '</tr>'));
        out.push('</tbody>', '</table>');
        return out.join('\\n');
      }
      case 'sql': {
        const sv = v => (v === null || v === undefined) ? 'NULL' : (typeof v === 'number' ? String(v) : "'" + esc(v).replace(/'/g, "''") + "'");
        const out = headerLines.map(l => '-- ' + l);
        rows.forEach(r => out.push('INSERT INTO export (' + columns.join(', ') + ') VALUES (' + columns.map(c => sv(r[c])).join(', ') + ');'));
        return out.join('\\n');
      }
      case 'ts': {
        const out = headerLines.map(l => '// ' + l);
        out.push('export const exportData = ' + JSON.stringify(plain(), null, 2) + ' as const;');
        return out.join('\\n');
      }
      case 'py': {
        const pv = v => (v === null || v === undefined) ? 'None' : (typeof v === 'boolean' ? (v ? 'True' : 'False') : (typeof v === 'number' ? String(v) : JSON.stringify(esc(v))));
        const out = headerLines.map(l => '# ' + l);
        out.push('export_data = [');
        rows.forEach(r => out.push('    {' + columns.map(c => JSON.stringify(c) + ': ' + pv(r[c])).join(', ') + '},'));
        out.push(']');
        return out.join('\\n');
      }
      case 'md': {
        const out = ['# ' + meta.title, '', '> Scope: ' + meta.scope, '> Generated: ' + now, ''];
        if (rows.length) {
          out.push('| ' + columns.join(' | ') + ' |');
          out.push('| ' + columns.map(() => '---').join(' | ') + ' |');
          rows.forEach(r => out.push('| ' + columns.map(c => esc(r[c]).replace(/\\|/g, '\\\\|').replace(/\\n/g, ' ')).join(' | ') + ' |'));
        } else {
          out.push('_No records match the current filter._');
        }
        return out.join('\\n');
      }
      case 'go':
      case 'rs':
      case 'proto':
      case 'schema.json': {
        const out = headerLines.map(l => '// ' + l);
        out.push('// A faithful ' + format + ' serializer is not implemented for this export;');
        out.push('// the data below is provided as JSON for portability instead.');
        out.push(JSON.stringify(plain(), null, 2));
        return out.join('\\n');
      }
      case 'txt':
      default: {
        const out = headerLines.slice();
        out.push('');
        if (!rows.length) { out.push('(no records match the current filter)'); return out.join('\\n'); }
        rows.forEach((r, i) => { if (i) out.push(''); columns.forEach(c => out.push(c + ': ' + esc(r[c]))); });
        return out.join('\\n');
      }
    }
  }

  get _wire() {
    const self = this;
    return {`

export function wireExports(html, replaceExact) {
  // -------------------------------------------------------------------
  // 0. Shared helpers: a real Save-As-plus-atomic-write wrapper around
  //    fileOps.exportContent, and a multi-format serializer every wired
  //    site below reuses.
  // -------------------------------------------------------------------
  html = replaceExact(html, EXPORT_HELPERS, EXPORT_HELPERS_REPLACEMENT)

  // -------------------------------------------------------------------
  // 1. History: single record.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `          { glyph: '▤', label: 'Export record', run: () => this.toast('Exported', 'history-' + r.id + '.' + s.exportFormat) },`,
    `          { glyph: '▤', label: 'Export record', run: () => this._exportRecords(
            'history-' + r.id + '.' + s.exportFormat,
            this._exportSerialize(s.exportFormat, { title: 'History record export', scope: 'single record ' + r.id }, ['time', 'surface', 'kind', 'text'],
              [{ time: r.time, surface: r.surf, kind: r.kind, text: r.text }]),
            s.exportFormat) },`
  )

  // -------------------------------------------------------------------
  // 2. History: one day's (already search/kind/surface-filtered) rows.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `          { glyph: '▤', label: 'Export the day', run: () => this.toast('Exported', dl + ' → history.' + s.exportFormat) },`,
    `          { glyph: '▤', label: 'Export the day', run: () => this._exportRecords(
            dl.replace(/[\\\\/:*?"<>|]/g, '-') + '.' + s.exportFormat,
            this._exportSerialize(s.exportFormat, { title: 'History export — ' + dl, scope: rows.length + ' record(s) on ' + dl + ' matching the current search/kind/surface filters' },
              ['time', 'surface', 'kind', 'text'], rows.map(rr => ({ time: rr.time, surface: rr.surf, kind: rr.kind, text: rr.text }))),
            s.exportFormat) },`
  )

  // -------------------------------------------------------------------
  // 3. History: "Export all" — the complete, unfiltered record set (the
  //    button is explicitly "all", so it deliberately ignores the active
  //    search/filter rather than honouring it).
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `      historyExportAll: () => this.toast('Exported', 'history.' + s.exportFormat),`,
    `      historyExportAll: () => this._exportRecords(
        'history.' + s.exportFormat,
        this._exportSerialize(s.exportFormat, { title: 'History export — everything', scope: 'all ' + recs.length + ' record(s), search and filters ignored' },
          ['time', 'surface', 'kind', 'text'], recs.map(rr => ({ time: rr.time, surface: rr.surf, kind: rr.kind, text: rr.text }))),
        s.exportFormat),`
  )

  // -------------------------------------------------------------------
  // 4. History: the current multi-selection.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `      historySelExport: () => this.toast('Exported', selCount + ' records → history-selection.' + s.exportFormat),`,
    `      historySelExport: () => this._exportRecords(
        'history-selection.' + s.exportFormat,
        this._exportSerialize(s.exportFormat, { title: 'History export — selection', scope: selCount + ' selected record(s)' },
          ['time', 'surface', 'kind', 'text'], recs.filter(rr => sel[rr.id]).map(rr => ({ time: rr.time, surface: rr.surf, kind: rr.kind, text: rr.text }))),
        s.exportFormat),`
  )

  // -------------------------------------------------------------------
  // 5. Group page: export the group's flags, in their CURRENT values, as
  //    a real .conf — same shape as the already-wired config-file export
  //    (on flags bare, off flags commented out).
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `          { glyph: '▤', label: 'Export group as .conf', run: () => this.toast('Exported', g.label + '.conf') },`,
    `          { glyph: '▤', label: 'Export group as .conf', run: () => {
            const lines = (g.flags || []).map(f => {
              const v = s.values[f.f];
              const on = v !== undefined && v !== false && v !== '';
              return (on ? '' : '# ') + f.f + (v && v !== true ? ' ' + v : '');
            });
            this._exportRecords(g.label.replace(/[\\\\/:*?"<>|]/g, '-') + '.conf',
              '# ' + g.label + ' — ' + (g.flags || []).length + ' flag(s), generated ' + new Date().toISOString() + '\\n' + lines.join('\\n'),
              'yt-dlp config');
          } },`
  )

  // -------------------------------------------------------------------
  // 6. Log page: export the currently search-filtered log lines.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `          { glyph: '▤', label: 'Export the log', run: () => this.toast('Exported', 'console.' + s.exportFormat) },`,
    `          { glyph: '▤', label: 'Export the log', run: () => this._exportRecords(
            'console.' + s.exportFormat,
            this._exportSerialize(s.exportFormat, { title: 'Log export', scope: logLines.length + ' line(s) matching the current log search' },
              ['line'], logLines.map(ll => ({ line: ll[0] }))),
            s.exportFormat) },`
  )

  // -------------------------------------------------------------------
  // 7. Current-view snapshot. This button is generic across every view,
  //    so it exports the richest real data actually in scope for the
  //    active surface: group flags+values on a group page, the queue's
  //    job rows when jobs are visible, otherwise a minimal but genuine
  //    view identifier (never a fabricated placeholder).
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `      exportView: () => this.toast('Exported', 'Current view written as .' + s.exportFormat),`,
    `      exportView: () => {
        const viewName = (meta.title || s.view || 'view');
        if (expert && s.view === 'group') {
          const lines = (group.flags || []).map(f => {
            const v = s.values[f.f];
            const on = v !== undefined && v !== false && v !== '';
            return (on ? '' : '# ') + f.f + (v && v !== true ? ' ' + v : '');
          });
          this._exportRecords(viewName.replace(/[\\\\/:*?"<>|]/g, '-') + '.conf',
            '# ' + viewName + ' — ' + (group.flags || []).length + ' flag(s), generated ' + new Date().toISOString() + '\\n' + lines.join('\\n'),
            'yt-dlp config');
        } else if (typeof jobRows !== 'undefined' && jobRows.length) {
          this._exportRecords('view.' + s.exportFormat,
            this._exportSerialize(s.exportFormat, { title: viewName + ' — download queue', scope: jobRows.length + ' job(s) matching the current queue search/state filter' },
              ['title', 'state', 'extractor', 'progress'], jobRows.map(j => ({ title: j.title, state: j.state, extractor: j.extractor, progress: j.pct + '%' }))),
            s.exportFormat);
        } else {
          this._exportRecords('view.' + s.exportFormat,
            this._exportSerialize(s.exportFormat, { title: viewName, scope: 'this view has no record list of its own to export — only its identity' },
              ['view', 'title', 'subtitle'], [{ view: s.view, title: meta.title, subtitle: meta.sub }]),
            s.exportFormat);
        }
      },`
  )

  // -------------------------------------------------------------------
  // 8. Settings page: export the current effective settings snapshot
  //    (defaults overridden by state.prefs then state.settings, exactly
  //    as this same closure already computes `store` for display).
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `            { glyph: '▤', label: 'Export settings', run: () => this.toast('Exported', 'settings.' + s.exportFormat) },`,
    `            { glyph: '▤', label: 'Export settings', run: () => this._exportRecords(
              'settings.' + s.exportFormat,
              this._exportSerialize(s.exportFormat, { title: 'Settings export', scope: Object.keys(store).length + ' current setting(s)' },
                ['setting', 'value'], Object.keys(store).map(k => ({ setting: k, value: store[k] }))),
              s.exportFormat) },`
  )

  // -------------------------------------------------------------------
  // 9. List editor bulk toolbar: export the current selection of list
  //    items (each item's flag prefix and value), never the whole list.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `        { glyph: 'file_download', label: 'Export', color: '#cfe9e5', run: () => this.toast('Exported', listItems.filter(i => i.selected).length + ' items') },`,
    `        { glyph: 'file_download', label: 'Export', color: '#cfe9e5', run: () => {
          const sel = listItems.filter(i => i.selected);
          const flagName = (s.list || {}).flag || 'list';
          this._exportRecords(flagName.replace(/^-+/, '').replace(/[\\\\/:*?"<>|]/g, '-') + '-selection.' + s.exportFormat,
            this._exportSerialize(s.exportFormat, { title: flagName + ' — selected items', scope: sel.length + ' selected item(s) of ' + listItems.length },
              ['prefix', 'value'], sel.map(it => ({ prefix: it.prefix || '', value: it.value }))),
            s.exportFormat);
        } },`
  )

  // -------------------------------------------------------------------
  // 10. Generic per-element "Export this element" house menu item. This
  //     is attached to arbitrary rows/cards/rail items across the whole
  //     app via openMenu(e, title, items); the only thing bound to the
  //     closure at the call site is the element's own title string —
  //     there is no record, list, or document behind it to serialize.
  //     Exporting just a title would be decoration pretending to be
  //     data, so this stays an honest refusal instead of a fake export.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `      { glyph: '▤', label: 'Export this element', run: () => this.toast('Exported', title + '.' + (this.state.exportFormat || 'md')) },`,
    `      { glyph: '▤', label: 'Export this element', run: () => this.toast('Not implemented', 'This is a generic per-element action with no record bound to it here — open the element\\'s own surface (History, Queue, Log, Settings…) and use its own Export action for real content') },`
  )

  // -------------------------------------------------------------------
  // 11. Rail nav "Export this surface" — same shape as #10: only the nav
  //     item's own label is in scope at this call site, not the data of
  //     whatever surface it navigates to. Honest refusal, with a pointer
  //     to the real per-surface export (or exportView once on that page).
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `          { glyph: '▤', label: 'Export this surface', run: () => this.toast('Exported', d.label + '.' + s.exportFormat) },`,
    `          { glyph: '▤', label: 'Export this surface', run: () => this.toast('Not implemented', 'Open ' + d.label + ' and use its own Export action (or the toolbar Export button) — this menu only has the nav item\\'s label, not that surface\\'s data') },`
  )

  return html
}
