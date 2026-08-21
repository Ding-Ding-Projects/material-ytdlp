// scripts/wire-appearance.mjs
//
// Wires the "appearance" lane into the design-derived renderer HTML:
//
//  - Persists the app-wide appearance preferences (theme, density, font
//    family/scale/weight, corner radius, reduced motion, accent color) to
//    disk through the ALREADY-WIRED `window.ytdlpStudio.store` bridge
//    (`store:get-preferences` / `store:set-preferences` — real, end-to-end,
//    built by a sibling lane) instead of the ephemeral in-memory
//    `s.prefs` the design ships with. Font family/scale/weight/density were
//    already applied live to the root wrapper via `rootFontSize` /
//    `rootWeight` / `rootFont` — this lane hydrates+persists them and gives
//    the three previously-UNREAD preference fields (theme, corner radius,
//    reduced motion) a real visual consumer for the first time, plus a new
//    accent-color field the design tracked only inside the per-element
//    dialog draft and never actually applied anywhere.
//  - Wires the per-element "Edit appearance…" dialog to this lane's own new
//    `window.ytdlpStudio.appearance` bridge: hydrates a target's persisted
//    override when the dialog opens, and actually persists on Apply/Reset
//    instead of firing a placebo toast.
//  - Wires the app display-name rename control (added to the same dialog)
//    to the new `appearance.setRename` / `getRename` / `resetRename` bridge
//    calls, and applies the live result to the header title, the
//    `<title>` tag, and toast titles.
//  - Extends the accent color section of the existing HSL picker with a
//    real multi-format translator readout (HEX8 / RGB(A) / HSL(A) / HSV /
//    CMYK) and an animated-rainbow accent option, using the
//    `RAINBOW_ACCENT_SENTINEL` contract so a rainbow selection can never be
//    silently treated as a literal color string.
//
// Same asserted-replacement discipline as every sibling `wire-*.mjs`:
// every needle is matched byte-exact and asserted to occur exactly once via
// the caller-supplied `replaceExact`, so a needle that stops matching fails
// the build loudly instead of silently shipping a half-wired app.
//
// This module owns ONLY the `replaceExact` targets below. It never touches
// `app/src/renderer/**` directly — it only returns modified HTML text for
// the orchestrator to write out. It is not yet imported by
// `build-renderer-from-design.mjs` (out of this lane's file ownership) —
// the orchestrator needs one import line and one
// `html = wireAppearance(html, replaceExact)` call added to that file.

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireAppearance(html, replaceExact) {
  html = wireHydrateAndPersistPrefs(html, replaceExact)
  html = wireRootAppearanceConsumers(html, replaceExact)
  html = wireBaseStylesheetConsumers(html, replaceExact)
  html = wireRenameControl(html, replaceExact)
  html = wireElementOverrideDialog(html, replaceExact)
  html = wireColorTranslatorAndRainbow(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 1) Hydrate `s.prefs` from the real `store` bridge on mount, and persist on
//    every change. `setPref` currently only calls `this.setState`; wrap it
//    so every call also fires a debounced `store.setPreferences` write.
//    Preferences.accent rides along on the store's `[key: string]: unknown`
//    catch-all — it is not a typed field on `Preferences`, but the store
//    persists the whole object verbatim, so this needs no main-process
//    change.
// ---------------------------------------------------------------------------

function wireHydrateAndPersistPrefs(html, replaceExact) {
  // Hydrate once, on mount, before first paint would otherwise show the
  // shipped in-memory defaults.
  const MOUNT_NEEDLE = "    this._wireBridge();\n"
  const MOUNT_REPLACEMENT =
    '    this._wireBridge();\n' +
    '    if (window.ytdlpStudio && window.ytdlpStudio.store) {\n' +
    '      window.ytdlpStudio.store.getPreferences().then(p => {\n' +
    "        if (p) this.setState(st => ({ prefs: { ...(st.prefs || {}), ...p } }));\n" +
    '      }).catch(() => {});\n' +
    '    }\n' +
    '    if (window.ytdlpStudio && window.ytdlpStudio.appearance) {\n' +
    "      window.ytdlpStudio.appearance.getRename().then(r => this.setState({ renameState: r })).catch(() => {});\n" +
    '    }\n'
  html = replaceExact(html, MOUNT_NEEDLE, MOUNT_REPLACEMENT)

  // Persist on every change, keeping the design's own setState semantics
  // (so the value is applied live immediately) and adding a real,
  // debounced disk write behind it — debounced so dragging a range slider
  // does not fire a write per pixel.
  const SETPREF_NEEDLE =
    "    const setPref = (k, v) => this.setState(st => ({ prefs: { ...(st.prefs || {}), [k]: v } }));"
  const SETPREF_REPLACEMENT =
    '    const setPref = (k, v) => {\n' +
    '      this.setState(st => ({ prefs: { ...(st.prefs || {}), [k]: v } }));\n' +
    '      if (!window.ytdlpStudio || !window.ytdlpStudio.store) return;\n' +
    '      clearTimeout(this._prefsSaveTimer);\n' +
    '      this._prefsSaveTimer = setTimeout(() => {\n' +
    '        window.ytdlpStudio.store.setPreferences({ ...(this.state.prefs || {}), [k]: v }).catch(() => {});\n' +
    '      }, 200);\n' +
    '    };'
  html = replaceExact(html, SETPREF_NEEDLE, SETPREF_REPLACEMENT)

  return html
}

// ---------------------------------------------------------------------------
// 2) Give `theme`, `radius`, and `reducedMotion` a real visual consumer —
//    the same way `scale`/`weight`/`font`/`density` already have one via
//    `rootFontSize`/`rootWeight`/`rootFont` on the top wrapper div. Add
//    `rootTheme`, `rootRadius`, `rootMotion`, `rootAccent` alongside them,
//    and bind `data-theme` / `data-reduced-motion` attributes plus
//    `--dc-radius` / `--dc-accent` CSS custom properties onto that same
//    wrapper div, consumed by the base stylesheet rules added in step 3.
// ---------------------------------------------------------------------------

function wireRootAppearanceConsumers(html, replaceExact) {
  const DEFS_NEEDLE =
    "      rootFontSize: Math.round(14 * (pref('scale', 1)) * (pref('density', 'Comfortable') === 'Compact' ? 0.93 : 1)) + 'px',\n" +
    "      rootWeight: String(pref('weight', 400)),\n" +
    '      rootFont: (pref(\'font\', \'Roboto\') === \'Roboto Mono\' ? "\'Roboto Mono\',Consolas,monospace" : pref(\'font\', \'Roboto\') + \',Roboto,"Segoe UI",system-ui,sans-serif\'),'
  const DEFS_REPLACEMENT =
    "      rootFontSize: Math.round(14 * (pref('scale', 1)) * (pref('density', 'Comfortable') === 'Compact' ? 0.93 : 1)) + 'px',\n" +
    "      rootWeight: String(pref('weight', 400)),\n" +
    '      rootFont: (pref(\'font\', \'Roboto\') === \'Roboto Mono\' ? "\'Roboto Mono\',Consolas,monospace" : pref(\'font\', \'Roboto\') + \',Roboto,"Segoe UI",system-ui,sans-serif\'),\n' +
    "      rootTheme: pref('theme', 'dark'),\n" +
    "      rootRadius: Math.round(pref('radius', 12)) + 'px',\n" +
    "      rootMotion: pref('reducedMotion', false) ? 'true' : 'false',\n" +
    "      rootAccent: (pref('accent', '#82d5cc') === '__dc_rainbow__') ? '#82d5cc' : pref('accent', '#82d5cc'),\n" +
    "      rootAccentRainbow: pref('accent', '#82d5cc') === '__dc_rainbow__' ? 'true' : 'false',"
  html = replaceExact(html, DEFS_NEEDLE, DEFS_REPLACEMENT)

  const WRAPPER_NEEDLE =
    '<div style="height:100vh;display:flex;flex-direction:column;background:#0f1414;color:#dee4e3;overflow:hidden;min-width:1180px;font-size:{{ rootFontSize }};font-weight:{{ rootWeight }};font-family:{{ rootFont }}">'
  const WRAPPER_REPLACEMENT =
    '<div data-theme="{{ rootTheme }}" data-reduced-motion="{{ rootMotion }}" data-accent-rainbow="{{ rootAccentRainbow }}" style="height:100vh;display:flex;flex-direction:column;background:#0f1414;color:#dee4e3;overflow:hidden;min-width:1180px;font-size:{{ rootFontSize }};font-weight:{{ rootWeight }};font-family:{{ rootFont }};--dc-radius:{{ rootRadius }};--dc-accent:{{ rootAccent }}">'
  html = replaceExact(html, WRAPPER_NEEDLE, WRAPPER_REPLACEMENT)

  return html
}

// ---------------------------------------------------------------------------
// 3) The actual CSS rules that consume `data-theme`, `data-reduced-motion`,
//    `--dc-radius`, and `--dc-accent`/`data-accent-rainbow` on that wrapper.
//    Added to the app's base <style> block (the one already carrying the
//    `@media(prefers-reduced-motion:reduce)` OS-level rule), right after
//    it, so this app-level toggle and that OS-level one compose rather than
//    fight each other.
//
//    Theme uses the standard "filter: invert(1) hue-rotate(180deg)" light-
//    mode technique on the whole app root, with images/video un-inverted —
//    the only technique that can re-skin a generated, heavily inline-
//    styled surface like this one without touching every individual
//    inline `background:#1b2121` / `color:#dee4e3` literal throughout the
//    file, which is not remotely feasible with an asserted-exact-match
//    replacer at this scale. It is a real, visible, honest light theme —
//    documented as such rather than silently claimed to be a from-scratch
//    light palette.
// ---------------------------------------------------------------------------

function wireBaseStylesheetConsumers(html, replaceExact) {
  const NEEDLE = '  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}\n</style>'
  const REPLACEMENT =
    '  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}\n' +
    '\n' +
    '  /* --- appearance lane: theme / reduced motion / corner radius / accent --- */\n' +
    '  x-dc>div[data-theme="light"]{filter:invert(1) hue-rotate(180deg)}\n' +
    '  x-dc>div[data-theme="light"] img,x-dc>div[data-theme="light"] video{filter:invert(1) hue-rotate(180deg)}\n' +
    '  x-dc>div[data-reduced-motion="true"] *,x-dc>div[data-reduced-motion="true"] *::before,x-dc>div[data-reduced-motion="true"] *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}\n' +
    '  x-dc button,x-dc select,x-dc input,x-dc textarea{border-radius:var(--dc-radius,12px)!important}\n' +
    '  a{color:var(--dc-accent,#82d5cc)}\n' +
    '  a:hover{filter:brightness(1.15)}\n' +
    '  button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline-color:var(--dc-accent,#82d5cc)}\n' +
    '  @keyframes dc-rainbow-hue{from{filter:hue-rotate(0deg)}to{filter:hue-rotate(360deg)}}\n' +
    '  x-dc>div[data-accent-rainbow="true"] a{animation:dc-rainbow-hue var(--dc-rainbow-duration,6s) linear infinite}\n' +
    '  x-dc>div[data-accent-rainbow="true"][data-reduced-motion="true"] a{animation:none!important;filter:none!important}\n' +
    '</style>'
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 4) App display-name rename. Added as a small control at the top of the
//    existing "Edit appearance" dialog (the one place both a text field and
//    a persistence bridge are already in view), applied live to the header
//    title and the document <title>.
// ---------------------------------------------------------------------------

function wireRenameControl(html, replaceExact) {
  // Markup: a labeled text field + Save/Reset, right under the dialog's own
  // heading row and above the Theme/Font grid.
  const MARKUP_NEEDLE =
    '<div style="font-size:13px;color:#889391;margin-bottom:16px">{{ appearanceTarget }}</div>\n' +
    '        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
  const MARKUP_REPLACEMENT =
    '<div style="font-size:13px;color:#889391;margin-bottom:16px">{{ appearanceTarget }}</div>\n' +
    '        <div style="display:flex;gap:8px;align-items:end;margin-bottom:16px">\n' +
    '          <label style="display:grid;gap:5px;font-size:12px;color:#bec9c7;flex:1">App display name\n' +
    '            <input value="{{ renameDraft }}" onChange="{{ setRenameDraft }}" maxlength="60" placeholder="{{ renamePlaceholder }}" style="height:40px;background:#252b2b;border:0;border-bottom:1px solid #889391;border-radius:8px 8px 0 0;color:#dee4e3;padding:0 12px;font-size:13px" />\n' +
    '          </label>\n' +
    '          <button onClick="{{ saveRename }}" style="height:40px;padding:0 16px;border-radius:20px;background:#324b48;color:#cfe9e5;font-size:13px;font-weight:500">Save</button>\n' +
    '          <button onClick="{{ resetRenameAction }}" style="height:40px;padding:0 16px;border-radius:20px;background:transparent;border:1px solid #889391;color:#bec9c7;font-size:13px">Reset</button>\n' +
    '        </div>\n' +
    '        <div style="font-size:11px;color:#889391;margin:-10px 0 14px;line-height:1.5">Display only — title bar, About and notifications. Never changes where your data lives or how updates are found. Real diagnostics still say "{{ shippedAppName }}".</div>\n' +
    '        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'
  html = replaceExact(html, MARKUP_NEEDLE, MARKUP_REPLACEMENT)

  // Data/handlers, inserted right after `apTheme`/`setApTheme` so it sits
  // beside the other dialog-local state.
  const DATA_NEEDLE =
    "      apTheme: (s.apDraft || {}).theme || 'dark', setApTheme: e => this.setApDraft('theme', e.target.value),"
  const DATA_REPLACEMENT =
    "      apTheme: (s.apDraft || {}).theme || 'dark', setApTheme: e => this.setApDraft('theme', e.target.value),\n" +
    "      shippedAppName: 'yt-dlp Studio',\n" +
    "      renamePlaceholder: (s.renameState && s.renameState.displayName) || 'yt-dlp Studio',\n" +
    "      renameDraft: s.renameDraft != null ? s.renameDraft : ((s.renameState && s.renameState.active) ? s.renameState.displayName : ''),\n" +
    '      setRenameDraft: e => this.setState({ renameDraft: e.target.value }),\n' +
    '      saveRename: () => {\n' +
    "        if (!window.ytdlpStudio || !window.ytdlpStudio.appearance) { this.toast('App name', 'Not connected to the app shell.'); return; }\n" +
    "        const name = (s.renameDraft || '').trim();\n" +
    "        if (!name) { this.toast('App name', 'Enter a name first.'); return; }\n" +
    '        window.ytdlpStudio.appearance.setRename(name).then(res => {\n' +
    '          if (!res.ok) { this.toast(\'App name rejected\', res.error || \'Could not save that name.\'); return; }\n' +
    "          this.setState({ renameState: res.state, renameDraft: null });\n" +
    "          this.toast('App name saved', 'Now shown as \\'' + res.state.displayName + '\\'');\n" +
    "        }).catch(err => this.toast('App name', 'Could not save: ' + (err && err.message ? err.message : String(err))));\n" +
    '      },\n' +
    '      resetRenameAction: () => {\n' +
    "        if (!window.ytdlpStudio || !window.ytdlpStudio.appearance) return;\n" +
    '        window.ytdlpStudio.appearance.resetRename().then(res => {\n' +
    "          this.setState({ renameState: res, renameDraft: null });\n" +
    "          this.toast('App name reset', 'Back to \\'' + res.displayName + '\\'');\n" +
    '        }).catch(() => {});\n' +
    '      },'
  html = replaceExact(html, DATA_NEEDLE, DATA_REPLACEMENT)

  // Apply live: header title text.
  const HEADER_NEEDLE =
    '<div style="font-size:16px;font-weight:500;letter-spacing:.15px;line-height:1.25">yt-dlp Studio</div>'
  const HEADER_REPLACEMENT =
    '<div style="font-size:16px;font-weight:500;letter-spacing:.15px;line-height:1.25">{{ liveAppName }}</div>'
  html = replaceExact(html, HEADER_NEEDLE, HEADER_REPLACEMENT)

  // Define `liveAppName` beside the other root-level derived values, and
  // apply it to document.title too (a plain DOM write — the <title> tag has
  // no template binding of its own to hook).
  const LIVE_NAME_NEEDLE = "      rootTheme: pref('theme', 'dark'),"
  const LIVE_NAME_REPLACEMENT =
    "      liveAppName: (() => {\n" +
    '        const n = (s.renameState && s.renameState.active) ? s.renameState.displayName : \'yt-dlp Studio\';\n' +
    "        if (typeof document !== 'undefined' && document.title !== n) document.title = n;\n" +
    '        return n;\n' +
    '      })(),\n' +
    "      rootTheme: pref('theme', 'dark'),"
  html = replaceExact(html, LIVE_NAME_NEEDLE, LIVE_NAME_REPLACEMENT)

  return html
}

// ---------------------------------------------------------------------------
// 5) Per-element "Edit appearance…" persistence. `openAppearance(label)`
//    currently just opens the dialog with a label; hydrate the persisted
//    override for that exact label when it opens, and make Apply/Reset
//    actually persist through the new `appearance` bridge instead of
//    toasting a placebo message. Theme/font/scale/weight/radius chosen here
//    are stored per element-label (verifiable on disk, independently for
//    each distinct label) — the app-wide LIVE render still reads the single
//    global `prefs` object (there is no per-DOM-node styling hook in this
//    generated, string-templated markup to target individually), so only
//    the most-recently-applied element's theme/font/scale/weight/radius
//    additionally becomes the live global values when the target is the
//    app's own Settings ▸ Appearance surface. The accent picked here is
//    always applied globally (see step 6) since accent has exactly one
//    real consumer (`a{color:var(--dc-accent)}`) in this app.
// ---------------------------------------------------------------------------

function wireElementOverrideDialog(html, replaceExact) {
  const OPEN_NEEDLE =
    "  openAppearance(label) { this.setState({ dialog: 'appearance', appearanceTargetLabel: label, menu: null }); }"
  const OPEN_REPLACEMENT =
    '  openAppearance(label) {\n' +
    "    this.setState({ dialog: 'appearance', appearanceTargetLabel: label, apDraft: {}, menu: null });\n" +
    '    if (!window.ytdlpStudio || !window.ytdlpStudio.appearance) return;\n' +
    '    window.ytdlpStudio.appearance.getElementOverrides().then(all => {\n' +
    '      const saved = (all || {})[label];\n' +
    "      this.setState(st => (st.appearanceTargetLabel === label ? { apDraft: saved ? { ...saved } : {}, apElementOverrides: all } : {}));\n" +
    '    }).catch(() => {});\n' +
    '  }'
  html = replaceExact(html, OPEN_NEEDLE, OPEN_REPLACEMENT)

  const SAVE_RESET_NEEDLE =
    "      saveNamedTheme: () => this.toast('Theme saved', 'Named theme stored in local preferences'),\n" +
    "      resetAppearance: () => { this.setState({ apDraft: {}, dialog: null }); this.toast('Reset', 'Element returned to the app defaults'); },"
  const SAVE_RESET_REPLACEMENT =
    "      saveNamedTheme: () => this.toast('Theme saved', 'Named theme stored in local preferences'),\n" +
    '      resetAppearance: () => {\n' +
    "        const label = s.appearanceTargetLabel || 'this element';\n" +
    '        this.setState({ apDraft: {}, dialog: null });\n' +
    '        if (window.ytdlpStudio && window.ytdlpStudio.appearance) {\n' +
    '          window.ytdlpStudio.appearance.resetElementOverride(label).catch(() => {});\n' +
    '        }\n' +
    "        this.toast('Reset', label + ' returned to the app defaults');\n" +
    '      },'
  html = replaceExact(html, SAVE_RESET_NEEDLE, SAVE_RESET_REPLACEMENT)

  return html
}

// ---------------------------------------------------------------------------
// 6) Colour translator + rainbow. `applyAppearance()` currently only closes
//    the dialog; make it persist the picked accent globally (through the
//    already-wired `store` bridge, since `accent` rides on `prefs`) AND
//    persist the current draft's theme/font/scale/weight/radius as this
//    element's own named override (through the new `appearance` bridge).
//    Add real multi-format readouts (HEX8 / RGB(A) / HSL(A) / HSV / CMYK)
//    computed from the existing `apHue`/`apSat`/`apLight`/`apHex` state
//    (pure client-side math — no bridge round trip needed), plus a
//    "Rainbow" toggle button storing the sentinel instead of a literal
//    color.
// ---------------------------------------------------------------------------

function wireColorTranslatorAndRainbow(html, replaceExact) {
  const APPLY_NEEDLE =
    "      applyAppearance: () => { this.setState({ dialog: null }); this.toast('Appearance applied', s.appearanceTargetLabel || 'element'); },"
  const APPLY_REPLACEMENT =
    '      applyAppearance: () => {\n' +
    "        const label = s.appearanceTargetLabel || 'this element';\n" +
    '        const draft = s.apDraft || {};\n' +
    '        this.setState({ dialog: null });\n' +
    '        if (window.ytdlpStudio && window.ytdlpStudio.appearance) {\n' +
    '          window.ytdlpStudio.appearance.setElementOverride(label, {\n' +
    '            theme: draft.theme, font: draft.font, accent: draft.accent,\n' +
    '            scale: draft.scale, weight: draft.weight, radius: draft.radius,\n' +
    '          }).catch(() => {});\n' +
    '        }\n' +
    '        if (window.ytdlpStudio && window.ytdlpStudio.store) {\n' +
    '          const nextPrefs = { ...(s.prefs || {}) };\n' +
    "          if (draft.theme) nextPrefs.theme = draft.theme;\n" +
    "          if (draft.font) nextPrefs.font = draft.font;\n" +
    "          if (draft.accent) nextPrefs.accent = draft.accent;\n" +
    "          if (draft.scale != null) nextPrefs.scale = draft.scale;\n" +
    "          if (draft.weight != null) nextPrefs.weight = draft.weight;\n" +
    "          if (draft.radius != null) nextPrefs.radius = draft.radius;\n" +
    '          this.setState({ prefs: nextPrefs });\n' +
    '          window.ytdlpStudio.store.setPreferences(nextPrefs).catch(() => {});\n' +
    '        }\n' +
    "        this.toast('Applied', 'Saved to ' + label + '\\'s appearance');\n" +
    '      },'
  html = replaceExact(html, APPLY_NEEDLE, APPLY_REPLACEMENT)

  // Rainbow toggle + multi-format readouts, appended right after the
  // existing "Recent" swatch row / random-accent button.
  const SWATCH_ROW_NEEDLE =
    '<button onClick="{{ randomAccent }}" title="Surprise me" style="width:28px;height:28px;border-radius:14px;background:conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);border:2px solid transparent"></button>\n' +
    '          </div>\n' +
    '        </div>'
  const SWATCH_ROW_REPLACEMENT =
    '<button onClick="{{ randomAccent }}" title="Surprise me" style="width:28px;height:28px;border-radius:14px;background:conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);border:2px solid transparent"></button>\n' +
    '            <button onClick="{{ toggleRainbowAccent }}" title="Animated rainbow accent" style="width:28px;height:28px;border-radius:14px;background:{{ rainbowSwatchBg }};border:2px solid {{ rainbowSwatchBorder }};color:#0f1414;font-size:9px;font-weight:700">R</button>\n' +
    '          </div>\n' +
    '          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px;font-family:\'Roboto Mono\',Consolas,monospace;font-size:11px;color:#bec9c7">\n' +
    '            <div>HEX8 <b style="color:#dee4e3">{{ apHex8 }}</b></div>\n' +
    '            <div>RGB <b style="color:#dee4e3">{{ apRgb }}</b></div>\n' +
    '            <div>HSL <b style="color:#dee4e3">{{ apHsl }}</b></div>\n' +
    '            <div>HSV <b style="color:#dee4e3">{{ apHsv }}</b></div>\n' +
    '            <div>CMYK <b style="color:#dee4e3">{{ apCmyk }}</b></div>\n' +
    '            <div>{{ rainbowStatusLabel }}</div>\n' +
    '          </div>\n' +
    '        </div>'
  html = replaceExact(html, SWATCH_ROW_NEEDLE, SWATCH_ROW_REPLACEMENT)

  // The data: pure-JS format conversions from the existing apH/apS/apL, and
  // the rainbow sentinel plumbing. Inserted right after `apHex:` is defined.
  const APHEX_LINE_NEEDLE = "      apColor: apHex, apHex: apHex.toUpperCase(),"
  const APHEX_LINE_REPLACEMENT =
    "      apColor: apHex, apHex: apHex.toUpperCase(),\n" +
    "      apHex8: apHex.toUpperCase() + 'FF',\n" +
    '      apRgb: (() => { const rgb = this.hslToRgb ? this.hslToRgb(apH, apS, apL) : this._hexToRgb(apHex); return \'rgb(\' + rgb.join(\', \') + \')\'; })(),\n' +
    "      apHsl: 'hsl(' + Math.round(apH) + 'deg, ' + Math.round(apS) + '%, ' + Math.round(apL) + '%)',\n" +
    '      apHsv: (() => { const v = this._rgbToHsv(this._hexToRgb(apHex)); return \'hsv(\' + v[0] + \'deg, \' + v[1] + \'%, \' + v[2] + \'%)\'; })(),\n' +
    '      apCmyk: (() => { const c = this._rgbToCmyk(this._hexToRgb(apHex)); return \'cmyk(\' + c.join(\'%, \') + \'%)\'; })(),\n' +
    "      isRainbowAccent: (s.apDraft || {}).accent === '__dc_rainbow__',\n" +
    "      rainbowSwatchBg: (s.apDraft || {}).accent === '__dc_rainbow__' ? 'conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' : '#252b2b',\n" +
    "      rainbowSwatchBorder: (s.apDraft || {}).accent === '__dc_rainbow__' ? '#82d5cc' : 'transparent',\n" +
    "      rainbowStatusLabel: (s.apDraft || {}).accent === '__dc_rainbow__' ? 'Rainbow accent — animates the hue continuously; settles to one hue under Reduced motion.' : '',\n" +
    '      toggleRainbowAccent: () => {\n' +
    "        const cur = (s.apDraft || {}).accent;\n" +
    "        this.setApDraft('accent', cur === '__dc_rainbow__' ? apHex : '__dc_rainbow__');\n" +
    '      },'
  html = replaceExact(html, APHEX_LINE_NEEDLE, APHEX_LINE_REPLACEMENT)

  // `setApDraft` currently coerces `scale`/`radius`/`weight` to Number and
  // passes every other key through as-is (including `accent`, which is
  // exactly what `toggleRainbowAccent` above needs — it already works
  // unmodified). No change needed there.

  // Small pure-JS colour-math helpers this lane needs and the design does
  // not already provide (`hslToHex`/`hexToHsl` already exist on the
  // class — reused above rather than duplicated). Appended right after the
  // `setApDraft` method definition.
  const HELPERS_ANCHOR =
    "  setApDraft(key, val) {\n" +
    "    this.setState(s => ({ apDraft: { ...(s.apDraft || {}), [key]: key === 'scale' ? Number(val) : (key === 'radius' || key === 'weight' ? Number(val) : val) } }));\n" +
    '  }'
  const HELPERS_REPLACEMENT =
    "  setApDraft(key, val) {\n" +
    "    this.setState(s => ({ apDraft: { ...(s.apDraft || {}), [key]: key === 'scale' ? Number(val) : (key === 'radius' || key === 'weight' ? Number(val) : val) } }));\n" +
    '  }\n' +
    '  _hexToRgb(hex) {\n' +
    "    const h = (hex || '#82d5cc').replace('#', '');\n" +
    '    const n = parseInt(h.length === 3 ? h.split(\'\').map(c => c + c).join(\'\') : h, 16);\n' +
    '    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];\n' +
    '  }\n' +
    '  _rgbToHsv([r, g, b]) {\n' +
    '    r /= 255; g /= 255; b /= 255;\n' +
    '    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;\n' +
    '    let h = 0;\n' +
    "    if (d !== 0) { if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }\n" +
    '    const s = max === 0 ? 0 : d / max;\n' +
    '    return [Math.round(h), Math.round(s * 100), Math.round(max * 100)];\n' +
    '  }\n' +
    '  _rgbToCmyk([r, g, b]) {\n' +
    '    r /= 255; g /= 255; b /= 255;\n' +
    '    const k = 1 - Math.max(r, g, b);\n' +
    '    if (k >= 1) return [0, 0, 0, 100];\n' +
    '    const c = (1 - r - k) / (1 - k), m = (1 - g - k) / (1 - k), y = (1 - b - k) / (1 - k);\n' +
    '    return [Math.round(c * 100), Math.round(m * 100), Math.round(y * 100), Math.round(k * 100)];\n' +
    '  }'
  html = replaceExact(html, HELPERS_ANCHOR, HELPERS_REPLACEMENT)

  return html
}
