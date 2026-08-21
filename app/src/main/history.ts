import { app } from 'electron'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './store'
import type {
  HistoryActionType,
  HistoryCommit,
  HistoryDiffField,
  HistoryDiffItem,
  HistoryDiffResult,
  HistoryDownloadRecord,
  HistoryExportFormat,
  HistoryExportResult,
  HistoryFilterState,
  HistoryRetentionSetting,
  HistorySnapshot,
  HistoryStatus,
} from '../shared/history-contract'
import { DEFAULT_HISTORY_FILTERS, DEFAULT_HISTORY_RETENTION } from '../shared/history-contract'

// ---------------------------------------------------------------------------
// A local, Git-backed history of the download list.
//
// Isolated repository under <userData>/history/ — never inside a user's own
// folders, never inside this project's own repository, never pushed or
// synced anywhere. Every mutation to the download list is recorded as its
// own append-only commit, so a deleted download (or a whole deleted list)
// can always come back. Restoring is itself a NEW commit, never a rewrite:
// git reset --hard, rebase, and force are never used here.
//
// A history write must NEVER fail the operation the user actually asked
// for. Every public method here swallows its own errors, logs them, and
// reports an honest status rather than throwing into a caller whose actual
// job (starting a download, removing one) has nothing to do with git.
// ---------------------------------------------------------------------------

const DATA_FILE = 'downloads.json'
const RETENTION_FILE = 'retention.json'
const FILTERS_FILE = 'filters.json'
const GIT_TIMEOUT_MS = 15_000

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err
}

interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

async function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ ok: false, stdout, stderr: `git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`, code: null })
    }, GIT_TIMEOUT_MS)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: String(err), code: null })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return fallback
    return fallback
  }
}

/** Stable, deterministic serialization so a git diff of this file is small and readable. */
function serializeSnapshot(snapshot: HistorySnapshot): string {
  const sortedIds = Object.keys(snapshot).sort()
  const ordered: HistorySnapshot = {}
  for (const id of sortedIds) {
    const rec = snapshot[id]
    // Sort each record's own keys too, for a stable per-line diff.
    const sortedRec = Object.keys(rec)
      .sort()
      .reduce((acc, k) => {
        ;(acc as unknown as Record<string, unknown>)[k] = (rec as unknown as Record<string, unknown>)[k]
        return acc
      }, {} as HistoryDownloadRecord)
    ordered[id] = sortedRec
  }
  return JSON.stringify(ordered, null, 2) + '\n'
}

export class HistoryStore {
  private readonly repoDir: string
  private gitAvailable: boolean | null = null
  private lastReason: string | null = null
  private initPromise: Promise<void> | null = null

  constructor(userDataDir: string = app.getPath('userData')) {
    this.repoDir = join(userDataDir, 'history')
  }

  private dataPath(): string {
    return join(this.repoDir, DATA_FILE)
  }

  private retentionPath(): string {
    return join(this.repoDir, RETENTION_FILE)
  }

  private filtersPath(): string {
    return join(this.repoDir, FILTERS_FILE)
  }

  async getFilters(): Promise<HistoryFilterState> {
    const stored = await readJson<Partial<HistoryFilterState>>(this.filtersPath(), {})
    return { ...DEFAULT_HISTORY_FILTERS, ...stored }
  }

  async setFilters(filters: HistoryFilterState): Promise<void> {
    // Filter state is a UI preference, not tracked download-list history —
    // written directly (still through the shared atomic-write helper), not
    // committed to the git log.
    await atomicWriteFile(this.filtersPath(), JSON.stringify(filters, null, 2))
  }

  // -- Initialization -------------------------------------------------------

