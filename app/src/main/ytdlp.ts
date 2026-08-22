import { spawn, type ChildProcess } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import {
  IpcEvent,
  type JobCapabilities,
  type JobHistoryEntry,
  type JobLogEvent,
  type JobProgress,
  type JobProgressEvent,
  type JobRecord,
  type JobState,
  type JobStateEvent,
  type LogLevel,
  type PauseMode,
  type StartJobRequest,
} from '../shared/ipc-contract'
import { getStore } from './store'

// ---------------------------------------------------------------------------
// Progress template
//
// Machine-readable progress, never scraped from the human progress bar. Every
// line yt-dlp prints that begins with the PROGRESS_MARKER is parsed into a
// structured JobProgress; every other line is plain console output.
// ---------------------------------------------------------------------------

const PROGRESS_MARKER = '[[PROGRESS]]'

const PROGRESS_TEMPLATE =
  `download:${PROGRESS_MARKER}%(progress.status)s|%(progress._percent_str)s|` +
  `%(progress._speed_str)s|%(progress._total_bytes_str)s|%(progress._eta_str)s|` +
  `%(progress.fragment_index)s|%(progress.fragment_count)s|%(info.id)s`

function progressFlags(): string[] {
  return ['--newline', '--progress-template', PROGRESS_TEMPLATE]
}

// ---------------------------------------------------------------------------
// History metadata capture
//
// Job history (JobHistoryEntry, appended on finish() below) wants to say
// what was actually downloaded — title, uploader, extractor, video id,
// duration, the real output path — not just that a job id finished. None of
// that is on the progress template above, so it is captured separately via
// six `--print after_move:...` flags: yt-dlp's `after_move` hook fires once
// per completed item, AFTER any merge/post-processing step has already
// written the file to its final location, so %(filepath)s there names the
// real file rather than a ".part" temporary.
//
// Six SEPARATE `--print` flags rather than one pipe-delimited template
// deliberately: title/uploader/filepath are free-form strings that can
// contain a literal "|", which would corrupt a single delimited line with
// no reliable way to tell which field it belonged to. One marker per field,
// each on its own line, has no such ambiguity — the same reasoning that
// keeps PROGRESS_MARKER's own fields to values that cannot contain '|'.
//
// A playlist/channel job fires these six lines once per item; this layer
// keeps only the LATEST set seen before the process exits (see
// parseHistoryMetaLine's caller in spawnFor), so a multi-item job's history
// entry describes its last completed item rather than its first. That is a
// deliberate simplification, not a bug: a full per-item history is future
// work, not what JobHistoryEntry (one entry per job run) models today.
// ---------------------------------------------------------------------------

const HISTORY_MARKERS = {
  title: '[[HIST_TITLE]]',
  uploader: '[[HIST_UPLOADER]]',
  extractor: '[[HIST_EXTRACTOR]]',
  durationSec: '[[HIST_DURATION]]',
  outputPath: '[[HIST_FILEPATH]]',
  videoId: '[[HIST_ID]]',
} as const

type HistoryMetaKey = keyof typeof HISTORY_MARKERS

/** Maps a HistoryMeta key to the yt-dlp output-template field name it is printed from, for the (rare) keys where they differ. */
const HISTORY_TEMPLATE_FIELD: Partial<Record<HistoryMetaKey, string>> = {
  durationSec: 'duration',
  videoId: 'id',
}

export interface HistoryMeta {
  title: string | null
  uploader: string | null
  extractor: string | null
  durationSec: number | null
  outputPath: string | null
  /** yt-dlp's own %(id)s for this media, e.g. a YouTube video id. Paired with `extractor` this is the same "extractor id" shape yt-dlp uses for --download-archive lines. */
  videoId: string | null
}

export function emptyHistoryMeta(): HistoryMeta {
  return { title: null, uploader: null, extractor: null, durationSec: null, outputPath: null, videoId: null }
}

function historyPrintFlags(): string[] {
  const flags: string[] = []
  for (const key of Object.keys(HISTORY_MARKERS) as HistoryMetaKey[]) {
    const field = HISTORY_TEMPLATE_FIELD[key] ?? key
    flags.push('--print', `after_move:${HISTORY_MARKERS[key]}%(${field})s`)
  }
  return flags
}

/**
 * yt-dlp prints "NA" for a `%()s` field it cannot resolve (same convention
 * documented on parseRawProgressLine's `na` helper above — duplicated here
 * rather than shared, since the two parsers have no other code in common
 * and this keeps that battle-tested progress parser untouched).
 */
