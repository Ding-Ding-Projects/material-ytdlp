import { BrowserWindow, app, dialog } from 'electron'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './store'
import {
  VOCABULARY_MAX_DEPTH,
  VOCABULARY_MAX_ENTRIES,
  VOCABULARY_MAX_FILE_BYTES,
  VOCABULARY_MAX_KEY_LENGTH,
  VOCABULARY_MAX_VALUE_LENGTH,
  VOCABULARY_SCHEMA_VERSION,
  VOCABULARY_UNSAFE_KEYS,
  emptyVocabularyState,
  type VocabularyLoadResult,
  type VocabularyPayload,
  type VocabularyState,
} from '../shared/vocabulary-contract'

const CACHE_FILENAME = 'personal-vocabulary-cache.json'
const UNSAFE_KEYS = new Set<string>(VOCABULARY_UNSAFE_KEYS)

function cachePath(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, CACHE_FILENAME)
}

// ---------------------------------------------------------------------------
// A strict, hand-rolled JSON parser.
//
// `JSON.parse` cannot detect duplicate keys: when the same key appears twice
// in one object literal, the parser silently keeps only the last value and
// gives the caller no way to know a duplicate ever existed. A `reviver`
// callback does not help either — it is invoked once per FINAL key, after
// duplicates have already been collapsed, so it never sees the discarded
// occurrence. The only reliable way to catch this is to walk the raw text
// ourselves and track which keys have already been seen at each object
// nesting level.
//
// This same walk also gives us, for free and without a second pass over the
// text, the two other structural checks that a plain `JSON.parse` cannot
// provide cheaply: a hard container-nesting-depth ceiling (enforced as we
// descend, so a hostile payload cannot force unbounded recursion) and
// rejection of unsafe object keys (__proto__, constructor, prototype) at the
// moment they are parsed, before they could ever reach `Object.assign` or a
// spread.
//
// The parser is intentionally small: it supports exactly the JSON grammar
// (object, array, string, number, true/false/null) and nothing more, is
// bounded by the caller's own file-size ceiling before it is ever invoked,
// and never uses a regular expression to reason about nested braces — a
// regex cannot see nesting, which is exactly the property this check needs.
// ---------------------------------------------------------------------------

interface ParseFailure {
  ok: false
  reason: string
}

interface ParseSuccess {
  ok: true
  value: unknown
}

