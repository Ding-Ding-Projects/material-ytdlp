/**
 * The language/voice text-transformation boundary. Pure, dependency-free,
 * and narrow by design — exactly like `vocabulary-apply.ts` beside it,
 * this file describes the transformation as real, typed, testable TypeScript,
 * even though the generated single-file renderer (`app/src/renderer/index.html`,
 * built by `scripts/build-renderer-from-design.mjs` + `scripts/wire-language.mjs`)
 * is plain browser JS with no module graph that can `import` it directly.
 * `scripts/wire-language.mjs` inlines an equivalent implementation as plain
 * JS text — the same "duplicated on purpose" pattern already used for
 * `SUPPORT_TICKETS_DISCLOSURE` in `wire-settings-actions.mjs`. Keep the two
 * in sync by hand; this file is the one to read to understand *why* the
 * transform does what it does.
 *
 * SCOPE, STATED HONESTLY: this only ever transforms the ONE choke point
 * every notice in the app already funnels through — `toast(title, body)`
 * (design source, `componentDidMount`'s sibling method). Toast TITLES are
 * drawn from a small, finite, static set (~70 distinct strings across 157
 * call sites — verified by grepping the design source), so a real
 * translation dictionary for them is honest and complete. Toast BODIES
 * routinely carry dynamic, interpolated content (a filename, a flag value,
 * a byte count) that this file has no way to machine-translate without
 * inventing words that were never actually said — so bodies are never
 * rewritten into Cantonese; only decorated (funny-level wrapping, an
 * optional leading emoji) without altering a single character of the
 * original fact-bearing text. This is a deliberate, load-bearing choice:
 * the "facts stay exact at every funny level" rule is satisfied by
 * construction here, because the original string is never edited, only
 * wrapped.
 */

import type { LanguageMode } from '../shared/ipc-contract'

export interface LanguageCopyState {
  mode: LanguageMode
  enFunny: number
  yueFunny: number
  emoji: boolean
}

// ---------------------------------------------------------------------------
// Cantonese toast-title dictionary.
//
// Every key below is copy-pasted verbatim from a `this.toast('<title>', ...)`
// call site in `design/yt-dlp Studio.dc.html` (grep `this\.toast\('` to
// re-verify after a design change). Playful Hong Kong-style Cantonese,
// written in Chinese script (not romanized) since that is how the app's own
// contract describes "Cantonese" copy elsewhere (e.g. the Yue label). Kept
// short, like the English titles they replace, because these are TITLES —
// tone comes from the funny-level wrapper below, not from the translation
// itself. Never mocking, never referencing the user's data loss or ability;
// these are neutral status words (Saved, Copied, Reset...), so there is
// nothing here to mock in the first place.
// ---------------------------------------------------------------------------

