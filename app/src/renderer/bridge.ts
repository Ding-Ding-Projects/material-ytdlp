/**
 * Renderer-side typing for the bridge exposed on `window.ytdlpStudio` by
 * `src/preload/index.ts`. We do not import the preload module directly (it
 * pulls in `electron` at the type level via IpcRendererEvent internals in
 * some setups); instead we declare the exact shape the preload script
 * `contextBridge.exposeInMainWorld`s, kept in sync by hand against
 * `src/preload/index.ts`.
 */
import type {
  JobCapabilities,
  JobHistoryEntry,
  JobLogEvent,
  JobProgressEvent,
  JobRecord,
  JobStateEvent,
  LastPaths,
  PickFileOptions,
  Preferences,
  ResolveAllBinariesResult,
  SaveFileOptions,
  StartJobRequest,
} from '../shared/ipc-contract'

export interface YtdlpStudioBridge {
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    unmaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  binaries: {
    resolveAll: () => Promise<ResolveAllBinariesResult>
    probeVersion: (binaryPath: string) => Promise<string | null>
  }
  jobs: {
    start: (req: StartJobRequest) => Promise<JobRecord>
    pause: (id: string) => Promise<void>
    resume: (id: string) => Promise<void>
    cancel: (id: string) => Promise<void>
    retry: (id: string) => Promise<void>
    remove: (id: string) => Promise<void>
    list: () => Promise<JobRecord[]>
    capabilities: () => Promise<JobCapabilities>
    onProgress: (handler: (event: JobProgressEvent) => void) => () => void
    onLog: (handler: (event: JobLogEvent) => void) => () => void
    onState: (handler: (event: JobStateEvent) => void) => () => void
  }
  dialogs: {
    pickFolder: () => Promise<string | null>
    pickFile: (options?: PickFileOptions) => Promise<string | null>
    pickBatchFile: () => Promise<string | null>
    pickInfoJson: () => Promise<string | null>
    pickCookiesFile: () => Promise<string | null>
    saveFile: (options?: SaveFileOptions) => Promise<string | null>
  }
  store: {
    getPreferences: () => Promise<Preferences>
    setPreferences: (prefs: Preferences) => Promise<void>
    getJobHistory: () => Promise<JobHistoryEntry[]>
    appendJobHistory: (entry: JobHistoryEntry) => Promise<JobHistoryEntry[]>
    getLastPaths: () => Promise<LastPaths>
    setLastPaths: (paths: LastPaths) => Promise<void>
  }
}

declare global {
  interface Window {
    ytdlpStudio: YtdlpStudioBridge
  }
}

/** Safe accessor: null when preload has not attached the bridge yet/at all. */
export function getBridge(): YtdlpStudioBridge | null {
  if (typeof window === 'undefined') return null
  return window.ytdlpStudio ?? null
}