function parseJsonStrict(raw: string): ParseSuccess | ParseFailure {
  const n = raw.length
  let i = 0

  function fail(reason: string): ParseFailure {
    return { ok: false, reason }
  }

  function isWs(c: string): boolean {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r'
  }

  function skipWs(): void {
    while (i < n && isWs(raw[i]!)) i++
  }

  function parseString(): { ok: true; value: string } | ParseFailure {
    // raw[i] === '"'
    i++
    let out = ''
    while (i < n) {
      const c = raw[i]!
      if (c === '"') {
        i++
        return { ok: true, value: out }
      }
      if (c === '\\') {
        const next = raw[i + 1]
        if (next === undefined) return fail('Unterminated escape sequence in a string.')
        switch (next) {
          case '"':
          case '\\':
          case '/':
            out += next
            i += 2
            break
          case 'b':
            out += '\b'
            i += 2
            break
          case 'f':
            out += '\f'
            i += 2
            break
          case 'n':
            out += '\n'
            i += 2
            break
          case 'r':
            out += '\r'
            i += 2
            break
          case 't':
            out += '\t'
            i += 2
            break
          case 'u': {
            const hex = raw.slice(i + 2, i + 6)
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              return fail('Invalid \\u escape in a string.')
            }
            out += String.fromCharCode(Number.parseInt(hex, 16))
            i += 6
            break
          }
          default:
            return fail(`Invalid escape sequence "\\${next}" in a string.`)
        }
        continue
      }
      // JSON forbids raw control characters in strings.
      if (c.charCodeAt(0) < 0x20) return fail('Unescaped control character in a string.')
      out += c
      i++
    }
    return fail('Unterminated string literal.')
  }

  function parseNumber(): { ok: true; value: number } | ParseFailure {
    const start = i
    if (raw[i] === '-') i++
    if (raw[i] === '0') {
      i++
    } else if (raw[i] >= '1' && raw[i] <= '9') {
      while (raw[i] >= '0' && raw[i] <= '9') i++
    } else {
      return fail('Malformed number literal.')
    }
    if (raw[i] === '.') {
      i++
      if (!(raw[i] >= '0' && raw[i] <= '9')) return fail('Malformed number literal.')
      while (raw[i] >= '0' && raw[i] <= '9') i++
    }
    if (raw[i] === 'e' || raw[i] === 'E') {
      i++
      if (raw[i] === '+' || raw[i] === '-') i++
      if (!(raw[i] >= '0' && raw[i] <= '9')) return fail('Malformed number literal.')
      while (raw[i] >= '0' && raw[i] <= '9') i++
    }
    const text = raw.slice(start, i)
    const value = Number(text)
    if (Number.isNaN(value)) return fail('Malformed number literal.')
    return { ok: true, value }
  }

  function parseLiteral(word: string, value: unknown): { ok: true; value: unknown } | ParseFailure {
    if (raw.slice(i, i + word.length) !== word) return fail(`Expected "${word}".`)
    i += word.length
    return { ok: true, value }
  }

  function parseValue(depth: number): { ok: true; value: unknown } | ParseFailure {
    skipWs()
    if (i >= n) return fail('Unexpected end of input.')
    const c = raw[i]!
    if (c === '"') return parseString()
    if (c === '{') return parseObject(depth)
    if (c === '[') return parseArray(depth)
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber()
    if (c === 't') return parseLiteral('true', true)
    if (c === 'f') return parseLiteral('false', false)
    if (c === 'n') return parseLiteral('null', null)
    return fail(`Unexpected character "${c}".`)
  }

  function parseObject(depth: number): { ok: true; value: Record<string, unknown> } | ParseFailure {
    if (depth > VOCABULARY_MAX_DEPTH) {
      return fail(`JSON nesting exceeds the maximum depth of ${VOCABULARY_MAX_DEPTH}.`)
    }
    i++ // '{'
    const result: Record<string, unknown> = {}
    const seenKeys = new Set<string>()
    skipWs()
    if (raw[i] === '}') {
      i++
      return { ok: true, value: result }
    }
    for (;;) {
      skipWs()
      if (raw[i] !== '"') return fail('Expected a string key in an object.')
      const keyResult = parseString()
      if (!keyResult.ok) return keyResult
      const key = keyResult.value
      if (seenKeys.has(key)) return fail(`Duplicate key "${key}" in an object.`)
      seenKeys.add(key)
      if (UNSAFE_KEYS.has(key)) return fail(`Unsafe key "${key}" is not allowed.`)
      skipWs()
      if (raw[i] !== ':') return fail('Expected ":" after an object key.')
      i++
      const valueResult = parseValue(depth + 1)
      if (!valueResult.ok) return valueResult
      result[key] = valueResult.value
      skipWs()
      if (raw[i] === ',') {
        i++
        continue
      }
      if (raw[i] === '}') {
        i++
        return { ok: true, value: result }
      }
      return fail('Expected "," or "}" in an object.')
    }
  }

  function parseArray(depth: number): { ok: true; value: unknown[] } | ParseFailure {
    if (depth > VOCABULARY_MAX_DEPTH) {
      return fail(`JSON nesting exceeds the maximum depth of ${VOCABULARY_MAX_DEPTH}.`)
    }
    i++ // '['
    const result: unknown[] = []
    skipWs()
    if (raw[i] === ']') {
      i++
      return { ok: true, value: result }
    }
    for (;;) {
      const valueResult = parseValue(depth + 1)
      if (!valueResult.ok) return valueResult
      result.push(valueResult.value)
      if (result.length > VOCABULARY_MAX_ENTRIES) {
        return fail(`Array exceeds the ${VOCABULARY_MAX_ENTRIES}-item limit.`)
      }
      skipWs()
      if (raw[i] === ',') {
        i++
        continue
      }
      if (raw[i] === ']') {
        i++
        return { ok: true, value: result }
      }
      return fail('Expected "," or "]" in an array.')
    }
  }

  const top = parseValue(1)
  if (!top.ok) return top
  skipWs()
  if (i !== n) return fail('Unexpected trailing content after the JSON value.')
  return { ok: true, value: top.value }
}

// ---------------------------------------------------------------------------
// Schema validation on top of the strict parse.
// ---------------------------------------------------------------------------

export type VocabularyValidation = { ok: true; payload: VocabularyPayload } | { ok: false; reason: string }

/**
 * Validates the COMPLETE raw file text before anything is displayed or
 * cached: size, strict-JSON structure (including duplicate-key and unsafe-
 * key rejection and a bounded nesting depth), the exact top-level shape,
 * the schema version, and every key/value in `terms` (string-only values,
 * bounded lengths, bounded entry count). Any failure returns a specific
 * reason and applies nothing — there is no partial success path.
 */
