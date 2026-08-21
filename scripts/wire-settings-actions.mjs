// scripts/wire-settings-actions.mjs
//
// Wires the "settings actions" lane into the design-derived renderer HTML:
// personal vocabulary (backend already exists — this lane consumes it),
// the custom application mark, a real in-app Support Tickets dialog, and
// an honest empty-state changelog (no releases have shipped yet).
//
// Same asserted-replacement discipline as `build-renderer-from-design.mjs`:
// every needle is matched byte-exact and asserted to occur exactly once
// via the caller-supplied `replaceExact`, so a needle that stops matching
// fails the build loudly instead of silently shipping a half-wired app.
//
// This module owns ONLY the `replaceExact` targets below. It never touches
// `app/src/renderer/**` directly — it only returns modified HTML text for
// the orchestrator to write out.

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireSettingsActions(html, replaceExact) {
  html = wireTicketsDialogMarkup(html, replaceExact)
  html = wireTicketsDialogData(html, replaceExact)
  html = wireSettingAction(html, replaceExact)
  html = wireSettingRowsLiveState(html, replaceExact)
  html = wireHonestChangelog(html, replaceExact)
  return html
}

// The exact disclosure line this app's Support Tickets contract requires
// (mirrors SUPPORT_TICKETS_DISCLOSURE in
// app/src/shared/settings-actions-contract.ts — duplicated here on
// purpose, since this file is plain generated browser JS with no module
// graph to import that constant from). It is rendered as VISIBLE dialog
// copy — not passed through a native prompt() that vanishes on submit —
// because it is the one line in this whole surface that must actually be
// read.
const DISCLOSURE =
  'This is a local joke, not a real help desk: nothing here is ever sent anywhere, no ticket exists outside this computer, no network request is made, and nobody is reading it. Nobody is coming. "Open data folder" opens this app’s own local data folder so you can delete it yourself — it never deletes anything for you.'

// ---------------------------------------------------------------------------
// 1) A real, anchored Support Tickets dialog (markup), modeled directly on
//    the existing `dialogConfirm` dialog's own structure and styling so it
//    reads as part of the same design rather than a bolted-on prompt().
//    Electron's renderer does not implement window.prompt()/confirm() —
//    they throw at call time — so a native browser dialog was never a
//    viable route here; this replaces that dead-on-arrival approach.
// ---------------------------------------------------------------------------

function wireTicketsDialogMarkup(html, replaceExact) {
  const ANCHOR = '  <sc-if value="{{ hasWizard }}" hint-placeholder-val="{{ false }}">'
  const DIALOG =
    '  <sc-if value="{{ dialogTickets }}" hint-placeholder-val="{{ false }}">\n' +
    '    <div style="position:fixed;inset:0;background:#000b;display:grid;place-items:center;overflow:auto;padding:24px 0;z-index:48">\n' +
    '      <div style="width:min(480px,calc(100vw - 40px));background:#1b2121;border-radius:28px;padding:24px;box-shadow:0 8px 24px #000a">\n' +
    '        <div style="font-size:22px;font-weight:400;margin-bottom:6px">Support tickets</div>\n' +
    '        <div style="font-size:12px;color:#889391;margin-bottom:16px;line-height:1.5;text-wrap:pretty">{{ ticketDisclosure }}</div>\n' +
    '        <label style="display:block;font-size:12px;color:#bec9c7;margin-bottom:4px">Category</label>\n' +
    '        <select value="{{ ticketCategory }}" onChange="{{ setTicketCategory }}" style="width:100%;height:40px;border-radius:8px;background:#252b2b;color:#dee4e3;border:1px solid #3f4948;margin-bottom:12px;padding:0 10px;box-sizing:border-box">\n' +
    '          <sc-for list="{{ ticketCategories }}" as="cat" hint-placeholder-count="4">\n' +
    '            <option value="{{ cat }}">{{ cat }}</option>\n' +
    '          </sc-for>\n' +
    '        </select>\n' +
    '        <label style="display:block;font-size:12px;color:#bec9c7;margin-bottom:4px">What went wrong</label>\n' +
    '        <textarea value="{{ ticketDescription }}" onChange="{{ setTicketDescription }}" rows="4" placeholder="Describe it, or do not — nobody reads this either way" style="width:100%;border-radius:8px;background:#252b2b;color:#dee4e3;border:1px solid #3f4948;padding:10px;margin-bottom:8px;resize:vertical;box-sizing:border-box;font-family:inherit;font-size:13px"></textarea>\n' +
    '        <div style="font-size:12px;color:{{ ticketStatusColor }};min-height:16px;margin-bottom:12px">{{ ticketStatusMessage }}</div>\n' +
    '        <sc-if value="{{ hasTicketRows }}" hint-placeholder-val="{{ false }}">\n' +
    '          <div style="max-height:120px;overflow:auto;border-top:1px solid #2a3130;padding-top:10px;margin-bottom:14px;display:grid;gap:6px">\n' +
    '            <sc-for list="{{ ticketRows }}" as="t" hint-placeholder-count="2">\n' +
    '              <div style="font-size:11.5px;color:#bec9c7"><b style="color:#dee4e3">{{ t.number }}</b> · {{ t.category }} · {{ t.status }}</div>\n' +
    '            </sc-for>\n' +
    '          </div>\n' +
    '        </sc-if>\n' +
    '        <div style="display:flex;justify-content:end;gap:8px;margin-top:6px">\n' +
    '          <button onClick="{{ closeTickets }}" style="height:40px;padding:0 20px;border-radius:20px;background:#324b48;color:#cfe9e5;font-size:14px;font-weight:500">{{ closeTicketsLabel }}</button>\n' +
    '          <button onClick="{{ openTicketFolder }}" style="height:40px;padding:0 20px;border-radius:20px;background:#252b2b;color:#bec9c7;font-size:14px;font-weight:500">Open data folder</button>\n' +
    '          <button onClick="{{ fileTicket }}" style="height:40px;padding:0 24px;border-radius:20px;background:#82d5cc;color:#003733;font-size:14px;font-weight:700">File ticket</button>\n' +
    '        </div>\n' +
    '      </div>\n' +
    '    </div>\n' +
    '  </sc-if>\n' +
    '\n'
  return replaceExact(html, ANCHOR, DIALOG + ANCHOR)
}

