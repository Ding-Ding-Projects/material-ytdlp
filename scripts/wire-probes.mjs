// scripts/wire-probes.mjs
//
// Wires the design's mocked "one-shot informational query" surfaces to the
// real bridge.probes.* IPC exposed by app/src/preload/index.ts, which in turn
// runs the real bundled yt-dlp (see app/src/main/probes.ts).
//
// Same discipline as build-renderer-from-design.mjs: every replacement is
// asserted to match EXACTLY ONCE via the caller-supplied `replaceExact`, so a
// needle that stops matching (because the design or an earlier wiring pass
// changed) fails the build loudly instead of silently leaving a mock in
// place.
//
// Exports: wireProbes(html, replaceExact) -> html
//
// This module does not import electron, node:fs, or anything else with side
// effects — it is pure string transformation, called by the orchestrator
// (scripts/build-renderer-from-design.mjs) with the html produced so far and
// its own replaceExact helper.

export function wireProbes(html, replaceExact) {
  html = wireExtractorCount(html, replaceExact)
  html = wireSiteCount(html, replaceExact)
  html = wireListSubsAndThumbnails(html, replaceExact)
  html = wireEasyUrlProbe(html, replaceExact)
  html = addProbesWireMethods(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 1. extractorCount — fetch once on mount, show the real number instead of
// the dash that build-renderer-from-design.mjs's zeroDemoState() leaves
// behind (it explicitly notes there was previously no IPC surface for this;
// probes.ts now provides one).
// ---------------------------------------------------------------------------

function wireExtractorCount(html, replaceExact) {
  // Kick the fetch off once, right after componentDidMount's other one-shot
  // setup (refreshTotp). extractorCount() is cheap and cached in the main
  // process against the binary's own --version, so calling it here costs at
  // most one real --list-extractors run per binary per app lifetime.
  html = replaceExact(
    html,
    '    this._totpTimer = setInterval(() => this.refreshTotp(), 1000);\n    this.refreshTotp();\n',
    "    this._totpTimer = setInterval(() => this.refreshTotp(), 1000);\n    this.refreshTotp();\n" +
      "    this._wire.fetchExtractorCount(this);\n",
  )

  // The badge itself: was a hard-coded '1 908 extractors' in the design,
  // already neutralized to a dash by zeroDemoState() since there was no real
  // data source. Read the real count from state now that there is one.
  html = replaceExact(
    html,
    "        { glyph: 'extension', text: '—', color: '#bec9c7', title: 'Loaded extractors',",
    "        { glyph: 'extension', text: (s.extractorCountText || '—'), color: '#bec9c7', title: 'Loaded extractors',",
  )

  return html
}

// ---------------------------------------------------------------------------
// 1b. Sites surface's own status line — a SEPARATE hardcoded literal from
// the status-bar badge above (same fabricated '1 908 extractors' figure,
// caught in a screenshot review after the badge was already fixed). Reuses
// the SAME s.extractorCountText the badge reads (populated once, on mount,
// by fetchExtractorCount below) rather than issuing a second fetch.
//
// The "24 shown" half was ALSO hardcoded even though a real filtered count
// was sitting right there — siteRows is built via a
// [...].filter(...).map(...) chain, and the literal below just never read
// its own length. Rather than duplicating the 24-row array (fragile: two
// copies that can drift), this stashes the filtered array's length as a
// side effect of building siteRows (`this._siteRowsShown = [...].filter(...)`)
// and reads it back one property later in the same object literal, which is
// legal because JS evaluates object literal property VALUES in source
// order, left to right.
// ---------------------------------------------------------------------------

function wireSiteCount(html, replaceExact) {
  html = replaceExact(html, "      siteRows: [", "      siteRows: (this._siteRowsShown = [")

  html = replaceExact(
    html,
    "].filter(r => this.match(r.join(' '), s.siteSearch)).map(r => ({\n        key: r[0], note: r[1],",
    "])).map(r => ({\n        key: r[0], note: r[1],",
  )

  html = replaceExact(
    html,
    "      siteCount: '24 shown · 1 908 extractors loaded',",
    "      siteCount: (this._siteRowsShown || []).length + ' shown · ' + (s.extractorCountText ? s.extractorCountText + ' loaded' : '— extractors loaded'),",
  )

  return html
}

// ---------------------------------------------------------------------------
// 2. Per-job "List subtitles (--list-subs)" / "List thumbnails" context menu
// items — were `this.toast(...)` mocks with fabricated numbers baked in.
// ---------------------------------------------------------------------------

function wireListSubsAndThumbnails(html, replaceExact) {
  html = replaceExact(
    html,
    "        { glyph: '⌯', label: 'List subtitles (--list-subs)', run: () => this.toast('--list-subs', '18 languages, 2 auto') },\n" +
      "        { glyph: '▢', label: 'List thumbnails', run: () => this.toast('--list-thumbnails', '7 thumbnails') },\n",
    "        { glyph: '⌯', label: 'List subtitles (--list-subs)', run: () => this._wire.listSubtitlesForJob(this, j) },\n" +
      "        { glyph: '▢', label: 'List thumbnails', run: () => this._wire.listThumbnailsForJob(this, j) },\n",
  )
  return html
}

// ---------------------------------------------------------------------------
// 3. Easy-mode "Channel detected" card — was entirely fabricated from a
// string-matching heuristic over the pasted URL (`kind()`), with specific
// numbers ("312 videos", "40 entries") that were never measured. `kind()`
// itself is left in place for icon/color selection only (a URL-shape guess
// for which glyph to show before any real answer exists is a reasonable,
// honestly-scoped use of a heuristic); the TITLE, DETAIL and ENTRY COUNT
// shown to the user now come from a real probeUrl() call, with an honest
// "not checked yet / checking / could not check" state in between.
// ---------------------------------------------------------------------------

function wireEasyUrlProbe(html, replaceExact) {
  const before = `      easyUrl: s.easyUrl, setEasyUrl: e => this.setState({ easyUrl: e.target.value }),
      pasteEasy: () => this.setState({ easyUrl: 'https://www.youtube.com/@blenderfoundation' }),
      easyKindColor: kind === 'channel' ? '#82d5cc' : kind === 'playlist' ? '#febc2e' : kind === 'empty' ? '#3f4948' : '#82d5cc',
      easyKindGlyph: kind === 'channel' ? 'subscriptions' : kind === 'playlist' ? 'playlist_play' : kind === 'empty' ? 'link' : 'play_circle',
      easyKindTitle: kind === 'channel' ? 'Channel detected' : kind === 'playlist' ? 'Playlist detected' : kind === 'empty' ? 'Waiting for a link' : 'Single video',
      easyKindDetail: kind === 'channel' ? 'Blender Foundation · 312 videos · newest 2 days ago'
        : kind === 'playlist' ? '40 entries · mixed qualities'
        : kind === 'empty' ? 'Paste anything from 1900+ supported sites'
        : 'Big Buck Bunny 4K remaster · 10:34 · 24 formats',
      easyExtractor: this.extractorOf(),
      easyIsChannel: kind === 'channel' || kind === 'playlist',
      easyEntryCount: kind === 'playlist' ? 40 : 312,
`

  const after = `      easyUrl: s.easyUrl, setEasyUrl: e => { const v = e.target.value; this.setState({ easyUrl: v }); this._wire.probeEasyUrl(this, v); },
      pasteEasy: () => { const v = 'https://www.youtube.com/@blenderfoundation'; this.setState({ easyUrl: v }); this._wire.probeEasyUrl(this, v); },
      easyKindColor: kind === 'channel' ? '#82d5cc' : kind === 'playlist' ? '#febc2e' : kind === 'empty' ? '#3f4948' : '#82d5cc',
      easyKindGlyph: kind === 'channel' ? 'subscriptions' : kind === 'playlist' ? 'playlist_play' : kind === 'empty' ? 'link' : 'play_circle',
      easyKindTitle: kind === 'empty' ? 'Waiting for a link'
        : (s.easyProbe && s.easyProbe.loading) ? 'Checking…'
        : (s.easyProbe && s.easyProbe.error) ? 'Could not check'
        : (s.easyProbe && s.easyProbe.result && s.easyProbe.result.isCollection) ? (kind === 'playlist' ? 'Playlist detected' : 'Channel detected')
        : (s.easyProbe && s.easyProbe.result) ? 'Single video'
        : 'Not checked yet',
      easyKindDetail: kind === 'empty' ? 'Paste anything from 1900+ supported sites'
        : (s.easyProbe && s.easyProbe.loading) ? 'Asking yt-dlp…'
        : (s.easyProbe && s.easyProbe.error) ? s.easyProbe.error
        : (s.easyProbe && s.easyProbe.result) ? (s.easyProbe.result.isCollection
            ? (s.easyProbe.result.entryCount != null ? s.easyProbe.result.entryCount + ' entries · first: ' + (s.easyProbe.result.title || '(no title)') : 'First entry: ' + (s.easyProbe.result.title || '(no title)'))
            : (s.easyProbe.result.title || '(no title)') + (s.easyProbe.result.durationSec != null ? ' · ' + Math.floor(s.easyProbe.result.durationSec / 60) + ':' + String(Math.round(s.easyProbe.result.durationSec % 60)).padStart(2, '0') : ''))
        : 'Press Enter or paste a link to check',
      easyExtractor: (s.easyProbe && s.easyProbe.result && s.easyProbe.result.extractor) || this.extractorOf(),
      easyIsChannel: kind === 'channel' || kind === 'playlist',
      easyEntryCount: (s.easyProbe && s.easyProbe.result && s.easyProbe.result.entryCount) || 0,
`

  return replaceExact(html, before, after)
}

// ---------------------------------------------------------------------------
// 4. New `_wire` methods. Appended right before the closing `};` / `}` of the
// `get _wire()` getter that build-renderer-from-design.mjs's wireHandlers()
// injects — the same pattern the fileops/settings-actions lanes use for
// their own additions to the same object.
// ---------------------------------------------------------------------------

function addProbesWireMethods(html, replaceExact) {
  const anchor =
    "        }).catch(err => comp.toast('Retention failed', String(err && err.message ? err.message : err)));\n" +
    "      },\n" +
    "    };\n" +
    "  }\n"

  const methods = `        }).catch(err => comp.toast('Retention failed', String(err && err.message ? err.message : err)));
      },

      // -- probes (one-shot, informational yt-dlp queries) ------------------

      fetchExtractorCount(comp) {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.probes) return;
        bridge.probes.extractorCount().then(res => {
          if (res && res.ok && res.data) comp.setState({ extractorCountText: res.data.count.toLocaleString() + ' extractors' });
          // ok:false or unparsed: leave the dash showing rather than a guess.
        }).catch(() => {});
      },

      listSubtitlesForJob(comp, j) {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.probes) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        const url = j && j.url;
        if (!url) { comp.toast('No URL on this job', 'Cannot list subtitles without a source URL'); return; }
        const requestId = 'subs-' + j.id + '-' + Date.now();
        comp.toast('--list-subs', 'Asking yt-dlp\\u2026');
        bridge.probes.listSubtitles(requestId, url).then(res => {
          if (!res || !res.ok) { comp.toast('--list-subs failed', (res && res.error && res.error.message) || 'Unknown error'); return; }
          if (!res.parsed || !res.data) { comp.toast('--list-subs', 'Ran, but the output could not be parsed \\u2014 see raw log'); return; }
          const n = res.data.tracks.length;
          const auto = res.data.tracks.filter(t => t.isAutomatic).length;
          comp.toast('--list-subs', n + ' track(s), ' + auto + ' automatic');
        }).catch(err => comp.toast('--list-subs failed', String(err && err.message ? err.message : err)));
      },

      listThumbnailsForJob(comp, j) {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.probes) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        const url = j && j.url;
        if (!url) { comp.toast('No URL on this job', 'Cannot list thumbnails without a source URL'); return; }
        const requestId = 'thumbs-' + j.id + '-' + Date.now();
        comp.toast('--list-thumbnails', 'Asking yt-dlp\\u2026');
        bridge.probes.listThumbnails(requestId, url).then(res => {
          if (!res || !res.ok) { comp.toast('--list-thumbnails failed', (res && res.error && res.error.message) || 'Unknown error'); return; }
          if (!res.parsed || !res.data) { comp.toast('--list-thumbnails', 'Ran, but the output could not be parsed \\u2014 see raw log'); return; }
          comp.toast('--list-thumbnails', res.data.thumbnails.length + ' thumbnail(s)');
        }).catch(err => comp.toast('--list-thumbnails failed', String(err && err.message ? err.message : err)));
      },

      probeEasyUrl(comp, url) {
        const bridge = window.ytdlpStudio;
        const trimmed = (url || '').trim();
        if (!bridge || !bridge.probes) return;
        // Cancel whatever is in flight for this surface before starting a
        // new one, so a fast typist's earlier keystroke cannot resolve after
        // (and overwrite) a later one.
        if (comp._easyProbeRequestId) bridge.probes.cancel(comp._easyProbeRequestId).catch(() => {});
        if (!trimmed) { comp._easyProbeRequestId = null; comp.setState({ easyProbe: null }); return; }
        const requestId = 'easy-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        comp._easyProbeRequestId = requestId;
        comp.setState({ easyProbe: { loading: true, result: null, error: null } });
        // A short debounce: wait for the user to pause typing rather than
        // spawning a yt-dlp process on every keystroke.
        clearTimeout(comp._easyProbeDebounce);
        comp._easyProbeDebounce = setTimeout(() => {
          bridge.probes.probeUrl(requestId, trimmed).then(res => {
            if (comp._easyProbeRequestId !== requestId) return; // superseded
            if (!res || !res.ok) {
              comp.setState({ easyProbe: { loading: false, result: null, error: (res && res.error && res.error.message) || 'Unknown error' } });
              return;
            }
            if (!res.parsed || !res.data) {
              comp.setState({ easyProbe: { loading: false, result: null, error: 'Could not parse yt-dlp\\'s output' } });
              return;
            }
            comp.setState({ easyProbe: { loading: false, result: res.data, error: null } });
          }).catch(err => {
            if (comp._easyProbeRequestId !== requestId) return;
            comp.setState({ easyProbe: { loading: false, result: null, error: String(err && err.message ? err.message : err) } });
          });
        }, 500);
      },
    };
  }
`

  return replaceExact(html, anchor, methods)
}
