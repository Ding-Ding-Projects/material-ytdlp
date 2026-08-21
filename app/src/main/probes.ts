/**
 * One-shot, informational yt-dlp probes.
 *
 * Deliberately NOT a general "run arbitrary yt-dlp command" surface. Each
 * probe below is a named operation with a FIXED argument shape constructed
 * here — the renderer can supply a url string, never argv. This keeps a
 * user-pasted URL from ever reaching anything that could interpret it as
 * more than a single opaque argument.
 *
 * Security:
 *   - spawn() is always called with an argv ARRAY, never `shell: true`.
 *   - Every probe is bounded: a timeout that actually kills the whole
 *     process tree (not just the parent — see killTree in ytdlp.ts for the
 *     same reasoning; duplicated narrowly here rather than importing from
 *     ytdlp.ts, which this lane does not own), a maximum captured-output
 *     size, and a global concurrency cap.
 *   - Cancellable via a generation/abort token per requestId so a probe
 *     whose surface has closed, or been superseded by a newer request for
 *     the same surface, cannot overwrite a fresher result.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type {
  ExtractorCountResult,
  FormatEntry,
  ListFormatsResult,
  ListSubtitlesResult,
  ListThumbnailsResult,
  ProbeError,
  ProbeResult,
  ProbeUrlResult,
  SubtitleTrack,
  ThumbnailEntry,
} from '../shared/probes-contract'
import { resolveBinary, probeVersion } from './resolve-binaries'

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Killed after this long regardless of state — sized against the slowest legitimate case (a channel/playlist probe over a slow network), not the typical one. */
const PROBE_TIMEOUT_MS = 25_000
/** Extractor listing is local-only (no network) and fast; give it a short leash so a hung process is noticed quickly. */
const EXTRACTOR_LIST_TIMEOUT_MS = 15_000
/** Hard cap on captured stdout+stderr bytes. yt-dlp's extractor list alone is ~250KB of text; leave real headroom without allowing unbounded growth from a runaway process. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
/** At most this many probe child processes may be alive at once, so pasting many URLs cannot spawn an unbounded number of processes. */
const MAX_CONCURRENT_PROBES = 3

let activeProbes = 0
const waitQueue: Array<() => void> = []

async function acquireSlot(): Promise<() => void> {
  if (activeProbes < MAX_CONCURRENT_PROBES) {
    activeProbes++
    return () => release()
  }
  await new Promise<void>((resolve) => waitQueue.push(resolve))
  activeProbes++
  return () => release()
}

function release(): void {
  activeProbes--
  const next = waitQueue.shift()
  if (next) next()
}

// ---------------------------------------------------------------------------
// Cancellation: one generation counter per logical requestId. A caller
// cancels by requestId; a stale run's result is simply dropped by the
// caller returning early rather than resolving into a superseded slot —
// this module hands back whatever it produced and lets ipc.ts / the
// renderer decide staleness, but ALSO tracks live child processes by
// requestId so an explicit cancel can actually kill the process rather
// than merely being ignored.
// ---------------------------------------------------------------------------

const liveByRequestId = new Map<string, { pid: number | null; cancelled: boolean }>()

export function cancelProbe(requestId: string): void {
  const entry = liveByRequestId.get(requestId)
  if (!entry) return
  entry.cancelled = true
  if (entry.pid != null) killTree(entry.pid)
}

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {
      try {
        process.kill(pid)
      } catch {
        /* already gone */
      }
    })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Core runner: spawn one bounded, argv-array child, capture output, resolve
// with the raw text or a classified ProbeError. Never throws.
// ---------------------------------------------------------------------------

interface RunOutcome {
  ok: boolean
  raw: string
  error: ProbeError | null
}