// ---------------------------------------------------------------------------
// 2) The dialog's data/handlers — inserted right after the dialogConfirm
//    block's own JS (which ends at `hasWizard: !!s.wizard,`, the JS-side
//    counterpart of the markup anchor above).
// ---------------------------------------------------------------------------

function wireTicketsDialogData(html, replaceExact) {
  const ANCHOR = '      hasWizard: !!s.wizard,'
  const DATA =
    "      dialogTickets: s.dialog === 'tickets',\n" +
    '      ticketDisclosure: ' + JSON.stringify(DISCLOSURE) + ',\n' +
    "      ticketCategories: ['General', 'Playback', 'Downloads', 'Just venting'],\n" +
    "      ticketCategory: s.ticketCategory || 'General',\n" +
    '      setTicketCategory: e => this.setState({ ticketCategory: e.target.value }),\n' +
    "      ticketDescription: s.ticketDescription || '',\n" +
    "      setTicketDescription: e => this.setState({ ticketDescription: e.target.value, ticketStatusMessage: '', ticketStatusColor: '#889391' }),\n" +
    "      ticketStatusMessage: s.ticketStatusMessage || '',\n" +
    "      ticketStatusColor: s.ticketStatusColor || '#889391',\n" +
    '      hasTicketRows: !!(s.ticketList && s.ticketList.length),\n' +
    '      ticketRows: (s.ticketList || []).slice(0, 6).map(t => ({ number: t.number, category: t.category, status: t.status })),\n' +
    "      closeTicketsLabel: s.ticketFiledOnce ? 'Close' : 'Cancel',\n" +
    '      closeTickets: () => this.setState({ dialog: null }),\n' +
    '      openTicketFolder: () => {\n' +
    '        if (!window.ytdlpStudio) return;\n' +
    '        window.ytdlpStudio.supportTickets.openDataFolder().then(res => {\n' +
    "          if (!res.ok) this.toast('Support tickets', res.error || 'Could not open the folder.');\n" +
    "        }).catch(err => this.toast('Support tickets', 'Could not open the folder: ' + (err && err.message ? err.message : String(err))));\n" +
    '      },\n' +
    '      fileTicket: () => {\n' +
    "        if (!window.ytdlpStudio) { this.setState({ ticketStatusMessage: 'Not connected to the app shell.', ticketStatusColor: '#ffb4ab' }); return; }\n" +
    "        const category = s.ticketCategory || 'General';\n" +
    "        const description = (s.ticketDescription || '').trim();\n" +
    "        if (!description) { this.setState({ ticketStatusMessage: 'Describe what went wrong first.', ticketStatusColor: '#ffb4ab' }); return; }\n" +
    '        window.ytdlpStudio.supportTickets.create({ category, description }).then(res => {\n' +
    '          if (!res.ok || !res.ticket) {\n' +
    "            this.setState({ ticketStatusMessage: res.error || 'Could not file the ticket.', ticketStatusColor: '#ffb4ab' });\n" +
    '            return;\n' +
    '          }\n' +
    '          this.setState(st => ({\n' +
    "            ticketDescription: '',\n" +
    '            ticketFiledOnce: true,\n' +
    "            ticketStatusMessage: 'Filed as ' + res.ticket.number + ' (status: ' + res.ticket.status + ').',\n" +
    "            ticketStatusColor: '#82d5cc',\n" +
    '            ticketList: [res.ticket, ...(st.ticketList || [])],\n' +
    '          }));\n' +
    "        }).catch(err => this.setState({ ticketStatusMessage: 'Could not file the ticket: ' + (err && err.message ? err.message : String(err)), ticketStatusColor: '#ffb4ab' }));\n" +
    '      },\n' +
    '\n' +
    '      hasWizard: !!s.wizard,'
  return replaceExact(html, ANCHOR, DATA)
}

