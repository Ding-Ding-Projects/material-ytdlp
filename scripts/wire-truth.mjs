// scripts/wire-truth.mjs
//
// Final honesty pass: wires five remaining fabricated-but-plausible figures
// to the real bridge surfaces that already exist, or to dashes/neutral
// copy where no real surface exists yet. Same discipline as every other
// wiring lane: every replacement is asserted to match EXACTLY ONCE via the
// caller-supplied `replaceExact`, against the html produced by every lane
// that runs before this one (wireSettingsActions, wireFileOps, wireProbes,
// wireExports) — so every needle here is sourced from the GENERATED output,
// not from design/yt-dlp Studio.dc.html directly.
//
// This module does not import electron, node:fs, or anything else with side
// effects — it is pure string transformation, called last by the
// orchestrator (scripts/build-renderer-from-design.mjs) with the html
// produced by every earlier lane and its own replaceExact helper.
//
// The five things this fixes, in order:
//  1. historySummary  — fabricated '1,247 records · 482 KiB on disk · since
//     3 May 2026', now the real record count / summed known sizes / real
//     earliest record date, sourced from window.ytdlpStudio.history.
//  2. formatRows      — fabricated 11-row format table, now wired to
//     window.ytdlpStudio.probes.listFormats() with real empty / loading /
//     error / result states.
//  3. easyDownload's title entry count — fabricated 'all 312', now the real
//     count from the existing easy-mode probe (s.easyProbe), or a neutral
//     "count unknown" phrase.
//  4. easyJobs rate    — a fabricated rate formula, now read from the real
//     matching job in s.jobs (populated by the bridge's jobs.onProgress),
//     or a dash when there is no real job behind that run.
//  5. sparkCounts      — a fabricated 14-entry sparkline, now real per-day
//     counts over the last 14 days computed from s.historyCommits, which
//     renders empty (all-zero) exactly like a real quiet history would.

