/**
 * Shared IPC contract for the local, Git-backed download history feature.
 *
 * TYPES + CHANNEL NAMES ONLY — never import `electron` here at runtime, so
 * both the main process and the renderer (via the preload bridge) can import
 * this file freely. Deliberately kept separate from `ipc-contract.ts` (that
 * file is owned by other work); channel names below are plain strings that
 * do not collide with any entry in `IpcChannel`/`IpcEvent` there.
 */

// ---------------------------------------------------------------------------
// Channel names (renderer -> main, request/response)
// ---------------------------------------------------------------------------

export const HistoryIpcChannel = {
  Status: 'history:status',
  GetSnapshot: 'history:get-snapshot',
  ListCommits: 'history:list-commits',
  GetDiff: 'history:get-diff',
  RestoreEntry: 'history:restore-entry',
  RestoreList: 'history:restore-list',
  BulkRemove: 'history:bulk-remove',
  Export: 'history:export',
  GetRetention: 'history:get-retention',
  SetRetention: 'history:set-retention',
  GetFilters: 'history:get-filters',
  SetFilters: 'history:set-filters',
} as const

export type HistoryIpcChannelName = (typeof HistoryIpcChannel)[keyof typeof HistoryIpcChannel]

// ---------------------------------------------------------------------------
// The recorded download-list snapshot
// ---------------------------------------------------------------------------

export type HistoryDownloadState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'removed'

export interface HistoryDownloadRecord {
  id: string
  url: string
  title: string | null
  filename: string | null
  /** File extension without the leading dot, e.g. "mp4". */
  ext: string | null
  extractor: string | null
  sizeBytes: number | null
  durationSec: number | null
  state: HistoryDownloadState
  error: string | null
  addedAt: number
  updatedAt: number
}

/** The whole tracked list at one point in time, keyed by download id. */
export type HistorySnapshot = Record<string, HistoryDownloadRecord>

// ---------------------------------------------------------------------------
// Mutations / commits
// ---------------------------------------------------------------------------

export type HistoryActionType =
  | 'added'
  | 'started'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retried'
  | 'removed'
  | 'bulk-removed'
  | 'restored-entry'
  | 'restored-list'
  | 'app-closed'

export interface HistoryCommit {
  sha: string
  parentSha: string | null
  action: HistoryActionType
  /** Human-readable summary of WHAT changed, e.g. "Removed 3 completed downloads". */
  message: string
  /** Download ids this commit touched. */
  affectedIds: string[]
  timestamp: number
}

export interface HistoryStatus {
  /** False when `git` could not be found on PATH; history degrades honestly. */
  gitAvailable: boolean
  /** Non-null only when gitAvailable is false, or a repo-level error occurred. */
  reason: string | null
  repoDir: string
  commitCount: number
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

export type HistoryDiffKind = 'added' | 'removed' | 'changed'

export interface HistoryDiffField {
  field: keyof HistoryDownloadRecord
  before: unknown
  after: unknown
}

export interface HistoryDiffItem {
  id: string
  kind: HistoryDiffKind
  before: HistoryDownloadRecord | null
  after: HistoryDownloadRecord | null
  changedFields: HistoryDiffField[]
}

export interface HistoryDiffResult {
  commit: HistoryCommit
  items: HistoryDiffItem[]
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type HistoryExportFormat = 'json' | 'csv' | 'markdown'

export interface HistoryExportRequest {
  format: HistoryExportFormat
  /** Ids to export; when null, exports every entry currently matching the caller's active filter view. */
  ids: string[] | null
  /** Human-readable description of the active filter/scope, embedded in the file per the export-honesty rule. */
  scopeDescription: string
}

export interface HistoryExportResult {
  content: string
  suggestedFilename: string
  mimeType: string
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export type HistoryRetentionMode = 'keep-everything' | 'prune-by-count' | 'prune-by-age'

export interface HistoryRetentionSetting {
  mode: HistoryRetentionMode
  /** Used when mode === 'prune-by-count'. */
  maxEntries: number
  /** Used when mode === 'prune-by-age'. */
  maxAgeDays: number
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreEntryRequest {
  id: string
  fromCommitSha: string
}

// ---------------------------------------------------------------------------
// Persisted filter state (survives restart)
// ---------------------------------------------------------------------------

export interface HistoryDateRange {
  from: number | null
  to: number | null
}

export interface HistoryFilterState {
  query: string
  useRegex: boolean
  regexFlags: string
  actions: HistoryActionType[]
  states: HistoryDownloadState[]
  extractors: string[]
  extensions: string[]
  dateRange: HistoryDateRange
  sizeMinBytes: number | null
  sizeMaxBytes: number | null
  durationMinSec: number | null
  durationMaxSec: number | null
  sortBy: 'date' | 'title' | 'size' | 'duration' | 'status'
  sortDir: 'asc' | 'desc'
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilterState = {
  query: '',
  useRegex: false,
  regexFlags: 'i',
  actions: [],
  states: [],
  extractors: [],
  extensions: [],
  dateRange: { from: null, to: null },
  sizeMinBytes: null,
  sizeMaxBytes: null,
  durationMinSec: null,
  durationMaxSec: null,
  sortBy: 'date',
  sortDir: 'desc',
}

export const DEFAULT_HISTORY_RETENTION: HistoryRetentionSetting = {
  mode: 'keep-everything',
  maxEntries: 500,
  maxAgeDays: 90,
}