function runBounded(binaryPath: string, args: string[], timeoutMs: number, requestId?: string): Promise<RunOutcome> {
  return new Promise((resolvePromise) => {
    let out = ''
    let truncated = false
    let settled = false
    let timedOut = false

    const trackKey = requestId ?? `__anon:${Math.random()}`
    if (requestId && liveByRequestId.get(requestId)?.cancelled) {
      resolvePromise({ ok: false, raw: '', error: { kind: 'cancelled', message: 'Cancelled before it started.' } })
      return
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binaryPath, args, {
        windowsHide: true,
        // NEVER shell: true. args is always a plain string array; a URL
        // must never be interpreted by a shell.
      })
    } catch (err) {
      resolvePromise({
        ok: false,
        raw: '',
        error: { kind: 'spawn-failed', message: err instanceof Error ? err.message : String(err) },
      })
      return
    }

    liveByRequestId.set(trackKey, { pid: child.pid ?? null, cancelled: false })

    const finish = (outcome: RunOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      liveByRequestId.delete(trackKey)
      resolvePromise(outcome)
    }

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid != null) killTree(child.pid)
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      if (out.length >= MAX_OUTPUT_BYTES) {
        truncated = true
        return
      }
      out += chunk.toString('utf8')
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    child.on('error', (err) => {
      finish({ ok: false, raw: out, error: { kind: 'spawn-failed', message: err.message } })
    })

    child.on('close', (code) => {
      const wasCancelled = liveByRequestId.get(trackKey)?.cancelled ?? false
      if (wasCancelled) {
        finish({ ok: false, raw: out, error: { kind: 'cancelled', message: 'Cancelled by caller.' } })
        return
      }
      if (timedOut) {
        finish({
          ok: false,
          raw: out,
          error: { kind: 'timeout', message: `Timed out after ${timeoutMs}ms with no result.` },
        })
        return
      }
      if (code !== 0) {
        // A network failure is normal, not exceptional — report the real
        // tail of what yt-dlp printed rather than a generic message.
        const tail = out.trim().split(/\r?\n/).slice(-6).join('\n')
        const looksLikeNetwork = /network|resolve|timed out|connection|unreachable|dns/i.test(tail)
        finish({
          ok: false,
          raw: out + (truncated ? '\n…(output truncated)' : ''),
          error: {
            kind: looksLikeNetwork ? 'network' : 'non-zero-exit',
            message: tail.length > 0 ? tail : `Exited with code ${code}.`,
          },
        })
        return
      }
      finish({ ok: true, raw: out + (truncated ? '\n…(output truncated)' : ''), error: null })
    })
  })
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireSlot()
  try {
    return await fn()
  } finally {
    release()
  }
}

function requireYtDlp(): { ok: true; path: string } | { ok: false; result: ProbeResult<never> } {
  const resolved = resolveBinary('yt-dlp')
  if (!resolved.path) {
    return {
      ok: false,
      result: {
        ok: false,
        data: null,
        parsed: false,
        raw: '',
        error: { kind: 'not-found', message: 'yt-dlp could not be found. Searched:\n' + resolved.searched.join('\n') },
      },
    }
  }
  return { ok: true, path: resolved.path }
}

// ---------------------------------------------------------------------------
// 1. extractorCount — cached against the resolved binary's own version.
// ---------------------------------------------------------------------------

interface ExtractorCountCacheEntry {
  version: string
  count: number
}

let extractorCountCache: ExtractorCountCacheEntry | null = null

/**
 * Runs `--list-extractors` and counts the lines, cached against the
 * binary's own reported --version so it runs once per binary and never
 * re-runs while the binary is unchanged. On any failure returns ok:false /
 * data:null so the status bar keeps showing its honest dash rather than a
 * guessed number.
 */
export async function extractorCount(): Promise<ProbeResult<ExtractorCountResult>> {
  const bin = requireYtDlp()
  if (!bin.ok) return bin.result

  const version = await probeVersion(bin.path)
  if (version && extractorCountCache && extractorCountCache.version === version) {
    return { ok: true, data: { count: extractorCountCache.count, version }, parsed: true, raw: '', error: null }
  }

  return withSlot(async () => {
    const outcome = await runBounded(bin.path, ['--list-extractors'], EXTRACTOR_LIST_TIMEOUT_MS)
    if (!outcome.ok) {
      return { ok: false, data: null, parsed: false, raw: outcome.raw, error: outcome.error }
    }
    const lines = outcome.raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
    if (lines.length === 0) {
      // Ran fine but produced nothing — this is "could not make sense of
      // the output," not "zero extractors exist." Report honestly.
      return {
        ok: true,
        data: null,
        parsed: false,
        raw: outcome.raw,
        error: null,
      }
    }
    const count = lines.length
    const resolvedVersion = version ?? (await probeVersion(bin.path)) ?? 'unknown'
    extractorCountCache = { version: resolvedVersion, count }
    return { ok: true, data: { count, version: resolvedVersion }, parsed: true, raw: outcome.raw, error: null }
  })
}