export function wireTruth(html, replaceExact) {
  html = addHelperMethods(html, replaceExact)
  html = wireHistorySnapshotFetch(html, replaceExact)
  html = wireHistorySummary(html, replaceExact)
  html = wireSparkCounts(html, replaceExact)
  html = wireFormatExplorer(html, replaceExact)
  html = wireEasyDownloadTitleCount(html, replaceExact)
  html = wireEasyJobsRate(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 0. New helper methods on the component prototype, inserted right before
// _totalRateLabel (an existing method already added by
// build-renderer-from-design.mjs's WIRING_METHODS, so it is a stable,
// unique anchor already present in the generated html by the time this
// lane runs).
// ---------------------------------------------------------------------------

function addHelperMethods(html, replaceExact) {
  const anchor = '  _totalRateLabel(activeJobs) {'
  const methods = `  // Real-truth wiring (scripts/wire-truth.mjs): formats a byte count for
  // display, matching _totalRateLabel's unit style but with no '/s' suffix.
  // Returns a dash for null/undefined/zero — a measured size of 0 B is a
  // different claim than "unknown", and every history record here either
  // has a real measured size or none at all.
  _formatBytesLabel(bytes) {
    if (bytes == null || !isFinite(bytes) || bytes <= 0) return '—';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GiB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MiB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + 'KiB';
    return Math.round(bytes) + 'B';
  }

  // Format Explorer wiring: the design's -F table was 11 fabricated,
  // plausible-looking rows for a video nobody downloaded. These three
  // helpers read window.ytdlpStudio.probes.listFormats() (a real bundled
  // yt-dlp run, app/src/main/probes.ts) via state.formatProbe (populated by
  // _wire.probeFormats below), and give the table honest empty / loading /
  // error / real states instead of a permanent fake catalogue.
  _formatProbeHasResults(s) {
    const p = s.formatProbe;
    return !!(p && p.result && p.result.formats && p.result.formats.length);
  }
  _formatProbeStatusText(s) {
    const p = s.formatProbe;
    if (!s.formatProbeUrl) return 'Paste a URL above and choose -F list formats to see its real, currently-available formats.';
    if (p && p.loading) return 'Asking yt-dlp for the real formats\\u2026';
    if (p && p.error) return 'Could not list formats: ' + p.error;
    if (p && p.result && !this._formatProbeHasResults(s)) return 'yt-dlp reported no formats for this URL.';
    if (this._formatProbeHasResults(s)) return s.formatProbeUrl;
    return 'Choose -F list formats to check this URL\\u2019s real, currently-available formats.';
  }
  _formatProbeRows(s) {
    const p = s.formatProbe;
    if (!p || !p.result || !p.result.formats) return [];
    return p.result.formats.map(f => {
      const resLabel = f.resolution || (f.channels ? 'audio only' : '—');
      const codecParts = [f.vcodec, f.acodec].filter(v => v && v !== 'none');
      const codecs = codecParts.length ? codecParts.join(' / ') + (f.note ? ' \\u00b7 ' + f.note : '') : (f.note || '—');
      return {
        id: f.formatId, ext: f.ext || '—', res: resLabel, fps: f.fps != null ? String(f.fps) : '—',
        size: f.fileSize || '—', tbr: f.tbr || '—', proto: f.protocol || '—', codecs,
        searchText: [f.formatId, f.ext, resLabel, f.protocol, f.vcodec, f.acodec, f.note].filter(Boolean).join(' '),
      };
    });
  }

  ${anchor}`
  return replaceExact(html, anchor, methods)
}

// ---------------------------------------------------------------------------
// 1a. Fetch getFullSnapshot() alongside the existing status()/listCommits()
// reload, so historySummary (below) has real record data to read.
// ---------------------------------------------------------------------------

function wireHistorySnapshotFetch(html, replaceExact) {
  const needle = `    const reload = () => {
      bridge.history.status().then(st => this.setState({ historyStatus: st })).catch(() => {});
      bridge.history.listCommits().then(commits => this.setState({ historyCommits: commits }))
        .catch(err => this.toast('History unavailable', String(err && err.message ? err.message : err)));
    };`
  const replacement = `    const reload = () => {
      bridge.history.status().then(st => this.setState({ historyStatus: st })).catch(() => {});
      bridge.history.listCommits().then(commits => this.setState({ historyCommits: commits }))
        .catch(err => this.toast('History unavailable', String(err && err.message ? err.message : err)));
      // Feeds historySummary's real record count / known-size total / real
      // earliest record date. Failure is silent (no toast) — listCommits
      // above already reports connectivity problems once.
      bridge.history.getFullSnapshot().then(snapshot => this.setState({ historySnapshot: snapshot })).catch(() => {});
    };`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 1b. historySummary itself: real record count, real summed known sizes,
// real earliest record date — computed inline (this function's body is a
// single object-literal return, so no new `const` statement can be
// introduced without becoming a syntax error; the computation lives in a
// small self-invoking function assigned straight to the property instead).
// ---------------------------------------------------------------------------

function wireHistorySummary(html, replaceExact) {
  const needle = `      historySummary: '1,247 records · 482 KiB on disk · since 3 May 2026',`
  const replacement = `      historySummary: (() => {
        if (historyUnavailable) return 'History unavailable' + ((s.historyStatus && s.historyStatus.reason) ? ' — ' + s.historyStatus.reason : '');
        const historyRecords = s.historySnapshot ? Object.values(s.historySnapshot) : [];
        if (!historyRecords.length) return 'No download records yet';
        const sizedBytes = historyRecords.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
        const earliestAt = Math.min.apply(null, historyRecords.map(r => r.addedAt));
        return historyRecords.length + (historyRecords.length === 1 ? ' record' : ' records') +
          ' · ' + this._formatBytesLabel(sizedBytes) + ' on disk' +
          ' · since ' + new Date(earliestAt).toLocaleDateString();
      })(),`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 5. sparkCounts: real per-day commit counts over the last 14 days, derived
// from s.historyCommits (the same real data recs is built from a few lines
// above this in the same function), instead of a fixed [1,0,2,4,...] array.
// A quiet or empty history now renders as a genuinely flat/empty spark line
// rather than a shaped fake one — the c===0 branch already in historySpark's
// mapper (a couple of lines below this needle, untouched) renders a 0-count
// day as its lowest, dimmest bar, which is exactly the honest "nothing
// happened" rendering for a real zero.
// ---------------------------------------------------------------------------

function wireSparkCounts(html, replaceExact) {
  const needle = `    const sparkCounts = [1, 0, 2, 4, 0, 3, 2, 5, 0, 2, 3, 0, 4, 7];`
  const replacement = `    const sparkDays = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (13 - i));
      return d;
    });
    const sparkCounts = sparkDays.map(dayStart => {
      const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
      return (s.historyCommits || []).filter(c => c.timestamp >= dayStart.getTime() && c.timestamp < dayEnd.getTime()).length;
    });`
  html = replaceExact(html, needle, replacement)

  // The date label baked into each spark bar's tooltip ("(7 + i) + ' Aug'")
  // was as fabricated as the counts — replace it with the real date for
  // that bar, formatted the same short way.
  const titleNeedle = `title: c + (c === 1 ? ' change · ' : ' changes · ') + (7 + i) + ' Aug' })),`
  const titleReplacement = `title: c + (c === 1 ? ' change · ' : ' changes · ') + sparkDays[i].toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) })),`
  html = replaceExact(html, titleNeedle, titleReplacement)

  return html
}

// ---------------------------------------------------------------------------
// 2. formatRows — wires the -F table to a URL input, a "-F list formats"
// button, and the real window.ytdlpStudio.probes.listFormats() bridge.
// Adds two new bits of state (formatProbeUrl, formatProbe) and rewrites the
// section markup to show a real status line plus real rows instead of the
// hard-coded "Big Buck Bunny 4K remaster" subtitle and 11 invented rows.
// ---------------------------------------------------------------------------

function wireFormatExplorer(html, replaceExact) {
  // 2a. New state fields, next to the sibling ones the design already keeps
  // for this same tab.
  html = replaceExact(
    html,
    `    formatSearch: '', outTemplate: '%(uploader)s/%(playlist|)s/%(title)s [%(id)s].%(ext)s',`,
    `    formatProbeUrl: '', formatProbe: null,
    formatSearch: '', outTemplate: '%(uploader)s/%(playlist|)s/%(title)s [%(id)s].%(ext)s',`,
  )

  // 2b. Markup: URL input + probe button replace the fixed "Big Buck Bunny
  // 4K remaster · aqz-KE-bpKQ" subtitle; the fixed header row + grid are now
  // shown only once real results exist, with a plain status message
  // otherwise (idle / loading / error / no-formats-reported).
  const markupNeedle = `                <section style="grid-column:1/-1;background:#1b2121;border:0;border-radius:12px;padding:16px">
                  <div style="display:flex;gap:10px;align-items:end;margin-bottom:14px;flex-wrap:wrap">
                    <div style="flex:1;min-width:250px">
                      <h2 style="font-size:11px;margin:0 0 3px;letter-spacing:.9px;text-transform:uppercase;color:#bec9c7;font-weight:800">-F available formats</h2>
                      <p style="margin:0;color:#bec9c7">Big Buck Bunny 4K remaster · aqz-KE-bpKQ · right-click a row for per-format actions</p>
                    </div>
                    <label style="display:grid;gap:5px;font-weight:700;font-size:12px;color:#bec9c7;flex:0 0 340px">Search formats
                      <div style="display:flex;gap:5px">
                        <input value="{{ formatSearch }}" onChange="{{ setFormatSearch }}" placeholder="id, ext, codec, resolution, note" style="width:100%;background:#252b2b;border:1px solid #3f4948;border-radius:6px;color:#dee4e3;padding:6px 9px;font-size:12px" />
                        <button onClick="{{ openRegexFormats }}" title="Regex builder" style="height:27px;min-width:27px;background:#303636;border-radius:6px;color:#82d5cc;font-weight:800">.*</button>
                      </div>
                    </label>
                  </div>
                  <div style="display:grid;grid-template-columns:78px 62px 118px 66px 92px 108px 108px minmax(0,1fr);gap:10px;padding:0 12px 8px;color:#889391;font-size:10.5px;font-weight:800;letter-spacing:.7px;font-family:'Roboto Mono',Consolas,monospace">
                    <div>ID</div><div>EXT</div><div>RESOLUTION</div><div>FPS</div><div>FILESIZE</div><div>TBR</div><div>PROTO</div><div>VCODEC / ACODEC</div>
                  </div>
                  <div style="display:grid;gap:4px">
                    <sc-for list="{{ formatRows }}" as="fmt" hint-placeholder-count="8">
                      <div onContextMenu="{{ fmt.menu }}" onClick="{{ fmt.pick }}" style="display:grid;grid-template-columns:78px 62px 118px 66px 92px 108px 108px minmax(0,1fr);gap:10px;padding:9px 12px;border-radius:10px;background:{{ fmt.bg }};font-family:'Roboto Mono',Consolas,monospace;font-size:12px;align-items:center">
                        <b style="color:{{ fmt.idColor }}">{{ fmt.id }}</b>
                        <span style="color:#bec9c7">{{ fmt.ext }}</span>
                        <span style="color:#dee4e3">{{ fmt.res }}</span>
                        <span style="color:#bec9c7">{{ fmt.fps }}</span>
                        <span style="color:#bec9c7">{{ fmt.size }}</span>
                        <span style="color:#bec9c7">{{ fmt.tbr }}</span>
                        <span style="color:#bec9c7">{{ fmt.proto }}</span>
                        <span style="color:#889391;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ fmt.codecs }}</span>
                      </div>
                    </sc-for>
                  </div>
                </section>`
  const markupReplacement = `                <section style="grid-column:1/-1;background:#1b2121;border:0;border-radius:12px;padding:16px">
                  <div style="display:flex;gap:10px;align-items:end;margin-bottom:14px;flex-wrap:wrap">
                    <div style="flex:1;min-width:250px">
                      <h2 style="font-size:11px;margin:0 0 3px;letter-spacing:.9px;text-transform:uppercase;color:#bec9c7;font-weight:800">-F available formats</h2>
                      <p style="margin:0;color:#bec9c7">{{ formatProbeStatusText }}</p>
                      <div style="display:flex;gap:5px;margin-top:8px">
                        <input value="{{ formatProbeUrl }}" onChange="{{ setFormatProbeUrl }}" placeholder="Paste a URL to list its real formats" spellcheck="false" style="flex:1;min-width:220px;background:#252b2b;border:1px solid #3f4948;border-radius:6px;color:#dee4e3;padding:6px 9px;font-family:'Roboto Mono',Consolas,monospace;font-size:12px" />
                        <button onClick="{{ runFormatProbe }}" style="padding:6px 12px;border-radius:6px;font-weight:700;background:#303636;color:#82d5cc;font-size:11.5px;white-space:nowrap">-F list formats</button>
                      </div>
                    </div>
                    <label style="display:grid;gap:5px;font-weight:700;font-size:12px;color:#bec9c7;flex:0 0 340px">Search formats
                      <div style="display:flex;gap:5px">
                        <input value="{{ formatSearch }}" onChange="{{ setFormatSearch }}" placeholder="id, ext, codec, resolution, note" style="width:100%;background:#252b2b;border:1px solid #3f4948;border-radius:6px;color:#dee4e3;padding:6px 9px;font-size:12px" />
                        <button onClick="{{ openRegexFormats }}" title="Regex builder" style="height:27px;min-width:27px;background:#303636;border-radius:6px;color:#82d5cc;font-weight:800">.*</button>
                      </div>
                    </label>
                  </div>
                  <sc-if value="{{ formatHasResults }}" hint-placeholder-val="{{ true }}">
                  <div style="display:grid;grid-template-columns:78px 62px 118px 66px 92px 108px 108px minmax(0,1fr);gap:10px;padding:0 12px 8px;color:#889391;font-size:10.5px;font-weight:800;letter-spacing:.7px;font-family:'Roboto Mono',Consolas,monospace">
                    <div>ID</div><div>EXT</div><div>RESOLUTION</div><div>FPS</div><div>FILESIZE</div><div>TBR</div><div>PROTO</div><div>VCODEC / ACODEC</div>
                  </div>
                  <div style="display:grid;gap:4px">
                    <sc-for list="{{ formatRows }}" as="fmt" hint-placeholder-count="8">
                      <div onContextMenu="{{ fmt.menu }}" onClick="{{ fmt.pick }}" style="display:grid;grid-template-columns:78px 62px 118px 66px 92px 108px 108px minmax(0,1fr);gap:10px;padding:9px 12px;border-radius:10px;background:{{ fmt.bg }};font-family:'Roboto Mono',Consolas,monospace;font-size:12px;align-items:center">
                        <b style="color:{{ fmt.idColor }}">{{ fmt.id }}</b>
                        <span style="color:#bec9c7">{{ fmt.ext }}</span>
                        <span style="color:#dee4e3">{{ fmt.res }}</span>
                        <span style="color:#bec9c7">{{ fmt.fps }}</span>
                        <span style="color:#bec9c7">{{ fmt.size }}</span>
                        <span style="color:#bec9c7">{{ fmt.tbr }}</span>
                        <span style="color:#bec9c7">{{ fmt.proto }}</span>
                        <span style="color:#889391;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ fmt.codecs }}</span>
                      </div>
                    </sc-for>
                  </div>
                  </sc-if>
                </section>`
  html = replaceExact(html, markupNeedle, markupReplacement)

  // 2c. Object-literal properties: replace the fixed formatRows array with
  // the real, probe-backed rows, and expose the two new status props the
  // markup above now reads.
  const dataNeedle = `      formatSearch: s.formatSearch, setFormatSearch: e => this.setState({ formatSearch: e.target.value }),
      openRegexFormats: () => this.setState({ dialog: 'regex', regexTarget: 'formats' }),
      formatRows: [
        ['sb2', 'mhtml', '48x27', '0', '—', '—', 'mhtml', 'images'],
        ['139', 'm4a', 'audio only', '—', '1.29MiB', '48k', 'https', 'audio only / mp4a.40.5'],
        ['140', 'm4a', 'audio only', '—', '9.85MiB', '129k', 'https', 'audio only / mp4a.40.2'],
        ['251', 'webm', 'audio only', '—', '9.92MiB', '132k', 'https', 'audio only / opus'],
        ['160', 'mp4', '256x144', '24', '1.18MiB', '48k', 'https', 'avc1.4d400c / video only'],
        ['133', 'mp4', '426x240', '24', '2.15MiB', '96k', 'https', 'avc1.4d4015 / video only'],
        ['136', 'mp4', '1280x720', '24', '25.4MiB', '1189k', 'https', 'avc1.4d401f / video only'],
        ['137', 'mp4', '1920x1080', '24', '48.9MiB', '2402k', 'https', 'avc1.640028 / video only'],
        ['315', 'webm', '3840x2160', '60', '212MiB', '9410k', 'https', 'vp9 / video only'],
        ['625', 'mp4', '3840x2160', '60', '198MiB', '8802k', 'https', 'av01.0.13M.08 / video only'],
        ['18', 'mp4', '640x360', '24', '12.7MiB', '611k', 'https', 'avc1.42001E / mp4a.40.2'],
      ].filter(r => this.match(r.join(' '), s.formatSearch)).map(r => ({
        id: r[0], ext: r[1], res: r[2], fps: r[3], size: r[4], tbr: r[5], proto: r[6], codecs: r[7],
        bg: s.formatExpr.includes(r[0]) ? '#243634' : '#252b2b',
        idColor: r[2] === 'audio only' ? '#febc2e' : '#82d5cc',
        pick: () => this.setState({ formatExpr: r[0] }),
        menu: e => this.openMenu(e, 'format ' + r[0], [
          { glyph: 'f', label: 'Use as -f ' + r[0], run: () => this.setState({ formatExpr: r[0] }) },
          { glyph: '+', label: 'Merge with best audio', run: () => this.setState({ formatExpr: r[0] + '+ba' }) },
          { glyph: '⎘', label: 'Copy format id', run: () => this.toast('Copied', r[0]) },
          { glyph: '↓', label: 'Download only this format', run: () => this.toast('Queued', 'format ' + r[0]) },
          { glyph: '✓', label: 'Check it is downloadable', run: () => this.toast('--check-formats', 'format ' + r[0] + ' is downloadable') },
          { glyph: '{}', label: 'Copy this format JSON', run: () => this.toast('Copied', 'format ' + r[0] + ' json') },
        ]),
      })),`
  const dataReplacement = `      formatProbeUrl: s.formatProbeUrl, setFormatProbeUrl: e => this.setState({ formatProbeUrl: e.target.value }),
      runFormatProbe: () => this._wire.probeFormats(this, s.formatProbeUrl),
      formatProbeStatusText: this._formatProbeStatusText(s),
      formatHasResults: this._formatProbeHasResults(s),
      formatSearch: s.formatSearch, setFormatSearch: e => this.setState({ formatSearch: e.target.value }),
      openRegexFormats: () => this.setState({ dialog: 'regex', regexTarget: 'formats' }),
      formatRows: this._formatProbeRows(s).filter(r => this.match(r.searchText, s.formatSearch)).map(r => ({
        id: r.id, ext: r.ext, res: r.res, fps: r.fps, size: r.size, tbr: r.tbr, proto: r.proto, codecs: r.codecs,
        bg: s.formatExpr.includes(r.id) ? '#243634' : '#252b2b',
        idColor: r.res === 'audio only' ? '#febc2e' : '#82d5cc',
        pick: () => this.setState({ formatExpr: r.id }),
        menu: e => this.openMenu(e, 'format ' + r.id, [
          { glyph: 'f', label: 'Use as -f ' + r.id, run: () => this.setState({ formatExpr: r.id }) },
          { glyph: '+', label: 'Merge with best audio', run: () => this.setState({ formatExpr: r.id + '+ba' }) },
          { glyph: '⎘', label: 'Copy format id', run: () => this.toast('Copied', r.id) },
          { glyph: '↓', label: 'Download only this format', run: () => this.toast('Queued', 'format ' + r.id) },
          { glyph: '✓', label: 'Check it is downloadable', run: () => this.toast('--check-formats', 'format ' + r.id + ' is downloadable') },
          { glyph: '{}', label: 'Copy this format JSON', run: () => this.toast('Copied', 'format ' + r.id + ' json') },
        ]),
      })),`
  html = replaceExact(html, dataNeedle, dataReplacement)

  // 2d. New _wire.probeFormats action, appended after wireProbes' own
  // probeEasyUrl (the last method wireProbes adds to the same `get _wire()`
  // getter — this anchor is therefore stable across build order as long as
  // wireProbes still runs before this lane, which build-renderer-from-
  // design.mjs's comments already require).
  const wireAnchor = `        }, 500);
      },
    };
  }
`
  const wireReplacement = `        }, 500);
      },

      probeFormats(comp, url) {
        const bridge = window.ytdlpStudio;
        const trimmed = (url || '').trim();
        if (!bridge || !bridge.probes) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        if (!trimmed) { comp.setState({ formatProbe: null }); return; }
        const requestId = 'formats-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        comp.setState({ formatProbe: { loading: true, result: null, error: null } });
        bridge.probes.listFormats(requestId, trimmed).then(res => {
          if (!res || !res.ok) {
            comp.setState({ formatProbe: { loading: false, result: null, error: (res && res.error && res.error.message) || 'Unknown error' } });
            return;
          }
          if (!res.parsed || !res.data) {
            comp.setState({ formatProbe: { loading: false, result: null, error: 'Could not parse yt-dlp\\'s output' } });
            return;
          }
          comp.setState({ formatProbe: { loading: false, result: res.data, error: null } });
        }).catch(err => {
          comp.setState({ formatProbe: { loading: false, result: null, error: String(err && err.message ? err.message : err) } });
        });
      },
    };
  }
`
  html = replaceExact(html, wireAnchor, wireReplacement)

  return html
}

// ---------------------------------------------------------------------------
// 3. easyDownload's title used a fixed 'all 312' entry count regardless of
// what was actually probed. Read the real count from state.easyProbe (the
// same easy-mode probe wireProbes.mjs already populates via probeEasyUrl),
// falling back to a neutral "count unknown" phrase rather than a number
// nobody measured.
// ---------------------------------------------------------------------------

function wireEasyDownloadTitleCount(html, replaceExact) {
  const needle = `        const title = kind === 'channel' ? 'Blender Foundation — ' + (s.easyScope === 'all' ? 'all 312' : s.easyLimit) + ' videos' : 'Big Buck Bunny 4K remaster';`
  const replacement = `        const knownEntryCount = s.easyProbe && s.easyProbe.result && s.easyProbe.result.entryCount != null ? s.easyProbe.result.entryCount : null;
        const scopeLabel = s.easyScope === 'all' ? (knownEntryCount != null ? 'all ' + knownEntryCount : 'all (count unknown)') : s.easyLimit;
        const title = kind === 'channel' ? 'Blender Foundation — ' + scopeLabel + ' videos' : 'Big Buck Bunny 4K remaster';`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 4. easyJobs rate was computed from a fabricated formula tied to r.pct
// rather than any real measurement. Each easyRuns entry now carries the
// real job id from _startJob (see _wire.easyDownload, added earlier in
// build-renderer-from-design.mjs) when the bridge is connected, so the
// matching entry in s.jobs — kept live by the real jobs.onProgress
// subscription in _wireBridge — is the real source of truth for both
// progress and rate. A run with no matching live job (no bridge connected,
// or the job already dropped off the list) renders with a dash and no
// motion rather than a guessed number.
// ---------------------------------------------------------------------------

function wireEasyJobsRate(html, replaceExact) {
  const needle = `      easyJobs: s.easyRuns.map(r => ({
        title: r.title, width: r.pct + '%', rate: r.pct >= 100 ? '—' : (5 + Math.round(r.pct % 5)) + '.2MiB/s',
        accent: r.pct >= 100 ? '#889391' : '#82d5cc', stateLabel: r.pct >= 100 ? 'DONE' : r.pct.toFixed(0) + '%',
      })),`
  const replacement = `      easyJobs: s.easyRuns.map(r => {
        const liveJob = s.jobs.find(j => j.id === r.id);
        const pct = liveJob ? liveJob.pct : r.pct;
        const done = liveJob ? liveJob.state === 'done' : pct >= 100;
        return {
          title: r.title, width: pct + '%',
          rate: done ? '—' : (liveJob && liveJob.rate) ? liveJob.rate : '—',
          accent: done ? '#889391' : '#82d5cc', stateLabel: done ? 'DONE' : pct.toFixed(0) + '%',
        };
      }),`
  return replaceExact(html, needle, replacement)
}