// ---------------------------------------------------------------------------
// 3) settingAction(key) — replace the mock toasts for 'vocab' and 'appLogo'
//    with real bridge calls, and open the real Support Tickets dialog
//    (rather than firing window.prompt(), which Electron's renderer does
//    not implement — it throws "prompt() is and will not be supported."
//    at the very first call, so the original prompt()-based flow never
//    collected anything on the real packaged app). 'editor' (owned by the
//    fileops lane) and 'changelog'/'dimsum' are carried through byte-for-
//    byte; the changelog's own fabricated content is fixed separately in
//    `wireHonestChangelog` below.
// ---------------------------------------------------------------------------

function wireSettingAction(html, replaceExact) {
  const NEEDLE =
    "  settingAction(key) {\n" +
    "    if (key === 'vocab') this.toast('Vocabulary loaded', 'personal-vocabulary.json · 212 terms now replace the stock copy');\n" +
    "    else if (key === 'appLogo') this.toast('App mark', 'Pick a square PNG or SVG — title bar, tray and installer');\n" +
    "    else if (key === 'editor') this.toast('Handed off', 'yt-dlp.conf opened in your editor — saved changes reload live');\n" +
    "    else if (key === 'tickets') this.setState({ dialog: 'notifications' });\n" +
    "    else if (key === 'changelog') { this.setState({ docId: 'changelog' }); this.goto('docs'); }\n" +
    "    else if (key === 'dimsum') this.toast('🥟 Dim-sum surprise', 'Har gow — crystal skin, three pleats minimum');\n" +
    "  }"

  const REPLACEMENT =
    "  settingAction(key) {\n" +
    "    if (key === 'vocab') {\n" +
    "      if (!window.ytdlpStudio) { this.toast('Vocabulary', 'Not connected to the app shell.'); return; }\n" +
    "      window.ytdlpStudio.vocabulary.pickAndLoad().then(res => {\n" +
    "        this.setState({ vocabState: res.state });\n" +
    "        if (res.cancelled) return;\n" +
    "        if (!res.ok) { this.toast('Vocabulary rejected', res.error || 'The file could not be loaded.'); return; }\n" +
    "        const n = res.state.entryCount;\n" +
    "        this.toast('Vocabulary loaded', n + ' term' + (n === 1 ? '' : 's') + ' now replace the stock copy');\n" +
    "      }).catch(err => this.toast('Vocabulary', 'Could not open the picker: ' + (err && err.message ? err.message : String(err))));\n" +
    "    }\n" +
    "    else if (key === 'appLogo') {\n" +
    "      if (!window.ytdlpStudio) { this.toast('App mark', 'Not connected to the app shell.'); return; }\n" +
    "      window.ytdlpStudio.appMark.pickAndApply().then(res => {\n" +
    "        this.setState({ appMarkState: res.state });\n" +
    "        if (res.cancelled) return;\n" +
    "        if (!res.ok) { this.toast('App mark rejected', res.error || 'The image could not be applied.'); return; }\n" +
    "        this.toast('App mark applied', res.state.widthPx + 'x' + res.state.heightPx + 'px — title bar and tray only');\n" +
    "      }).catch(err => this.toast('App mark', 'Could not open the picker: ' + (err && err.message ? err.message : String(err))));\n" +
    "    }\n" +
    "    else if (key === 'editor') this.toast('Handed off', 'yt-dlp.conf opened in your editor — saved changes reload live');\n" +
    "    else if (key === 'tickets') {\n" +
    "      if (!window.ytdlpStudio) { this.toast('Support tickets', 'Not connected to the app shell.'); return; }\n" +
    "      this.setState({ dialog: 'tickets', ticketCategory: 'General', ticketDescription: '', ticketStatusMessage: '', ticketFiledOnce: false, ticketList: [] });\n" +
    "      window.ytdlpStudio.supportTickets.list().then(list => this.setState({ ticketList: list })).catch(() => {});\n" +
    "    }\n" +
    "    else if (key === 'changelog') { this.setState({ docId: 'changelog' }); this.goto('docs'); }\n" +
    "    else if (key === 'dimsum') this.toast('🥟 Dim-sum surprise', 'Har gow — crystal skin, three pleats minimum');\n" +
    "  }"

  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 4) settingRows — make the 'vocab' and 'appLogo' row `help` text report