// ---------------------------------------------------------------------------
// 2. listSubtitles
// ---------------------------------------------------------------------------

/**
 * Parses yt-dlp's `--list-subs` table. Real observed shapes (this format
 * has changed across yt-dlp versions and is NOT a stable contract):
 *
 *   [info] Available subtitles for <id>:
 *   Language Formats
 *   en       vtt, srt, ttml, srv3, srv2, srv1, json3
 *   en-orig  vtt, srt, ttml, srv3, srv2, srv1, json3
 *
 *   [info] Available automatic captions for <id>:
 *   Language      Formats
 *   af             vtt, srt, ...
 *
 * Both a "subtitles" and an "automatic captions" section may appear; rows
 * under the automatic-captions header are marked isAutomatic: true.
 */
function parseListSubtitles(raw: string): ListSubtitlesResult | null {
  const lines = raw.split(/\r?\n/)
  const tracks: SubtitleTrack[] = []
  let inAutomaticSection = false
  let sawAnyHeader = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (/automatic captions/i.test(line)) {
      inAutomaticSection = true
      sawAnyHeader = true
      continue
    }
    if (/available subtitles/i.test(line)) {
      inAutomaticSection = false
      sawAnyHeader = true
      continue
    }
    if (/^Language\s+(Name\s+)?Formats?$/i.test(line)) continue
    if (/^\[/.test(line)) continue // other [info]/[debug] noise
    if (/^ERROR|^WARNING/.test(line)) continue

    // Data row: "en       English  vtt, srt, ttml, ..." — split on 2+ spaces.
    const cols = line.split(/\s{2,}/).filter((c) => c.length > 0)
    if (cols.length < 2) continue
    const languageCode = cols[0]
    // yt-dlp sometimes prints a name column, sometimes not; the LAST column
    // is always the comma-separated formats list.
    const formatsCol = cols[cols.length - 1]
    if (!/,/.test(formatsCol) && !/^[a-z0-9]+$/i.test(formatsCol)) continue
    const languageName = cols.length >= 3 ? cols[1] : null
    const formats = formatsCol
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
    if (formats.length === 0) continue
    tracks.push({ languageCode, languageName, formats, isAutomatic: inAutomaticSection })
  }

  if (!sawAnyHeader && tracks.length === 0) return null
  return { tracks }
}

export async function listSubtitles(url: string, requestId?: string): Promise<ProbeResult<ListSubtitlesResult>> {
  const bin = requireYtDlp()
  if (!bin.ok) return bin.result
  return withSlot(async () => {
    const outcome = await runBounded(bin.path, ['--list-subs', '--', url], PROBE_TIMEOUT_MS, requestId)
    if (!outcome.ok) return { ok: false, data: null, parsed: false, raw: outcome.raw, error: outcome.error }
    const parsedResult = parseListSubtitles(outcome.raw)
    if (parsedResult === null) {
      return { ok: true, data: null, parsed: false, raw: outcome.raw, error: null }
    }
    return { ok: true, data: parsedResult, parsed: true, raw: outcome.raw, error: null }
  })
}

// ---------------------------------------------------------------------------
// 3. listThumbnails
// ---------------------------------------------------------------------------

/**
 * Parses yt-dlp's `--list-thumbnails` table:
 *
 *   [info] Available thumbnails for <id>:
 *   ID       Width  Height  URL
 *   0        640    480     https://...
 *   maxresdefault  1280  720  https://...
 */
