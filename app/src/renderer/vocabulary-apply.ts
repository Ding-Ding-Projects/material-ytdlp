/**
 * The personal-vocabulary text-replacement boundary.
 *
 * Pure, dependency-free, and deliberately narrow: it knows nothing about
 * IPC, storage, or validation (that lives in `../main/vocabulary.ts`), and
 * it must never be reachable from a call site that is not explicitly
 * user-facing prose. This file ships NO real vocabulary values — the
 * `terms` map it operates on always comes from the user's own validated
 * upload; there is nothing built in here to replace anything with.
 */

export interface VocabularyMatcher {
  /** Replaces every whole-word match of a dictionary key with its user-chosen replacement. */
  apply(text: string): string
}

const NOOP_MATCHER: VocabularyMatcher = { apply: (text: string) => text }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Precompiles a matcher for one loaded dictionary. Call this ONCE per loaded
 * (or reloaded/cleared) dictionary — never per render — and reuse the
 * returned matcher for every subsequent `applyPersonalVocabularyToProse`
 * call, so the cost of building the pattern is paid once rather than on
 * every render.
 *
 * Keys are matched longest-first so that a longer phrase is never shadowed
 * by a shorter one that happens to be a substring of it (e.g. a dictionary
 * containing both "download" and "download manager" must match the longer
 * phrase first). Matching is whole-word (`\b...\b`) and case-sensitive:
 * exact, deterministic, and never rewrites part of a larger unrelated word.
 */
export function compileVocabularyMatcher(terms: Record<string, string>): VocabularyMatcher {
  const keys = Object.keys(terms)
  if (keys.length === 0) return NOOP_MATCHER

  const sortedKeys = [...keys].sort((a, b) => b.length - a.length)
  const alternation = sortedKeys.map(escapeRegExp).join('|')
  const pattern = new RegExp(`\\b(?:${alternation})\\b`, 'gu')

  return {
    apply(text: string): string {
      if (!text) return text
      return text.replace(pattern, (match) => terms[match] ?? match)
    },
  }
}

/**
 * Applies the personal vocabulary to ONE piece of user-facing prose — a
 * label, a description, a button's visible text, or an accessible name.
 *
 * Call sites are responsible for only ever passing genuine user-facing
 * prose here. Never pass: a command, a CLI flag (`--format`, `--cookies`),
 * a URL, a file path, an identifier, a version string, or any other factual
 * external record — a whole-word replacement over such a string would
 * silently corrupt it (a flag renamed out from under yt-dlp, a path that no
 * longer resolves), which is precisely the failure this narrow boundary
 * exists to prevent. There is deliberately no "replace everywhere" helper
 * that walks an object tree blindly; every call site names the exact string
 * it means to translate.
 */
export function applyPersonalVocabularyToProse(text: string, matcher: VocabularyMatcher): string {
  return matcher.apply(text)
}