//    real state instead of the design's static copy. Reads
//    `s.vocabState` / `s.appMarkState`, lazily fetched exactly once (guarded
//    on the instance) the first time this settings list is built, since
//    this lane deliberately does not touch componentDidMount (shared,
//    contended text also touched by the base build script and other
//    lanes' wire modules).
// ---------------------------------------------------------------------------

function wireSettingRowsLiveState(html, replaceExact) {
  const NEEDLE_1 = '        const [key, label, help, type, options] = r;'
  const REPLACEMENT_1 =
    "        const [key, label, help, type, options] = r;\n" +
    '        if (!this._settingsActionsPolled && window.ytdlpStudio) {\n' +
    '          this._settingsActionsPolled = true;\n' +
    '          window.ytdlpStudio.vocabulary.getState().then(vs => this.setState({ vocabState: vs })).catch(() => {});\n' +
    '          window.ytdlpStudio.appMark.getState().then(ms => this.setState({ appMarkState: ms })).catch(() => {});\n' +
    '        }\n' +
    "        const liveHelp = key === 'vocab'\n" +
    '          ? ((s.vocabState && s.vocabState.loaded)\n' +
    "              ? (s.vocabState.entryCount + ' term' + (s.vocabState.entryCount === 1 ? '' : 's') + ' active — your words replace the stock copy everywhere.')\n" +
    "              : 'No file loaded — original wording is shown everywhere. Upload a local JSON dictionary to replace it.')\n" +
    "          : key === 'appLogo'\n" +
    '          ? ((s.appMarkState && s.appMarkState.active)\n' +
    "              ? ('Custom mark active (' + s.appMarkState.widthPx + 'x' + s.appMarkState.heightPx + 'px) in the title bar and tray. Display only — never changes installer or data identity.')\n" +
    "              : 'Using the shipped app mark. Replace it with your own PNG — title bar and tray only.')\n" +
    '          : help;'

  const NEEDLE_2 = "          label, help, isToggle: type === 'toggle', isSelect: type === 'select', isRange: type === 'range',"
  const REPLACEMENT_2 = "          label, help: liveHelp, isToggle: type === 'toggle', isSelect: type === 'select', isRange: type === 'range',"

  html = replaceExact(html, NEEDLE_1, REPLACEMENT_1)
  html = replaceExact(html, NEEDLE_2, REPLACEMENT_2)
  return html
}

// ---------------------------------------------------------------------------
// 5) Honest changelog: this build has shipped no GitHub Releases at all, so
//    the in-app "What changed" page must not present an invented release
//    history (0.9.2 / 0.9.1 / 0.9.0) as though those were real, published
//    versions. Replace it with a genuine empty state, gated the same way
//    the app's other now-removed seeded demo data was gated. The rendering
//    for `doc.sections` (see `docSections` in the JS builder) already
//    handles an arbitrary list of `[glyph, heading, body]` tuples
//    generically, so an honest single "no releases yet" entry needs no new
//    markup — it reuses the exact same tuple shape the real content would
//    use once a release actually ships.
// ---------------------------------------------------------------------------

function wireHonestChangelog(html, replaceExact) {
  const NEEDLE =
    "{ id: 'changelog', glyph: 'new_releases', title: 'What changed', summary: 'Release notes for the app and the yt-dlp engine it ships. Offline, like everything else.',\n" +
    '        sections: [\n' +
    "          ['new_releases', '0.9.2 — this build', 'History became a manager: day grouping, diff inspector, restore points, bulk actions and retention. Legacy-flag reference. Element locks now actually lock, with an unlock flow. Guide dialogs fixed for empty choices.', '', ['Open history', 'history']],\n" +
    "          ['update', '0.9.1', 'Engine updated to yt-dlp 2026.08.12. New --remote-components and --js-runtimes controls. Companion extension handshake for start, progress and completion.'],\n" +
    "          ['flag', '0.9.0', 'First unsigned preview: three modes, every CLI option as a real control, wizards, presets, toy locks and the command palette.'],\n" +
    '        ] },'

  const REPLACEMENT =
    "{ id: 'changelog', glyph: 'new_releases', title: 'What changed', summary: 'Release notes for the app and the yt-dlp engine it ships, offline, once a release actually exists.',\n" +
    '        sections: [\n' +
    "          ['info', 'No releases yet', 'This build has not shipped a release. Nothing is invented here to fill the gap — once a real GitHub Release is published, its notes will appear on this page automatically.'],\n" +
    '        ] },'

  return replaceExact(html, NEEDLE, REPLACEMENT)
}
