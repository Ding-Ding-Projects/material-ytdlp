# Personal vocabulary

## Behavior

The Settings surface always shows a **Personal vocabulary** control, even before the user has
ever supplied a file — the control itself is never hidden, and there is no built-in dictionary
behind it. Its states:

- **No file loaded (the default, honest empty state).** Every surface in the app renders its
  original shipped English (or Cantonese, or bilingual) wording, unchanged.
- **Loaded.** The app renders with the user's own word choices substituted for the matching
  stock terms, wherever that substitution is applied.
- **Invalid / rejected.** The most recent upload attempt failed a specific, named validation
  rule; nothing is applied, and whatever was in effect before (loaded or empty) remains in
  effect unchanged. A rejected file never applies partially.
- **Replace / clear.** The user can pick a new file at any time (replacing the previous
  dictionary outright) or clear the loaded dictionary, which purges the cache and restores
  original wording immediately.

**No built-in mappings ship, ever.** There is no sample file, no template, no default
dictionary, and no "try it" fixture anywhere in this feature's code, tests, or documentation.
Real vocabulary values exist only after the user explicitly selects and successfully loads their
own local JSON file. Wherever this document or the code needs an example, it uses obviously
neutral placeholder pairs such as `"alpha" -> "bravo"` — never anything resembling a real
personal dictionary, because this is a public repository.

### The file format

A personal vocabulary file is a single JSON object with exactly two top-level fields:

```json
{
  "schemaVersion": 1,
  "terms": {
    "alpha": "bravo",
    "charlie delta": "echo foxtrot"
  }
}
```

- `schemaVersion` must be exactly `1` (the only version this build understands). An unknown
  version is rejected outright — there is no "best effort" upgrade path, because guessing at an
  unfamiliar shape is how a malformed file ends up partially applied.
- `terms` maps a stock word or phrase to the user's own replacement. Both sides must be
  non-empty strings.

### Where replacement is, and is not, applied

Replacement happens only at the user-facing text boundary — labels, descriptions, button text,
and accessible names — through a single narrow function
(`app/src/renderer/vocabulary-apply.ts`, `applyPersonalVocabularyToProse`). Call sites must name
the exact string they intend to translate; there is no "replace everywhere" helper that walks an
object tree blindly.

Replacement is **never** applied to: yt-dlp commands or CLI flags (`--format`, `--cookies`),
URLs, file paths, identifiers, version strings, or any other factual external record. A
whole-word substitution over one of those would silently corrupt it (a flag renamed out from
under yt-dlp, a path that no longer resolves), which is exactly the failure this boundary exists
to prevent.

Matching is whole-word and case-sensitive, with longer dictionary entries matched before shorter
ones that happen to be a substring of them (so a dictionary containing both `"download"` and
`"download manager"` matches the longer phrase first, rather than leaving `" manager"` dangling
after the shorter one already matched). The matcher is precompiled once per loaded dictionary and
reused on every render — it is not rebuilt per call.

## Configuration

### Validation (`app/src/main/vocabulary.ts`)

The complete raw file text is validated before anything is displayed or cached. Every rule below
is checked, and a failed file is rejected with a specific, human-readable reason naming exactly
which rule it broke:

| Rule | Limit / behavior |
| --- | --- |
| Maximum file size | 1,000,000 bytes (`VOCABULARY_MAX_FILE_BYTES`), checked before parsing |
| JSON well-formedness | Parsed with a hand-rolled strict parser (see below), not `JSON.parse` alone |
| Duplicate keys | Rejected. `JSON.parse` silently keeps only the last occurrence of a repeated key and gives no signal that a duplicate ever existed — a `reviver` callback does not help either, since it only ever sees the final, already-collapsed key. The strict parser tracks every key it has seen at each object nesting level as it walks the raw text, and rejects the file the moment a key repeats within the same object. |
| Unsafe keys | `__proto__`, `constructor`, and `prototype` are rejected anywhere they appear as an object key — a prototype-pollution guard enforced at parse time, before any such key could reach an `Object.assign` or spread. |
| Maximum nesting depth | 2 containers deep (`VOCABULARY_MAX_DEPTH`) — the documented shape (`{ schemaVersion, terms: { ... } }`) needs only two, so anything deeper is rejected before it is even schema-checked, bounding recursion cost for a hostile payload. |
| Unexpected top-level fields | Only `schemaVersion` and `terms` are permitted; anything else is rejected by name. |
| Schema version | Must equal the one supported version exactly. |
| `terms` shape | Must be a JSON object (not an array, not a primitive), with at least one entry. |
| Maximum entry count | 5,000 entries (`VOCABULARY_MAX_ENTRIES`). |
| Key/value type | Every value must be a string — a number, object, array, boolean, or `null` value is rejected by key name. |
| Key/value length | Keys are capped at 200 characters, values at 500 characters (`VOCABULARY_MAX_KEY_LENGTH` / `VOCABULARY_MAX_VALUE_LENGTH`). |