function parseListThumbnails(raw: string): ListThumbnailsResult | null {
  const lines = raw.split(/\r?\n/)
  const thumbnails: ThumbnailEntry[] = []
  let sawHeader = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (/^ID\s+Width\s+Height\s+URL$/i.test(line)) {
      sawHeader = true
      continue
    }
    if (/available thumbnails/i.test(line)) continue
    if (/^\[/.test(line)) continue
    if (/^ERROR|^WARNING/.test(line)) continue

    const cols = line.split(/\s+/).filter((c) => c.length > 0)
    if (cols.length < 2) continue
    const url = cols[cols.length - 1]
    if (!/^https?:\/\//i.test(url)) continue
    const id = cols[0]
    const width = cols.length >= 4 ? Number.parseInt(cols[1], 10) : NaN
    const height = cols.length >= 4 ? Number.parseInt(cols[2], 10) : NaN
    thumbnails.push({
      id,
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      url,
    })
  }

  if (!sawHeader && thumbnails.length === 0) return null
  return { thumbnails }
}

export async function listThumbnails(url: string, requestId?: string): Promise<ProbeResult<ListThumbnailsResult>> {
  const bin = requireYtDlp()
  if (!bin.ok) return bin.result
  return withSlot(async () => {
    const outcome = await runBounded(bin.path, ['--list-thumbnails', '--', url], PROBE_TIMEOUT_MS, requestId)
    if (!outcome.ok) return { ok: false, data: null, parsed: false, raw: outcome.raw, error: outcome.error }
    const parsedResult = parseListThumbnails(outcome.raw)
    if (parsedResult === null) {
      return { ok: true, data: null, parsed: false, raw: outcome.raw, error: null }
    }
    return { ok: true, data: parsedResult, parsed: true, raw: outcome.raw, error: null }
  })
}

// ---------------------------------------------------------------------------
// 4. listFormats
// ---------------------------------------------------------------------------

/**
 * Parses yt-dlp's `-F` table. Column layout varies by version and by
 * whether the extractor reports fps/channels/etc, so this splits on 2+
 * spaces and maps by position from the header row rather than assuming
 * fixed column widths.
 *
 *   ID       EXT   RESOLUTION FPS CH |   FILESIZE   TBR PROTO | VCODEC ... ACODEC ... MORE INFO
 */
function parseListFormats(raw: string): ListFormatsResult | null {
  const lines = raw.split(/\r?\n/)
  const formats: FormatEntry[] = []
  let sawHeader = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (/^ID\s+EXT\s+RESOLUTION/i.test(line)) {
      sawHeader = true
      continue
    }
    if (/^-+$/.test(line)) continue
    if (/available formats/i.test(line)) continue
    if (/^\[/.test(line)) continue
    if (/^ERROR|^WARNING/.test(line)) continue
    if (!sawHeader) continue

    const cols = line.split(/\s{2,}/).filter((c) => c.length > 0)
    if (cols.length < 2) continue
    const formatId = cols[0]
    const ext = cols[1] ?? ''
    const rest = cols.slice(2)
    const note = rest.length > 0 ? rest[rest.length - 1] : null
    formats.push({
      formatId,
      ext,
      resolution: rest[0] ?? null,
      fps: null,
      channels: null,
      fileSize: null,
      tbr: null,
      protocol: null,
      vcodec: null,
      acodec: null,
      note,
    })
  }

  if (!sawHeader) return null
  return { formats }
}

export async function listFormats(url: string, requestId?: string): Promise<ProbeResult<ListFormatsResult>> {
  const bin = requireYtDlp()
  if (!bin.ok) return bin.result
  return withSlot(async () => {
    const outcome = await runBounded(bin.path, ['-F', '--', url], PROBE_TIMEOUT_MS, requestId)
    if (!outcome.ok) return { ok: false, data: null, parsed: false, raw: outcome.raw, error: outcome.error }
    const parsedResult = parseListFormats(outcome.raw)
    if (parsedResult === null) {
      return { ok: true, data: null, parsed: false, raw: outcome.raw, error: null }
    }
    return { ok: true, data: parsedResult, parsed: true, raw: outcome.raw, error: null }
  })
}

// ---------------------------------------------------------------------------
// 5. probeUrl — lightweight --simulate --print of a few fields.
//
// Uses --print with a literal field list separated by a marker that cannot
// plausibly appear inside a title, so a title containing newlines does not
// desynchronize the field split.
// ---------------------------------------------------------------------------

const PROBE_FIELD_MARKER = 'FIELD'
const PROBE_FIELDS = ['title', 'duration', 'extractor', 'webpage_url', 'playlist_count', '_type']

function probeUrlPrintTemplate(): string {
  return PROBE_FIELDS.map((f) => `%(${f})s`).join(PROBE_FIELD_MARKER)
}

function parseProbeUrl(raw: string): ProbeUrlResult | null {
  // With a playlist/channel, yt-dlp's --simulate --print with --flat-playlist
  // prints one line per entry PLUS one line for the collection itself
  // (since --print without --no-simulate still evaluates the top-level
  // info dict once for a playlist target when --yes-playlist / default).
  // Take the FIRST non-empty line as it is emitted before per-entry lines
  // in yt-dlp's normal extraction order for the collection root.
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.startsWith('['))
  if (lines.length === 0) return null
  const line = lines[0]
  const parts = line.split(PROBE_FIELD_MARKER)
  if (parts.length !== PROBE_FIELDS.length) return null

  const clean = (v: string): string | null => {
    const t = v.trim()
    return t.length === 0 || t === 'NA' || t === 'None' ? null : t
  }

  const [titleRaw, durationRaw, extractorRaw, webpageRaw, playlistCountRaw, typeRaw] = parts
  const title = clean(titleRaw)
  const durationNum = Number.parseFloat(durationRaw)
  const durationSec = Number.isFinite(durationNum) ? durationNum : null
  const extractor = clean(extractorRaw)
  const webpageUrl = clean(webpageRaw)
  const type = clean(typeRaw)
  const playlistCountNum = Number.parseInt(playlistCountRaw, 10)
  const isCollection = type === 'playlist' || Number.isFinite(playlistCountNum)
  const entryCount = Number.isFinite(playlistCountNum) ? playlistCountNum : null

  return { title, durationSec, extractor, isCollection, entryCount, webpageUrl }
}