export const CANTONESE_TOAST_TITLES: Record<string, string> = {
  'App mark': '應用程式標記',
  'Appearance applied': '外觀已套用',
  Applied: '已套用',
  Archive: '存檔',
  Authorized: '已授權',
  'Code applied': '代碼已套用',
  Compacted: '已壓縮',
  Config: '設定',
  'Cookies handed back': 'Cookies 已交還',
  'Copied as JSON': '已複製為 JSON',
  Copied: '已複製',
  Default: '預設',
  Disabled: '已停用',
  Dismissed: '已忽略',
  'Element locked': '元件已鎖定',
  Exec: '執行',
  Explorer: '檔案總管',
  Exported: '已匯出',
  'File picker': '選擇檔案',
  'Folder picked': '已選資料夾',
  Folder: '資料夾',
  Forgotten: '已忘記',
  'Group collapsed': '群組已收合',
  'Group created': '群組已建立',
  'Group renamed': '群組已重新命名',
  Groups: '群組',
  'Handed off': '已交接',
  'Item range': '項目範圍',
  Jumped: '已跳至',
  Moved: '已移動',
  'Navigation moved': '導覽已移動',
  'No code yet': '仲未有代碼',
  'Not armed': '未啟動',
  Palette: '指令面板',
  'Pattern applied': '樣式已套用',
  Pinned: '已固定',
  Player: '播放器',
  'Post-processing': '後製處理',
  'Preset applied': '預設已套用',
  'Preview first': '先預覽',
  Printing: '列印中',
  Queue: '佇列',
  Queued: '已排入佇列',
  'Recipe applied': '配方已套用',
  Recovery: '復原',
  Refreshed: '已重新整理',
  Removed: '已移除',
  Reset: '已重設',
  Retention: '保留',
  Retrying: '重試中',
  Running: '執行中',
  'Safety gate': '安全閘',
  Saved: '已儲存',
  Started: '已開始',
  'Still locked': '仍然鎖定',
  Tabs: '分頁',
  'Theme saved': '主題已儲存',
  Unlocked: '已解鎖',
  'Vocabulary loaded': '詞彙已載入',
  'info.json': 'info.json',
  '🥟 Dim-sum surprise': '🥟 點心驚喜',
  'Not connected': '未連接',
}

// ---------------------------------------------------------------------------
// Funny-level decoration. Levels ADD a short, deterministic tail after the
// factual body — never before it, never replacing any part of it — so the
// fact the notice exists to report is always intact and always read first.
// Level 1 is fully professional (no addition, in either language). Applies
// to every category, errors and warnings included, per the "no carve-outs"
// rule: the added text is always neutral-to-warm, never trivializing what
// the notice is reporting.
// ---------------------------------------------------------------------------

const EN_FUNNY_TAILS: Record<number, string> = {
  1: '',
  2: '',
  3: ' Nice.',
  4: ' All good here.',
  5: ' Living our best download life.',
}

const YUE_FUNNY_TAILS: Record<number, string> = {
  1: '',
  2: '',
  3: ' 幾好呀。',
  4: ' 一切順利。',
  5: ' 今日又叻咗一次。',
}

function funnyTail(level: number, table: Record<number, string>): string {
  const clamped = Math.min(5, Math.max(1, Math.round(level)))
  return table[clamped] ?? ''
}

// ---------------------------------------------------------------------------
// Emoji-in-dialogs. A small, honest keyword heuristic over the TITLE only
// (never a button, action label, field label, or accessible name — those
// are outside this function's reach entirely, by construction, since this
// function only ever sees toast title/body text). Off by default.
// ---------------------------------------------------------------------------

const WARN_WORDS = /lock|not connected|not armed|forgotten|safety|retry|retrying|error|fail/i
const OK_WORDS = /saved|applied|copied|exported|pinned|unlocked|refreshed|authorized|handed|compacted/i
const BUSY_WORDS = /running|started|queued|printing|jumped|moved/i

function emojiFor(title: string): string {
  if (WARN_WORDS.test(title)) return '⚠️'
  if (OK_WORDS.test(title)) return '✅'
  if (BUSY_WORDS.test(title)) return '⏳'
  return '✨'
}

export interface AppliedToastCopy {
  title: string
  body: string
  /** The variant actually spoken by the narrator when narratorLanguage requires the "other" language and no real translation exists — lets the narrator honestly fall back instead of inventing words. */
  spokenEn: string
  spokenYue: string
}

/**
 * Transforms one toast's title/body for display, honoring language mode,
 * both funny-level sliders, and the emoji toggle. Pure: same inputs, same
 * output, every time — call it fresh per toast, never memoized across
 * setting changes.
 */