function naHistoryField(v: string): string | null {
  const trimmed = v.trim()
  return trimmed === '' || trimmed === 'NA' || trimmed === 'None' ? null : trimmed
}

/**
 * Recognizes one `[[HIST_*]]`-prefixed line and returns which HistoryMeta
 * field it carries plus its normalized value, or null when the line carries
 * none of the six markers at all (i.e. it is ordinary yt-dlp output).
 */
export function parseHistoryMetaLine(line: string): { key: HistoryMetaKey; value: string | number | null } | null {
  for (const key of Object.keys(HISTORY_MARKERS) as HistoryMetaKey[]) {
    const marker = HISTORY_MARKERS[key]
    const idx = line.indexOf(marker)
    if (idx === -1) continue
    const raw = naHistoryField(line.slice(idx + marker.length))
    if (key === 'durationSec') {
      const n = raw === null ? null : Math.round(parseFloat(raw))
      return { key, value: Number.isFinite(n) ? n : null }
    }
    return { key, value: raw }
  }
  return null
}

/**
 * Applies one parsed `[[HIST_*]]` field onto a job's accumulated metadata.
 * Written as an explicit switch (rather than a generic `meta[key] = value`
 * indexed assignment) so TypeScript can actually verify each field lands in
 * its correctly-typed slot instead of trusting a same-shaped cast.
 */
function applyHistoryMetaField(meta: HistoryMeta, field: { key: HistoryMetaKey; value: string | number | null }): void {
  if (field.key === 'durationSec') {
    meta.durationSec = typeof field.value === 'number' ? field.value : null
    return
  }
  meta[field.key] = typeof field.value === 'string' ? field.value : null
}

/**
 * Splits one `[[PROGRESS]]`-prefixed line into its raw, unaggregated fields.
 * Returns null when the line does not carry the marker at all.
 *
 * yt-dlp reports several of these fields as the literal strings "NA" or
 * "Unknown" when the value is not knowable yet (very common on fragmented
 * DASH/HLS streams, where total size and ETA are unknown until enough
 * fragments have been seen). Those are normalized to null here rather than
 * coerced into 0 or NaN: a size of NaN rendered in the UI reads as a broken
 * app, while null lets the surface honestly show nothing.
 */
export function parseRawProgressLine(line: string): RawProgressFields | null {
  const idx = line.indexOf(PROGRESS_MARKER)
  if (idx === -1) return null
  const rest = line.slice(idx + PROGRESS_MARKER.length)
  const [status, pct, rate, size, eta, fragIndex, fragCount] = rest.split('|')
  // yt-dlp right-pads/left-pads several of these fields with spaces for
  // fixed-width alignment even inside a custom --progress-template (real
  // observed output: "   803.01B/s", "       N/A") — trim before comparing
  // against or storing a value, or padding survives into the UI and an
  // "N/A" with leading spaces fails to match the sentinel below.
  // yt-dlp prints "N/A" (with the slash) for an unknown _total_bytes_str and
  // "NA" for some other unknown numeric fields, plus "Unknown" for
  // _eta_str — accept all three rather than only one spelling.
  const na = (v: string | undefined) => {
    const trimmed = v?.trim() ?? ''
    return trimmed === '' || trimmed === 'NA' || trimmed === 'N/A' || trimmed === 'Unknown' ? null : trimmed
  }
  return {
    status: na(status),
    percentStr: na(pct),
    rate: na(rate),
    size: na(size),
    eta: na(eta),
    fragmentIndexStr: na(fragIndex),
    fragmentCountStr: na(fragCount),
  }
}

export interface RawProgressFields {
  status: string | null
  percentStr: string | null
  rate: string | null
  size: string | null
  eta: string | null
  fragmentIndexStr: string | null
  fragmentCountStr: string | null
}

/**
 * Per-job state carried between successive progress lines so `pct` can be
 * made monotonic within a download phase. Not part of the public contract —
 * this is purely bookkeeping for computeJobProgress.
 */
export interface ProgressPhaseState {
  /** The last fragment_index seen, or null once we are past fragmented output for this phase. */
  lastFragmentIndex: number | null
  /** Whether the last line seen carried fragment info at all (video/audio download vs. e.g. a merge step). */
  hadFragments: boolean
  /** The highest overall percentage computed so far in the current phase, used to prevent `pct` going backwards. */
  maxOverallPct: number | null
}