  private async ensureInit(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    try {
      await mkdir(this.repoDir, { recursive: true })
      const probe = await runGit(['--version'], this.repoDir)
      if (!probe.ok) {
        this.gitAvailable = false
        this.lastReason =
          'git was not found on PATH. Version history is unavailable; the download list still works normally.'
        return
      }
      this.gitAvailable = true

      const isRepo = await runGit(['rev-parse', '--is-inside-work-tree'], this.repoDir)
      if (!isRepo.ok) {
        const init = await runGit(['init'], this.repoDir)
        if (!init.ok) {
          this.gitAvailable = false
          this.lastReason = `Could not initialize the local history repository: ${init.stderr.trim() || 'unknown error'}`
          return
        }
        // Local-only identity, scoped to this repo — never the user's real
        // git identity, and never touching global git config.
        await runGit(['config', 'user.name', 'yt-dlp Studio'], this.repoDir)
        await runGit(['config', 'user.email', 'history@ytdlp-studio.local'], this.repoDir)
        await atomicWriteFile(this.dataPath(), serializeSnapshot({}))
        await runGit(['add', DATA_FILE], this.repoDir)
        await runGit(['commit', '-m', 'Started download history'], this.repoDir)
      }
    } catch (err) {
      this.gitAvailable = false
      this.lastReason = `Local history repository could not be prepared: ${String(err)}`
    }
  }

  async status(): Promise<HistoryStatus> {
    await this.ensureInit()
    let commitCount = 0
    if (this.gitAvailable) {
      const res = await runGit(['rev-list', '--count', 'HEAD'], this.repoDir)
      commitCount = res.ok ? Number.parseInt(res.stdout.trim(), 10) || 0 : 0
    }
    return {
      gitAvailable: this.gitAvailable ?? false,
      reason: this.lastReason,
      repoDir: this.repoDir,
      commitCount,
    }
  }

  // -- Snapshot access --------------------------------------------------------

  async getSnapshot(): Promise<HistorySnapshot> {
    return readJson<HistorySnapshot>(this.dataPath(), {})
  }

  /**
   * Apply `mutate` to the current snapshot and record the result as a new
   * commit. Never throws: a failure here is logged and reported through the
   * return value, and the caller's real operation must proceed regardless.
   */
  async recordMutation(
    action: HistoryActionType,
    message: string,
    mutate: (snapshot: HistorySnapshot) => HistorySnapshot,
    affectedIds: string[] = [],
  ): Promise<{ ok: boolean; sha: string | null }> {
    try {
      await this.ensureInit()
      const current = await this.getSnapshot()
      const next = mutate(current)
      await atomicWriteFile(this.dataPath(), serializeSnapshot(next))

      if (!this.gitAvailable) return { ok: false, sha: null }

      const add = await runGit(['add', DATA_FILE], this.repoDir)
      if (!add.ok) {
        console.error('[history] git add failed:', add.stderr)
        return { ok: false, sha: null }
      }
      // Nothing to commit (identical content) is not an error.
      const status = await runGit(['status', '--porcelain'], this.repoDir)
      if (!status.stdout.trim()) return { ok: true, sha: null }

      const commit = await runGit(['commit', '-m', message, '--allow-empty-message'], this.repoDir)
      if (!commit.ok) {
        console.error('[history] git commit failed:', commit.stderr)
        return { ok: false, sha: null }
      }
      const sha = await runGit(['rev-parse', 'HEAD'], this.repoDir)
      void action
      void affectedIds
      return { ok: true, sha: sha.ok ? sha.stdout.trim() : null }
    } catch (err) {
      console.error('[history] recordMutation failed, download list operation proceeds regardless:', err)
      return { ok: false, sha: null }
    }
  }

  // -- Commit log / diff --------------------------------------------------

  async listCommits(limit = 500): Promise<HistoryCommit[]> {
    await this.ensureInit()
    if (!this.gitAvailable) return []
    const SEP = ''
    const res = await runGit(
      ['log', `--max-count=${limit}`, `--format=%H${SEP}%P${SEP}%ct${SEP}%s`],
      this.repoDir,
    )
    if (!res.ok) return []
    const commits: HistoryCommit[] = []
    for (const line of res.stdout.split('\n')) {
      if (!line.trim()) continue
      const [sha, parents, ts, ...msgParts] = line.split(SEP)
      const message = msgParts.join(SEP)
      const parentSha = parents ? parents.trim().split(' ')[0] || null : null
      commits.push({
        sha,
        parentSha: parentSha || null,
        action: inferActionFromMessage(message),
        message,
        affectedIds: [],
        timestamp: Number.parseInt(ts, 10) * 1000,
      })
    }
    return commits
  }

