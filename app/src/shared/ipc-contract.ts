/**
 * Shared IPC contract between the main process and the renderer.
 *
 * This file is TYPES ONLY — it must never import anything from `electron`
 * at runtime, so both the main process and the renderer (via the preload
 * bridge) can import it without pulling in Node/Electron internals.
 */

// ---------------------------------------------------------------------------
// Channel names
// ---------------------------------------------------------------------------

/** Renderer -> main, request/response (ipcMain.handle / ipcRenderer.invoke). */
export const IpcChannel = {
  // Window controls (frameless window, custom title bar)
  WindowMinimize: 'window:minimize',
  WindowMaximize: 'window:maximize',
  WindowUnmaximize: 'window:unmaximize',
  WindowClose: 'window:close',
  WindowIsMaximized: 'window:is-maximized',

  // Binary resolution
  BinariesResolveAll: 'binaries:resolve-all',
  BinariesProbeVersion: 'binaries:probe-version',

  // yt-dlp job control
  JobStart: 'job:start',
  JobPause: 'job:pause',
  JobResume: 'job:resume',
  JobCancel: 'job:cancel',
  JobRetry: 'job:retry',
  JobRemove: 'job:remove',
  JobList: 'job:list',
  JobCapabilities: 'job:capabilities',

  // Dialogs
  DialogPickFolder: 'dialog:pick-folder',
  DialogPickFile: 'dialog:pick-file',
  DialogPickBatchFile: 'dialog:pick-batch-file',
  DialogPickInfoJson: 'dialog:pick-info-json',
  DialogPickCookiesFile: 'dialog:pick-cookies-file',
  DialogSaveFile: 'dialog:save-file',

  // Store / preferences
  StoreGetPreferences: 'store:get-preferences',
  StoreSetPreferences: 'store:set-preferences',
  StoreGetJobHistory: 'store:get-job-history',
  StoreAppendJobHistory: 'store:append-job-history',
  StoreGetLastPaths: 'store:get-last-paths',
  StoreSetLastPaths: 'store:set-last-paths',
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

/** Main -> renderer, fire-and-forget events (webContents.send / ipcRenderer.on). */
export const IpcEvent = {
  JobProgress: 'job:progress',
  JobLog: 'job:log',
  JobState: 'job:state',
} as const

export type IpcEventName = (typeof IpcEvent)[keyof typeof IpcEvent]

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

export type BinaryName = 'yt-dlp' | 'ffmpeg' | 'ffprobe'

export type BinaryOrigin = 'override' | 'bundled' | 'path'

export interface ResolvedBinary {
  name: BinaryName
  /** Absolute path to the resolved executable, or null when not found. */
  path: string | null
  origin: BinaryOrigin | null
  /** Every location that was searched, in order, for diagnostic/UI display. */
  searched: string[]
  version: string | null
}

export type ResolveAllBinariesResult = Record<BinaryName, ResolvedBinary>

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobState = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'

export interface JobProgress {
  status: string | null
  /**
   * Overall, monotonic-within-phase download percentage, already aggregated
   * across fragments where applicable. This is what a progress bar should
   * bind to. See ytdlp.ts `computeJobProgress` for why this cannot simply be
   * yt-dlp's own `_percent_str` on a fragmented (DASH/HLS) download: that
   * field is PER-FRAGMENT, resets to ~0% at the start of every fragment, and
   * would make a bar wired to it jitter and repeatedly hit 100% early.
   */
  pct: string | null
  /** The raw, unaggregated per-fragment percentage as yt-dlp reported it, for diagnostics/expert display only. Not monotonic — do not bind a progress bar to this. */
  fragmentPct: string | null
  rate: string | null
  size: string | null
  eta: string | null
  frags: string | null
}

export interface JobRecord {
  id: string
  url: string
  argv: string[]
  cwd: string | null
  state: JobState
  progress: JobProgress
  exitCode: number | null
  createdAt: number
  updatedAt: number
}

export interface StartJobRequest {
  id: string
  url: string
  argv: string[]
  cwd?: string | null
}

/**
 * How pause/resume is actually implemented on this platform. Windows has no
 * SIGSTOP, so a real suspend is not always available; when it is not, pause
 * is honestly implemented as "stop the process, and resume respawns with
 * --continue". The UI must read this and describe the real behavior rather
 * than claiming a capability that was not implemented.
 */
export type PauseMode = 'suspend' | 'stop-continue'

export interface JobCapabilities {
  pauseMode: PauseMode
}

export type LogLevel = 'error' | 'warn' | 'info'

export interface JobLogEvent {
  id: string
  text: string
  level: LogLevel
}

export interface JobProgressEvent {
  id: string
  progress: JobProgress
}

export interface JobStateEvent {
  id: string
  state: JobState
  exitCode: number | null
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export interface SaveFileOptions {
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface PickFileOptions {
  filters?: { name: string; extensions: string[] }[]
}

// ---------------------------------------------------------------------------
// Preferences / store
// ---------------------------------------------------------------------------

export type LanguageMode = 'en' | 'yue' | 'bilingual'

export interface Preferences {
  languageMode: LanguageMode
  funnyLevelEn: number
  funnyLevelYue: number
  theme: 'light' | 'dark' | 'system'
  density: number
  fontFamily: string | null
  scale: number
  fontWeight: number
  cornerRadius: number
  reducedMotion: boolean
  [key: string]: unknown
}

export interface LastPaths {
  downloadFolder: string | null
  batchFile: string | null
  infoJson: string | null
  cookiesFile: string | null
  [key: string]: unknown
}

/**
 * A record of one job run reaching a terminal state (done/error/cancelled),
 * appended by YtDlpManager (app/src/main/ytdlp.ts) via Store.appendJobHistory
 * so a fresh launch can show what was actually downloaded — not merely that
 * some job id finished.
 *
 * The five fields below `finishedAt` are captured from yt-dlp's own real
 * output at the `after_move` hook (i.e. after any post-processing/merge has
 * already written the final file), never invented. A run that never reached
 * that hook — it failed during extraction, was cancelled early, or yt-dlp's
 * build genuinely omitted a field for that extractor — leaves the
 * corresponding field `null` rather than a guessed value. An entry loaded
 * from a job-history.json written before this field set existed will simply
 * have these as `undefined` at runtime; every reader must treat that the
 * same as `null` rather than assuming presence.
 */
export interface JobHistoryEntry {
  id: string
  url: string
  argv: string[]
  state: JobState
  exitCode: number | null
  finishedAt: number
  /** The media title yt-dlp resolved, or null if the job never got that far. */
  title: string | null
  /** The channel/account/user yt-dlp attributes the media to, or null when the extractor does not report one (or the job never got that far). */
  uploader: string | null
  /** The yt-dlp extractor that handled this URL (e.g. "youtube", "twitch:vod"), or null if extraction never started. */
  extractor: string | null
  /** The extractor's own id for this media (yt-dlp's %(id)s — e.g. a YouTube video id), or null if extraction never started. Paired with `extractor` this is the same "extractor id" shape yt-dlp itself uses for --download-archive lines, but it is not cross-checked against the actual archive file. */
  videoId: string | null
  /** Media duration in whole seconds, or null for a live/unknown-duration source, or a job that never resolved it. */
  durationSec: number | null
  /**
   * The absolute path of the file yt-dlp actually wrote, captured AFTER any
   * merge/post-processing step so it names the real final file rather than a
   * temporary ".part" path. Null for a run that never produced an output
   * file (failed before download, cancelled early, or a --simulate-style
   * job). This is the exact string yt-dlp reported — it is not re-verified
   * against the filesystem, so a since-deleted or since-moved file still
   * shows its last known path here; callers must not present that path as
   * proof the file still exists.
   */
  outputPath: string | null
  /**
   * The last human-readable size figure ("1.42GiB") yt-dlp reported in job
   * progress before this run finished — for display only. It is the last
   * progress line's own string, not a verified byte count of the final
   * file (a multi-stream download's last progress line may describe only
   * one stream), so treat it as an approximation.
   */
  sizeLabel: string | null
}
