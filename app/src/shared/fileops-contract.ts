// ---------------------------------------------------------------------------
// Host file-operations contract: channel names and payload/result types
// shared between the main process (app/src/main/fileops.ts) and the
// preload bridge (app/src/preload/index.ts). No Electron import here —
// this file is safe to import from either side (and, transitively, from
// the renderer's type-only usage) without pulling in Node/Electron APIs.
// ---------------------------------------------------------------------------

export enum FileOpsIpcChannel {
  ExportContent = 'fileops:export-content',
  RevealPath = 'fileops:reveal-path',
  OpenPath = 'fileops:open-path',
  OpenInEditor = 'fileops:open-in-editor',
  ListConfigFiles = 'fileops:list-config-files',
  ReadConfigFile = 'fileops:read-config-file',
  WriteConfigFile = 'fileops:write-config-file',
  ValidateConfigText = 'fileops:validate-config-text',
  ReadArchive = 'fileops:read-archive',
  CompactArchive = 'fileops:compact-archive',
}

// -- Export (Save As… + atomic write) ---------------------------------------

export interface ExportContentRequest {
  /** Filename offered in the Save dialog, e.g. "history.json". */
  suggestedName: string
  /** The exact bytes to write, as text. */
  contents: string
  /** Human label used only for dialog filters, e.g. "JSON". */
  formatLabel?: string
}

export interface ExportContentResult {
  ok: boolean
  /** The path actually written to. Null when cancelled or failed. */
  path: string | null
  cancelled: boolean
  error: string | null
}

// -- Reveal in file manager --------------------------------------------------

export interface RevealPathRequest {
  path: string
  /** True to open a directory itself rather than revealing a file inside it. */
  isDirectory?: boolean
}

export interface RevealPathResult {
  ok: boolean
  error: string | null
}

// -- Open with the OS default application ------------------------------------

export interface OpenPathRequest {
  path: string
}

export interface OpenPathResult {
  ok: boolean
  error: string | null
}

// -- External editor handoff -------------------------------------------------

export interface OpenInEditorRequest {
  path: string
  /** True when `path` is a folder that should open as a workspace root. */
  asFolder?: boolean
}

export interface OpenInEditorResult {
  ok: boolean
  /** Which route actually opened it, or null when nothing could. */
  method: 'vscode' | 'os-default' | null
  error: string | null
}

// -- Config files -------------------------------------------------------------

export type ConfigFileId = 'portable' | 'home' | 'user' | 'system' | 'locations'

export interface ConfigFileInfo {
  id: ConfigFileId
  label: string
  path: string
  exists: boolean
}

export interface ReadConfigFileResult {
  exists: boolean
  contents: string | null
  error: string | null
}

export interface WriteConfigFileResult {
  ok: boolean
  path: string
  error: string | null
}

export interface ValidateConfigTextResult {
  valid: boolean
  lineCount: number
  activeLineCount: number
  errors: string[]
}

// -- Download archive ----------------------------------------------------------

export interface ReadArchiveResult {
  exists: boolean
  path: string | null
  lineCount: number
  error: string | null
}

export interface CompactArchiveResult {
  ok: boolean
  path: string | null
  beforeBytes: number
  afterBytes: number
  removedDuplicates: number
  error: string | null
}
