import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  IpcEvent,
  type JobHistoryEntry,
  type JobLogEvent,
  type JobProgressEvent,
  type JobStateEvent,
  type LastPaths,
  type PickFileOptions,
  type Preferences,
  type ResolveAllBinariesResult,
  type SaveFileOptions,
  type StartJobRequest,
} from '../shared/ipc-contract'

// ---------------------------------------------------------------------------
// Deadline-enforced invoke.
//
// Every renderer -> main call gets a timeout that REJECTS. A `catch` at the
// call site cannot save a caller from a promise that simply never settles —
// the ipcRenderer.invoke promise only ever resolves when the main process
// replies, so if that reply never comes the caller hangs forever with no
// error and nothing in the console. Each call site below sizes its own
// deadline against the slowest legitimate case (a file dialog the user may
// leave open for a while gets a long deadline; a quick store read gets a
// short one) and the timer is always cleared on every settle path so a call
// that finishes normally never leaks a timer.
// ---------------------------------------------------------------------------

class IpcTimeoutError extends Error {
  constructor(channel: string, ms: number) {
    super(`IPC call "${channel}" did not respond within ${ms}ms`)
    this.name = 'IpcTimeoutError'
  }
}

function invokeWithDeadline<T>(channel: string, ms: number, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new IpcTimeoutError(channel, ms))
    }, ms)

    ipcRenderer
      .invoke(channel, ...args)
      .then((result: T) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      })
      .catch((err: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
  })
}

// Deadlines, in milliseconds, per call shape.
const SHORT = 8_000 // quick, purely in-process reads/writes (store, window controls)
const MEDIUM = 20_000 // spawning a process, resolving/probing binaries
const LONG = 10 * 60_000 // interactive dialogs the user may leave open

// ---------------------------------------------------------------------------
// Event subscription helpers: return an unsubscribe function.
// ---------------------------------------------------------------------------

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// ---------------------------------------------------------------------------
// Bridge surface exposed to the renderer. No Node APIs are exposed directly.
// ---------------------------------------------------------------------------

const bridge = {
  window: {
    minimize: () => invokeWithDeadline<void>(IpcChannel.WindowMinimize, SHORT),
    maximize: () => invokeWithDeadline<void>(IpcChannel.WindowMaximize, SHORT),
    unmaximize: () => invokeWithDeadline<void>(IpcChannel.WindowUnmaximize, SHORT),
    close: () => invokeWithDeadline<void>(IpcChannel.WindowClose, SHORT),
    isMaximized: () => invokeWithDeadline<boolean>(IpcChannel.WindowIsMaximized, SHORT),
  },

  binaries: {
    resolveAll: () => invokeWithDeadline<ResolveAllBinariesResult>(IpcChannel.BinariesResolveAll, MEDIUM),
    probeVersion: (binaryPath: string) =>
      invokeWithDeadline<string | null>(IpcChannel.BinariesProbeVersion, MEDIUM, binaryPath),
  },

  jobs: {
    start: (req: StartJobRequest) => invokeWithDeadline(IpcChannel.JobStart, MEDIUM, req),
    pause: (id: string) => invokeWithDeadline<void>(IpcChannel.JobPause, SHORT, id),
    resume: (id: string) => invokeWithDeadline<void>(IpcChannel.JobResume, MEDIUM, id),
    cancel: (id: string) => invokeWithDeadline<void>(IpcChannel.JobCancel, SHORT, id),
    retry: (id: string) => invokeWithDeadline<void>(IpcChannel.JobRetry, MEDIUM, id),
    remove: (id: string) => invokeWithDeadline<void>(IpcChannel.JobRemove, SHORT, id),
    list: () => invokeWithDeadline(IpcChannel.JobList, SHORT),
    capabilities: () => invokeWithDeadline(IpcChannel.JobCapabilities, SHORT),
    onProgress: (handler: (event: JobProgressEvent) => void) => subscribe(IpcEvent.JobProgress, handler),
    onLog: (handler: (event: JobLogEvent) => void) => subscribe(IpcEvent.JobLog, handler),
    onState: (handler: (event: JobStateEvent) => void) => subscribe(IpcEvent.JobState, handler),
  },

  dialogs: {
    pickFolder: () => invokeWithDeadline<string | null>(IpcChannel.DialogPickFolder, LONG),
    pickFile: (options?: PickFileOptions) =>
      invokeWithDeadline<string | null>(IpcChannel.DialogPickFile, LONG, options),
    pickBatchFile: () => invokeWithDeadline<string | null>(IpcChannel.DialogPickBatchFile, LONG),
    pickInfoJson: () => invokeWithDeadline<string | null>(IpcChannel.DialogPickInfoJson, LONG),
    pickCookiesFile: () => invokeWithDeadline<string | null>(IpcChannel.DialogPickCookiesFile, LONG),
    saveFile: (options?: SaveFileOptions) =>
      invokeWithDeadline<string | null>(IpcChannel.DialogSaveFile, LONG, options),
  },

  store: {
    getPreferences: () => invokeWithDeadline<Preferences>(IpcChannel.StoreGetPreferences, SHORT),
    setPreferences: (prefs: Preferences) => invokeWithDeadline<void>(IpcChannel.StoreSetPreferences, SHORT, prefs),
    getJobHistory: () => invokeWithDeadline<JobHistoryEntry[]>(IpcChannel.StoreGetJobHistory, SHORT),
    appendJobHistory: (entry: JobHistoryEntry) =>
      invokeWithDeadline<JobHistoryEntry[]>(IpcChannel.StoreAppendJobHistory, SHORT, entry),
    getLastPaths: () => invokeWithDeadline<LastPaths>(IpcChannel.StoreGetLastPaths, SHORT),
    setLastPaths: (paths: LastPaths) => invokeWithDeadline<void>(IpcChannel.StoreSetLastPaths, SHORT, paths),
  },
}

export type Bridge = typeof bridge

contextBridge.exposeInMainWorld('ytdlpStudio', bridge)