The strict parser (`parseJsonStrict` inside `vocabulary.ts`) exists specifically because duplicate
keys, nesting depth, and unsafe keys are cheap to reject while walking the raw text character by
character, but cannot be recovered once `JSON.parse` has already collapsed them into a plain
object.

### Storage

Only the validated payload is ever written to disk, at
`<userData>/personal-vocabulary-cache.json`, via the same atomic-write helper
(`atomicWriteFile` in `app/src/main/store.ts`) every other persisted file in this app uses —
including its bounded retry against the transient Windows sharing-violation codes that can hit a
rename immediately after a write. The source file's own path is **never** persisted anywhere: it
is read once during pick-and-load, validated, and discarded.

The cache is revalidated on every load (`loadVocabularyFromDisk`). A missing, corrupt,
unreadable, or now-unsupported cache falls back to the empty state — original shipped wording —
rather than throwing or applying anything partial.

### Clearing

Clearing (`clearVocabularyCache`) deletes the cache file and returns the empty state
immediately; it is idempotent and never treated as an error when there was nothing cached to
begin with.

### IPC surface

Exposed on `window.ytdlpStudio.vocabulary`:

- `pickAndLoad()` — opens the native JSON file picker; on a real (non-cancelled) selection,
  validates and, only on success, caches the file. Returns `{ ok, cancelled, error, state }`.
- `getState()` — re-reads and revalidates the on-disk cache; returns the current
  `VocabularyState`.
- `clear()` — purges the cache; returns the resulting empty `VocabularyState`.

See `app/src/shared/vocabulary-contract.ts` for the exact types and channel names.

## Failure modes

- **Oversized file, malformed JSON, duplicate key, unsafe key, wrong schema version, disallowed
  field, wrong `terms` shape, too many entries, non-string value, or an over-length key/value:**
  the file is rejected outright with the specific reason from the table above; whatever
  dictionary (or empty state) was previously in effect remains unchanged.
- **Cache corrupted or deleted out from under the app between loads:** the next `getState()` /
  `loadVocabularyFromDisk()` call revalidates it, finds it invalid, and falls back to the empty
  state rather than crashing or applying a partial dictionary.
- **User cancels the file picker:** reported as `{ ok: true, cancelled: true, error: null }` —
  never treated as, or displayed as, an error.
- **Write interrupted (e.g. the transient Windows sharing-violation codes on rename):** handled
  by `atomicWriteFile`'s existing bounded retry; if every retry is exhausted, the write throws
  and the previous cache (if any) is left untouched, since the atomic write never partially
  overwrites the destination.

## Security considerations

- **Local-only, always.** Parsing, validation, replacement, and caching make zero network
  requests. Nothing about this feature reaches outside the machine.
- **Never logged, exported, or otherwise leaked.** The vocabulary must never appear in logs,
  telemetry, crash reports, diagnostics, screenshots, the clipboard, local history snapshots, or
  any exported file. Where an export would otherwise include user-facing text that vocabulary
  affects, the export states plainly that vocabulary substitution was not carried into it, rather
  than silently dropping the fact.
- **Prototype-pollution guard.** `__proto__`, `constructor`, and `prototype` are rejected as
  object keys anywhere in the payload, at parse time, before the parsed value could ever be
  merged into another object.
- **Bounded parsing cost.** File size, entry count, and nesting depth are all capped before or
  during parsing, so a hostile file cannot force unbounded memory use or recursion.
- **Fail closed.** Every rejection path (missing file, corrupt cache, invalid upload) resolves to
  the original shipped wording — never a half-applied dictionary.

## Verification status

`app/src/shared/vocabulary-contract.ts`, `app/src/main/vocabulary.ts`, and
`app/src/renderer/vocabulary-apply.ts` implement validation, storage, and the replacement
boundary, and are wired into `app/src/main/ipc.ts` and `app/src/preload/index.ts`. Verified with
`npx tsc --noEmit` and a payload-free Node smoke script covering the validation table above (see
that script's own output for the exact cases exercised); no automated test framework was added.
**Not yet wired into the renderer's Settings UI** — see the wiring note in the implementing
agent's report for what the Settings surface (currently a mocked `settingAction('vocab')` in the
design reference) needs to call.
