import { app } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { JobHistoryEntry, LastPaths, Preferences } from '../shared/ipc-contract'

// ---------------------------------------------------------------------------
// Atomic write helper, shared by every persisted file this module writes.
//
// On Windows, a rename onto an existing destination fails with EPERM/EACCES/
// EBUSY whenever the destination is *momentarily* open by anyone else — the
// antivirus real-time scanner, the search indexer, or a OneDrive-style sync
// client routinely do this for a few milliseconds right after a file is
// written. A single rename attempt is not atomic-in-practice on this
// platform; without a bounded retry this is silent data loss. Retrying is
// still safe because the rename itself is one indivisible operation — a
// retry can never observe or produce a torn write, it can only try the same
// indivisible operation again once whoever held the destination lets go.
// ---------------------------------------------------------------------------

let tempCounter = 0

const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RETRY_ATTEMPTS = 6
const RETRY_DELAY_MS = 50

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err
}

/**
 * Write `contents` to `targetPath` atomically: write to a unique temp file
 * beside the target, then rename over it, retrying the rename a bounded
 * number of times on the transient Windows sharing-violation codes.
 *
 * ENOENT (the temp file vanished — a caller bug) and ENOSPC (disk full) are
 * never retried: retrying cannot help either, and swallowing them would hide
 * a real failure from a caller that depends on knowing whether the write
 * actually landed.
 */
export async function atomicWriteFile(targetPath: string, contents: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = join(dirname(targetPath), `.${process.pid}-${tempCounter++}.tmp`)
  await writeFile(tempPath, contents, 'utf8')

  let lastError: unknown = null
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      await rename(tempPath, targetPath)
      return
    } catch (err) {
      lastError = err
      if (isNodeError(err) && RETRYABLE_CODES.has(err.code ?? '')) {
        await sleep(RETRY_DELAY_MS * (attempt + 1))
        continue
      }
      // Not retryable (ENOENT, ENOSPC, or anything else): clean up the temp
      // file if it is still there, then surface the real error immediately.
      await unlink(tempPath).catch(() => {})
      throw err
    }
  }

  // Exhausted retries on a transient code: never swallow the final error.
  await unlink(tempPath).catch(() => {})
  throw lastError
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return fallback
    // A corrupt or unreadable file falls back rather than crashing the app;
    // the next write will atomically replace it with valid data.
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const DEFAULT_PREFERENCES: Preferences = {
  languageMode: 'en',
  funnyLevelEn: 2,
  funnyLevelYue: 2,
  theme: 'system',
  density: 0,
  fontFamily: null,
  scale: 1,
  fontWeight: 400,
  cornerRadius: 12,
  reducedMotion: false,
}

const DEFAULT_LAST_PATHS: LastPaths = {
  downloadFolder: null,
  batchFile: null,
  infoJson: null,
  cookiesFile: null,
}

/**
 * The default download destination: a named subfolder of the user's own
 * Downloads folder, so this app's output stays together instead of scattering
 * itself through the folder every browser and installer also writes to.
 *
 * Returns null if the platform cannot name a Downloads folder. Never throws:
 * a missing default must degrade to "ask the user" rather than take down the
 * store that every other preference is read from.
 */
function defaultDownloadFolder(): string | null {
  try {
    const downloads = app.getPath('downloads')
    return downloads ? join(downloads, 'yt-dlp Studio') : null
  } catch {
    return null
  }
}

const MAX_JOB_HISTORY = 500

export class Store {
  private readonly dir: string

  constructor(userDataDir: string = app.getPath('userData')) {
    this.dir = userDataDir
  }

  private path(name: string): string {
    return join(this.dir, name)
  }

  async getPreferences(): Promise<Preferences> {
    const stored = await readJsonFile<Partial<Preferences>>(this.path('preferences.json'), {})
    return { ...DEFAULT_PREFERENCES, ...stored }
  }

  async setPreferences(prefs: Preferences): Promise<void> {
    await atomicWriteFile(this.path('preferences.json'), JSON.stringify(prefs, null, 2))
  }

  async getJobHistory(): Promise<JobHistoryEntry[]> {
    return readJsonFile<JobHistoryEntry[]>(this.path('job-history.json'), [])
  }

  async appendJobHistory(entry: JobHistoryEntry): Promise<JobHistoryEntry[]> {
    const existing = await this.getJobHistory()
    const next = [...existing, entry].slice(-MAX_JOB_HISTORY)
    await atomicWriteFile(this.path('job-history.json'), JSON.stringify(next, null, 2))
    return next
  }

  async getLastPaths(): Promise<LastPaths> {
    const stored = await readJsonFile<Partial<LastPaths>>(this.path('last-paths.json'), {})
    const merged = { ...DEFAULT_LAST_PATHS, ...stored }

    // Downloads must land somewhere real. Resolved here rather than in
    // DEFAULT_LAST_PATHS because app.getPath() is only valid once the app is
    // ready, and that constant is evaluated at module load.
    //
    // An empty folder is not a harmless default: the renderer only passes -P
    // when it has one, so yt-dlp fell back to writing relative to whatever
    // working directory the packaged app inherited. That varies by how the app
    // was launched, and when it lands somewhere unwritable yt-dlp's Python
    // reports it as "[Errno 28] No space left on device" -- observed on a disk
    // with 2.5 TB free, which sends anyone reading it in entirely the wrong
    // direction.
    if (!merged.downloadFolder) {
      merged.downloadFolder = defaultDownloadFolder()
    }
    return merged
  }

  async setLastPaths(paths: LastPaths): Promise<void> {
    await atomicWriteFile(this.path('last-paths.json'), JSON.stringify(paths, null, 2))
  }
}

let sharedStore: Store | null = null

export function getStore(): Store {
  if (!sharedStore) sharedStore = new Store()
  return sharedStore
}