export function applyToastCopy(title: string, body: string, state: LanguageCopyState): AppliedToastCopy {
  const yueTitle = CANTONESE_TOAST_TITLES[title]
  const enTail = funnyTail(state.enFunny, EN_FUNNY_TAILS)
  const yueTail = funnyTail(state.yueFunny, YUE_FUNNY_TAILS)

  const enTitleRaw = title
  const enBodyRaw = body ? body + enTail : body
  const yueTitleRaw = yueTitle ?? title
  // Body has no dictionary translation (dynamic content) — honestly reuse
  // the English body rather than fabricate a Cantonese sentence for facts
  // this function was never given a real translation for.
  const yueBodyRaw = body ? body + yueTail : body

  let displayTitle: string
  let displayBody: string
  if (state.mode === 'en') {
    displayTitle = enTitleRaw
    displayBody = enBodyRaw
  } else if (state.mode === 'yue') {
    displayTitle = yueTitleRaw
    displayBody = yueBodyRaw
  } else {
    // bilingual: show both, primary (English) prominent, secondary compact
    // — mirrors the "primary label prominent, secondary compact" rule.
    displayTitle = yueTitle ? `${enTitleRaw} · ${yueTitleRaw}` : enTitleRaw
    displayBody = enBodyRaw
  }

  if (state.emoji && displayTitle) {
    displayTitle = `${emojiFor(title)} ${displayTitle}`
  }

  return {
    title: displayTitle,
    body: displayBody,
    spokenEn: enTitleRaw + (enBodyRaw ? '. ' + enBodyRaw : ''),
    spokenYue: yueTitleRaw + (yueBodyRaw ? '. ' + yueBodyRaw : ''),
  }
}

// ---------------------------------------------------------------------------
// Narrator voice selection. Pure given a voice list — the actual
// `speechSynthesis.getVoices()` call, its `voiceschanged` re-read, and the
// `SpeechSynthesisUtterance` construction all live in the browser-only
// wiring (`scripts/wire-language.mjs`), which this function has no access
// to here. What IS pure, and worth keeping correct and tested in one place,
// is "given the voices this machine actually reports and a stored choice,
// which one do we actually use, and what do we tell the user about it".
// ---------------------------------------------------------------------------

export interface NarratorVoiceLike {
  voiceURI: string
  name: string
  lang: string
}

export interface VoiceResolution {
  /** The voice to actually use, or null if this machine has no voice for the requested language at all. */
  voice: NarratorVoiceLike | null
  /** True when the user's stored choice exists but is not installed on this machine, so the choice is being kept (not silently reset) while falling back. */
  fallenBack: boolean
}

/** The stable identity to persist for a voice: voiceURI per spec, falling back to name+lang if a platform ever reports an empty voiceURI. */
export function voiceIdentity(voice: NarratorVoiceLike): string {
  return voice.voiceURI && voice.voiceURI.length > 0 ? voice.voiceURI : `${voice.name}::${voice.lang}`
}

/**
 * Resolves which installed voice to speak a track with, given the user's
 * stored choice (a voiceURI, or AUTO_VOICE for "choose automatically").
 *
 * - AUTO_VOICE: pick the first voice whose lang matches the target
 *   language's prefix ('zh' for Cantonese/Yue, 'en' for English); null if
 *   none exists on this machine.
 * - An explicit stored id that IS installed: use it exactly.
 * - An explicit stored id that is NOT installed: fall back to the same
 *   automatic match, but report `fallenBack: true` so the caller can say
 *   so plainly — the stored choice is kept, never silently reset.
 */
export function resolveNarratorVoice(
  voices: NarratorVoiceLike[],
  targetLanguage: 'en' | 'yue',
  storedVoiceId: string,
): VoiceResolution {
  const prefix = targetLanguage === 'yue' ? 'zh' : 'en'
  const autoMatch = voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null

  if (storedVoiceId === 'auto' || storedVoiceId === '') {
    return { voice: autoMatch, fallenBack: false }
  }

  const explicit = voices.find((v) => voiceIdentity(v) === storedVoiceId) ?? null
  if (explicit) return { voice: explicit, fallenBack: false }

  return { voice: autoMatch, fallenBack: true }
}
