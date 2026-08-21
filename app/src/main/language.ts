/**
 * Main-process persistence and validation for the language/voice feature.
 *
 * There is deliberately no separate on-disk file and no separate IPC
 * channel here: the three core fields (`languageMode`, `funnyLevelEn`,
 * `funnyLevelYue`) already live on `Preferences`, and `Preferences` already
 * round-trips through `getStore().getPreferences()` /
 * `getStore().setPreferences()` in `./store.ts` — which itself writes
 * through `atomicWriteFile`, so this feature inherits that file's
 * Windows-safe atomic-write-with-retry behavior for free. This module adds
 * the extra fields (narrator, emoji, voice choices, rate, pitch) to that
 * same object and is the one place that clamps/validates all six fields
 * before they ever reach disk, so a corrupt or hand-edited profile can
 * never persist an out-of-range funny level, an unrecognized narrator
 * language, or a NaN rate/pitch.
 */

import type { LanguageMode, Preferences } from '../shared/ipc-contract'
import { getStore } from './store'
import {
  DEFAULT_LANGUAGE_EXTRAS,
  clampFunnyLevel,
  clampNarratorPitch,
  clampNarratorRate,
  normalizeNarratorLanguage,
  normalizeVoiceId,
  type LanguageExtras,
} from '../shared/language-contract'

export type LanguagePrefs = Preferences & LanguageExtras

function isLanguageMode(value: unknown): value is LanguageMode {
  return value === 'en' || value === 'yue' || value === 'bilingual'
}

/**
 * Validates and clamps every field this feature owns on a `Preferences`
 * object, filling in a default for anything missing, unrecognized, or
 * out of range. Every other field on `prefs` (theme, density, font scale,
 * and so on — owned by other lanes) is passed through untouched: this
 * function only ever narrows its own six fields, never the whole object.
 */
export function sanitizeLanguagePrefs(prefs: Partial<Preferences>): LanguagePrefs {
  const languageMode: LanguageMode = isLanguageMode(prefs.languageMode) ? prefs.languageMode : 'en'
  const d = DEFAULT_LANGUAGE_EXTRAS
  return {
    ...(prefs as Preferences),
    languageMode,
    funnyLevelEn: clampFunnyLevel(prefs.funnyLevelEn, 2),
    funnyLevelYue: clampFunnyLevel(prefs.funnyLevelYue, 3),
    emoji: prefs.emoji === true ? true : prefs.emoji === false ? false : d.emoji,
    narrator: prefs.narrator === true ? true : prefs.narrator === false ? false : d.narrator,
    narratorLanguage: normalizeNarratorLanguage(prefs.narratorLanguage ?? d.narratorLanguage),
    narratorVoiceEn: normalizeVoiceId(prefs.narratorVoiceEn ?? d.narratorVoiceEn),
    narratorVoiceYue: normalizeVoiceId(prefs.narratorVoiceYue ?? d.narratorVoiceYue),
    narratorRate: clampNarratorRate(prefs.narratorRate ?? d.narratorRate),
    narratorPitch: clampNarratorPitch(prefs.narratorPitch ?? d.narratorPitch),
  }
}

/** Reads the persisted preferences and returns them with every language/voice field validated and defaulted. */
export async function getLanguagePrefs(): Promise<LanguagePrefs> {
  const stored = await getStore().getPreferences()
  return sanitizeLanguagePrefs(stored)
}

/**
 * Merges `partial` onto the currently persisted preferences, sanitizes the
 * result, writes it back (through the existing atomic-write-backed store),
 * and returns what was actually persisted. Merging against the live stored
 * value — rather than whatever the caller happened to hold in memory —
 * means a change to a field this feature does not own (made by another
 * lane, in a different renderer tick) is never clobbered by a concurrent
 * language/voice change.
 */
export async function setLanguagePrefs(partial: Partial<LanguagePrefs>): Promise<LanguagePrefs> {
  const store = getStore()
  const current = await store.getPreferences()
  const next = sanitizeLanguagePrefs({ ...current, ...partial })
  await store.setPreferences(next)
  return next
}
