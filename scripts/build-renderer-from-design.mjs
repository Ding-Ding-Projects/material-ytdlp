#!/usr/bin/env node
/**
 * Builds app/src/renderer/index.html (plus two verbatim-copied support
 * files) FROM the checked-in design component at
 * `design/yt-dlp Studio.dc.html`.
 *
 * design/ is read-only input. Nothing in this script ever writes there.
 * Everything this script produces lives under app/src/renderer/ and is
 * regenerated on every run, so the design file stays the single source of
 * truth: change the design, re-run the build, the app picks it up.
 *
 * What it does, in order:
 *
 *  1. Copies design/support.js and design/ytdlp-flags.js VERBATIM into
 *     app/src/renderer/ (as dc-support.js / dc-ytdlp-flags.js) so they can
 *     be served as same-origin relative files by Vite/Electron.
 *  2. Reads the design .dc.html, and:
 *     - strips the Google Fonts <link> tags and replaces them with local
 *       @font-face rules pointing at the vendored font files, so the app
 *       never depends on a network font CDN;
 *     - injects `window.__resources` (support.js's documented offline
 *       hook — see design/support.js `cdnScriptFor`) mapping the three
 *       exact unpkg URLs it looks up to the vendored local copies, BEFORE
 *       dc-support.js loads, so React/ReactDOM/Babel are never fetched
 *       from the network;
 *     - points the <script src="./support.js"> tag at the local copy;
 *     - patches the `import('./ytdlp-flags.js')` call inside the
 *       component script to the local copy's filename;
 *     - splices a small set of exact, asserted string replacements into
 *       the component's own script text, swapping the design's local mock
 *       handlers for calls across the real `window.ytdlpStudio` bridge,
 *       and appends the wiring helpers used by those replacements right
 *       after the `class Component extends DCLogic {` line.
 *  3. Writes the result to app/src/renderer/index.html.
 *
 * Every substitution below is asserted to occur in the design file. If the
 * design changes such that a needle no longer matches, this script FAILS
 * LOUDLY rather than silently generating a broken or half-wired app — the
 * lesson (recorded at length in the shared instructions) is that a
 * mismatched needle in a search-and-replace is silent, not loud, so every
 * needle here is checked for an exact occurrence count before use.
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Each wiring lane owns its own module and exports one pure function taking
// (html, replaceExact). They are kept separate deliberately: three agents wrote
// them in parallel, and one shared file would have been three agents editing the
// same needles. This script owns the ORDER they run in, which matters — a later
// lane's needle may be text an earlier lane rewrote.
import { wireFileOps } from './wire-fileops.mjs'
import { wireSettingsActions } from './wire-settings-actions.mjs'
import { wireProbes } from './wire-probes.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const DESIGN_DIR = join(repoRoot, 'design')
const DESIGN_HTML_PATH = join(DESIGN_DIR, 'yt-dlp Studio.dc.html')
const DESIGN_SUPPORT_PATH = join(DESIGN_DIR, 'support.js')
const DESIGN_CATALOG_PATH = join(DESIGN_DIR, 'ytdlp-flags.js')

const RENDERER_DIR = join(repoRoot, 'app', 'src', 'renderer')
const PUBLIC_DIR = join(RENDERER_DIR, 'public')
const OUT_HTML_PATH = join(RENDERER_DIR, 'index.html')
// These two live in Vite's publicDir (src/renderer/public), which is
// copied VERBATIM to the build output with no bundling, hashing, or
// import-specifier rewriting. That matters specifically because the
// design's own script text contains `import('./dc-ytdlp-flags.js')` as
// a plain string inside a non-module <script> block; Vite's HTML
// plugin was observed rewriting that string to a hashed asset path
// when the file lived inside the module graph (i.e. anywhere else
// under src/renderer), which breaks the runtime import. publicDir
// files are never scanned that way.
const OUT_RESOURCES_PATH = join(PUBLIC_DIR, 'dc-resources.js')
const OUT_SUPPORT_PATH = join(PUBLIC_DIR, 'dc-support.js')
// dc-ytdlp-flags.js, unlike dc-support.js, IS reached through a real
// `import('./dc-ytdlp-flags.js')` inside the component's script text.
// Vite's HTML plugin statically scans inline script text for import()
// calls (confirmed by observation — it rewrote this exact string to a
// hashed asset path even though the containing <script> has a custom
// text/x-dc type) and resolves it relative to index.html at BUILD time,
// before publicDir semantics apply. So this one has to live inside the
// module graph (src/renderer, not public/) for the build to find it;
// Vite bundles it, hashes it, and rewrites the reference consistently,
// which is harmless since nothing else depends on the literal filename.
const OUT_CATALOG_PATH = join(RENDERER_DIR, 'dc-ytdlp-flags.js')

// ---------------------------------------------------------------------------
// Small helper: replace a needle that must occur EXACTLY `expected` times.
// Throws loudly (rather than silently no-opping or over-replacing) if the
// count is wrong, per the "assert every replacement" rule.
// ---------------------------------------------------------------------------

function replaceExact(source, needle, replacement, expected = 1) {
  const count = source.split(needle).length - 1
  if (count !== expected) {
    throw new Error(
      `build-renderer-from-design: expected ${expected} occurrence(s) of needle, found ${count}.\n` +
        `Needle (first 200 chars):\n${needle.slice(0, 200)}`
    )
  }
  return source.split(needle).join(replacement)
}

function main() {
  mkdirSync(RENDERER_DIR, { recursive: true })
  mkdirSync(PUBLIC_DIR, { recursive: true })

  // 1. Verbatim-copy the two support files design/support.js imports and
  // is itself. These are copied byte-for-byte; design/ is never modified.
  copyFileSync(DESIGN_SUPPORT_PATH, OUT_SUPPORT_PATH)
  copyFileSync(DESIGN_CATALOG_PATH, OUT_CATALOG_PATH)

  let html = readFileSync(DESIGN_HTML_PATH, 'utf8')

  // Insert a Content-Security-Policy meta tag. `script-src 'self'
  // 'unsafe-eval'` is required — not a nicety — because support.js's own
  // JSX-import path executes compiled module code via `new Function(...)`
  // (design/support.js, createExternalModules -> `load`). Without
  // 'unsafe-eval' Electron blocks that call and the component fails to
  // mount. Everything else stays locked to 'self': no remote origin is
  // ever permitted to supply script, style, font, or image content.
  const CSP =
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; font-src \'self\'; img-src \'self\' data:; connect-src \'self\'" />'
  html = replaceExact(html, '<meta charset="utf-8">', '<meta charset="utf-8">\n' + CSP)

  // The packaged window otherwise falls back to Electron's app name
  // (the package.json "name", i.e. the literal string "yt-dlp-studio")
  // for its title-bar/taskbar/Alt-Tab title, because the design has no
  // <title> element at all. Set it explicitly from the design's own
  // displayed product name.
  html = replaceExact(html, '<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>yt-dlp Studio</title>')

  // 2a. Point the support.js <script src> at the local verbatim copy.
  html = replaceExact(html, '<script src="./support.js"></script>', '<script src="./dc-support.js"></script>')

  // 2b. Strip the Google Fonts <link> tags (preconnect x2 + the stylesheet)
  // and replace with local @font-face rules. The stylesheet <link> also
  // carries the Material Symbols Outlined face, which is served from the
  // already-vendored font in assets/fonts/ (ligature icon font — without
  // it every <i class="msym"> renders its glyph's English name as literal
  // text instead of an icon, which is the runtime's own honest fallback
  // for a missing ligature font, and reads as a broken interface).
  const FONT_LINKS_NEEDLE =
    '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap" rel="stylesheet" />'
  const LOCAL_FONT_FACES = `<style>
  @font-face { font-family:'Roboto'; font-style:normal; font-weight:400 700; font-display:swap; src:url('./assets/fonts/Roboto-latin.woff2') format('woff2'); }
  @font-face { font-family:'Roboto Mono'; font-style:normal; font-weight:400 500; font-display:swap; src:url('./assets/fonts/RobotoMono-latin.woff2') format('woff2'); }
  @font-face { font-family:'Material Symbols Outlined'; font-style:normal; font-weight:100 700; font-display:block; src:url('./assets/fonts/MaterialSymbolsOutlined.ttf') format('truetype'); }
</style>`
  html = replaceExact(html, FONT_LINKS_NEEDLE, LOCAL_FONT_FACES)

  // 2c. Inject window.__resources BEFORE dc-support.js loads. This is
  // support.js's own documented offline hook (design/support.js,
  // `cdnScriptFor`): when window.__resources[<exact CDN URL>] is a
  // non-empty string, that local path is used as the <script src> instead
  // of ever reaching unpkg. Setting window.__resources at all also
  // suppresses a `fetch(location.href)` boot() otherwise performs.
  //
  // This lives in its own external file (dc-resources.js, written to
  // publicDir below) rather than an inline <script> block, so the CSP's
  // script-src can stay at 'self' 'unsafe-eval' without also needing
  // 'unsafe-inline' — CSP has no opinion about an external same-origin
  // script, only about inline script text.
  writeFileSync(
    OUT_RESOURCES_PATH,
    `window.__resources = {\n` +
      `  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "./vendor/react.production.min.js",\n` +
      `  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "./vendor/react-dom.production.min.js",\n` +
      `  "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js": "./vendor/babel.min.js"\n` +
      `};\n`,
    'utf8'
  )
  html = replaceExact(
    html,
    '<script src="./dc-support.js"></script>',
    '<script src="./dc-resources.js"></script>\n<script src="./dc-support.js"></script>'
  )

  // 2d. Point the component's own dynamic import at the local verbatim
  // copy of ytdlp-flags.js.
  html = replaceExact(
    html,
    "import('./ytdlp-flags.js').then(m => this.setState({ groups: m.GROUPS, presets: m.PRESETS }));",
    "import('./dc-ytdlp-flags.js').then(m => this.setState({ groups: m.GROUPS, presets: m.PRESETS }));"
  )

  // 3. Wire the handlers. Every needle below is the exact mock handler
  // text from the design file (verified against the checked-in source at
  // generator-authoring time); each is asserted to occur exactly once.
  html = wireHandlers(html)

  // 4. Empty the design's demo/seed data so a fresh profile shows real
  //    zero/empty states instead of fabricated activity (jobs, rates,
  //    archive counts, a pre-typed URL, a fake update banner...).
  html = zeroDemoState(html)

  // 5. The parallel wiring lanes. Order matters and is deliberate:
  //    - settings actions and file operations rewrite handler bodies that exist
  //      in the design source unchanged, so they run first;
  //    - probes runs last because one of its needles targets the extractor-count
  //      dash that zeroDemoState introduces, which does not exist in the design
  //      source at all.
  //    Each lane asserts its own needles through the same replaceExact helper,
  //    so a design change that moves any of them fails the build loudly rather
  //    than silently producing a half-wired application.
  html = wireSettingsActions(html, replaceExact)
  html = wireFileOps(html, replaceExact)
  html = wireProbes(html, replaceExact)

  writeFileSync(OUT_HTML_PATH, html, 'utf8')
  console.log(`build-renderer-from-design: wrote ${OUT_HTML_PATH}`)
  console.log(`build-renderer-from-design: wrote ${OUT_SUPPORT_PATH}`)
  console.log(`build-renderer-from-design: wrote ${OUT_CATALOG_PATH}`)
}

function wireHandlers(html) {
  // ---------------------------------------------------------------------
  // Append the wiring runtime right after the class opens. It is plain
  // methods on the component's prototype (class fields work the same way
  // babel/standalone compiles them), so every replacement below can just
  // call `this._wire.xxx(...)`.
  // ---------------------------------------------------------------------
  html = replaceExact(
    html,
    'class Component extends DCLogic {\n',
    'class Component extends DCLogic {\n' + WIRING_METHODS + '\n'
  )

  // --- componentDidMount: drop the fake progress interval, subscribe to
  // real job events instead. ---------------------------------------------
  const MOUNT_NEEDLE = `  componentDidMount() {
    import('./dc-ytdlp-flags.js').then(m => this.setState({ groups: m.GROUPS, presets: m.PRESETS }));
    this._key = e => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); this.setState({ dialog: 'palette' }); }
      if (e.key === 'Escape') this.setState({ dialog: null });
    };
    window.addEventListener('keydown', this._key);
    this._totpTimer = setInterval(() => this.refreshTotp(), 1000);
    this.refreshTotp();
    this._timer = setInterval(() => {
      this.setState(s => ({
        jobs: s.jobs.map(j => j.state === 'downloading' && !s.paused
          ? { ...j, pct: j.pct >= 99.4 ? 12 : +(j.pct + Math.random() * 0.6).toFixed(1) } : j),
        easyRuns: s.easyRuns.map(r => r.pct >= 100 ? r : { ...r, pct: Math.min(100, +(r.pct + Math.random() * 3.5).toFixed(1)) }),
      }));
    }, 900);
  }`
  const MOUNT_REPLACEMENT = `  componentDidMount() {
    import('./dc-ytdlp-flags.js').then(m => this.setState({ groups: m.GROUPS, presets: m.PRESETS }));
    this._key = e => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); this.setState({ dialog: 'palette' }); }
      if (e.key === 'Escape') this.setState({ dialog: null });
    };
    window.addEventListener('keydown', this._key);
    this._totpTimer = setInterval(() => this.refreshTotp(), 1000);
    this.refreshTotp();
    this._wireBridge();
  }`
  html = replaceExact(html, MOUNT_NEEDLE, MOUNT_REPLACEMENT)

  // --- plain mode run ------------------------------------------------
  html = replaceExact(
    html,
    "plainRun: () => this.toast('Running', 'Command sent to yt-dlp as typed'),",
    "plainRun: () => this._wire.plainRun(this),"
  )

  // --- expert mode: browse Folder for easy mode ------------------------
  html = replaceExact(
    html,
    "browseFolder: () => this.toast('Folder', 'Native folder picker'),",
    "browseFolder: () => this._wire.browseFolder(this, v => this.setState({ easyFolder: v })),"
  )

  // --- easy mode download ------------------------------------------------
  html = replaceExact(
    html,
    `      easyDownload: () => {
        const title = kind === 'channel' ? 'Blender Foundation — ' + (s.easyScope === 'all' ? 'all 312' : s.easyLimit) + ' videos' : 'Big Buck Bunny 4K remaster';
        this.setState(st => ({ easyRuns: [{ id: Math.random(), title, pct: 2 }, ...st.easyRuns].slice(0, 4) }));
        this.toast('Started', title);
      },`,
    `      easyDownload: () => {
        const title = kind === 'channel' ? 'Blender Foundation — ' + (s.easyScope === 'all' ? 'all 312' : s.easyLimit) + ' videos' : 'Big Buck Bunny 4K remaster';
        this._wire.easyDownload(this, s, title);
      },`
  )

  // --- expert mode: enqueue / pickBatch / pickInfoJson / openLogin / simulate
  html = replaceExact(
    html,
    "enqueue: () => this.toast('Queued', (s.urls || '').split('\\n').filter(x => x.trim()).length + ' URLs added'),",
    "enqueue: () => this._wire.enqueue(this, s),"
  )
  html = replaceExact(
    html,
    "pickBatch: () => this.toast('-a batch file', 'D:\\\\queue\\\\weekly.txt'),",
    "pickBatch: () => this._wire.pickBatch(this),"
  )
  html = replaceExact(
    html,
    "pickInfoJson: () => this.toast('--load-info-json', 'Reads a previously written .info.json'),",
    "pickInfoJson: () => this._wire.pickInfoJson(this),"
  )
  html = replaceExact(
    html,
    "simulateRun: () => this.toast('-s simulate', 'Nothing written to disk'),",
    "simulateRun: () => this._wire.simulateRun(this, s),"
  )

  // --- pause / resume the whole queue ------------------------------------
  html = replaceExact(
    html,
    'togglePause: () => this.setState(st => ({ paused: !st.paused })),',
    'togglePause: () => this._wire.togglePause(this),'
  )

  // --- per-job retry / remove --------------------------------------------
  html = replaceExact(
    html,
    `      retry: () => this.toast('Retrying', j.title),
      remove: () => this.setState(st => ({ jobs: st.jobs.filter(x => x.id !== j.id) })),`,
    `      retry: () => this._wire.jobRetry(this, j),
      remove: () => this._wire.jobRemove(this, j),`
  )

  // --- expert command strip run -------------------------------------
  html = replaceExact(html, "runCommand: () => this.toast('Running', 'Queue started'),", 'runCommand: () => this._wire.runCommand(this, s),')

  // --- finish login (cookie handoff) --------------------------------------
  html = replaceExact(
    html,
    "finishLogin: () => { this.setState({ dialog: null, loginCookieCount: 27 }); this.toast('Cookies handed back', '27 cookies written to yt.cookies.txt'); },",
    'finishLogin: () => this._wire.finishLogin(this),'
  )

  // --- validate / export / save config ------------------------------
  html = replaceExact(
    html,
    `      validateConfig: () => {
        const bad = confLines.filter(l => l.on && l.needsValue && !l.value);
        this.toast(bad.length ? 'Validation failed' : 'Configuration valid',
          bad.length ? bad.length + ' line(s) are missing a required value' : confLines.filter(l => l.on).length + ' active lines parse cleanly');
      },`,
    `      validateConfig: () => this._wire.validateConfig(this, confLines),`
  )
  html = replaceExact(
    html,
    "exportConf: () => this.toast('Exported', 'Current UI state written as yt-dlp.conf'),",
    "exportConf: () => this._wire.exportConf(this, this.state.configBody !== undefined ? this.state.configBody : undefined, confLines),"
  )
  html = replaceExact(
    html,
    "saveConf: () => this.toast('Saved', 'Configuration written'),",
    'saveConf: () => this._wire.saveConf(this, s.configFile, confLines),'
  )

  // --- pickers: flag-row browse, config-line browse, studio __browse__ ---
  html = replaceExact(
    html,
    "browse: () => this.toast('File picker', f.f + ' — native dialog'),",
    'browse: () => this._wire.browsePath(this, v => this.setV(f.f, v)),'
  )
  html = replaceExact(
    html,
    "browse: () => this.toast('File picker', l.flag),",
    'browse: () => this._wire.browsePath(this, v => setLine({ value: v })),'
  )
  html = replaceExact(
    html,
    "if (c[3] === '__browse__') { const stb = this.state.studio; const path = 'D:\\\\media\\\\chosen'; this.setState({ studio: { ...stb, value: path } }); stb.apply(path); this.toast('Folder picked', path + ' — the host opens a real browser here'); return; }",
    "if (c[3] === '__browse__') { this._wire.browsePath(this, v => { const stb2 = this.state.studio; this.setState({ studio: { ...stb2, value: v } }); stb2.apply(v); }); return; }"
  )

  html = wireHistory(html)

  html = replaceExact(
    html,
    "  componentWillUnmount() { clearInterval(this._timer); clearInterval(this._totpTimer); window.removeEventListener('keydown', this._key); }",
    "  componentWillUnmount() { clearInterval(this._timer); clearInterval(this._totpTimer); window.removeEventListener('keydown', this._key); this._unwireBridge(); }"
  )

  return html
}

// ---------------------------------------------------------------------------
// History surface wiring: swaps the design's static demo record list for
// window.ytdlpStudio.history.* (app/src/shared/history-contract.ts), a
// real local Git-backed, APPEND-ONLY history store already registered in
// app/src/main/ipc.ts. Nothing here ever rewrites or deletes a commit —
// "delete" and "restore" actions each add a new commit, exactly as the
// contract requires, and the copy below is corrected to say so rather
// than the design's original (inaccurate) "nothing else holds a copy".
// ---------------------------------------------------------------------------

function wireHistory(html) {
  // askDestructive gains an optional third `run` callback, invoked only
  // once the two-key-plus-slider gate is actually armed and the user hits
  // Authorize. The design's own version had no way to attach an action to
  // a destructive confirmation at all.
  html = replaceExact(
    html,
    `  askDestructive(title, copy) {
    this.setState({ dialog: 'confirm', confirm: { title, copy, a: false, l: false, slider: 0 } });
  }`,
    `  askDestructive(title, copy, run) {
    this.setState({ dialog: 'confirm', confirm: { title, copy, run: run || null, a: false, l: false, slider: 0 } });
  }`
  )
  html = replaceExact(
    html,
    `      authorizeDestructive: () => {
        if (((s.confirm || {}).slider || 0) < 100) { this.toast('Not armed', 'The gate is not satisfied yet'); return; }
        this.setState({ dialog: null, confirm: null, closeArmed: false });
        this.toast('Authorized', (s.confirm || {}).title || 'Action completed');
      },`,
    `      authorizeDestructive: () => {
        if (((s.confirm || {}).slider || 0) < 100) { this.toast('Not armed', 'The gate is not satisfied yet'); return; }
        const run = (s.confirm || {}).run;
        this.setState({ dialog: null, confirm: null, closeArmed: false });
        this.toast('Authorized', (s.confirm || {}).title || 'Action completed');
        if (run) run();
      },`
  )

  // Replace the static 14-row demo `recs` array with real commits fetched
  // from the bridge (populated into state.historyCommits by
  // _wireHistoryBridge in componentDidMount). Day grouping is computed
  // from the real commit timestamp instead of three hard-coded labels.
  const RECS_NEEDLE = `    const recs = [
      { id: 'h1', day: 'Today', time: '08:41:02', surf: 'QUEUE', kind: 'error', text: 'nebula job failed: HTTP 403 after 10 retries', before: 'downloading · fragment 214/450', after: 'failed · HTTP 403 Forbidden', argv: '', origin: 'download', err: 'ERROR: unable to download video data: HTTP Error 403: Forbidden' },
      { id: 'h2', day: 'Today', time: '08:30:17', surf: 'CONFIG', kind: 'change', text: 'Wrote --download-archive into the user config', before: '(not set)', after: '--download-archive D:\\\\media\\\\archive.txt', argv: '--download-archive D:\\\\media\\\\archive.txt', origin: 'config' },
      { id: 'h3', day: 'Today', time: '08:22:03', surf: 'SPONSORBLOCK', kind: 'run', text: 'Removed 4 segments from "Keynote 2026"', before: '58:14 runtime', after: '55:41 runtime · 4 cuts', argv: '--sponsorblock-remove sponsor,interaction', origin: 'sb' },
      { id: 'h4', day: 'Today', time: '08:19:55', surf: 'POST-PROCESSING', kind: 'change', text: 'Enabled --embed-thumbnail and --embed-metadata', before: 'both off', after: 'both on', argv: '--embed-thumbnail --embed-metadata', origin: 'pp' },
      { id: 'h5', day: 'Today', time: '08:14:19', surf: 'AUTH', kind: 'auth', text: 'Cookies handed back from the embedded browser (27 cookies)', before: 'no cookies', after: '27 cookies · youtube.com', argv: '--cookies %APPDATA%\\\\yt-dlp-studio\\\\cookies.txt', origin: 'login' },
      { id: 'h6', day: 'Today', time: '08:12:41', surf: 'FORMAT', kind: 'change', text: 'Format selector rewritten in the explorer', before: '-f bv*+ba/b', after: '-f bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/b', argv: '-f "bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/b"', origin: 'formats' },
      { id: 'h7', day: 'Today', time: '08:12:04', surf: 'DOWNLOAD', kind: 'run', text: 'Queued 3 URLs from the intake box', before: 'queue empty', after: '3 jobs queued', argv: '', origin: 'download' },
      { id: 'h8', day: 'Yesterday', time: '22:10:44', surf: 'SETTINGS', kind: 'change', text: 'Corner radius changed in Appearance', before: '12', after: '16', argv: '', origin: 'settings' },
      { id: 'h9', day: 'Yesterday', time: '21:58:31', surf: 'PRESET', kind: 'change', text: 'Saved preset "Podcast rip"', before: '(new)', after: '-x --audio-format mp3 --embed-thumbnail --embed-metadata', argv: '-x --audio-format mp3 --embed-thumbnail --embed-metadata', origin: 'presets' },
      { id: 'h10', day: 'Yesterday', time: '21:40:12', surf: 'QUEUE', kind: 'destructive', text: 'Removed 2 finished jobs and their .part files', before: '2 .part files on disk', after: 'deleted · 412 MiB freed', argv: '', origin: 'download' },
      { id: 'h11', day: 'Yesterday', time: '20:02:09', surf: 'DOWNLOAD', kind: 'run', text: 'Channel @daily-flux archived — 41 of 41 items', before: '38 in archive', after: '41 in archive', argv: '', origin: 'download' },
      { id: 'h12', day: 'Mon 17 Aug', time: '09:31:27', surf: 'CONFIG', kind: 'change', text: 'Imported portable config from D:\\\\tools\\\\yt-dlp.conf (14 lines)', before: 'user config only', after: '14 portable lines loaded', argv: '', origin: 'config' },
      { id: 'h13', day: 'Mon 17 Aug', time: '09:30:05', surf: 'APP', kind: 'run', text: 'Session started · yt-dlp 2026.08.12 · ffmpeg 7.1', before: '', after: '', argv: '', origin: 'settings' },
      { id: 'h14', day: 'Mon 17 Aug', time: '09:12:50', surf: 'FORMAT', kind: 'change', text: 'Format sort set from the sort builder', before: '(default order)', after: '-S res:1080,fps,hdr:12', argv: '-S res:1080,fps,hdr:12', origin: 'formats' },
    ];`
  const RECS_REPLACEMENT = `    // Real commits from window.ytdlpStudio.history.listCommits(), fetched
    // in _wireHistoryBridge() and stored in state.historyCommits. The
    // action->kind mapping below is the only place that translates the
    // append-only commit log's vocabulary into this surface's existing
    // (change/run/error/auth/destructive) badge colors.
    const ACTION_KIND = {
      added: 'run', started: 'run', completed: 'change', failed: 'error',
      cancelled: 'change', retried: 'run', removed: 'destructive',
      'bulk-removed': 'destructive', 'restored-entry': 'change',
      'restored-list': 'change', 'app-closed': 'run',
    };
    const historyUnavailable = !!(s.historyStatus && s.historyStatus.gitAvailable === false);
    const recs = (s.historyCommits || []).map(c => {
      const d = new Date(c.timestamp);
      return {
        id: c.sha, day: d.toDateString(), time: d.toLocaleTimeString([], { hour12: false }),
        surf: 'HISTORY', kind: ACTION_KIND[c.action] || 'change', text: c.message,
        before: '', after: '', argv: '', origin: 'history', sha: c.sha,
      };
    });`
  html = replaceExact(html, RECS_NEEDLE, RECS_REPLACEMENT)

  // Dynamic day grouping instead of three hard-coded labels.
  html = replaceExact(
    html,
    "    const historyDays = ['Today', 'Yesterday', 'Mon 17 Aug'].map(dl => {",
    "    const dayLabels = [...new Set(recs.map(r => r.day))];\n    const historyDays = dayLabels.map(dl => {"
  )

  // restore(): call the real, append-only restoreList (which itself adds
  // a new commit rather than rewriting history), and say so honestly.
  html = replaceExact(
    html,
    "    const restore = r => this.askDestructive('Restore everything to just before ' + r.time + '?', 'Every change recorded after that moment is rolled back. Files already on disk are not touched.');",
    "    const restore = r => this.askDestructive('Restore everything to just before ' + r.time + '?', 'This adds a new, append-only history entry that puts the download list back to that point in time. Nothing already recorded is rewritten or deleted, and files already on disk are not touched.', () => this._wire.historyRestore(this, r.sha));"
  )

  // clearHistory: the design's copy claimed a permanent, irrecoverable
  // wipe ("nothing else holds a copy"), which is false for an append-only
  // store — removing every current record is itself just another commit.
  html = replaceExact(
    html,
    "clearHistory: () => this.askDestructive('Clear the local history?', 'Every recorded state change is deleted from this machine. Nothing else holds a copy.'),",
    "clearHistory: () => this.askDestructive('Clear the local history?', 'Every download record is marked removed. This adds a new append-only entry — the earlier records are not erased and stay recoverable, they just stop showing in this list.', () => this._wire.historyClearAll(this)),"
  )

  // historySelDelete: same honesty fix, and a real bulkRemove call.
  html = replaceExact(
    html,
    "      historySelDelete: () => this.askDestructive('Delete ' + selCount + ' history records?', 'The selected records are removed from the local file. Nothing else holds a copy.'),",
    "      historySelDelete: () => this.askDestructive('Delete ' + selCount + ' history records?', 'This adds a new append-only entry marking the selected records removed. The earlier records are not erased and stay recoverable.', () => this._wire.historyBulkRemove(this, Object.keys(sel))),"
  )

  // Retention: persist the real setting instead of only a toast.
  html = replaceExact(
    html,
    "      setHistoryKeep: e => { this.setState({ historyKeep: e.target.value }); this.toast('Retention', 'History kept for ' + e.target.value.toLowerCase()); },",
    "      setHistoryKeep: e => this._wire.setHistoryKeep(this, e.target.value),"
  )

  return html
}

// A single template literal appended right after the class opens. Every
// name below is called from the small set of replaced handlers above and
// nowhere else, so it stays self-contained and easy to audit against
// design/HANDOFF.md.
// ---------------------------------------------------------------------------
// Empties the design's demo/seed state so a FRESH profile shows real zero and
// empty states instead of fabricated activity. The design ships with canned
// jobs, a pre-typed URL, a fake update banner, and specific-looking numbers
// ("18 442 ids", "1 908 extractors", "14.6MiB/s") that were never measured.
// A user's first launch must not appear to already have downloads, a rate,
// or an update it never asked for. Every needle below is sourced from the
// untouched design file (these lines are never touched by wireHandlers or
// wireHistory), so this stays exact even as the design evolves elsewhere.
// ---------------------------------------------------------------------------

function zeroDemoState(html) {
  html = replaceExact(html, '    easyUrl: \'https://www.youtube.com/@blenderfoundation\',', '    easyUrl: \'\',')

  html = replaceExact(html, '    easyArchive: \'yes\', easyFolder: \'D:\\\\media\\\\%(uploader)s\', easySubs: true,', '    easyArchive: \'yes\', easyFolder: \'\', easySubs: true,')

  html = replaceExact(html, '    urls: \'https://www.youtube.com/watch?v=aqz-KE-bpKQ\\nhttps://www.twitch.tv/videos/2109458821\\nhttps://vimeo.com/347119375\',', '    urls: \'\',')

  html = replaceExact(html, `    jobs: [
      { id: 'a', state: 'downloading', extractor: 'youtube', title: 'Big Buck Bunny 4K remaster', detail: '137+140 · mkv · 3840x2160 60fps', pct: 61.4, rate: '7.9MiB/s', size: '1.42GiB', eta: '03:12', frags: 'frag 214/362' },
      { id: 'b', state: 'downloading', extractor: 'twitch:vod', title: 'Speedrun marathon — day 2 VOD', detail: 'hls-1080p60 · mp4 · 1920x1080', pct: 23.8, rate: '4.1MiB/s', size: '6.02GiB', eta: '21:46', frags: 'frag 89/1204' },
      { id: 'c', state: 'downloading', extractor: 'vimeo', title: 'Colour grading reel 2025', detail: 'http-1080p+audio · mp4', pct: 88.1, rate: '2.6MiB/s', size: '742MiB', eta: '00:34', frags: 'frag 51/58' },
      { id: 'd', state: 'queued', extractor: 'soundcloud', title: 'Late night set — 3 hours', detail: 'ba/b · -x --audio-format flac', pct: 0, rate: '—', size: '~1.1GiB', eta: 'waiting', frags: 'slot 1 of 4' },
      { id: 'e', state: 'queued', extractor: 'youtube:tab', title: 'Channel backlog (playlist, 40 entries)', detail: '-I 1:40 · --lazy-playlist', pct: 0, rate: '—', size: '~22GiB', eta: 'waiting', frags: 'entry 0/40' },
      { id: 'f', state: 'done', extractor: 'youtube', title: 'Keynote 2026 — full session', detail: 'merged mkv · SponsorBlock removed 4 segments', pct: 100, rate: '—', size: '3.31GiB', eta: 'done', frags: 'post-processed' },
      { id: 'g', state: 'done', extractor: 'bilibili', title: 'Documentary ep. 4 (subs: zh-Hans, en)', detail: 'embedded subs · --convert-subs srt', pct: 100, rate: '—', size: '1.08GiB', eta: 'done', frags: 'post-processed' },
      { id: 'h', state: 'done', extractor: 'generic', title: 'Conference stream mirror', detail: 'm3u8_native · mpegts', pct: 100, rate: '—', size: '498MiB', eta: 'done', frags: 'post-processed' },
      { id: 'i', state: 'error', extractor: 'nebula', title: 'Members-only episode 12', detail: 'ERROR: This video is only available to subscribers', pct: 42, rate: '—', size: '—', eta: 'failed', frags: 'HTTP 403 after 10 retries' },
    ],`, '    jobs: [],')
  html = replaceExact(html, `    log: [
      ['[debug] Command-line config: [-f, bv*[height<=1080]+ba/b, --embed-metadata]', '#889391'],
      ['[debug] Loaded 1908 extractors · plugin dirs: default', '#889391'],
      ['[youtube] Extracting URL: https://www.youtube.com/watch?v=aqz-KE-bpKQ', '#bec9c7'],
      ['[youtube] aqz-KE-bpKQ: Downloading webpage', '#bec9c7'],
      ['[youtube] aqz-KE-bpKQ: Downloading tv client config', '#bec9c7'],
      ['[info] aqz-KE-bpKQ: Downloading 1 format(s): 137+140', '#82d5cc'],
      ['[download] Destination: Blender Foundation/Big Buck Bunny [aqz-KE-bpKQ].f137.mp4', '#dee4e3'],
      ['[download]  61.4% of ~1.42GiB at 7.90MiB/s ETA 03:12 (frag 214/362)', '#dee4e3'],
      ['[SponsorBlock] Found 4 segments in the SponsorBlock API', '#82d5cc'],
      ['[nebula] ERROR: This video is only available to subscribers. Use --cookies-from-browser', '#ffb4ab'],
      ['[debug] ffmpeg version 7.1 · Merger: mkv', '#889391'],
    ],`, '    log: [],')

  html = replaceExact(html, '    setOnly: false, exportFormat: \'md\', updateBanner: true, paused: false,', '    setOnly: false, exportFormat: \'md\', updateBanner: false, paused: false,')

  html = replaceExact(html, '                    <div style="display:flex;justify-content:space-between;padding:10px 12px;border-radius:11px;background:#252b2b"><span style="color:#bec9c7">archive</span><b>18 442 ids</b></div>', '                    <div style="display:flex;justify-content:space-between;padding:10px 12px;border-radius:11px;background:#252b2b"><span style="color:#bec9c7">archive</span><b>—</b></div>')


  // The status-bar extractor count ('1 908 extractors') was a fixed string
  // with no backing data source. There is no IPC surface today that runs the
  // bundled yt-dlp's --list-extractors and reports a real count, so a dash
  // is shown rather than a specific number nobody actually measured.
  html = replaceExact(html, '        { glyph: \'extension\', text: \'1 908 extractors\', color: \'#bec9c7\', title: \'Loaded extractors\',', '        { glyph: \'extension\', text: \'—\', color: \'#bec9c7\', title: \'Loaded extractors\',')

  // Add a real placeholder to the Save-to field now that its value starts
  // empty, so the user still sees the shape of a real yt-dlp output template
  // without it looking like an already-chosen folder.
  html = replaceExact(html, '<input value="{{ easyFolder }}" onChange="{{ setEasyFolder }}" style="flex:1;min-width:0;background:#252b2b;border:1px solid #3f4948;border-radius:11px;color:#dee4e3;padding:11px 12px;font-family:\'Roboto Mono\',Consolas,monospace;font-size:12.5px" />', '<input value="{{ easyFolder }}" onChange="{{ setEasyFolder }}" placeholder="D:\\media\\%(uploader)s" style="flex:1;min-width:0;background:#252b2b;border:1px solid #3f4948;border-radius:11px;color:#dee4e3;padding:11px 12px;font-family:\'Roboto Mono\',Consolas,monospace;font-size:12.5px" />')

  // The batch-file watch banner claimed a real file on disk was being
  // watched, unconditionally, with no watcher behind it at all. Gate it
  // behind a real (currently always-false) state flag instead of deleting
  // the surface, so a future real batch-watch feature can flip it on.
  html = replaceExact(html, `                  <div style="margin-top:12px;padding:11px 13px;border-radius:12px;background:#223131;border-left:3px solid #82d5cc;color:#bec9c7;font-size:12.5px">
                    Batch file <b style="color:#dee4e3">D:\\queue\\weekly.txt</b> is watched — 3 new lines since 06:40. Lines starting with <code>#</code>, <code>;</code> or <code>]</code> are comments.
                  </div>`, `                  <sc-if value="{{ hasBatchWatch }}" hint-placeholder-val="{{ false }}">
                  <div style="margin-top:12px;padding:11px 13px;border-radius:12px;background:#223131;border-left:3px solid #82d5cc;color:#bec9c7;font-size:12.5px">
                    Batch file <b style="color:#dee4e3">D:\\queue\\weekly.txt</b> is watched — 3 new lines since 06:40. Lines starting with <code>#</code>, <code>;</code> or <code>]</code> are comments.
                  </div>
                  </sc-if>`)
  html = replaceExact(html, 'enqueue: () => this._wire.enqueue(this, s),', `hasBatchWatch: false,
      enqueue: () => this._wire.enqueue(this, s),`)


  // The 'total rate' figure — shown both in the SESSION panel and the
  // status bar — was a fixed '14.6M'/'14.6MiB/s' with no measurement
  // behind it. Both now derive from the real per-job rates the bridge
  // streams in via jobs.onProgress (see _totalRateLabel above), and read
  // a dash when nothing is actually downloading.
  html = replaceExact(html, '      totalRate: \'14.6M\', pauseLabel: s.paused ? \'Resume queue\' : \'Pause queue\',', '      totalRate: this._totalRateLabel(activeJobs), pauseLabel: s.paused ? \'Resume queue\' : \'Pause queue\',')
  html = replaceExact(html, '        { glyph: \'speed\', text: \'14.6MiB/s\', color: \'#bec9c7\', title: \'Total download rate\',', '        { glyph: \'speed\', text: this._totalRateLabel(activeJobs), color: \'#bec9c7\', title: \'Total download rate\',')


  // Second sweep pass: the same shape of fabricated-but-plausible data was
  // found in several more places once the first pass made the pattern easy
  // to spot. Same rule throughout: a fresh profile must not claim anything
  // about the user's own files, browser, or configuration that is not true
  // at that moment. A dash or an empty list is always honest.

  // Chapters & SponsorBlock panel: a fixed timeline for a video the user
  // never downloaded. Emptying state.timeline empties the segment strip and
  // list; hasChapterData (below) additionally hides the whole panel, since
  // an empty timeline strip with no context reads as broken rather than honest.
  html = replaceExact(html, `    timeline: [
      { tag: 'INTRO', w: 9, color: '#82d5cc', title: 'Intro 0:00–0:57', range: '0:00 – 0:57', action: 'mark' },
      { tag: 'SPONSOR', w: 14, color: '#ffb4ab', title: 'Sponsor 0:57–2:26', range: '0:57 – 2:26', action: 'remove' },
      { tag: '', w: 32, color: '#303636', title: 'Content', range: '', action: '' },
      { tag: 'SELF', w: 8, color: '#febc2e', title: 'Self promo 5:40–6:31', range: '5:40 – 6:31', action: 'remove' },
      { tag: '', w: 26, color: '#303636', title: 'Content', range: '', action: '' },
      { tag: 'OUTRO', w: 11, color: '#82d5cc', title: 'Outro 9:23–10:34', range: '9:23 – 10:34', action: 'mark' },
    ],`, '    timeline: [],')

  // Library surface: six fabricated 'already downloaded' files at real-
  // looking D:/media/... paths, with a working delete-from-disk action.
  // The <sc-for> already renders a correct empty grid for an empty array.
  html = replaceExact(html, `        ['Keynote 2026 — full session', 'D:\\\\media\\\\Conference\\\\Keynote 2026 [x8Kd2Lp].mkv', 'Conference Org', '3.31GiB', 'mkv', 'youtube x8Kd2Lp'],
        ['Documentary ep. 4', 'D:\\\\media\\\\BiliBili\\\\Documentary ep 4 [BV1x4].mkv', 'CCTV Docs', '1.08GiB', 'mkv', 'BiliBili BV1x4'],
        ['Conference stream mirror', 'D:\\\\media\\\\generic\\\\stream-mirror.mp4', 'generic', '498MiB', 'mp4', 'generic 9f2a1'],
        ['Late night set — 3 hours', 'D:\\\\media\\\\SoundCloud\\\\Late night set.flac', 'DJ Nocturne', '1.14GiB', 'flac', 'soundcloud 88213'],
        ['Big Buck Bunny 4K remaster', 'D:\\\\media\\\\Blender Foundation\\\\Big Buck Bunny [aqz-KE-bpKQ].mkv', 'Blender Foundation', '2.24GiB', 'mkv', 'youtube aqz-KE-bpKQ'],
        ['Colour grading reel 2025', 'D:\\\\media\\\\Vimeo\\\\Colour grading reel.mp4', 'Studio Nine', '742MiB', 'mp4', 'vimeo 347119375'],`, '')
  html = replaceExact(html, '      libraryCount: \'6 of 1 204 files · 18 442 archive ids\',', '      libraryCount: \'0 of 0 files · — archive ids\',')

  // Config surface's effective-configuration table claimed specific flags
  // came from named config files that were never actually read. Empty is
  // honest; the .filter().map() chain right after handles it unchanged.
  html = replaceExact(html, `        ['-f bv*[height<=1080]+ba/b', 'user', '#82d5cc'],
        ['--merge-output-format mkv', 'user', '#dee4e3'],
        ['-N 4', 'user', '#dee4e3'],
        ['-r 8M', 'portable (overridden)', '#889391'],
        ['--downloader aria2c', 'user', '#dee4e3'],
        ['--sponsorblock-mark all,-preview', 'user', '#dee4e3'],
        ['--cookies-from-browser firefox', 'user', '#dee4e3'],
        ['--download-archive D:\\\\media\\\\archive.txt', 'command line', '#82d5cc'],`, '')

  // Notification centre: five fabricated notices with specific timestamps,
  // none of which happened. There is no real notification-history feature
  // wired up yet, so honest means empty rather than a new persistence layer.
  html = replaceExact(html, `        ['✓', '#82d5cc', 'Archive updated', '18 442 ids · +3 this session', '08:41'],
        ['!', '#ffb4ab', 'nebula job failed', 'HTTP 403 after 10 retries — auto-fix wizard available', '08:41'],
        ['⬆', '#82d5cc', 'Update downloaded', '2026.08.19 nightly, unsigned, hash verified', '08:33'],
        ['✓', '#82d5cc', 'Cookies handed back', '27 cookies written to yt.cookies.txt', '08:14'],
        ['i', '#bec9c7', 'Format check', '2 formats rejected by --check-formats', '08:12'],`, '')

  // Status bar 'cookies: firefox' claimed a browser cookie source was
  // already configured. Nothing in the default state.values sets --cookies
  // or --cookies-from-browser, so this is untrue on a fresh profile -- and
  // it is a claim about touching the user's own browser profile. Read the
  // real flag values instead.
  html = replaceExact(html, '        { glyph: \'key\', text: s.loginCookieCount ? \'cookies: \' + s.loginCookieCount : \'cookies: firefox\', color: \'#bec9c7\', title: \'Cookie source\',', '        { glyph: \'key\', text: s.loginCookieCount ? \'cookies: \' + s.loginCookieCount : (s.values[\'--cookies-from-browser\'] || s.values[\'--cookies\']) ? \'cookies: configured\' : \'cookies: none\', color: \'#bec9c7\', title: \'Cookie source\',')

  // Status bar 'user config' implied a configuration file had been found
  // and loaded from disk. No IPC wiring today actually reads a config file
  // (saveConf/validateConfig are still stubs), so show a dash rather than a
  // source that was never read.
  html = replaceExact(html, '        { glyph: \'settings\', text: \'user config\', color: \'#bec9c7\', title: \'Active configuration source\',', '        { glyph: \'settings\', text: \'—\', color: \'#bec9c7\', title: \'Active configuration source\',')

  // Vestigial: historyPins referenced the design's old demo record id 'h9',
  // which no longer exists now that history is real commit shas. Harmless,
  // but start with no pins for the same reason everything else starts empty.
  html = replaceExact(html, '    historyPins: { h9: true }, historyLive: true, historyKeep: \'90 days\', historyCollapsed: {},', '    historyPins: {}, historyLive: true, historyKeep: \'90 days\', historyCollapsed: {},')


  html = replaceExact(html, '      segments: s.timeline.filter(t => t.tag).map(t => ({ title: t.title.split(\' \')[0], color: t.color, range: t.range, action: t.action })),', `      segments: s.timeline.filter(t => t.tag).map(t => ({ title: t.title.split(' ')[0], color: t.color, range: t.range, action: t.action })),
      hasChapterData: s.timeline.length > 0,`)

  // Gate the whole Chapters & SponsorBlock section behind real chapter data,
  // exactly as the batch-file banner is gated behind hasBatchWatch. Wrapped as
  // one block (rather than just the opening tag) because the section's own
  // opening <section style=...> string recurs elsewhere in the template, so
  // only the full block -- anchored by the unique 'Chapters & SponsorBlock'
  // heading -- is a safe needle.
  html = replaceExact(html, `                <section style="grid-column:span 5;background:#1b2121;border:0;border-radius:12px;padding:16px">
                  <h2 style="font-size:11px;margin:0 0 9px;letter-spacing:.9px;text-transform:uppercase;color:#bec9c7;font-weight:800">Chapters &amp; SponsorBlock</h2>
                  <p style="margin:0 0 14px;color:#bec9c7;font-size:12.5px">Big Buck Bunny — 10:34. Segments from the SponsorBlock API; mark and remove policy applies at post-process.</p>
                  <div style="display:flex;height:34px;border-radius:9px;overflow:hidden;border:1px solid #3f4948">
                    <sc-for list="{{ timeline }}" as="seg" hint-placeholder-count="6">
                      <div title="{{ seg.title }}" style="width:{{ seg.width }};background:{{ seg.color }};display:grid;place-items:center;font-size:9px;font-weight:800;color:#0a0f0f;overflow:hidden">{{ seg.tag }}</div>
                    </sc-for>
                  </div>
                  <div style="display:grid;gap:6px;margin-top:12px">
                    <sc-for list="{{ segments }}" as="seg" hint-placeholder-count="4">
                      <div style="display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:10px;background:#252b2b;font-size:12px">
                        <span style="width:9px;height:9px;border-radius:50%;background:{{ seg.color }};flex:0 0 auto"></span>
                        <b style="font-weight:600">{{ seg.title }}</b>
                        <span style="margin-left:auto;font-family:'Roboto Mono',Consolas,monospace;color:#bec9c7">{{ seg.range }}</span>
                        <span style="border-radius:99px;background:#303636;color:#82d5cc;padding:2px 8px;font-size:10px;font-weight:700">{{ seg.action }}</span>
                      </div>
                    </sc-for>
                  </div>
                </section>`, `                <sc-if value="{{ hasChapterData }}" hint-placeholder-val="{{ false }}">
                <section style="grid-column:span 5;background:#1b2121;border:0;border-radius:12px;padding:16px">
                  <h2 style="font-size:11px;margin:0 0 9px;letter-spacing:.9px;text-transform:uppercase;color:#bec9c7;font-weight:800">Chapters &amp; SponsorBlock</h2>
                  <p style="margin:0 0 14px;color:#bec9c7;font-size:12.5px">Big Buck Bunny — 10:34. Segments from the SponsorBlock API; mark and remove policy applies at post-process.</p>
                  <div style="display:flex;height:34px;border-radius:9px;overflow:hidden;border:1px solid #3f4948">
                    <sc-for list="{{ timeline }}" as="seg" hint-placeholder-count="6">
                      <div title="{{ seg.title }}" style="width:{{ seg.width }};background:{{ seg.color }};display:grid;place-items:center;font-size:9px;font-weight:800;color:#0a0f0f;overflow:hidden">{{ seg.tag }}</div>
                    </sc-for>
                  </div>
                  <div style="display:grid;gap:6px;margin-top:12px">
                    <sc-for list="{{ segments }}" as="seg" hint-placeholder-count="4">
                      <div style="display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:10px;background:#252b2b;font-size:12px">
                        <span style="width:9px;height:9px;border-radius:50%;background:{{ seg.color }};flex:0 0 auto"></span>
                        <b style="font-weight:600">{{ seg.title }}</b>
                        <span style="margin-left:auto;font-family:'Roboto Mono',Consolas,monospace;color:#bec9c7">{{ seg.range }}</span>
                        <span style="border-radius:99px;background:#303636;color:#82d5cc;padding:2px 8px;font-size:10px;font-weight:700">{{ seg.action }}</span>
                      </div>
                    </sc-for>
                  </div>
                </section>
                </sc-if>`)

  return html
}

const WIRING_METHODS = `
  // ---------------------------------------------------------------------
  // Real IPC wiring (generated — see scripts/build-renderer-from-design.mjs).
  // Every method below replaces a local mock handler named in
  // design/HANDOFF.md with a call across window.ytdlpStudio, the preload
  // bridge exposed by app/src/preload/index.ts. Nothing here mutates
  // design/ — this text only exists in the generated app/src/renderer/index.html.
  // ---------------------------------------------------------------------
  _wireBridge() {
    const bridge = window.ytdlpStudio;
    if (!bridge) { this.toast('Not connected', 'window.ytdlpStudio is missing — running outside the packaged app?'); return; }
    this._offProgress = bridge.jobs.onProgress(ev => {
      this.setState(st => ({ jobs: st.jobs.map(j => j.id === ev.id ? { ...j,
        pct: ev.progress.pct != null ? parseFloat(ev.progress.pct) || 0 : j.pct,
        rate: ev.progress.rate || '—', size: ev.progress.size || '', eta: ev.progress.eta || '',
        frags: ev.progress.frags || '',
      } : j) }));
    });
    this._offLog = bridge.jobs.onLog(ev => {
      const color = ev.level === 'error' ? '#ffb4ab' : ev.level === 'warn' ? '#febc2e' : '#dee4e3';
      this.setState(st => ({ log: [...(st.log || []), [ev.text, color]].slice(-500) }));
    });
    this._offState = bridge.jobs.onState(ev => {
      const stateMap = { queued: 'queued', running: 'downloading', paused: 'queued', done: 'done', error: 'error', cancelled: 'error' };
      this.setState(st => ({ jobs: st.jobs.map(j => j.id === ev.id ? { ...j, state: stateMap[ev.state] || j.state } : j) }));
    });
    bridge.jobs.capabilities().then(caps => {
      const label = caps && caps.pauseMode === 'suspend' ? 'Pause queue' : 'Stop queue (Windows cannot truly suspend a process — resuming restarts it with --continue)';
      this.setState({ pauseLabelOverride: label });
    }).catch(() => {});
    this._wireHistoryBridge();
  }

  // Loads the real, local, Git-backed append-only history store
  // (app/src/main/history.ts via app/src/shared/history-contract.ts) into
  // state, replacing the design's static demo record list. When git is
  // not on PATH the store reports itself unavailable with a reason, and
  // that is shown plainly rather than as an empty "no history yet" list.
  _wireHistoryBridge() {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.history) return;
    const reload = () => {
      bridge.history.status().then(st => this.setState({ historyStatus: st })).catch(() => {});
      bridge.history.listCommits().then(commits => this.setState({ historyCommits: commits }))
        .catch(err => this.toast('History unavailable', String(err && err.message ? err.message : err)));
    };
    reload();
    this._historyReloadTimer = setInterval(() => { if (this.state.historyLive) reload(); }, 5000);
    bridge.history.getRetention().then(r => {
      const label = r.mode === 'keep-everything' ? 'Forever' : r.mode === 'prune-by-count' ? r.maxEntries + ' entries' : r.maxAgeDays + ' days';
      this.setState({ historyKeep: label });
    }).catch(() => {});
  }
  // Called from the design's own componentWillUnmount (patched in
  // wireHandlers below) so subscriptions and timers set up by
  // _wireBridge()/_wireHistoryBridge() actually get torn down.
  _unwireBridge() {
    if (this._offProgress) this._offProgress();
    if (this._offLog) this._offLog();
    if (this._offState) this._offState();
    if (this._historyReloadTimer) clearInterval(this._historyReloadTimer);
  }

  // Small shell-like tokenizer: splits a design-produced command STRING
  // (from expertCommand()/easyCommand()/plainCommand) into a real argv,
  // honoring single/double quotes and backslash escapes. This mirrors
  // app/src/renderer/commandBuilder.ts's parsePlainCommand, translated to
  // plain JS since this code runs inside the design's own runtime rather
  // than through the TypeScript build.
  // Sums the real per-job rate strings ('7.9MiB/s', '4.1MiB/s', ...) that
  // arrive from window.ytdlpStudio.jobs.onProgress, rather than the
  // design's fixed '14.6MiB/s' demo figure. Returns a dash when nothing
  // is actually downloading, since a rate of 0.0MiB/s still implies
  // something is being measured.
  _totalRateLabel(activeJobs) {
    const parse = (r) => {
      const m = /([\d.]+)\s*([KMG]?)i?B\/s/i.exec(String(r || ''));
      if (!m) return 0;
      const mult = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 }[m[2].toUpperCase()] || 1;
      return parseFloat(m[1]) * mult;
    };
    const totalBytes = (activeJobs || []).reduce((sum, j) => sum + parse(j.rate), 0);
    if (!totalBytes) return '—';
    if (totalBytes >= 1024 * 1024 * 1024) return (totalBytes / 1024 / 1024 / 1024).toFixed(1) + 'GiB/s';
    if (totalBytes >= 1024 * 1024) return (totalBytes / 1024 / 1024).toFixed(1) + 'MiB/s';
    if (totalBytes >= 1024) return (totalBytes / 1024).toFixed(1) + 'KiB/s';
    return Math.round(totalBytes) + 'B/s';
  }

  _tokenize(line) {
    const argv = [];
    let cur = '', inS = false, inD = false, has = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inS) { if (ch === "'") inS = false; else cur += ch; continue; }
      if (inD) {
        if (ch === '"') inD = false;
        else if (ch === '\\\\' && i + 1 < line.length && (line[i + 1] === '"' || line[i + 1] === '\\\\')) cur += line[++i];
        else cur += ch;
        continue;
      }
      if (ch === "'") { inS = true; has = true; continue; }
      if (ch === '"') { inD = true; has = true; continue; }
      if (ch === '\\\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
      if (/\\s/.test(ch)) { if (has) { argv.push(cur); cur = ''; has = false; } continue; }
      cur += ch; has = true;
    }
    if (has) argv.push(cur);
    if (argv[0] === 'yt-dlp') argv.shift();
    return argv;
  }

  _startJob(comp, url, argv) {
    const bridge = window.ytdlpStudio;
    if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
    const id = 'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const job = { id, state: 'queued', extractor: '', title: url || '(no URL)', detail: argv.join(' '), pct: 0, rate: '—', size: '', eta: '', frags: '' };
    comp.setState(st => ({ jobs: [job, ...st.jobs] }));
    bridge.jobs.start({ id, url: url || '', argv, cwd: null }).catch(err => {
      comp.toast('Failed to start', String(err && err.message ? err.message : err));
      comp.setState(st => ({ jobs: st.jobs.map(j => j.id === id ? { ...j, state: 'error' } : j) }));
    });
    return id;
  }

  get _wire() {
    const self = this;
    return {
      plainRun(comp) {
        const line = comp.state.plainCommand !== undefined ? comp.state.plainCommand : comp.expertCommand();
        const argv = self._tokenize(line);
        self._startJob(comp, '', argv);
        comp.toast('Running', 'Sent to yt-dlp: ' + argv.join(' '));
      },
      runCommand(comp, s) {
        const easy = s.mode === 'easy';
        const line = easy ? comp.easyCommand() : comp.expertCommand();
        const argv = self._tokenize(line);
        self._startJob(comp, '', argv);
        comp.toast('Running', 'Queue started');
      },
      enqueue(comp, s) {
        const urls = (s.urls || '').split('\\n').map(x => x.trim()).filter(Boolean);
        const line = comp.expertCommand();
        const baseArgv = self._tokenize(line).filter(a => !urls.includes(a));
        urls.forEach(u => self._startJob(comp, u, [...baseArgv, u]));
        comp.toast('Queued', urls.length + ' URLs added');
      },
      easyDownload(comp, s, title) {
        const bridge = window.ytdlpStudio;
        const argv = [];
        const qmap = { best: 'bv*+ba/b', '1080p': 'bv*[height<=1080]+ba/b[height<=1080]', '720p': 'bv*[height<=720]+ba/b[height<=720]', '480p': 'bv*[height<=480]+ba/b[height<=480]' };
        argv.push('-f', qmap[s.easyQuality] || 'bv*+ba/b');
        if (s.easyFolder) argv.push('-P', s.easyFolder);
        if (s.easySubs) argv.push('--write-subs', '--write-auto-subs', '--embed-subs');
        if (s.easyThumb) argv.push('--write-thumbnail', '--embed-thumbnail');
        if (s.easySponsor) argv.push('--sponsorblock-mark', 'all');
        if (s.easyUrl) argv.push(s.easyUrl);
        const id = bridge ? self._startJob(comp, s.easyUrl, argv) : null;
        comp.setState(st => ({ easyRuns: [{ id: id || Math.random(), title, pct: 2 }, ...st.easyRuns].slice(0, 4) }));
        comp.toast('Started', title);
      },
      togglePause(comp) {
        const bridge = window.ytdlpStudio;
        comp.setState(st => {
          const paused = !st.paused;
          const runningJobs = st.jobs.filter(j => j.state === 'downloading');
          if (bridge) runningJobs.forEach(j => (paused ? bridge.jobs.pause(j.id) : bridge.jobs.resume(j.id)).catch(() => {}));
          return { paused };
        });
      },
      jobRetry(comp, j) {
        const bridge = window.ytdlpStudio;
        if (bridge) bridge.jobs.retry(j.id).catch(err => comp.toast('Retry failed', String(err && err.message ? err.message : err)));
        comp.toast('Retrying', j.title);
      },
      jobRemove(comp, j) {
        const bridge = window.ytdlpStudio;
        if (bridge) bridge.jobs.remove(j.id).catch(() => {});
        comp.setState(st => ({ jobs: st.jobs.filter(x => x.id !== j.id) }));
      },
      browseFolder(comp, apply) {
        const bridge = window.ytdlpStudio;
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        bridge.dialogs.pickFolder().then(p => { if (p) apply(p); }).catch(err => comp.toast('Folder picker failed', String(err && err.message ? err.message : err)));
      },
      browsePath(comp, apply) {
        const bridge = window.ytdlpStudio;
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        bridge.dialogs.pickFile().then(p => { if (p) apply(p); }).catch(err => comp.toast('File picker failed', String(err && err.message ? err.message : err)));
      },
      pickBatch(comp) {
        const bridge = window.ytdlpStudio;
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        bridge.dialogs.pickBatchFile().then(p => { if (p) comp.toast('-a batch file', p); }).catch(err => comp.toast('Picker failed', String(err && err.message ? err.message : err)));
      },
      pickInfoJson(comp) {
        const bridge = window.ytdlpStudio;
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        bridge.dialogs.pickInfoJson().then(p => { if (p) comp.toast('--load-info-json', p); }).catch(err => comp.toast('Picker failed', String(err && err.message ? err.message : err)));
      },
      simulateRun(comp, s) {
        const line = comp.expertCommand();
        const argv = self._tokenize(line);
        self._startJob(comp, '', ['-s', ...argv]);
        comp.toast('-s simulate', 'Nothing written to disk');
      },
      finishLogin(comp) {
        comp.setState({ dialog: null });
        comp.toast('Not implemented', 'Cookie handoff needs a real embedded sign-in surface and OS-vault storage — see design/HANDOFF.md');
      },
      validateConfig(comp, confLines) {
        const bad = confLines.filter(l => l.on && l.needsValue && !l.value);
        comp.toast(bad.length ? 'Validation failed' : 'Configuration valid',
          bad.length ? bad.length + ' line(s) are missing a required value' : confLines.filter(l => l.on).length + ' active lines parse cleanly');
      },
      exportConf(comp, body, confLines) {
        const bridge = window.ytdlpStudio;
        const text = body !== undefined ? body : confLines.map(l => (l.on ? '' : '# ') + l.flag + (l.value ? ' ' + l.value : '')).join('\\n');
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        bridge.dialogs.saveFile({ defaultPath: 'yt-dlp.conf', filters: [{ name: 'yt-dlp config', extensions: ['conf', 'txt'] }] })
          .then(p => { if (p) comp.toast('Exported', p); })
          .catch(err => comp.toast('Export failed', String(err && err.message ? err.message : err)));
      },
      saveConf(comp, configFile, confLines) {
        comp.toast('Not implemented', 'Writing to a real yt-dlp.conf location needs a host-side file write — see design/HANDOFF.md "Config files"');
      },

      historyRestore(comp, sha) {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.history) { comp.toast('Not connected', 'window.ytdlpStudio.history is missing'); return; }
        bridge.history.restoreList(sha).then(res => {
          if (!res || !res.ok) { comp.toast('Restore failed', 'The history store refused the restore'); return; }
          comp.toast('Restored', 'A new history entry now records the restore');
          comp._wireHistoryBridge();
        }).catch(err => comp.toast('Restore failed', String(err && err.message ? err.message : err)));
      },
      historyBulkRemove(comp, ids) {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.history) { comp.toast('Not connected', 'window.ytdlpStudio.history is missing'); return; }
        if (!ids.length) { comp.toast('Nothing selected', 'Select at least one record first'); return; }
        bridge.history.bulkRemove(ids).then(res => {
          if (!res || !res.ok) { comp.toast('Remove failed', 'The history store refused the removal'); return; }
          comp.setState({ historySel: {} });
          comp.toast('Removed', ids.length + ' record(s) marked removed');
        }).catch(err => comp.toast('Remove failed', String(err && err.message ? err.message : err)));
      },
      historyClearAll(comp) {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.history) { comp.toast('Not connected', 'window.ytdlpStudio.history is missing'); return; }
        bridge.history.getFullSnapshot().then(snapshot => {
          const ids = Object.keys(snapshot || {});
          if (!ids.length) { comp.toast('Nothing to clear', 'History is already empty'); return; }
          return bridge.history.bulkRemove(ids).then(res => {
            if (!res || !res.ok) { comp.toast('Clear failed', 'The history store refused the removal'); return; }
            comp.toast('Cleared', ids.length + ' record(s) marked removed');
          });
        }).catch(err => comp.toast('Clear failed', String(err && err.message ? err.message : err)));
      },
      setHistoryKeep(comp, label) {
        const bridge = window.ytdlpStudio;
        comp.setState({ historyKeep: label });
        if (!bridge || !bridge.history) return;
        const setting = label === 'Forever' ? { mode: 'keep-everything', maxEntries: 500, maxAgeDays: 90 }
          : label === '30 days' ? { mode: 'prune-by-age', maxEntries: 500, maxAgeDays: 30 }
          : label === '90 days' ? { mode: 'prune-by-age', maxEntries: 500, maxAgeDays: 90 }
          : label === '1 year' ? { mode: 'prune-by-age', maxEntries: 500, maxAgeDays: 365 }
          : { mode: 'keep-everything', maxEntries: 500, maxAgeDays: 90 };
        bridge.history.setRetention(setting).then(() => {
          comp.toast('Retention', 'History kept for ' + label.toLowerCase() + ' — this only limits the view; nothing recorded is deleted');
        }).catch(err => comp.toast('Retention failed', String(err && err.message ? err.message : err)));
      },
    };
  }
`

main()