export function initialProgressPhaseState(): ProgressPhaseState {
  return { lastFragmentIndex: null, hadFragments: false, maxOverallPct: null }
}

function parseNumber(v: string | null): number | null {
  if (v === null) return null
  const n = parseFloat(v.replace('%', '').trim())
  return Number.isFinite(n) ? n : null
}

function parseInteger(v: string | null): number | null {
  if (v === null) return null
  const n = parseInt(v.trim(), 10)
  return Number.isFinite(n) ? n : null
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`
}

/**
 * Aggregates one raw progress line into the JobProgress the UI actually
 * binds to, plus the updated phase state to pass into the next call.
 *
 * WHY THIS EXISTS (do not "simplify" this back to `pct: raw.percentStr`):
 * yt-dlp's `progress._percent_str` on a fragmented download (DASH/HLS,
 * i.e. whenever fragment_count is set) is the percentage of the CURRENT
 * FRAGMENT, not of the file. With fragment_count=123 it counts 0% -> 100%
 * up to 123 separate times over the course of one download. A progress bar
 * wired straight to that field jitters wildly and repeatedly claims the
 * download finished. Real evidence from a fragmented DASH download:
 *
 *   downloading|100.0%|...|0|123|<id>   <- fragment 0 finishing
 *   downloading|  0.4%|...|1|123|<id>   <- fragment 1 starting: percent resets
 *   downloading|  4.0%|...|1|123|<id>
 *   downloading|  3.5%|...|1|123|<id>   <- even within one fragment, percent can wobble
 *
 * So: when fragment_count is a positive number, compute an overall
 * percentage as (fragment_index + fragmentPercent/100) / fragment_count *
 * 100, and clamp it to never go backwards within the current phase. A
 * download can have multiple phases (video stream, then audio stream, then
 * mux/merge) — fragment_index resets to a lower value at the start of a new
 * phase, which is treated here as a genuine phase boundary: the monotonic
 * clamp is reset rather than letting the new phase's low fragment_index get
 * clamped up against the old phase's high water mark.
 */
export function computeJobProgress(
  raw: RawProgressFields,
  state: ProgressPhaseState,
): { progress: JobProgress; nextState: ProgressPhaseState } {
  const fragmentIndex = parseInteger(raw.fragmentIndexStr)
  const fragmentCount = parseInteger(raw.fragmentCountStr)
  const fragmentPercent = parseNumber(raw.percentStr)
  const hasFragments = fragmentIndex !== null && fragmentCount !== null && fragmentCount > 0

  // A phase boundary is: fragment_index has gone backwards (a new fragmented
  // stream started), or fragment info disappeared/appeared entirely (moving
  // between a fragmented download step and a non-fragmented step such as a
  // merge). Either way, the old phase's high-water mark must not clamp the
  // new phase's readings.
  const fragmentIndexWentBackwards =
    state.lastFragmentIndex !== null && fragmentIndex !== null && fragmentIndex < state.lastFragmentIndex
  const fragmentPresenceChanged = state.hadFragments !== hasFragments
  const isNewPhase = fragmentIndexWentBackwards || fragmentPresenceChanged

  let overallPct: number | null
  if (hasFragments && fragmentPercent !== null) {
    overallPct = ((fragmentIndex + fragmentPercent / 100) / fragmentCount) * 100
  } else {
    overallPct = fragmentPercent
  }

  const priorMax = isNewPhase ? null : state.maxOverallPct
  const clampedPct = overallPct === null ? null : priorMax === null ? overallPct : Math.max(overallPct, priorMax)

  const nextState: ProgressPhaseState = {
    lastFragmentIndex: fragmentIndex,
    hadFragments: hasFragments,
    maxOverallPct: clampedPct === null ? state.maxOverallPct : clampedPct,
  }

  const progress: JobProgress = {
    status: raw.status,
    pct: clampedPct === null ? null : formatPct(clampedPct),
    fragmentPct: raw.percentStr,
    rate: raw.rate,
    size: raw.size,
    eta: raw.eta,
    frags: fragmentIndex !== null && fragmentCount !== null ? `${fragmentIndex}/${fragmentCount}` : null,
  }

  return { progress, nextState }
}

function classifyLogLevel(line: string): LogLevel {
  if (/ERROR/.test(line)) return 'error'
  if (/WARNING/.test(line)) return 'warn'
  return 'info'
}

// ---------------------------------------------------------------------------
// Line splitting for a streamed child process pipe: buffers partial lines
// across chunk boundaries and yields complete lines (both \n and \r as yt-dlp
// uses \r for in-place progress redraw before --newline normalizes it).
// ---------------------------------------------------------------------------

function makeLineSplitter(onLine: (line: string) => void) {
  let buffer = ''
  return (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let idx: number
    // eslint-disable-next-line no-cond-assign
    while ((idx = buffer.search(/[\r\n]/)) !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.length > 0) onLine(line)
    }
  }
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

interface InternalJob {
  record: JobRecord
  child: ChildProcess | null
  binaryPath: string
  /** Carried across progress lines within the current process run so `pct` can be made monotonic. Reset on every (re)spawn — see spawnFor. */
  phaseState: ProgressPhaseState
  /** Accumulated from `[[HIST_*]]` lines during the current process run (see parseHistoryMetaLine). Reset on every (re)spawn, same as phaseState. */
  historyMeta: HistoryMeta
}

/**
 * Pause/resume capability on this platform.
 *
 * Windows has no SIGSTOP/SIGCONT. A true suspend would require injecting
 * NtSuspendProcess via a native addon, which this layer does not carry, so
 * pause is honestly implemented as "stop the child process, and resume
 * respawns it with --continue (yt-dlp's own partial-download resume) rather
 * than actually freezing it in place." This is exposed as a capability flag
 * so the UI can describe the real behavior instead of claiming a suspend
 * that never happened.
 */
const PAUSE_MODE: PauseMode = process.platform === 'win32' ? 'stop-continue' : 'stop-continue'

export class YtDlpManager {
  private readonly jobs = new Map<string, InternalJob>()
  private getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
  }

  capabilities(): JobCapabilities {
    return { pauseMode: PAUSE_MODE }
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].map((j) => j.record)
  }

  get(id: string): JobRecord | null {
    return this.jobs.get(id)?.record ?? null
  }

  start(binaryPath: string, req: StartJobRequest): JobRecord {
    const now = Date.now()
    const record: JobRecord = {
      id: req.id,
      url: req.url,
      argv: req.argv,
      cwd: req.cwd ?? null,
      state: 'queued',
      progress: { status: null, pct: null, fragmentPct: null, rate: null, size: null, eta: null, frags: null },
      exitCode: null,
      createdAt: now,
      updatedAt: now,
    }
    this.jobs.set(req.id, {
      record,
      child: null,
      binaryPath,
      phaseState: initialProgressPhaseState(),
      historyMeta: emptyHistoryMeta(),
    })
    this.spawnFor(req.id, req.argv)
    return record
  }

  private spawnFor(id: string, argv: string[]): void {
    const job = this.jobs.get(id)
    if (!job) return

    const fullArgv = [...argv, ...progressFlags(), ...historyPrintFlags()]
    const child = spawn(job.binaryPath, fullArgv, {
      cwd: job.record.cwd ?? undefined,
      windowsHide: true,
      // NEVER shell: true — a URL (or a maliciously crafted filename/title
      // template) must never reach a shell for interpretation.
    })
    job.child = child
    // Each (re)spawn is its own process run — reset the monotonic-percent
    // bookkeeping so a resumed/retried job does not get clamped against a
    // high-water mark left over from a previous run. Same reasoning for
    // historyMeta: a retry that succeeds should record ITS OWN after_move
    // output, not metadata left over from an earlier failed attempt that
    // never reached that hook.
    job.phaseState = initialProgressPhaseState()
    job.historyMeta = emptyHistoryMeta()
    this.setState(id, 'running')

    const emitLog = (text: string) => {
      const historyField = parseHistoryMetaLine(text)
      if (historyField) {
        const current = this.jobs.get(id)
        if (current) applyHistoryMetaField(current.historyMeta, historyField)
        return
      }
      const raw = parseRawProgressLine(text)
      if (raw) {
        const current = this.jobs.get(id)
        if (!current) return
        const { progress, nextState } = computeJobProgress(raw, current.phaseState)
        current.phaseState = nextState
        this.emitProgress(id, progress)
        return
      }
      this.emitLog(id, text, classifyLogLevel(text))
    }

    child.stdout?.on('data', makeLineSplitter(emitLog))
    child.stderr?.on('data', makeLineSplitter(emitLog))

    child.on('error', (err) => {
      this.emitLog(id, `Failed to start: ${err.message}`, 'error')
      this.finish(id, 'error', null)
    })

    child.on('close', (code) => {
      const current = this.jobs.get(id)
      if (!current) return
      // A job that was explicitly cancelled or stopped-for-pause reports its
      // own state already; do not let a delayed 'close' event override it.
      if (current.record.state === 'cancelled' || current.record.state === 'paused') return
      // Never report success from spawn alone: the real exit code decides.
      this.finish(id, code === 0 ? 'done' : 'error', code)
    })
  }

  /** Cancel: kill the whole process tree, not just the parent. */
  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !job.child || job.child.pid == null) return
    killTree(job.child.pid)
    this.finish(id, 'cancelled', null)
  }

  /**
   * Pause. See PAUSE_MODE: this stops the child process; it does not suspend
   * it in place. Resuming respawns with --continue.
   */
  pause(id: string): void {
    const job = this.jobs.get(id)
    if (!job || !job.child || job.child.pid == null) return
    if (job.record.state !== 'running') return
    killTree(job.child.pid)
    job.child = null
    this.setState(id, 'paused')
  }

  resume(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.record.state !== 'paused') return
    const argv = job.record.argv.includes('--continue') ? job.record.argv : [...job.record.argv, '--continue']
    job.record.argv = argv
    this.spawnFor(id, argv)
  }

  retry(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.record.state === 'running' || job.record.state === 'paused') return
    this.spawnFor(id, job.record.argv)
  }

  remove(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.child && job.child.pid != null && (job.record.state === 'running' || job.record.state === 'paused')) {
      killTree(job.child.pid)
    }
    this.jobs.delete(id)
  }

  private finish(id: string, state: JobState, exitCode: number | null): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.record.exitCode = exitCode
    job.child = null
    this.setState(id, state, exitCode)
    this.recordHistory(id, state, exitCode)
  }

  /**
   * Appends one JobHistoryEntry for this run to the on-disk job history
   * (Store.appendJobHistory) — real title/uploader/extractor/duration/output
   * path when this run's `after_move` output supplied them, honest `null`
   * for whatever it did not. Fire-and-forget and never throws into a
   * caller: a history-recording failure must never take down the real job
   * it is trying to record, same principle the separate Git-backed
   * download-list history already applies in
   * app/src/main/ipc.ts's recordFromJobRecord.
   */
  private recordHistory(id: string, state: JobState, exitCode: number | null): void {
    const job = this.jobs.get(id)
    if (!job) return
    const entry: JobHistoryEntry = {
      id,
      url: job.record.url,
      argv: job.record.argv,
      state,
      exitCode,
      finishedAt: Date.now(),
      title: job.historyMeta.title,
      uploader: job.historyMeta.uploader,
      extractor: job.historyMeta.extractor,
      videoId: job.historyMeta.videoId,
      durationSec: job.historyMeta.durationSec,
      outputPath: job.historyMeta.outputPath,
      sizeLabel: job.record.progress.size,
    }
    void getStore()
      .appendJobHistory(entry)
      .catch((err) => {
        console.error('[job-history] appendJobHistory failed:', err)
      })
  }

  private setState(id: string, state: JobState, exitCode: number | null = null): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.record.state = state
    job.record.updatedAt = Date.now()
    if (exitCode !== null) job.record.exitCode = exitCode
    const event: JobStateEvent = { id, state, exitCode: job.record.exitCode }
    this.getWindow()?.webContents.send(IpcEvent.JobState, event)
  }

  private emitProgress(id: string, progress: JobProgress): void {
    const job = this.jobs.get(id)
    if (!job) return
    job.record.progress = progress
    job.record.updatedAt = Date.now()
    const event: JobProgressEvent = { id, progress }
    this.getWindow()?.webContents.send(IpcEvent.JobProgress, event)
  }

  private emitLog(id: string, text: string, level: LogLevel): void {
    const event: JobLogEvent = { id, text, level }
    this.getWindow()?.webContents.send(IpcEvent.JobLog, event)
  }
}

/**
 * Kill a process tree by pid. Killing only the parent leaves yt-dlp's own
 * ffmpeg/ffprobe children (and any muxing subprocess) running orphaned, so on
 * Windows this always goes through `taskkill /T /F` rather than a plain
 * process.kill().
 */
function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {
      // Best-effort: if taskkill itself cannot start, fall back to killing
      // just the parent rather than losing the signal entirely.
      try {
        process.kill(pid)
      } catch {
        /* process may already be gone */
      }
    })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* process may already be gone */
      }
    }
  }
}
