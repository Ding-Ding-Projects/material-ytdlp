import { app, BrowserWindow, ipcMain } from 'electron'
import {
  IpcChannel,
  IpcEvent,
  type JobHistoryEntry,
  type JobRecord,
  type JobStateEvent,
  type LastPaths,
  type Preferences,
  type ResolveAllBinariesResult,
  type StartJobRequest,
} from '../shared/ipc-contract'
import {
  HistoryIpcChannel,
  type HistoryDownloadRecord,
  type HistoryExportFormat,
  type HistoryFilterState,
  type HistoryRetentionSetting,
} from '../shared/history-contract'
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
import { getHistoryStore } from './history'
import { YtDlpManager } from './ytdlp'
import { VocabularyIpcChannel } from '../shared/vocabulary-contract'
import { clearVocabularyCache, loadVocabularyFromDisk, pickAndLoadVocabulary } from './vocabulary'

// ---------------------------------------------------------------------------
// History auto-recording.
//
// YtDlpManager reports job state transitions by calling
// `getWindow()?.webContents.send(IpcEvent.JobState, event)` directly — it is
// not an EventEmitter, and it is out of this lane's allowed files. To record
// history without touching ytdlp.ts, wrap the `getWindow` function handed to
// the manager: the wrapper returns a window whose `webContents.send` is
// intercepted only for `IpcEvent.JobState`, forwards that event to the
// history recorder, and then always still performs the real send so the
// renderer's queue UI is completely unaffected. A history recording failure
// here must never throw into the manager's own send path.
// ---------------------------------------------------------------------------

