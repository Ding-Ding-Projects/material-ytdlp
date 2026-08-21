import { BrowserWindow, ipcMain } from 'electron'
import {
  IpcChannel,
  type JobHistoryEntry,
  type LastPaths,
  type Preferences,
  type ResolveAllBinariesResult,
  type StartJobRequest,
} from '../shared/ipc-contract'
import {
  pickBatchFile,
  pickCookiesFile,
  pickFile,
  pickFolder,
  pickInfoJson,
  saveFile,
} from './dialogs'
import { resolveAllBinaries, probeVersion } from './resolve-binaries'
import { getStore } from './store'
import { YtDlpManager } from './ytdlp'

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): YtDlpManager {
  const store = getStore()
  const manager = new YtDlpManager(getWindow)

  // -- Window controls (custom title bar, frameless window) -----------------

  ipcMain.handle(IpcChannel.WindowMinimize, () => {
    getWindow()?.minimize()
  })
  ipcMain.handle(IpcChannel.WindowMaximize, () => {
    getWindow()?.maximize()
  })
  ipcMain.handle(IpcChannel.WindowUnmaximize, () => {
    getWindow()?.unmaximize()
  })
  ipcMain.handle(IpcChannel.WindowClose, () => {
    getWindow()?.close()
  })
  ipcMain.handle(IpcChannel.WindowIsMaximized, () => {
    return getWindow()?.isMaximized() ?? false
  })

  // -- Binaries ---------------------------------------------------------------

  ipcMain.handle(IpcChannel.BinariesResolveAll, async (): Promise<ResolveAllBinariesResult> => {
    const prefs = await store.getPreferences()
    const overrides = (prefs.binaryOverrides as Record<string, string | null> | undefined) ?? {}
    const resolved = resolveAllBinaries({ overrides })
    for (const key of Object.keys(resolved) as (keyof ResolveAllBinariesResult)[]) {
      const entry = resolved[key]
      if (entry.path) entry.version = await probeVersion(entry.path)
    }
    return resolved
  })

  ipcMain.handle(IpcChannel.BinariesProbeVersion, async (_event, binaryPath: string) => {
    return probeVersion(binaryPath)
  })

  // -- Jobs ---------------------------------------------------------------

  ipcMain.handle(IpcChannel.JobStart, async (_event, req: StartJobRequest) => {
    const resolved = resolveAllBinaries()
    const ytdlp = resolved['yt-dlp']
    if (!ytdlp.path) {
      throw new Error(
        [`yt-dlp could not be found. Searched, in order:`, ...ytdlp.searched.map((p) => `  - ${p}`)].join('\n'),
      )
    }
    return manager.start(ytdlp.path, req)
  })

  ipcMain.handle(IpcChannel.JobPause, (_event, id: string) => {
    manager.pause(id)
  })
  ipcMain.handle(IpcChannel.JobResume, (_event, id: string) => {
    manager.resume(id)
  })
  ipcMain.handle(IpcChannel.JobCancel, (_event, id: string) => {
    manager.cancel(id)
  })
  ipcMain.handle(IpcChannel.JobRetry, (_event, id: string) => {
    manager.retry(id)
  })
  ipcMain.handle(IpcChannel.JobRemove, (_event, id: string) => {
    manager.remove(id)
  })
  ipcMain.handle(IpcChannel.JobList, () => {
    return manager.list()
  })
  ipcMain.handle(IpcChannel.JobCapabilities, () => {
    return manager.capabilities()
  })

  // -- Dialogs --------------------------------------------------------------

  ipcMain.handle(IpcChannel.DialogPickFolder, () => pickFolder())
  ipcMain.handle(IpcChannel.DialogPickFile, (_event, options) => pickFile(options))
  ipcMain.handle(IpcChannel.DialogPickBatchFile, () => pickBatchFile())
  ipcMain.handle(IpcChannel.DialogPickInfoJson, () => pickInfoJson())
  ipcMain.handle(IpcChannel.DialogPickCookiesFile, () => pickCookiesFile())
  ipcMain.handle(IpcChannel.DialogSaveFile, (_event, options) => saveFile(options))

  // -- Store / preferences ---------------------------------------------------

  ipcMain.handle(IpcChannel.StoreGetPreferences, () => store.getPreferences())
  ipcMain.handle(IpcChannel.StoreSetPreferences, (_event, prefs: Preferences) => store.setPreferences(prefs))
  ipcMain.handle(IpcChannel.StoreGetJobHistory, () => store.getJobHistory())
  ipcMain.handle(IpcChannel.StoreAppendJobHistory, (_event, entry: JobHistoryEntry) =>
    store.appendJobHistory(entry),
  )
  ipcMain.handle(IpcChannel.StoreGetLastPaths, () => store.getLastPaths())
  ipcMain.handle(IpcChannel.StoreSetLastPaths, (_event, paths: LastPaths) => store.setLastPaths(paths))

  return manager
}
