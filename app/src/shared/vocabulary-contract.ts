/**
 * Shared IPC contract for the personal-vocabulary feature.
 *
 * TYPES + CHANNEL NAMES + SCHEMA CONSTANTS ONLY — never import `electron`
 * here at runtime, so both the main process and the renderer (via the
 * preload bridge) can import this file freely. Deliberately kept separate
 * from `ipc-contract.ts` and `history-contract.ts` (those files are owned by
 * other work); channel names below are plain strings that do not collide
 * with any entry in either of them.
 *
 * NOTE ON SCOPE: this file, and the vocabulary system it describes, ships
 * NO real vocabulary values anywhere — no sample dictionary, no default
 * mapping, no "try it" fixture. The user's own words exist only after they
 * explicitly supply a valid local JSON file; until then every surface in
 * the app renders its original shipped wording, unchanged. Wherever an
 * example is needed in code, tests, or documentation, use only obviously
 * neutral placeholder pairs (e.g. "alpha" -> "bravo") — never anything that
 * resembles a real personal dictionary.
 */

// ---------------------------------------------------------------------------
// Channel names (renderer -> main, request/response)
// ---------------------------------------------------------------------------

export const VocabularyIpcChannel = {
  /** Opens a native file picker, validates the selection, and (on success) caches it. */
  PickAndLoad: 'vocabulary:pick-and-load',
  /** Re-reads and revalidates the on-disk cache, returning the current state. */
  GetState: 'vocabulary:get-state',
  /** Purges the cache and returns the resulting (empty) state. */
  Clear: 'vocabulary:clear',
} as const

export type VocabularyIpcChannelName = (typeof VocabularyIpcChannel)[keyof typeof VocabularyIpcChannel]

// ---------------------------------------------------------------------------
// Schema + bounds
//
// These are limits and shapes only — no real data. A supported schema
// version is rejected outright if it does not match exactly; there is
// deliberately no "best effort" upgrade path for an unknown version, since
// guessing at an unfamiliar shape is how a malformed file gets partially
// applied.
// ---------------------------------------------------------------------------

/** The only schema version this build understands. An unrecognized version is rejected, never guessed at. */
export const VOCABULARY_SCHEMA_VERSION = 1 as const

/** Hard ceiling on the raw file size, in bytes, before it is even parsed. */
export const VOCABULARY_MAX_FILE_BYTES = 1_000_000 // 1 MB

/** Maximum number of term -> replacement entries in one dictionary. */
export const VOCABULARY_MAX_ENTRIES = 5_000

/** Maximum length, in UTF-16 code units, of a single dictionary key (the stock term being replaced). */
export const VOCABULARY_MAX_KEY_LENGTH = 200

/** Maximum length, in UTF-16 code units, of a single replacement value. */
export const VOCABULARY_MAX_VALUE_LENGTH = 500

/**
 * Maximum JSON *container* nesting depth accepted by the strict parser,
 * counting the outermost object as depth 1. The documented shape is exactly
 * two levels — `{ schemaVersion, terms: { ... } }` — so a depth of 2 is
 * already generous; anything deeper is rejected before it is even
 * schema-checked, which bounds recursion cost for a hostile payload.
 */
export const VOCABULARY_MAX_DEPTH = 2

/** Object keys that are never accepted, anywhere in the payload: a prototype-pollution guard. */
export const VOCABULARY_UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'] as const

// ---------------------------------------------------------------------------
// The validated, cacheable payload
// ---------------------------------------------------------------------------

/** The exact on-disk / in-cache shape once a file has passed full validation. */
export interface VocabularyPayload {
  schemaVersion: typeof VOCABULARY_SCHEMA_VERSION
  /** Stock term -> the user's own word. String keys and string values only. */
  terms: Record<string, string>
}

// ---------------------------------------------------------------------------
// The state surfaced to the renderer
// ---------------------------------------------------------------------------

/**
 * What the renderer needs to know and render. Deliberately does NOT include
 * the source file's path — that is read once during pick-and-load and then
 * discarded; only the validated `terms` payload itself is ever persisted or
 * reported back.
 */
export interface VocabularyState {
  /** True once a valid dictionary is cached and in effect. False is the honest, ever-present empty state. */
  loaded: boolean
  entryCount: number
  schemaVersion: number | null
  /** Epoch ms the currently-loaded dictionary was validated and cached, or null when nothing is loaded. */
  loadedAt: number | null
  /** The active term -> replacement map. Empty when `loaded` is false. */
  terms: Record<string, string>
}

export function emptyVocabularyState(): VocabularyState {
  return { loaded: false, entryCount: 0, schemaVersion: null, loadedAt: null, terms: {} }
}

/** Result of a pick-and-load round trip: the user may cancel, the file may be rejected, or it may succeed. */
export interface VocabularyLoadResult {
  ok: boolean
  /** True when the user dismissed the file picker without choosing anything — never an error. */
  cancelled: boolean
  /** Null on success or cancellation; a specific, human-readable rejection reason on failure. */
  error: string | null
  /** The resulting state after this operation — on failure, whatever was in effect before (fail-closed, never partial). */
  state: VocabularyState
}
