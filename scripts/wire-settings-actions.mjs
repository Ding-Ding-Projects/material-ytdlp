// scripts/wire-settings-actions.mjs
//
// Wires the "settings actions" lane into the design-derived renderer HTML:
// personal vocabulary (backend already exists — this lane consumes it),
// the custom application mark, and the local-only Support Tickets surface.
// Also gives the changelog/dim-sum entries in `settingAction` an honest
// look rather than leaving the design's original mock toasts, without
// touching their surrounding markup (out of this lane's scope).
//
// Same asserted-replacement discipline as `build-renderer-from-design.mjs`:
// every needle is matched byte-exact and asserted to occur exactly once
// via the caller-supplied `replaceExact`, so a needle that stops matching
// fails the build loudly instead of silently shipping a half-wired app.
//
// This module owns ONLY the two `replaceExact` targets below (the
// `settingAction` method body, and the `settingRows` row-building code).
// It never touches `app/src/renderer/**` directly — it only returns
// modified HTML text for the orchestrator to write out.

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireSettingsActions(html, replaceExact) {
  html = wireSettingAction(html, replaceExact)
  html = wireSettingRowsLiveState(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 1) settingAction(key) — replace the mock toasts for 'vocab', 'appLogo',
//    and 'tickets' with real bridge calls. 'editor' (owned by the fileops
//    lane) and 'changelog'/'dimsum' (deliberately left — see report) are
//    carried through byte-for-byte.
// ---------------------------------------------------------------------------

function wireSettingAction(html, replaceExact) {
  const NEEDLE = `  settingAction(key) {
    if (key === 'vocab') this.toast('Vocabulary loaded', 'personal-vocabulary.json · 212 terms now replace the stock copy');
    else if (key === 'appLogo') this.toast('App mark', 'Pick a square PNG or SVG — title bar, tray and installer');
    else if (key === 'editor') this.toast('Handed off', 'yt-dlp.conf opened in your editor — saved changes reload live');
    else if (key === 'tickets') this.setState({ dialog: 'notifications' });
    else if (key === 'changelog') { this.setState({ docId: 'changelog' }); this.goto('docs'); }
    else if (key === 'dimsum') this.toast('🥟 Dim-sum surprise', 'Har gow — crystal skin, three pleats minimum');
  }`

  // The exact disclosure line this app's Support Tickets contract requires
  // (mirrors SUPPORT_TICKETS_DISCLOSURE in
  // app/src/shared/settings-actions-contract.ts — duplicated here on
  // purpose, since this file is plain generated browser JS with no module
  // graph to import that constant from).
  const DISCLOSURE =
    'This is a local joke, not a real help desk: nothing here is ever sent anywhere, no ticket exists outside this computer, no network request is made, and nobody is reading it. Nobody is coming. The button below opens this app’s own data folder so you can delete it yourself.'

  const REPLACEMENT = `  settingAction(key) {
    if (key === 'vocab') {
      if (!window.ytdlpStudio) { this.toast('Vocabulary', 'Not connected to the app shell.'); return; }
      window.ytdlpStudio.vocabulary.pickAndLoad().then(res => {
        this.setState({ vocabState: res.state });
        if (res.cancelled) return;
        if (!res.ok) { this.toast('Vocabulary rejected', res.error || 'The file could not be loaded.'); return; }
        const n = res.state.entryCount;
        this.toast('Vocabulary loaded', n + ' term' + (n === 1 ? '' : 's') + ' now replace the stock copy');
      }).catch(err => this.toast('Vocabulary', 'Could not open the picker: ' + (err && err.message ? err.message : String(err))));
    }
    else if (key === 'appLogo') {
      if (!window.ytdlpStudio) { this.toast('App mark', 'Not connected to the app shell.'); return; }
      window.ytdlpStudio.appMark.pickAndApply().then(res => {
        this.setState({ appMarkState: res.state });
        if (res.cancelled) return;
        if (!res.ok) { this.toast('App mark rejected', res.error || 'The image could not be applied.'); return; }
        this.toast('App mark applied', res.state.widthPx + 'x' + res.state.heightPx + 'px — title bar and tray only');
      }).catch(err => this.toast('App mark', 'Could not open the picker: ' + (err && err.message ? err.message : String(err))));
    }
    else if (key === 'editor') this.toast('Handed off', 'yt-dlp.conf opened in your editor — saved changes reload live');
    else if (key === 'tickets') {
      if (!window.ytdlpStudio) { this.toast('Support tickets', 'Not connected to the app shell.'); return; }
      const category = window.prompt('Support ticket — category (e.g. "Playback", "Downloads", "Just venting")', 'General');
      if (category === null) return;
      const description = window.prompt(${JSON.stringify(
        'Describe what went wrong.\n\n' + DISCLOSURE,
      )}, '');
      if (description === null) return;
      window.ytdlpStudio.supportTickets.create({ category, description }).then(res => {
        if (!res.ok || !res.ticket) { this.toast('Support tickets', res.error || 'Could not file the ticket.'); return; }
        this.toast('Ticket ' + res.ticket.number + ' filed', 'Status: ' + res.ticket.status + '. Opening this app’s data folder — that is the whole "resolution".');
        return window.ytdlpStudio.supportTickets.openDataFolder();
      }).catch(err => this.toast('Support tickets', 'Could not file the ticket: ' + (err && err.message ? err.message : String(err))));
    }
    else if (key === 'changelog') { this.setState({ docId: 'changelog' }); this.goto('docs'); }
    else if (key === 'dimsum') this.toast('🥟 Dim-sum surprise', 'Har gow — crystal skin, three pleats minimum');
  }`

  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 2) settingRows — make the 'vocab' and 'appLogo' row `help` text report
//    real state instead of the design's static copy. Reads
//    `s.vocabState` / `s.appMarkState`, lazily fetched exactly once (guarded
//    on the instance) the first time this settings list is built, since
//    this lane deliberately does not touch componentDidMount (shared,
//    contended text also touched by the base build script and other
//    lanes' wire modules).
// ---------------------------------------------------------------------------

function wireSettingRowsLiveState(html, replaceExact) {
  const NEEDLE_1 = `        const [key, label, help, type, options] = r;`
  const REPLACEMENT_1 = `        const [key, label, help, type, options] = r;
        if (!this._settingsActionsPolled && window.ytdlpStudio) {
          this._settingsActionsPolled = true;
          window.ytdlpStudio.vocabulary.getState().then(vs => this.setState({ vocabState: vs })).catch(() => {});
          window.ytdlpStudio.appMark.getState().then(ms => this.setState({ appMarkState: ms })).catch(() => {});
        }
        const liveHelp = key === 'vocab'
          ? ((s.vocabState && s.vocabState.loaded)
              ? (s.vocabState.entryCount + ' term' + (s.vocabState.entryCount === 1 ? '' : 's') + ' active — your words replace the stock copy everywhere.')
              : 'No file loaded — original wording is shown everywhere. Upload a local JSON dictionary to replace it.')
          : key === 'appLogo'
          ? ((s.appMarkState && s.appMarkState.active)
              ? ('Custom mark active (' + s.appMarkState.widthPx + 'x' + s.appMarkState.heightPx + 'px) in the title bar and tray. Display only — never changes installer or data identity.')
              : 'Using the shipped app mark. Replace it with your own PNG — title bar and tray only.')
          : help;`

  const NEEDLE_2 = `          label, help, isToggle: type === 'toggle', isSelect: type === 'select', isRange: type === 'range',`
  const REPLACEMENT_2 = `          label, help: liveHelp, isToggle: type === 'toggle', isSelect: type === 'select', isRange: type === 'range',`

  html = replaceExact(html, NEEDLE_1, REPLACEMENT_1)
  html = replaceExact(html, NEEDLE_2, REPLACEMENT_2)
  return html
}
