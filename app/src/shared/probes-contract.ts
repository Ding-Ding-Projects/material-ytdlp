/**
 * Shared IPC contract for one-shot, informational yt-dlp probes.
 *
 * TYPES ONLY — must never import `electron` at runtime, so both the main
 * process and the renderer (via the preload bridge) can import it safely.
 *
 * These are narrow, purpose-built queries, each with a fixed argument shape
 * constructed by the main process. This is deliberately NOT a general
 * "run an arbitrary command" surface: the renderer can never supply argv.
 */

export const ProbesIpcChannel = {
  ExtractorCount: 'probes:extractor-count',
  ListSubtitles: 'probes:list-subtitles',
  ListThumbnails: 'probes:list-thumbnails',
  ListFormats: 'probes:list-formats',
  ProbeUrl: 'probes:probe-url',
  Cancel: 'probes:cancel',
} as const

export type ProbesIpcChannelName = (typeof ProbesIpcChannel)[keyof typeof ProbesIpcChannel]

// ---------------------------------------------------------------------------
// Shared envelope
//
// Parsing yt-dlp's human-formatted list output is inherently best-effort —
// its exact layout is not a stable contract and changes between versions.
// Every probe that parses output returns BOTH the structured result (when
// parsing succeeded) and the raw text, plus an honest `parsed` flag. A
// probe that could not parse must never return an empty array: an empty
// array reads as "there are none" (e.g. "no subtitles exist"), which is a
// completely different fact from "yt-dlp's output did not match what this
// parser expects." Those two states must never be conflated.
// ---------------------------------------------------------------------------

export interface ProbeError {
  /** Coarse classification so the UI can decide how to react. */
  kind: 'not-found' | 'network' | 'timeout' | 'cancelled' | 'spawn-failed' | 'non-zero-exit' | 'unknown'
  /** The real error text (stderr tail, exception message) — never fabricated. */
  message: string
}

export interface ProbeResult<T> {
  ok: boolean
  /** Present only when ok and parsing succeeded. */
  data: T | null
  /** Whether the raw text could be parsed into `data`. False with ok:true means "ran fine, could not parse". */
  parsed: boolean
  /** The verbatim stdout+stderr tail, always present on a completed run (even a failed one), for diagnosis and as a fallback view. */
  raw: string
  /** Present only when ok is false. */
  error: ProbeError | null
}

// ---------------------------------------------------------------------------
// extractorCount
// ---------------------------------------------------------------------------

export interface ExtractorCountResult {
  count: number
  /** The yt-dlp version string this count was measured against (cache key). */
  version: string
}

// ---------------------------------------------------------------------------
// listSubtitles
// ---------------------------------------------------------------------------

export interface SubtitleTrack {
  languageCode: string
  languageName: string | null
  /** e.g. ["vtt", "srt", "ass"] — formats offered for this language. */
  formats: string[]
  /** yt-dlp marks some tracks as auto-generated ("have not been requested"). */
  isAutomatic: boolean
}

export interface ListSubtitlesResult {
  tracks: SubtitleTrack[]
}

// ---------------------------------------------------------------------------
// listThumbnails
// ---------------------------------------------------------------------------

export interface ThumbnailEntry {
  id: string
  width: number | null
  height: number | null
  url: string
}

export interface ListThumbnailsResult {
  thumbnails: ThumbnailEntry[]
}

// ---------------------------------------------------------------------------
// listFormats
// ---------------------------------------------------------------------------

export interface FormatEntry {
  formatId: string
  ext: string
  resolution: string | null
  fps: number | null
  channels: string | null
  fileSize: string | null
  tbr: string | null
  protocol: string | null
  vcodec: string | null
  acodec: string | null
  note: string | null
}

export interface ListFormatsResult {
  formats: FormatEntry[]
}

// ---------------------------------------------------------------------------
// probeUrl
// ---------------------------------------------------------------------------

export interface ProbeUrlResult {
  title: string | null
  durationSec: number | null
  extractor: string | null
  /** True when yt-dlp reports this URL as a playlist/channel (multiple entries). */
  isCollection: boolean
  /** Entry count for a collection; null for a single item or when unknown. */
  entryCount: number | null
  webpageUrl: string | null
}

// ---------------------------------------------------------------------------
// Request/response shapes
// ---------------------------------------------------------------------------

export interface ProbeUrlRequest {
  /** Caller-chosen id so a superseded probe's late result can be ignored by generation, not overwrite a newer one. */
  requestId: string
  url: string
}

export interface ProbeCancelRequest {
  requestId: string
}