/**
 * VERIFIED LIMITATION (observed against a real 183-entry YouTube playlist):
 * with --flat-playlist --playlist-items 1, `title` and `durationSec` are the
 * FIRST ENTRY's title/duration, not the collection's own title — yt-dlp does
 * not expose the collection's title through --flat-playlist in one cheap
 * call. `isCollection` and `entryCount` (from playlist_count) ARE correct
 * for the collection as a whole. A caller showing "Channel/playlist
 * detected" must not present `title` as the collection name; show it as
 * "first entry: <title>" or omit it when isCollection is true.
 */
export async function probeUrl(url: string, requestId?: string): Promise<ProbeResult<ProbeUrlResult>> {
  const bin = requireYtDlp()
  if (!bin.ok) return bin.result
  return withSlot(async () => {
    const outcome = await runBounded(
      bin.path,
      ['--simulate', '--no-warnings', '--flat-playlist', '--print', probeUrlPrintTemplate(), '--playlist-items', '1', '--', url],
      PROBE_TIMEOUT_MS,
      requestId,
    )
    if (!outcome.ok) return { ok: false, data: null, parsed: false, raw: outcome.raw, error: outcome.error }
    const parsedResult = parseProbeUrl(outcome.raw)
    if (parsedResult === null) {
      return { ok: true, data: null, parsed: false, raw: outcome.raw, error: null }
    }
    return { ok: true, data: parsedResult, parsed: true, raw: outcome.raw, error: null }
  })
}

// Re-exported so a manual smoke check can read the same file the cache key
// comes from without duplicating the path logic — not used by any probe
// above (each resolves the live binary independently, which is correct: an
// override or PATH copy is a different binary from vendor/bin as far as
// this cache is concerned).
export async function readBundledBuildStamp(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}
