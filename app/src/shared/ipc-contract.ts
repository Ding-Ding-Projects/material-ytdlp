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
  pct: string | null
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

export interface JobHistoryEntry {
  id: string
  url: string
  argv: string[]
  state: JobState
  exitCode: number | null
  finishedAt: number
}