  private async readSnapshotAtRef(ref: string): Promise<HistorySnapshot | null> {
    const res = await runGit(['show', `${ref}:${DATA_FILE}`], this.repoDir)
    if (!res.ok) return null
    try {
      return JSON.parse(res.stdout) as HistorySnapshot
    } catch {
      return null
    }
  }

  async getDiff(sha: string): Promise<HistoryDiffResult | null> {
    await this.ensureInit()
    if (!this.gitAvailable) return null
    const commits = await this.listCommits(100000)
    const commit = commits.find((c) => c.sha === sha)
    if (!commit) return null

    const after = (await this.readSnapshotAtRef(sha)) ?? {}
    const before = commit.parentSha ? (await this.readSnapshotAtRef(commit.parentSha)) ?? {} : {}

    const ids = new Set([...Object.keys(before), ...Object.keys(after)])
    const items: HistoryDiffItem[] = []
    for (const id of ids) {
      const b = before[id] ?? null
      const a = after[id] ?? null
      if (!b && a) {
        items.push({ id, kind: 'added', before: null, after: a, changedFields: [] })
      } else if (b && !a) {
        items.push({ id, kind: 'removed', before: b, after: null, changedFields: [] })
      } else if (b && a) {
        const changedFields: HistoryDiffField[] = []
        for (const key of Object.keys(a) as (keyof HistoryDownloadRecord)[]) {
          if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
            changedFields.push({ field: key, before: b[key], after: a[key] })
          }
        }
        if (changedFields.length > 0) {
          items.push({ id, kind: 'changed', before: b, after: a, changedFields })
        }
      }
    }
    return { commit, items }
  }

  // -- Restore (append-only: always a NEW commit) --------------------------

  async restoreEntry(id: string, fromCommitSha: string): Promise<{ ok: boolean; sha: string | null }> {
    const snapshotAt = await this.readSnapshotAtRef(fromCommitSha)
    if (!snapshotAt || !snapshotAt[id]) return { ok: false, sha: null }
    const record = snapshotAt[id]
    const title = record.title ?? record.url
    return this.recordMutation(
      'restored-entry',
      `Restored "${title}" from history`,
      (snapshot) => ({ ...snapshot, [id]: { ...record, updatedAt: Date.now() } }),
      [id],
    )
  }

  async restoreList(fromCommitSha: string): Promise<{ ok: boolean; sha: string | null }> {
    const snapshotAt = await this.readSnapshotAtRef(fromCommitSha)
    if (!snapshotAt) return { ok: false, sha: null }
    const count = Object.keys(snapshotAt).length
    return this.recordMutation(
      'restored-list',
      `Restored the whole download list (${count} item${count === 1 ? '' : 's'}) to an earlier point`,
      () => ({ ...snapshotAt }),
      Object.keys(snapshotAt),
    )
  }

  // -- Bulk delete -----------------------------------------------------------

  async bulkRemove(ids: string[]): Promise<{ ok: boolean; sha: string | null }> {
    return this.recordMutation(
      'bulk-removed',
      `Removed ${ids.length} download${ids.length === 1 ? '' : 's'} from history`,
      (snapshot) => {
        const next = { ...snapshot }
        for (const id of ids) delete next[id]
        return next
      },
      ids,
    )
  }

  // -- Export -----------------------------------------------------------------

  async exportEntries(
    format: HistoryExportFormat,
    ids: string[] | null,
    scopeDescription: string,
  ): Promise<HistoryExportResult> {
    const snapshot = await this.getSnapshot()
    const records = (ids ? ids.map((id) => snapshot[id]).filter(Boolean) : Object.values(snapshot)) as HistoryDownloadRecord[]
    const exportedAt = new Date().toISOString()

    if (format === 'json') {
      const content = JSON.stringify(
        { exportedAt, scope: scopeDescription, count: records.length, records },
        null,
        2,
      )
      return { content, suggestedFilename: `download-history-${Date.now()}.json`, mimeType: 'application/json' }
    }

    if (format === 'csv') {
      const header = ['id', 'title', 'url', 'filename', 'ext', 'extractor', 'sizeBytes', 'durationSec', 'state', 'error', 'addedAt', 'updatedAt']
      const escape = (v: unknown) => {
        const s = v === null || v === undefined ? '' : String(v)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const lines = [
        `# Scope: ${scopeDescription} | Exported: ${exportedAt}`,
        header.join(','),
        ...records.map((r) => header.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(',')),
      ]
      return { content: lines.join('\n') + '\n', suggestedFilename: `download-history-${Date.now()}.csv`, mimeType: 'text/csv' }
    }

    // markdown
    const lines = [
      `# Download history export`,
      ``,
      `Scope: ${scopeDescription}  `,
      `Exported: ${exportedAt}  `,
      `Count: ${records.length}`,
      ``,
      `| Title | State | URL | Extractor | Size | Duration | Added |`,
      `| --- | --- | --- | --- | --- | --- | --- |`,
      ...records.map(
        (r) =>
          `| ${r.title ?? '(untitled)'} | ${r.state} | ${r.url} | ${r.extractor ?? ''} | ${r.sizeBytes ?? ''} | ${r.durationSec ?? ''} | ${new Date(r.addedAt).toISOString()} |`,
      ),
    ]
    return { content: lines.join('\n') + '\n', suggestedFilename: `download-history-${Date.now()}.md`, mimeType: 'text/markdown' }
  }

  // -- Retention ---------------------------------------------------------------

  async getRetention(): Promise<HistoryRetentionSetting> {
    const stored = await readJson<Partial<HistoryRetentionSetting>>(this.retentionPath(), {})
    return { ...DEFAULT_HISTORY_RETENTION, ...stored }
  }

  async setRetention(setting: HistoryRetentionSetting): Promise<void> {
    await atomicWriteFile(this.retentionPath(), JSON.stringify(setting, null, 2))
  }

  /**
   * Retention only bounds what is LISTED/exported by default — never a
   * rewrite of the append-only commit log. This app never runs
   * `git reset --hard`, rebase, or history rewriting of any kind. When a
   * user asks for "prune beyond N", they get an honest view cap; the real
   * commits stay in the repository forever.
   */
  applyRetentionView(commits: HistoryCommit[], setting: HistoryRetentionSetting): HistoryCommit[] {
    if (setting.mode === 'keep-everything') return commits
    if (setting.mode === 'prune-by-count') return commits.slice(0, Math.max(0, setting.maxEntries))
    const cutoff = Date.now() - setting.maxAgeDays * 24 * 60 * 60 * 1000
    return commits.filter((c) => c.timestamp >= cutoff)
  }
}

function inferActionFromMessage(message: string): HistoryActionType {
  const m = message.toLowerCase()
  if (m.startsWith('started download history')) return 'added'
  if (m.startsWith('restored the whole')) return 'restored-list'
  if (m.startsWith('restored')) return 'restored-entry'
  if (m.startsWith('removed') && m.includes('history')) return 'bulk-removed'
  if (m.startsWith('removed')) return 'removed'
  if (m.includes('failed')) return 'failed'
  if (m.includes('cancelled')) return 'cancelled'
  if (m.includes('retried') || m.includes('retry')) return 'retried'
  if (m.includes('completed') || m.includes('finished')) return 'completed'
  if (m.includes('started')) return 'started'
  if (m.includes('added') || m.includes('queued')) return 'added'
  if (m.includes('closing') || m.includes('app closed')) return 'app-closed'
  return 'added'
}

let shared: HistoryStore | null = null

export function getHistoryStore(): HistoryStore {
  if (!shared) shared = new HistoryStore()
  return shared
}