export function validateVocabularyPayload(raw: string): VocabularyValidation {
  const byteLength = Buffer.byteLength(raw, 'utf8')
  if (byteLength > VOCABULARY_MAX_FILE_BYTES) {
    return { ok: false, reason: `File is ${byteLength} bytes, which exceeds the ${VOCABULARY_MAX_FILE_BYTES}-byte limit.` }
  }

  const parsed = parseJsonStrict(raw)
  if (!parsed.ok) return { ok: false, reason: `Malformed JSON: ${parsed.reason}` }

  const value = parsed.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'The top level of the file must be a JSON object.' }
  }
  const obj = value as Record<string, unknown>

  const allowedTopFields = new Set(['schemaVersion', 'terms'])
  for (const key of Object.keys(obj)) {
    if (!allowedTopFields.has(key)) {
      return { ok: false, reason: `Unexpected top-level field "${key}". Only "schemaVersion" and "terms" are allowed.` }
    }
  }

  if (obj.schemaVersion !== VOCABULARY_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Unsupported schema version "${String(obj.schemaVersion)}" (this build only understands version ${VOCABULARY_SCHEMA_VERSION}).`,
    }
  }

  const terms = obj.terms
  if (typeof terms !== 'object' || terms === null || Array.isArray(terms)) {
    return { ok: false, reason: '"terms" must be a JSON object mapping stock words to your own words.' }
  }
  const termsObj = terms as Record<string, unknown>
  const entries = Object.entries(termsObj)

  if (entries.length === 0) {
    return { ok: false, reason: '"terms" must contain at least one entry.' }
  }
  if (entries.length > VOCABULARY_MAX_ENTRIES) {
    return { ok: false, reason: `"terms" has ${entries.length} entries, which exceeds the ${VOCABULARY_MAX_ENTRIES}-entry limit.` }
  }

  const cleaned: Record<string, string> = {}
  for (const [key, val] of entries) {
    if (key.length === 0 || key.length > VOCABULARY_MAX_KEY_LENGTH) {
      return { ok: false, reason: `Key "${key.slice(0, 40)}" is empty or exceeds ${VOCABULARY_MAX_KEY_LENGTH} characters.` }
    }
    if (typeof val !== 'string') {
      return { ok: false, reason: `The value for key "${key}" must be a string, not ${typeof val}.` }
    }
    if (val.length === 0 || val.length > VOCABULARY_MAX_VALUE_LENGTH) {
      return { ok: false, reason: `The value for key "${key}" is empty or exceeds ${VOCABULARY_MAX_VALUE_LENGTH} characters.` }
    }
    cleaned[key] = val
  }

  return { ok: true, payload: { schemaVersion: VOCABULARY_SCHEMA_VERSION, terms: cleaned } }
}

// ---------------------------------------------------------------------------
// Storage: only the validated payload ever reaches disk, via the shared
// atomic-write helper (Windows sharing-violation retry included). The
// source file's own path is never persisted anywhere — it is read once,
// validated, and discarded.
// ---------------------------------------------------------------------------

function toState(payload: VocabularyPayload): VocabularyState {
  return {
    loaded: true,
    entryCount: Object.keys(payload.terms).length,
    schemaVersion: payload.schemaVersion,
    loadedAt: Date.now(),
    terms: payload.terms,
  }
}

/**
 * Re-reads and revalidates the on-disk cache. A missing, corrupt, unreadable,
 * or now-unsupported cache fails closed to the empty state (original shipped
 * wording) rather than throwing or applying anything partial.
 */
export async function loadVocabularyFromDisk(userDataDir?: string): Promise<VocabularyState> {
  let raw: string
  try {
    raw = await readFile(cachePath(userDataDir), 'utf8')
  } catch {
    return emptyVocabularyState()
  }
  const validated = validateVocabularyPayload(raw)
  if (!validated.ok) return emptyVocabularyState()
  return toState(validated.payload)
}

/** Purges the cache. Idempotent: clearing an already-empty cache is not an error. */
export async function clearVocabularyCache(userDataDir?: string): Promise<VocabularyState> {
  try {
    await unlink(cachePath(userDataDir))
  } catch {
    // Already absent, or unreadable — either way there is nothing more to clear.
  }
  return emptyVocabularyState()
}

async function saveVocabularyToDisk(
  rawFileText: string,
  userDataDir?: string,
): Promise<{ ok: true; state: VocabularyState } | { ok: false; reason: string }> {
  const validated = validateVocabularyPayload(rawFileText)
  if (!validated.ok) return { ok: false, reason: validated.reason }
  await atomicWriteFile(cachePath(userDataDir), JSON.stringify(validated.payload))
  return { ok: true, state: toState(validated.payload) }
}

// ---------------------------------------------------------------------------
// The one network-free, filesystem-only entry point that combines the
// native file picker with validation and caching.
// ---------------------------------------------------------------------------

async function pickJsonFile(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Personal vocabulary (JSON)', extensions: ['json'] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/**
 * Opens the native file picker, and on a real selection reads, validates,
 * and (only on success) caches it. On cancellation or rejection, the
 * previously-cached state (or the empty state) is returned unchanged — a
 * rejected file never applies partially.
 */
export async function pickAndLoadVocabulary(userDataDir?: string): Promise<VocabularyLoadResult> {
  const path = await pickJsonFile()
  if (path === null) {
    return { ok: true, cancelled: true, error: null, state: await loadVocabularyFromDisk(userDataDir) }
  }

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    return {
      ok: false,
      cancelled: false,
      error: `Could not read the selected file: ${err instanceof Error ? err.message : String(err)}`,
      state: await loadVocabularyFromDisk(userDataDir),
    }
  }

  const saved = await saveVocabularyToDisk(raw, userDataDir)
  if (!saved.ok) {
    return { ok: false, cancelled: false, error: saved.reason, state: await loadVocabularyFromDisk(userDataDir) }
  }
  return { ok: true, cancelled: false, error: null, state: saved.state }
}
