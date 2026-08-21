// scripts/wire-tools-modes.mjs
//
// Wires four SURFACE-ONLY lanes named in docs/contract-audit.md into the
// design-derived renderer HTML, backed by the real main-process modules in
// app/src/main/modes.ts and app/src/main/ollama.ts (via the IPC bridge
// wired into app/src/main/ipc.ts + app/src/preload/index.ts):
//
//   1. ADHD modes: five INDEPENDENT toggles (Focus, Low stimulation,
//      Time awareness, One thing at a time, Momentum), all off by default,
//      each with a real visible effect and real main-process persistence.
//   2. School mode: a renameable, credential-gated toggle. A real password
//      dialog (not window.prompt(), which throws in this renderer) enables
//      and disables it; it forces English and hides Yue/Bilingual/funny
//      levels from the language settings while active.
//   3. The local Ollama model-suite manager: a real probe of Ollama's local
//      HTTP API (127.0.0.1:11434 — never a cloud service), rendered into
//      the existing "Local AI (Ollama)" settings row instead of a static
//      option list.
//   4. Changelog viewer: left to scripts/wire-settings-actions.mjs, which
//      already owns that surface's markup and already renders an honest
//      state rather than invented entries — not touched here to avoid a
//      needle collision with that lane.
//
// Same asserted-replacement discipline as every other wire-*.mjs module:
// every needle is matched byte-exact and asserted to occur exactly once via
// the caller-supplied `replaceExact`.

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireToolsModes(html, replaceExact) {
  html = wireAdhdKeyMap(html, replaceExact)
  html = wireSettingRows(html, replaceExact)
  html = wireQuickPaletteRow(html, replaceExact)
  html = wireGenericToggleHandler(html, replaceExact)
  html = wireLanguageRowsSchoolGate(html, replaceExact)
  html = wireOllamaLiveOptions(html, replaceExact)
  html = wireDidMountHydrate(html, replaceExact)
  html = wireWillUnmount(html, replaceExact)
  html = wireHeaderFocusChrome(html, replaceExact)
  html = wireHeaderStatusBar(html, replaceExact)
  html = wireSchoolDialog(html, replaceExact)
  html = wireRootDataAttrs(html, replaceExact)
  html = wireRootMotionAttr(html, replaceExact)
  html = wireSettingRowsSchoolGate(html, replaceExact)
  html = wireModeValueSchoolGate(html, replaceExact)
  html = wireMotionCss(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 0) A top-level lookup from the renderer's `pref()` keys to the real
//    AdhdFlags field name modes.ts persists, plus a small elapsed-time
//    formatter shared by the header status bar. Inserted once, at module
//    scope, above the component class.
// ---------------------------------------------------------------------------

function wireAdhdKeyMap(html, replaceExact) {
  const ANCHOR = 'class Component extends DCLogic {\n'
  const PREFIX =
    "const ADHD_PREF_TO_FLAG = { adhdFocus: 'focus', adhdLowStim: 'lowStim', adhdTime: 'timeAwareness', adhdOneThing: 'oneThing', adhdMomentum: 'momentum' };\n" +
    'function formatElapsedMs(ms) {\n' +
    '  const total = Math.max(0, Math.floor(ms / 1000));\n' +
    '  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;\n' +
    "  return (h > 0 ? h + 'h ' : '') + m + 'm ' + sec + 's';\n" +
    '}\n' +
    ANCHOR
  return replaceExact(html, ANCHOR, PREFIX)
}

// ---------------------------------------------------------------------------
// 1) Split the single ['adhd', ...] settings row into five independent
//    toggles, and add the School mode recovery line to its own row's help
//    text. All five default to `false` via the existing generic pref()
//    plumbing (`store[key]` falls back to `undefined` -> falsy -> off).
// ---------------------------------------------------------------------------

function wireSettingRows(html, replaceExact) {
  const NEEDLE =
    "        ['school', 'School mode', 'Classroom-safe plain copy everywhere; funny levels are ignored while it is on.', 'toggle'],\n" +
    "        ['adhd', 'ADHD mode', 'One thing at a time: fewer moving parts, stronger focus states, progress as plain numbers.', 'toggle'],\n"
  const REPLACEMENT =
    "        ['school', 'School mode', 'Classroom-safe plain copy everywhere; funny levels are ignored while it is on. Recovery: delete this app’s local data folder.', 'toggle'],\n" +
    "        ['adhdFocus', 'ADHD: Focus', 'Brings the current surface forward and dims the rest of the header. Nothing is ever hidden for good.', 'toggle'],\n" +
    "        ['adhdLowStim', 'ADHD: Low stimulation', 'Turns off decorative motion everywhere, on top of your reduced-motion setting.', 'toggle'],\n" +
    "        ['adhdTime', 'ADHD: Time awareness', 'Shows how long this session has been open, right in the header.', 'toggle'],\n" +
    "        ['adhdOneThing', 'ADHD: One thing at a time', 'Pins a single current action you choose, visible in the header.', 'toggle'],\n" +
    "        ['adhdMomentum', 'ADHD: Momentum', 'A gentle nudge if the pinned action sits untouched for 20 minutes. \"Not now\" is respected for an hour.', 'toggle'],\n"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 2) The command-palette quick row for the old single 'adhd' pref now
//    points at the real Focus flag, so it stays a working shortcut rather
//    than a dead reference to a key nothing sets anymore.
// ---------------------------------------------------------------------------

function wireQuickPaletteRow(html, replaceExact) {
  const NEEDLE =
    "      { label: 'ADHD mode', hint: 'Settings · Accessibility', control: 'toggle', value: pref('adhd', false), apply: v => setPref('adhd', v), run: () => this.teleport('settings', 'ADHD mode') },"
  const REPLACEMENT =
    "      { label: 'ADHD: Focus', hint: 'Settings · Accessibility', control: 'toggle', value: pref('adhdFocus', false), apply: v => setPref('adhdFocus', v), run: () => this.teleport('settings', 'ADHD: Focus') },"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 3) The generic toggle handler shared by every 'toggle'-type settings row.
//    Special-cases School mode (opens a real password dialog instead of
//    flipping a boolean directly) and every ADHD key (also persists to the
//    real main-process store via IPC, fire-and-forget with a caught error
//    so a missing bridge never throws inside a render-time handler).
// ---------------------------------------------------------------------------

function wireGenericToggleHandler(html, replaceExact) {
  const NEEDLE =
    '          toggle: () => this.setState(st => ({ settings: { ...(st.settings || {}), [key]: !on }, prefs: { ...(st.prefs || {}), [key]: !on } })),\n'
  const REPLACEMENT =
    '          toggle: () => {\n' +
    "            if (key === 'school') { this.setState({ dialog: on ? 'schoolDisable' : 'schoolEnable', schoolPassword: '', schoolError: null }); return; }\n" +
    '            const next = !on;\n' +
    '            this.setState(st => ({ settings: { ...(st.settings || {}), [key]: next }, prefs: { ...(st.prefs || {}), [key]: next } }));\n' +
    '            if (ADHD_PREF_TO_FLAG[key] && window.ytdlpStudio) {\n' +
    '              window.ytdlpStudio.modes.setAdhdFlag(ADHD_PREF_TO_FLAG[key], next).catch(() => {});\n' +
    '            }\n' +
    '          },\n'
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 4) School mode gates the language options it is documented to gate: while
//    it is on, the Language mode row is forced to English and its Yue and
//    Bilingual choices, plus both funny-level rows, disappear from the
//    options list rather than merely being disabled — the contract requires
//    they be "omitted from every surface", not just visually greyed out.
// ---------------------------------------------------------------------------

function wireLanguageRowsSchoolGate(html, replaceExact) {
  const NEEDLE = "    const prefs = s.prefs || {};\n    const pref = (k, d) => (prefs[k] !== undefined ? prefs[k] : d);\n"
  const REPLACEMENT =
    "    const prefs = s.prefs || {};\n" +
    "    const pref = (k, d) => (prefs[k] !== undefined ? prefs[k] : d);\n" +
    "    const schoolActive = !!prefs.school;\n"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 5) The "Local AI (Ollama)" settings row: real probe results instead of a
//    static option list. Options become "Off" plus every model Ollama's own
//    local /api/tags reports as installed; the row's help text states the
//    real reachable/unreachable state, never a guessed one.
// ---------------------------------------------------------------------------

function wireOllamaLiveOptions(html, replaceExact) {
  const NEEDLE =
    "        ['ollama', 'Local AI (Ollama)', 'Optional local model that summarises errors and drafts filters; fully offline.', 'select', ['Off', 'qwen3:4b', 'llama3.2:3b', 'Manage suite']],\n"
  const REPLACEMENT =
    "        ['ollama', 'Local AI (Ollama)', (s.ollamaState\n" +
    "          ? (s.ollamaState.status === 'unreachable'\n" +
    "              ? ('Ollama not detected: ' + s.ollamaState.error)\n" +
    "              : (s.ollamaState.models.length === 0\n" +
    "                  ? ('Ollama ' + (s.ollamaState.version || '') + ' is running with no models pulled yet.')\n" +
    "                  : (s.ollamaState.models.length + ' model(s) installed. Fit is evidence-based from real host memory and each model\\'s real reported size — never guessed from its name.')))\n" +
    "          : 'Optional local model, fully offline. Probing 127.0.0.1:11434\\u2026'),\n" +
    "          'select', (s.ollamaState && s.ollamaState.status === 'reachable' && s.ollamaState.models.length > 0)\n" +
    "            ? ['Off', ...s.ollamaState.models.map(m => m.name + ' (' + m.fit + ')')]\n" +
    "            : ['Off']],\n"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 6) componentDidMount: hydrate ADHD/School state and the one-thing-at-a-
//    time text from the real main-process record on launch, probe Ollama
//    once, and start the one-second ticker the header's elapsed-time and
//    momentum-nudge readouts use.
// ---------------------------------------------------------------------------

function wireDidMountHydrate(html, replaceExact) {
  const NEEDLE = '  componentDidMount() {\n'
  const REPLACEMENT =
    '  componentDidMount() {\n' +
    '    if (window.ytdlpStudio && window.ytdlpStudio.modes) {\n' +
    '      window.ytdlpStudio.modes.getState().then(ms => {\n' +
    '        this.setState(st => ({\n' +
    '          modesState: ms,\n' +
    '          prefs: {\n' +
    '            ...(st.prefs || {}),\n' +
    '            adhdFocus: ms.adhd.focus, adhdLowStim: ms.adhd.lowStim, adhdTime: ms.adhd.timeAwareness,\n' +
    '            adhdOneThing: ms.adhd.oneThing, adhdMomentum: ms.adhd.momentum, school: ms.school.enabled,\n' +
    '          },\n' +
    '          oneThingActionDraft: ms.oneThingAction || \'\',\n' +
    '        }));\n' +
    '      }).catch(() => {});\n' +
    '    }\n' +
    '    if (window.ytdlpStudio && window.ytdlpStudio.ollama) {\n' +
    '      window.ytdlpStudio.ollama.probe().then(res => this.setState({ ollamaState: res })).catch(err => {\n' +
    "        this.setState({ ollamaState: { status: 'unreachable', error: (err && err.message) ? err.message : String(err), version: null, models: [], hostTotalMemBytes: 0, hostFreeMemBytes: 0 } });\n" +
    '      });\n' +
    '    }\n' +
    '    this._modesTimer = setInterval(() => this.forceUpdate(), 1000);\n'
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

function wireWillUnmount(html, replaceExact) {
  // Anchor on the single _unwireBridge() call rather than the whole method.
  // Two other lanes now rewrite componentWillUnmount (one adds a tab-state
  // save timer, one expands it across several lines for the narrator), so the
  // method body is a moving target while this one line is stable and unique.
  const NEEDLE = "this._unwireBridge();"
  const REPLACEMENT = "clearInterval(this._modesTimer); this._unwireBridge();"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 7) Focus mode's real visible effect: dims (never hides) the header's
//    secondary chrome — the mode-tab pill, notification bell, and window
//    controls — while the active surface stays full-strength. Composes
//    with (never overrides) the CSS reduced-motion media query already in
//    the stylesheet.
// ---------------------------------------------------------------------------

function wireHeaderFocusChrome(html, replaceExact) {
  const NEEDLE =
    '    <div style="display:flex;align-items:center;gap:2px;flex:0 0 auto">\n' +
    '      <div style="display:flex;background:#252b2b;border-radius:18px;padding:3px;gap:2px">\n'
  const REPLACEMENT =
    '    <div style="display:flex;align-items:center;gap:2px;flex:0 0 auto;{{ focusChromeStyle }}">\n' +
    '      <div style="display:flex;background:#252b2b;border-radius:18px;padding:3px;gap:2px">\n'
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 8) The header status bar itself: only rendered when at least one ADHD
//    mode with a header presence is on. Time awareness gets a live elapsed
//    readout; One thing at a time gets an editable pinned-action field
//    (persisted via IPC on change); Momentum gets a dismissible nudge once
//    the pinned action has sat untouched for 20 minutes, snoozed for an
//    hour on "Not now".
// ---------------------------------------------------------------------------

function wireHeaderStatusBar(html, replaceExact) {
  const ANCHOR = '  </header>\n'
  const BAR =
    '  <sc-if value="{{ adhdBarVisible }}" hint-placeholder-val="{{ false }}">\n' +
    '    <div style="display:flex;align-items:center;gap:14px;padding:6px 16px;background:#151a1c;border-bottom:1px solid #2a3130;flex:0 0 auto;font-size:12px;color:#bec9c7">\n' +
    '      <sc-if value="{{ adhdTimeOn }}" hint-placeholder-val="{{ false }}">\n' +
    '        <span title="How long this session has been open"><i class="msym" style="font-size:14px;vertical-align:-2px">schedule</i> {{ elapsedSessionText }}</span>\n' +
    '      </sc-if>\n' +
    '      <sc-if value="{{ adhdOneThingOn }}" hint-placeholder-val="{{ false }}">\n' +
    '        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;max-width:420px">\n' +
    '          <i class="msym" style="font-size:14px;flex:0 0 auto">flag</i>\n' +
    '          <input value="{{ oneThingActionDraft }}" onChange="{{ setOneThingActionDraft }}" onBlur="{{ commitOneThingAction }}" placeholder="What is the one thing right now?" style="flex:1;min-width:0;background:transparent;border:0;border-bottom:1px solid #2a3130;color:#dee4e3;font-size:12px;padding:2px 0" />\n' +
    '        </div>\n' +
    '      </sc-if>\n' +
    '      <sc-if value="{{ adhdFocusOn }}" hint-placeholder-val="{{ false }}">\n' +
    '        <span style="color:#82d5cc"><i class="msym" style="font-size:14px;vertical-align:-2px">center_focus_strong</i> Focus on</span>\n' +
    '      </sc-if>\n' +
    '      <sc-if value="{{ adhdLowStimOn }}" hint-placeholder-val="{{ false }}">\n' +
    '        <span style="color:#82d5cc"><i class="msym" style="font-size:14px;vertical-align:-2px">volume_off</i> Low stimulation on</span>\n' +
    '      </sc-if>\n' +
    '      <sc-if value="{{ momentumNudgeVisible }}" hint-placeholder-val="{{ false }}">\n' +
    '        <div style="margin-left:auto;display:flex;align-items:center;gap:8px;background:#252b2b;border-radius:14px;padding:4px 10px">\n' +
    '          <span>Still on “{{ oneThingActionDraft }}”? It has sat untouched a while.</span>\n' +
    '          <button onClick="{{ snoozeMomentum }}" style="background:transparent;color:#82d5cc;font-size:12px;font-weight:500">Not now</button>\n' +
    '        </div>\n' +
    '      </sc-if>\n' +
    '    </div>\n' +
    '  </sc-if>\n' +
    ANCHOR
  return replaceExact(html, ANCHOR, BAR)
}

// ---------------------------------------------------------------------------
// 9) The School mode enable/disable dialogs. Modeled on the existing
//    Support Tickets dialog's own structure so it reads as part of the same
//    design. Enable sets a fresh credential (any non-empty value — this is
//    a documented user-experience lock, never a security boundary) and a
//    rename field; disable requires the credential to match, verified in
//    the main process via scrypt, and always offers the documented
//    recovery route (delete the local data folder) as a visible line.
// ---------------------------------------------------------------------------

function wireSchoolDialog(html, replaceExact) {
  const ANCHOR = '  <sc-if value="{{ hasWizard }}" hint-placeholder-val="{{ false }}">'
  const DIALOG =
    '  <sc-if value="{{ dialogSchoolEnable }}" hint-placeholder-val="{{ false }}">\n' +
    '    <div style="position:fixed;inset:0;background:#000b;display:grid;place-items:center;overflow:auto;padding:24px 0;z-index:48">\n' +
    '      <div style="width:min(420px,calc(100vw - 40px));background:#1b2121;border-radius:28px;padding:24px;box-shadow:0 8px 24px #000a">\n' +
    '        <div style="font-size:22px;font-weight:400;margin-bottom:6px">Turn on School mode</div>\n' +
    '        <div style="font-size:12px;color:#889391;margin-bottom:16px;line-height:1.5">A user-experience lock, not a security boundary. Forces English and hides Cantonese, bilingual, and funny-level controls until you turn it off again. You can rename it below; it can also be recovered by deleting this app’s local data folder.</div>\n' +
    '        <label style="display:block;font-size:12px;color:#bec9c7;margin-bottom:4px">Display name</label>\n' +
    '        <input value="{{ schoolNameDraft }}" onChange="{{ setSchoolNameDraft }}" placeholder="School mode" style="width:100%;height:40px;border-radius:8px;background:#252b2b;color:#dee4e3;border:1px solid #3f4948;padding:0 10px;margin-bottom:12px;box-sizing:border-box" />\n' +
    '        <label style="display:block;font-size:12px;color:#bec9c7;margin-bottom:4px">Unlock password or PIN</label>\n' +
    '        <input type="password" value="{{ schoolPassword }}" onChange="{{ setSchoolPassword }}" placeholder="Anything — this is just a speed bump" style="width:100%;height:40px;border-radius:8px;background:#252b2b;color:#dee4e3;border:1px solid #3f4948;padding:0 10px;box-sizing:border-box" />\n' +
    '        <div style="font-size:12px;color:#e9927c;min-height:16px;margin:8px 0 4px">{{ schoolError }}</div>\n' +
    '        <div style="display:flex;justify-content:end;gap:8px;margin-top:14px">\n' +
    '          <button onClick="{{ closeSchoolDialog }}" style="height:40px;padding:0 20px;border-radius:20px;background:#252b2b;color:#bec9c7;font-size:14px;font-weight:500">Cancel</button>\n' +
    '          <button onClick="{{ confirmSchoolEnable }}" style="height:40px;padding:0 24px;border-radius:20px;background:#82d5cc;color:#003733;font-size:14px;font-weight:700">Turn on</button>\n' +
    '        </div>\n' +
    '      </div>\n' +
    '    </div>\n' +
    '  </sc-if>\n' +
    '  <sc-if value="{{ dialogSchoolDisable }}" hint-placeholder-val="{{ false }}">\n' +
    '    <div style="position:fixed;inset:0;background:#000b;display:grid;place-items:center;overflow:auto;padding:24px 0;z-index:48">\n' +
    '      <div style="width:min(420px,calc(100vw - 40px));background:#1b2121;border-radius:28px;padding:24px;box-shadow:0 8px 24px #000a">\n' +
    '        <div style="font-size:22px;font-weight:400;margin-bottom:6px">Turn off {{ schoolDisplayName }}</div>\n' +
    '        <div style="font-size:12px;color:#889391;margin-bottom:16px;line-height:1.5">Enter the password or PIN you set. Forgot it? Close this and delete this app’s local data folder instead — that resets everything, including this lock.</div>\n' +
    '        <input type="password" value="{{ schoolPassword }}" onChange="{{ setSchoolPassword }}" placeholder="Password or PIN" style="width:100%;height:40px;border-radius:8px;background:#252b2b;color:#dee4e3;border:1px solid #3f4948;padding:0 10px;box-sizing:border-box" />\n' +
    '        <div style="font-size:12px;color:#e9927c;min-height:16px;margin:8px 0 4px">{{ schoolError }}</div>\n' +
    '        <div style="display:flex;justify-content:end;gap:8px;margin-top:14px">\n' +
    '          <button onClick="{{ closeSchoolDialog }}" style="height:40px;padding:0 20px;border-radius:20px;background:#252b2b;color:#bec9c7;font-size:14px;font-weight:500">Cancel</button>\n' +
    '          <button onClick="{{ confirmSchoolDisable }}" style="height:40px;padding:0 24px;border-radius:20px;background:#82d5cc;color:#003733;font-size:14px;font-weight:700">Turn off</button>\n' +
    '        </div>\n' +
    '      </div>\n' +
    '    </div>\n' +
    '  </sc-if>\n' +
    '\n' +
    ANCHOR
  return replaceExact(html, ANCHOR, DIALOG + ANCHOR)
}

// ---------------------------------------------------------------------------
// 10) Root wrapper gets computed template bindings: the render-time values
//     the markup above references, plus every handler the dialogs and
//     status bar call. Inserted right after the two other root-level style
//     computations so it reads as part of the same block.
// ---------------------------------------------------------------------------

function wireRootDataAttrs(html, replaceExact) {
  const NEEDLE =
    "      rootFont: (pref('font', 'Roboto') === 'Roboto Mono' ? \"'Roboto Mono',Consolas,monospace\" : pref('font', 'Roboto') + ',Roboto,\"Segoe UI\",system-ui,sans-serif'),\n"
  const REPLACEMENT =
    "      rootFont: (pref('font', 'Roboto') === 'Roboto Mono' ? \"'Roboto Mono',Consolas,monospace\" : pref('font', 'Roboto') + ',Roboto,\"Segoe UI\",system-ui,sans-serif'),\n" +
    '      focusChromeStyle: pref(\'adhdFocus\', false) ? \'opacity:.45;filter:grayscale(.6);transition:opacity .15s\' : \'\',\n' +
    "      adhdTimeOn: pref('adhdTime', false), adhdOneThingOn: pref('adhdOneThing', false),\n" +
    "      adhdFocusOn: pref('adhdFocus', false), adhdLowStimOn: pref('adhdLowStim', false),\n" +
    "      adhdBarVisible: pref('adhdTime', false) || pref('adhdOneThing', false) || pref('adhdFocus', false) || pref('adhdLowStim', false),\n" +
    "      elapsedSessionText: formatElapsedMs(Date.now() - ((s.modesState && s.modesState.sessionStartedAt) || Date.now())),\n" +
    "      oneThingActionDraft: s.oneThingActionDraft || '',\n" +
    "      setOneThingActionDraft: e => this.setState({ oneThingActionDraft: e.target.value }),\n" +
    '      commitOneThingAction: () => {\n' +
    '        if (window.ytdlpStudio && window.ytdlpStudio.modes) {\n' +
    '          window.ytdlpStudio.modes.setOneThingAction(s.oneThingActionDraft || null).then(ms => this.setState({ modesState: ms, momentumNudgeDismissedAt: null })).catch(() => {});\n' +
    '        }\n' +
    '      },\n' +
    '      momentumNudgeVisible: !!(\n' +
    "        pref('adhdMomentum', false) && s.oneThingActionDraft &&\n" +
    '        s.modesState && (!s.modesState.momentumSnoozedUntil || s.modesState.momentumSnoozedUntil < Date.now()) &&\n' +
    "        (Date.now() - (s._oneThingSetAt || Date.now())) > 20 * 60 * 1000\n" +
    '      ),\n' +
    '      snoozeMomentum: () => {\n' +
    '        const until = Date.now() + 60 * 60 * 1000;\n' +
    '        if (window.ytdlpStudio && window.ytdlpStudio.modes) {\n' +
    '          window.ytdlpStudio.modes.setMomentumSnooze(until).then(ms => this.setState({ modesState: ms })).catch(() => {});\n' +
    '        } else {\n' +
    '          this.setState(st => ({ modesState: { ...(st.modesState || {}), momentumSnoozedUntil: until } }));\n' +
    '        }\n' +
    '      },\n' +
    "      dialogSchoolEnable: s.dialog === 'schoolEnable', dialogSchoolDisable: s.dialog === 'schoolDisable',\n" +
    "      schoolNameDraft: (s.schoolNameDraft !== undefined ? s.schoolNameDraft : ((s.modesState && s.modesState.school.name) || 'School mode')),\n" +
    "      setSchoolNameDraft: e => this.setState({ schoolNameDraft: e.target.value }),\n" +
    "      schoolPassword: s.schoolPassword || '', setSchoolPassword: e => this.setState({ schoolPassword: e.target.value }),\n" +
    "      schoolError: s.schoolError || '',\n" +
    "      schoolDisplayName: (s.modesState && s.modesState.school.name) || 'School mode',\n" +
    "      closeSchoolDialog: () => this.setState({ dialog: null, schoolPassword: '', schoolError: null }),\n" +
    '      confirmSchoolEnable: () => {\n' +
    '        if (!window.ytdlpStudio || !window.ytdlpStudio.modes) { this.toast(\'School mode\', \'Not connected to the app shell.\'); return; }\n' +
    '        window.ytdlpStudio.modes.schoolEnable(s.schoolPassword || \'\').then(res => {\n' +
    '          if (!res.ok) { this.setState({ schoolError: res.error }); return; }\n' +
    '          const name = (s.schoolNameDraft || \'\').trim();\n' +
    '          const applyRename = name && name !== res.state.school.name\n' +
    '            ? window.ytdlpStudio.modes.schoolRename(name)\n' +
    '            : Promise.resolve(res.state);\n' +
    '          applyRename.then(finalState => {\n' +
    "            this.setState(st => ({ modesState: finalState, prefs: { ...(st.prefs || {}), school: true }, dialog: null, schoolPassword: '', schoolError: null }));\n" +
    "            this.toast(finalState.school.name + ' is on', 'English only; Cantonese, bilingual, and funny levels are hidden until you turn it off.');\n" +
    '          });\n' +
    '        }).catch(err => this.setState({ schoolError: (err && err.message) ? err.message : String(err) }));\n' +
    '      },\n' +
    '      confirmSchoolDisable: () => {\n' +
    '        if (!window.ytdlpStudio || !window.ytdlpStudio.modes) { this.toast(\'School mode\', \'Not connected to the app shell.\'); return; }\n' +
    '        window.ytdlpStudio.modes.schoolDisable(s.schoolPassword || \'\').then(res => {\n' +
    '          if (!res.ok) { this.setState({ schoolError: res.error }); return; }\n' +
    "          this.setState(st => ({ modesState: res.state, prefs: { ...(st.prefs || {}), school: false }, dialog: null, schoolPassword: '', schoolError: null }));\n" +
    "          this.toast('School mode is off', 'Your prior language and funny-level choices are back.');\n" +
    '        }).catch(err => this.setState({ schoolError: (err && err.message) ? err.message : String(err) }));\n' +
    '      },\n'
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 11) Low-stimulation motion-off: composes with (never replaces) the
//     existing @media(prefers-reduced-motion:reduce) rule by adding a
//     second, always-applicable rule keyed off a data attribute the root
//     wrapper sets from the real ADHD-lowStim (or Reduced-motion) pref.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 12) The root wrapper carries the real `data-motion` attribute the CSS
//     rule above keys off, driven by ADHD Low-stimulation OR the existing
//     Reduced-motion pref (composing with, never overriding, either) — and
//     the matching `motionOffAttr` computed prop.
// ---------------------------------------------------------------------------

function wireRootMotionAttr(html, replaceExact) {
  const NEEDLE = '<div data-theme='

  const REPLACEMENT = '<div data-motion="{{ motionOffAttr }}" data-theme='

  const withAttr = replaceExact(html, NEEDLE, REPLACEMENT)

  const PROP_NEEDLE = "      focusChromeStyle: pref('adhdFocus', false) ? 'opacity:.45;filter:grayscale(.6);transition:opacity .15s' : '',\n"
  const PROP_REPLACEMENT =
    PROP_NEEDLE +
    "      motionOffAttr: (pref('adhdLowStim', false) || pref('reducedMotion', false)) ? 'off' : 'on',\n"
  return replaceExact(withAttr, PROP_NEEDLE, PROP_REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 13) School mode's real gate on the language surface: while it is on, the
//     Narrator-language, English-funny-level, and Cantonese-funny-level
//     rows are OMITTED from settingRows entirely (not merely disabled —
//     the contract distinguishes the two), and the Language mode row's own
//     options collapse to English only.
// ---------------------------------------------------------------------------

function wireSettingRowsSchoolGate(html, replaceExact) {
  const NEEDLE = "      ].filter(r => this.match(r[1] + ' ' + r[2], s.settingsSearch)).map(r => {\n        const [key, label, help, type, options] = r;\n"
  const REPLACEMENT =
    "      ].filter(r => this.match(r[1] + ' ' + r[2], s.settingsSearch))\n" +
    "        .filter(r => !schoolActive || !['narratorLanguage', 'enFunny', 'yueFunny'].includes(r[0]))\n" +
    '        .map(r => {\n' +
    '        const [key, label, help, type, rawOptions] = r;\n' +
    "        const options = (key === 'mode' && schoolActive) ? ['English'] : rawOptions;\n"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 14) The Language mode row's own displayed/current value is forced to
//     English while School mode is on, matching the options collapse above
//     — a user who switched to Yue before School mode is not shown a value
//     that is not even in the (now English-only) options list.
// ---------------------------------------------------------------------------

function wireModeValueSchoolGate(html, replaceExact) {
  const NEEDLE = '        const val = store[key];\n'
  const REPLACEMENT = "        const val = (key === 'mode' && schoolActive) ? 'English' : store[key];\n"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

function wireMotionCss(html, replaceExact) {
  const NEEDLE = '  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}\n'
  const REPLACEMENT =
    NEEDLE + '  [data-motion="off"] *{animation:none!important;transition:none!important}\n'
  return replaceExact(html, NEEDLE, REPLACEMENT)
}
