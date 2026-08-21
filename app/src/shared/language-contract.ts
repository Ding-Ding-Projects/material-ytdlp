/**
 * Shared contract for the language/voice feature: language mode, the two
 * per-language playfulness sliders, the emoji-in-dialogs toggle, and the
 * spoken narrator (TTS).
 *
 * TYPES + DEFAULTS + BOUNDS ONLY — never import `electron` here at runtime,
 * so both the main process and the renderer can import this file freely.
 *
 * PERSISTENCE NOTE: this feature does NOT define its own IPC channels. The
 * three core fields it extends (`languageMode`, `funnyLevelEn`,
 * `funnyLevelYue`) already exist on `Preferences` in `ipc-contract.ts` and
 * already round-trip end to end through `IpcChannel.StoreGetPreferences` /
 * `IpcChannel.StoreSetPreferences` (`app/src/main/ipc.ts` ->
 * `app/src/main/store.ts`, exposed at `window.ytdlpStudio.store.*` in
 * `app/src/preload/index.ts`). The narrator/emoji/voice fields below ride
 * the same round trip: `Preferences` carries a `[key: string]: unknown`
 * index signature specifically so additional settings can be stored there
 * without a second persisted file or a second IPC surface. This file exists
 * to give those extra fields real names, real types, real bounds, and one
 * place that both the main process (validation) and the renderer
 * (defensive reads) agree on.
 */

/** Which language the optional spoken narrator reads notices in. 'both' speaks English then Cantonese, strictly serialized. */
export type NarratorLanguage = 'en' | 'yue' | 'both'

/** Sentinel stored when the user has not picked an explicit voice — the picker's own "Choose automatically" default. */
export const AUTO_VOICE = 'auto' as const

/** Lower/upper bounds for the two per-language playfulness sliders. Level 1 is fully professional; level 5 is maximum playfulness. */
export const FUNNY_LEVEL_MIN = 1
export const FUNNY_LEVEL_MAX = 5
export const DEFAULT_FUNNY_LEVEL_EN = 2
export const DEFAULT_FUNNY_LEVEL_YUE = 3

/** Narrator rate/pitch bounds. These mirror the Web Speech API's own documented ranges (rate 0.1-10 in spec, but 0.5-2 covers every voice that renders intelligibly; pitch is 0-2 per spec). */
export const NARRATOR_RATE_MIN = 0.5
export const NARRATOR_RATE_MAX = 2
export const DEFAULT_NARRATOR_RATE = 1
export const NARRATOR_PITCH_MIN = 0
export const NARRATOR_PITCH_MAX = 2
export const DEFAULT_NARRATOR_PITCH = 1

/**
 * The extra fields this feature stores inside `Preferences`, beyond the
 * `languageMode` / `funnyLevelEn` / `funnyLevelYue` fields that already
 * exist there. Every field has an explicit default so a fresh profile, or
 * a profile from before this feature shipped, reads as "off / automatic"
 * rather than throwing on a missing key.
 */
export interface LanguageExtras {
  /** Decorative emoji in dialogs and message boxes. Off by default. Never applied to buttons, action labels, field labels, or accessible names — those are handled at the call site, never by this flag. */
  emoji: boolean
  /** Whether the spoken narrator is enabled. OFF by default — this is an opt-in end-user choice; the implementation itself is mandatory regardless of this flag's value. */
  narrator: boolean
  /** Which language the narrator speaks. */
  narratorLanguage: NarratorLanguage
  /** The stable voice identity (SpeechSynthesisVoice.voiceURI, falling back to name+lang) chosen for the English track, or AUTO_VOICE. Never a display name alone — display names are not unique and are localized. */
  narratorVoiceEn: string
  /** Same as narratorVoiceEn, for the Cantonese/Yue track. */
  narratorVoiceYue: string
  /** Narrator speech rate, within [NARRATOR_RATE_MIN, NARRATOR_RATE_MAX]. */
  narratorRate: number
  /** Narrator speech pitch, within [NARRATOR_PITCH_MIN, NARRATOR_PITCH_MAX]. */
  narratorPitch: number
}

export const DEFAULT_LANGUAGE_EXTRAS: LanguageExtras = {
  emoji: false,
  narrator: false,
  narratorLanguage: 'en',
  narratorVoiceEn: AUTO_VOICE,
  narratorVoiceYue: AUTO_VOICE,
  narratorRate: DEFAULT_NARRATOR_RATE,
  narratorPitch: DEFAULT_NARRATOR_PITCH,
}

/** Clamps a funny-level value into [FUNNY_LEVEL_MIN, FUNNY_LEVEL_MAX] and rounds it to the nearest whole level. */
export function clampFunnyLevel(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(FUNNY_LEVEL_MAX, Math.max(FUNNY_LEVEL_MIN, Math.round(n)))
}

/** Clamps a narrator rate value into [NARRATOR_RATE_MIN, NARRATOR_RATE_MAX]. */
export function clampNarratorRate(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_NARRATOR_RATE
  return Math.min(NARRATOR_RATE_MAX, Math.max(NARRATOR_RATE_MIN, n))
}

/** Clamps a narrator pitch value into [NARRATOR_PITCH_MIN, NARRATOR_PITCH_MAX]. */
export function clampNarratorPitch(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_NARRATOR_PITCH
  return Math.min(NARRATOR_PITCH_MAX, Math.max(NARRATOR_PITCH_MIN, n))
}

function isNarratorLanguage(value: unknown): value is NarratorLanguage {
  return value === 'en' || value === 'yue' || value === 'both'
}

/** Normalizes an arbitrary stored narrator-language value, falling back to 'en' rather than throwing on a stale or corrupt profile. */
export function normalizeNarratorLanguage(value: unknown): NarratorLanguage {
  return isNarratorLanguage(value) ? value : 'en'
}

/** Normalizes an arbitrary stored voice-identity value: any non-empty string is accepted (the picker itself decides whether it still resolves to an installed voice), anything else falls back to AUTO_VOICE. */
export function normalizeVoiceId(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : AUTO_VOICE
}