function wrapWindowForHistory(
  getWindow: () => BrowserWindow | null,
  onJobState: (event: JobStateEvent) => void,
): () => BrowserWindow | null {
  return () => {
    const win = getWindow()
    if (!win) return null
    return new Proxy(win, {
      get(target, prop, receiver) {
        if (prop === 'webContents') {
          const wc = target.webContents
          return new Proxy(wc, {
            get(wcTarget, wcProp, wcReceiver) {
              if (wcProp === 'send') {
                return (channel: string, ...args: unknown[]) => {
                  if (channel === IpcEvent.JobState) {
                    try {
                      onJobState(args[0] as JobStateEvent)
                    } catch (err) {
                      console.error('[history] job-state auto-record failed:', err)
                    }
                  }
                  return (wcTarget.send as (...a: unknown[]) => void)(channel, ...args)
                }
              }
              return Reflect.get(wcTarget, wcProp, wcReceiver)
            },
          })
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }
}

function recordFromJobRecord(
  historyStore: ReturnType<typeof getHistoryStore>,
  action: 'added' | 'started' | 'completed' | 'failed' | 'cancelled' | 'retried' | 'removed',
  message: string,
  job: JobRecord | null,
): void {
  if (!job) return
  void historyStore.recordMutation(
    action,
    message,
    (snapshot) => {
      const existing = snapshot[job.id]
      const record: HistoryDownloadRecord = {
        id: job.id,
        url: job.url,
        title: existing?.title ?? job.url,
        filename: existing?.filename ?? null,
        ext: existing?.ext ?? null,
        extractor: existing?.extractor ?? null,
        sizeBytes: existing?.sizeBytes ?? (job.progress.size ? parseSizeToBytes(job.progress.size) : null),
        durationSec: existing?.durationSec ?? null,
        state:
          job.state === 'done'
            ? 'done'
            : job.state === 'error'
              ? 'error'
              : job.state === 'cancelled'
                ? 'cancelled'
                : job.state,
        error: job.state === 'error' ? job.progress.status : null,
        addedAt: existing?.addedAt ?? job.createdAt,
        updatedAt: job.updatedAt,
      }
      return { ...snapshot, [job.id]: record }
    },
    [job.id],
  )
}

function parseSizeToBytes(size: string): number | null {
  const m = /^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)?/i.exec(size.trim())
  if (!m) return null
  const value = Number.parseFloat(m[1])
  if (Number.isNaN(value)) return null
  const unit = (m[2] ?? 'B').toUpperCase()
  const factor: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  }
  return Math.round(value * (factor[unit] ?? 1))
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): YtDlpManager {
  const store = getStore()
  const historyStore = getHistoryStore()
  const lastRecordedState = new Map<string, string>()

  const historyAwareGetWindow = wrapWindowForHistory(getWindow, (event) => {
    const previous = lastRecordedState.get(event.id)
    if (previous === event.state) return
    lastRecordedState.set(event.id, event.state)
    const job = manager.list().find((j) => j.id === event.id) ?? null
    if (event.state === 'running' && previous === undefined) {
      recordFromJobRecord(historyStore, 'started', `Started: ${job?.url ?? event.id}`, job)
    } else if (event.state === 'done') {
      recordFromJobRecord(historyStore, 'completed', `Completed: ${job?.url ?? event.id}`, job)
    } else if (event.state === 'error') {
      recordFromJobRecord(historyStore, 'failed', `Download failed: ${job?.url ?? event.id}`, job)
    } else if (event.state === 'cancelled') {
      recordFromJobRecord(historyStore, 'cancelled', `Cancelled: ${job?.url ?? event.id}`, job)
    }
  })

  const manager = new YtDlpManager(historyAwareGetWindow)

  app.on('before-quit', () => {
    void historyStore.recordMutation('app-closed', 'App closed', (snapshot) => snapshot)
  })

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
    const result = await manager.start(ytdlp.path, req)
    const job = manager.list().find((j) => j.id === req.id) ?? null
    recordFromJobRecord(historyStore, 'added', `Added: ${req.url}`, job)
    return result
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
    const job = manager.list().find((j) => j.id === id) ?? null
    manager.retry(id)
    recordFromJobRecord(historyStore, 'retried', `Retried: ${job?.url ?? id}`, job)
  })
  ipcMain.handle(IpcChannel.JobRemove, (_event, id: string) => {
    const job = manager.list().find((j) => j.id === id) ?? null
    manager.remove(id)
    recordFromJobRecord(historyStore, 'removed', `Removed: ${job?.url ?? id}`, job)
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

  // -- Download history (local, Git-backed) ------------------------------

  ipcMain.handle(HistoryIpcChannel.Status, () => historyStore.status())
  ipcMain.handle(HistoryIpcChannel.GetSnapshot, () => historyStore.getSnapshot())
  ipcMain.handle(HistoryIpcChannel.ListCommits, () => historyStore.listCommits())
  ipcMain.handle(HistoryIpcChannel.GetDiff, (_event, sha: string) => historyStore.getDiff(sha))
  ipcMain.handle(HistoryIpcChannel.RestoreEntry, (_event, id: string, fromCommitSha: string) =>
    historyStore.restoreEntry(id, fromCommitSha),
  )
  ipcMain.handle(HistoryIpcChannel.RestoreList, (_event, fromCommitSha: string) => historyStore.restoreList(fromCommitSha))
  ipcMain.handle(HistoryIpcChannel.BulkRemove, (_event, ids: string[]) => historyStore.bulkRemove(ids))
  ipcMain.handle(
    HistoryIpcChannel.Export,
    (_event, req: { format: HistoryExportFormat; ids: string[] | null; scopeDescription: string }) =>
      historyStore.exportEntries(req.format, req.ids, req.scopeDescription),
  )
  ipcMain.handle(HistoryIpcChannel.GetRetention, () => historyStore.getRetention())
  ipcMain.handle(HistoryIpcChannel.SetRetention, (_event, setting: HistoryRetentionSetting) =>
    historyStore.setRetention(setting),
  )
  ipcMain.handle(HistoryIpcChannel.GetFilters, () => historyStore.getFilters())
  ipcMain.handle(HistoryIpcChannel.SetFilters, (_event, filters: HistoryFilterState) => historyStore.setFilters(filters))

  // -- Personal vocabulary (local-only; no built-in mappings ever ship) -----

  ipcMain.handle(VocabularyIpcChannel.PickAndLoad, () => pickAndLoadVocabulary())
  ipcMain.handle(VocabularyIpcChannel.GetState, () => loadVocabularyFromDisk())
  ipcMain.handle(VocabularyIpcChannel.Clear, () => clearVocabularyCache())

  return manager
}
