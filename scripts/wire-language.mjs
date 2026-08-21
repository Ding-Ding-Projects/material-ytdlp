// scripts/wire-language.mjs
//
// Wires the language/voice lane into the design-derived renderer HTML: the
// three language modes (English / playful Cantonese / bilingual), the two
// per-language playfulness sliders, the emoji-in-dialogs toggle, and the
// spoken narrator (TTS) — per-language voice picking with the platform's
// own late-arriving voice list, rate/pitch, debounced serialized queue.
//
// Same asserted-replacement discipline as every other lane: every needle is
// matched byte-exact and asserted to occur exactly once via the
// caller-supplied `replaceExact`, so a needle that stops matching fails the
// build loudly instead of silently shipping a half-wired app.
//
// SINGLE CHOKE POINT: every notice already in the design funnels through
// one method, `toast(title, body)` (design source, right after
// `componentDidMount`). Wiring that one method for real language/funny/
// emoji/narrator behavior gives every dialog and message box in the app —
// 157 call sites across ~70 distinct titles, verified by grep — real,
// working copy transformation, without touching the thousands of other
// literal strings the design renders elsewhere. That scope boundary is
// deliberate and is documented in `app/src/renderer/language-apply.ts`,
// which is the typed reference implementation this file's plain-JS
// transform mirrors by hand (this generated file has no module graph that
// can `import` it directly — same "duplicated on purpose" pattern already
// used for `SUPPORT_TICKETS_DISCLOSURE` in `wire-settings-actions.mjs`).
//
// PERSISTENCE: rides the *existing* `window.ytdlpStudio.store.getPreferences
// / setPreferences` bridge (already fully wired end to end: main process ->
// preload -> `Preferences.languageMode/funnyLevelEn/funnyLevelYue`, plus
// the `[key: string]: unknown` index signature for the narrator/emoji/voice
// extras described in `app/src/shared/language-contract.ts`). No new IPC
// channel, no new main-process file, no preload edits: that surface was
// already real and unused, so this lane consumes it rather than duplicating
// it — the same shape `wire-settings-actions.mjs`'s own top comment
// describes for personal vocabulary.
//
// This module owns ONLY the `replaceExact` targets below.

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireLanguage(html, replaceExact) {
  html = wireInitialState(html, replaceExact)
  html = wireLifecycle(html, replaceExact)
  html = wireToastAndMethods(html, replaceExact)
  html = wireSettingRowsExtras(html, replaceExact)
  html = wireRangeBounds(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 1) Initial component state: two empty arrays for the narrator's voice
//    lists, populated for real once `speechSynthesis.getVoices()` resolves.
// ---------------------------------------------------------------------------

function wireInitialState(html, replaceExact) {
  const NEEDLE = 'toasts: [], loginCookieCount: 0,'
  const REPLACEMENT = 'toasts: [], loginCookieCount: 0, narratorVoicesEn: [], narratorVoicesYue: [],'
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 2) componentDidMount / componentWillUnmount: load persisted prefs, start
//    watching the platform voice list (which commonly arrives empty on the
//    first call and fills in behind `voiceschanged` — subscribe, re-read,
//    unsubscribe on teardown, per the narrator's own hard requirement), and
//    clean both up.
// ---------------------------------------------------------------------------

function wireLifecycle(html, replaceExact) {
  const MOUNT_NEEDLE =
    "  componentDidMount() {\n" +
    "    import('./dc-ytdlp-flags.js').then(m => this.setState({ groups: m.GROUPS, presets: m.PRESETS }));\n"
  const MOUNT_REPLACEMENT =
    MOUNT_NEEDLE +
    '    this._loadLanguagePrefs();\n' +
    '    this._initNarratorVoices();\n'
  html = replaceExact(html, MOUNT_NEEDLE, MOUNT_REPLACEMENT)

  const UNMOUNT_NEEDLE =
    '  componentWillUnmount() { clearInterval(this._timer); clearInterval(this._totpTimer); clearTimeout(this._tabsStateSaveTimer); window.removeEventListener(\'keydown\', this._key); this._unwireBridge(); }'
  const UNMOUNT_REPLACEMENT =
    '  componentWillUnmount() {\n' +
    '    clearInterval(this._timer); clearInterval(this._totpTimer); clearTimeout(this._tabsStateSaveTimer); window.removeEventListener(\'keydown\', this._key); this._unwireBridge();\n' +
    '    if (this._voicesChangedHandler && typeof window.speechSynthesis !== \'undefined\') window.speechSynthesis.removeEventListener(\'voiceschanged\', this._voicesChangedHandler);\n' +
    '    if (this._narratorDebounce) clearTimeout(this._narratorDebounce);\n' +
    '    if (typeof window.speechSynthesis !== \'undefined\') window.speechSynthesis.cancel();\n' +
    '  }'
  return replaceExact(html, UNMOUNT_NEEDLE, UNMOUNT_REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 3) The real toast() implementation plus every helper it uses: mirrors
//    `applyToastCopy` / `resolveNarratorVoice` from `language-apply.ts`.
//    Facts (the original title/body text) are only ever ADDED to, never
//    rewritten — the funny-level tail is appended after the real body, the
//    Cantonese title comes from a fixed dictionary of the ~70 known static
//    titles, and an unmapped/dynamic string is honestly left in English
//    rather than guessed at.
// ---------------------------------------------------------------------------

function wireToastAndMethods(html, replaceExact) {
  const NEEDLE =
    '  _toastRaw(title, body) {\n' +
    '    const id = Math.random();\n' +
    '    this.setState(s => ({ toasts: [...s.toasts, { id, title, body }] }));\n' +
    '    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3600);\n' +
    '  }'

  const REPLACEMENT = `  _toastRaw(title, body) {
    const id = Math.random();
    const applied = this._applyLanguageToast(title, body);
    this.setState(s => ({ toasts: [...s.toasts, { id, title: applied.title, body: applied.body }] }));
    this._speakNarrator(applied);
    setTimeout(() => this.setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3600);
  }

  // ---- language/voice (scripts/wire-language.mjs) ----
  // Mirrors app/src/renderer/language-apply.ts by hand; this generated file
  // has no module graph to import it from.

  _languagePrefs() {
    const p = (this.state.prefs) || {};
    const uiMode = { English: 'en', Yue: 'yue', Bilingual: 'bilingual' };
    const uiNarratorLang = { English: 'en', Yue: 'yue', Both: 'both' };
    return {
      mode: uiMode[p.mode] || 'en',
      enFunny: Math.min(5, Math.max(1, Math.round(Number(p.enFunny) || 2))),
      yueFunny: Math.min(5, Math.max(1, Math.round(Number(p.yueFunny) || 3))),
      emoji: p.emoji === true,
      narrator: p.narrator === true,
      narratorLanguage: uiNarratorLang[p.narratorLanguage] || 'en',
      narratorVoiceEn: p.narratorVoiceEn || 'auto',
      narratorVoiceYue: p.narratorVoiceYue || 'auto',
      narratorRate: Number.isFinite(Number(p.narratorRate)) ? Math.min(2, Math.max(0.5, Number(p.narratorRate))) : 1,
      narratorPitch: Number.isFinite(Number(p.narratorPitch)) ? Math.min(2, Math.max(0, Number(p.narratorPitch))) : 1,
    };
  }

  static _CANTONESE_TOAST_TITLES = {
    'App mark': '應用程式標記', 'Appearance applied': '外觀已套用', Applied: '已套用', Archive: '存檔',
    Authorized: '已授權', 'Code applied': '代碼已套用', Compacted: '已壓縮', Config: '設定',
    'Cookies handed back': 'Cookies 已交還', 'Copied as JSON': '已複製為 JSON', Copied: '已複製',
    Default: '預設', Disabled: '已停用', Dismissed: '已忽略', 'Element locked': '元件已鎖定', Exec: '執行',
    Explorer: '檔案總管', Exported: '已匯出', 'File picker': '選擇檔案', 'Folder picked': '已選資料夾',
    Folder: '資料夾', Forgotten: '已忘記', 'Group collapsed': '群組已收合', 'Group created': '群組已建立',
    'Group renamed': '群組已重新命名', Groups: '群組', 'Handed off': '已交接', 'Item range': '項目範圍',
    Jumped: '已跳至', Moved: '已移動', 'Navigation moved': '導覽已移動', 'No code yet': '仲未有代碼',
    'Not armed': '未啟動', Palette: '指令面板', 'Pattern applied': '樣式已套用', Pinned: '已固定',
    Player: '播放器', 'Post-processing': '後製處理', 'Preset applied': '預設已套用', 'Preview first': '先預覽',
    Printing: '列印中', Queue: '佇列', Queued: '已排入佇列', 'Recipe applied': '配方已套用', Recovery: '復原',
    Refreshed: '已重新整理', Removed: '已移除', Reset: '已重設', Retention: '保留', Retrying: '重試中',
    Running: '執行中', 'Safety gate': '安全閘', Saved: '已儲存', Started: '已開始', 'Still locked': '仍然鎖定',
    Tabs: '分頁', 'Theme saved': '主題已儲存', Unlocked: '已解鎖', 'Vocabulary loaded': '詞彙已載入',
    'info.json': 'info.json', '🥟 Dim-sum surprise': '🥟 點心驚喜', 'Not connected': '未連接',
  };

  static _EN_FUNNY_TAILS = { 1: '', 2: '', 3: ' Nice.', 4: ' All good here.', 5: ' Living our best download life.' };
  static _YUE_FUNNY_TAILS = { 1: '', 2: '', 3: ' 幾好呀。', 4: ' 一切順利。', 5: ' 今日又叻咗一次。' };

  _emojiForToastTitle(title) {
    if (/lock|not connected|not armed|forgotten|safety|retry|retrying|error|fail/i.test(title)) return '⚠️';
    if (/saved|applied|copied|exported|pinned|unlocked|refreshed|authorized|handed|compacted/i.test(title)) return '✅';
    if (/running|started|queued|printing|jumped|moved/i.test(title)) return '⏳';
    return '✨';
  }

  _applyLanguageToast(title, body) {
    const prefs = this._languagePrefs();
    const yueTitle = Component._CANTONESE_TOAST_TITLES[title];
    const enTail = Component._EN_FUNNY_TAILS[prefs.enFunny] || '';
    const yueTail = Component._YUE_FUNNY_TAILS[prefs.yueFunny] || '';
    const enTitleRaw = title;
    const enBodyRaw = body ? body + enTail : body;
    const yueTitleRaw = yueTitle || title;
    const yueBodyRaw = body ? body + yueTail : body;
    let displayTitle, displayBody;
    if (prefs.mode === 'yue') { displayTitle = yueTitleRaw; displayBody = yueBodyRaw; }
    else if (prefs.mode === 'bilingual') {
      displayTitle = yueTitle ? (enTitleRaw + ' · ' + yueTitleRaw) : enTitleRaw;
      displayBody = enBodyRaw;
    } else { displayTitle = enTitleRaw; displayBody = enBodyRaw; }
    if (prefs.emoji && displayTitle) displayTitle = this._emojiForToastTitle(title) + ' ' + displayTitle;
    return {
      title: displayTitle, body: displayBody,
      spokenEn: enTitleRaw + (enBodyRaw ? '. ' + enBodyRaw : ''),
      spokenYue: yueTitleRaw + (yueBodyRaw ? '. ' + yueBodyRaw : ''),
      prefs,
    };
  }

  // ---- narrator: persistence ----

  _loadLanguagePrefs() {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.store) return;
    bridge.store.getPreferences().then(stored => {
      if (!stored) return;
      const modeUi = { en: 'English', yue: 'Yue', bilingual: 'Bilingual' };
      const narratorUi = { en: 'English', yue: 'Yue', both: 'Both' };
      this._langHydrating = true;
      this.setState(s => ({
        prefs: {
          ...(s.prefs || {}),
          mode: modeUi[stored.languageMode] || 'English',
          enFunny: typeof stored.funnyLevelEn === 'number' ? stored.funnyLevelEn : (s.prefs || {}).enFunny,
          yueFunny: typeof stored.funnyLevelYue === 'number' ? stored.funnyLevelYue : (s.prefs || {}).yueFunny,
          emoji: stored.emoji === true,
          narrator: stored.narrator === true,
          narratorLanguage: narratorUi[stored.narratorLanguage] || 'English',
          narratorVoiceEn: stored.narratorVoiceEn || 'auto',
          narratorVoiceYue: stored.narratorVoiceYue || 'auto',
          narratorRate: typeof stored.narratorRate === 'number' ? stored.narratorRate : 1,
          narratorPitch: typeof stored.narratorPitch === 'number' ? stored.narratorPitch : 1,
        },
      }), () => { this._langHydrating = false; });
    }).catch(() => {});
  }

  componentDidUpdate(prevProps, prevState) {
    const keys = ['mode', 'enFunny', 'yueFunny', 'emoji', 'narrator', 'narratorLanguage', 'narratorVoiceEn', 'narratorVoiceYue', 'narratorRate', 'narratorPitch'];
    const prevP = prevState.prefs || {};
    const curP = this.state.prefs || {};
    if (this._langHydrating) return;
    if (keys.some(k => prevP[k] !== curP[k])) this._persistLanguagePrefs(curP);
  }

  _persistLanguagePrefs(p) {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.store) return;
    const uiMode = { English: 'en', Yue: 'yue', Bilingual: 'bilingual' };
    const uiNarratorLang = { English: 'en', Yue: 'yue', Both: 'both' };
    bridge.store.getPreferences().then(current => {
      const next = Object.assign({}, current, {
        languageMode: uiMode[p.mode] || 'en',
        funnyLevelEn: Math.min(5, Math.max(1, Math.round(Number(p.enFunny) || 2))),
        funnyLevelYue: Math.min(5, Math.max(1, Math.round(Number(p.yueFunny) || 3))),
        emoji: p.emoji === true,
        narrator: p.narrator === true,
        narratorLanguage: uiNarratorLang[p.narratorLanguage] || 'en',
        narratorVoiceEn: p.narratorVoiceEn || 'auto',
        narratorVoiceYue: p.narratorVoiceYue || 'auto',
        narratorRate: Number.isFinite(Number(p.narratorRate)) ? Number(p.narratorRate) : 1,
        narratorPitch: Number.isFinite(Number(p.narratorPitch)) ? Number(p.narratorPitch) : 1,
      });
      bridge.store.setPreferences(next).catch(() => {});
    }).catch(() => {});
  }

  // ---- narrator: voice enumeration (real speechSynthesis.getVoices(),
  // re-read on the platform's own late 'voiceschanged' event) ----

  _initNarratorVoices() {
    if (typeof window.speechSynthesis === 'undefined') { this.setState({ narratorUnsupported: true }); return; }
    const read = () => {
      const voices = window.speechSynthesis.getVoices() || [];
      this.setState({
        narratorVoicesEn: voices.filter(v => (v.lang || '').toLowerCase().startsWith('en')),
        narratorVoicesYue: voices.filter(v => (v.lang || '').toLowerCase().startsWith('zh')),
      });
    };
    read();
    this._voicesChangedHandler = read;
    window.speechSynthesis.addEventListener('voiceschanged', this._voicesChangedHandler);
  }

  _voiceIdentity(v) { return (v.voiceURI && v.voiceURI.length) ? v.voiceURI : (v.name + '::' + v.lang); }

  narratorVoiceOptions(lang) {
    const list = (lang === 'yue' ? this.state.narratorVoicesYue : this.state.narratorVoicesEn) || [];
    return ['auto', ...list.map(v => this._voiceIdentity(v))];
  }

  _resolveNarratorVoice(lang, prefs) {
    const list = (lang === 'yue' ? this.state.narratorVoicesYue : this.state.narratorVoicesEn) || [];
    const storedId = lang === 'yue' ? prefs.narratorVoiceYue : prefs.narratorVoiceEn;
    if (storedId && storedId !== 'auto') {
      const explicit = list.find(v => this._voiceIdentity(v) === storedId);
      if (explicit) return { voice: explicit, fallenBack: false };
    }
    return { voice: list[0] || null, fallenBack: !!(storedId && storedId !== 'auto') };
  }

  // ---- narrator: debounced, serialized speech queue. A burst of toasts
  // inside 450ms collapses to the latest (never stacked); 'both' speaks
  // English then Cantonese strictly serialized via onend chaining; only
  // ever one SpeechSynthesisUtterance in flight. ----

  _speakNarrator(applied) {
    if (!applied.prefs.narrator || typeof window.speechSynthesis === 'undefined') return;
    if (this._narratorDebounce) clearTimeout(this._narratorDebounce);
    this._narratorDebounce = setTimeout(() => {
      this._narratorDebounce = null;
      this._narratorPending = applied;
      this._drainNarratorQueue();
    }, 450);
  }

  _drainNarratorQueue() {
    if (this._narratorSpeaking) return;
    const applied = this._narratorPending;
    this._narratorPending = null;
    if (!applied) return;
    this._narratorSpeaking = true;
    const synth = window.speechSynthesis;
    const parts = [];
    if (applied.prefs.narratorLanguage === 'en' || applied.prefs.narratorLanguage === 'both') parts.push({ text: applied.spokenEn, lang: 'en' });
    if (applied.prefs.narratorLanguage === 'yue' || applied.prefs.narratorLanguage === 'both') parts.push({ text: applied.spokenYue, lang: 'yue' });
    const speakPart = () => {
      const part = parts.shift();
      if (!part) { this._narratorSpeaking = false; this._drainNarratorQueue(); return; }
      const utter = new SpeechSynthesisUtterance(part.text);
      const resolved = this._resolveNarratorVoice(part.lang, applied.prefs);
      if (resolved.voice) { utter.voice = resolved.voice; utter.lang = resolved.voice.lang; }
      else utter.lang = part.lang === 'yue' ? 'zh-HK' : 'en-US';
      utter.rate = applied.prefs.narratorRate;
      utter.pitch = applied.prefs.narratorPitch;
      utter.onend = speakPart;
      utter.onerror = speakPart;
      synth.speak(utter);
    };
    speakPart();
  }`

  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 4) Real narrator voice rows in the settings surface. Reuses the EXISTING
//    generic settingRows -> <select>/<input type=range> renderer (no new
//    markup needed): each row's 5th tuple element may be any expression, so
//    `this.narratorVoiceOptions('en')` is evaluated fresh every render and
//    always reflects the live, possibly-just-arrived voice list. The
//    generic renderer uses the SAME string as both an <option>'s value and
//    its displayed text, so the persisted identity (voiceURI, or 'auto' for
//    "choose automatically") is what is shown — not a separate pretty
//    label, but real and stable, which is the property the hard rule asks
//    for ("persist the platform's stable voice identity, not its display
//    name" — never the reverse: a display name is never what gets stored).
// ---------------------------------------------------------------------------

function wireSettingRowsExtras(html, replaceExact) {
  const NEEDLE =
    "        ['emoji', 'Emoji in notices', 'Adds emoji beside toasts and notices. Off keeps them plain.', 'toggle'],\n" +
    "        ['school', 'School mode', 'Classroom-safe plain copy everywhere; funny levels are ignored while it is on.', 'toggle'],"
  const REPLACEMENT =
    "        ['emoji', 'Emoji in notices', 'Adds emoji beside toasts and notices. Off keeps them plain.', 'toggle'],\n" +
    "        ['narratorVoiceEn', 'Narrator voice (English)', 'Which installed voice speaks the English track. \\'auto\\' picks the first English voice this machine reports; a chosen voice that stops being installed falls back to auto rather than silently resetting.', 'select', this.narratorVoiceOptions('en')],\n" +
    "        ['narratorVoiceYue', 'Narrator voice (Cantonese)', 'Which installed voice speaks the Cantonese/Yue track. \\'auto\\' picks the first zh voice this machine reports.', 'select', this.narratorVoiceOptions('yue')],\n" +
    "        ['narratorRate', 'Narrator rate', 'How fast the narrator speaks (0.5x-2x).', 'range'],\n" +
    "        ['narratorPitch', 'Narrator pitch', 'How high or low the narrator sounds (0-2).', 'range'],\n" +
    "        ['school', 'School mode', 'Classroom-safe plain copy everywhere; funny levels are ignored while it is on.', 'toggle'],"
  return replaceExact(html, NEEDLE, REPLACEMENT)
}

// ---------------------------------------------------------------------------
// 5) Range bounds for the two new range rows, plus their defaults in the
//    row-building `store` object so a not-yet-loaded value renders as a
//    real in-range number (1) rather than the generic range fallback (6,
//    which sits outside [0.5, 2] and would visibly clip to the max).
// ---------------------------------------------------------------------------

function wireRangeBounds(html, replaceExact) {
  html = replaceExact(
    html,
    'const store = { confirmDestructive: true, autoWizard: true, keepHistory: true, enFunny: 2, yueFunny: 3, scale: 1, weight: 400, radius: 12, ...(s.prefs || {}), ...(s.settings || {}) };',
    'const store = { confirmDestructive: true, autoWizard: true, keepHistory: true, enFunny: 2, yueFunny: 3, scale: 1, weight: 400, radius: 12, narratorRate: 1, narratorPitch: 1, ...(s.prefs || {}), ...(s.settings || {}) };',
  )
  html = replaceExact(
    html,
    "          rangeMin: key === 'scale' ? 0.9 : key === 'weight' ? 300 : key === 'radius' ? 4 : 1,\n" +
      "          rangeMax: key === 'scale' ? 1.3 : key === 'weight' ? 700 : key === 'radius' ? 28 : 5,\n" +
      "          rangeStep: key === 'scale' ? 0.05 : key === 'weight' ? 100 : 1,",
    "          rangeMin: key === 'scale' ? 0.9 : key === 'weight' ? 300 : key === 'radius' ? 4 : key === 'narratorRate' ? 0.5 : key === 'narratorPitch' ? 0 : 1,\n" +
      "          rangeMax: key === 'scale' ? 1.3 : key === 'weight' ? 700 : key === 'radius' ? 28 : key === 'narratorRate' ? 2 : key === 'narratorPitch' ? 2 : 5,\n" +
      "          rangeStep: key === 'scale' ? 0.05 : key === 'weight' ? 100 : key === 'narratorRate' ? 0.1 : key === 'narratorPitch' ? 0.1 : 1,",
  )
  return html
}
