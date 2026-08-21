import { spawn, type ChildProcess } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import {
  IpcEvent,
  type JobCapabilities,
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

function parseProgressLine(line: string): JobProgress | null {
  const idx = line.indexOf(PROGRESS_MARKER)
  if (idx === -1) return null
  const rest = line.slice(idx + PROGRESS_MARKER.length)
  const parts = rest.split('|')
  const [status, pct, rate, size, eta, fragIndex, fragCount] = parts
  const na = (v: string | undefined) => (v === undefined || v === 'NA' ? null : v)
  return {
    status: na(status),
    pct: na(pct),
    rate: na(rate),
    size: na(size),
    eta: na(eta),
    frags: fragIndex && fragCount && fragIndex !== 'NA' && fragCount !== 'NA' ? `${fragIndex}/${fragCount}` : null,
  }
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
      progress: { status: null, pct: null, rate: null, size: null, eta: null, frags: null },
      exitCode: null,
      createdAt: now,
      updatedAt: now,
    }
    this.jobs.set(req.id, { record, child: null, binaryPath })
    this.spawnFor(req.id, req.argv)
    return record
  }

  private spawnFor(id: string, argv: string[]): void {
    const job = this.jobs.get(id)
    if (!job) return

    const fullArgv = [...argv, ...progressFlags()]
    const child = spawn(job.binaryPath, fullArgv, {
      cwd: job.record.cwd ?? undefined,
      windowsHide: true,
      // NEVER shell: true — a URL (or a maliciously crafted filename/title
      // template) must never reach a shell for interpretation.
    })
    job.child = child
    this.setState(id, 'running')

    const emitLog = (text: string) => {
      const idx = text.indexOf(PROGRESS_MARKER)
      if (idx !== -1) {
        const progress = parseProgressLine(text)
        if (progress) this.emitProgress(id, progress)
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
