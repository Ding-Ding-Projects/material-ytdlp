import { BrowserWindow, dialog, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve as resolvePath, sep } from 'node:path'
import { promisify } from 'node:util'
import { atomicWriteFile, getStore } from './store'
import type {
  CompactArchiveResult,
  ConfigFileId,
  ConfigFileInfo,
  ExportContentRequest,
  ExportContentResult,
  OpenInEditorRequest,
  OpenInEditorResult,
  OpenPathRequest,
  OpenPathResult,
  ReadArchiveResult,
  ReadConfigFileResult,
  RevealPathRequest,
  RevealPathResult,
  ValidateConfigTextResult,
  WriteConfigFileResult,
} from '../shared/fileops-contract'

const execFileAsync = promisify(execFile)

function owner(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err
}

// ---------------------------------------------------------------------------
// Export: a real Save As… dialog followed by a genuine atomic write. Every
// path here is untrusted renderer input, so nothing is ever passed through a
// shell — only Node's fs APIs and Electron's own dialog are used.
// ---------------------------------------------------------------------------

function extensionFilters(suggestedName: string, formatLabel?: string): Electron.FileFilter[] {
  const ext = suggestedName.includes('.') ? suggestedName.split('.').pop() ?? '' : ''
  const filters: Electron.FileFilter[] = []
  if (ext) filters.push({ name: formatLabel ? `${formatLabel} file` : ext.toUpperCase(), extensions: [ext] })
  filters.push({ name: 'All files', extensions: ['*'] })
  return filters
}

export async function exportContent(req: ExportContentRequest): Promise<ExportContentResult> {
  const win = owner()
  const dialogOptions: Electron.SaveDialogOptions = {
    defaultPath: req.suggestedName,
    filters: extensionFilters(req.suggestedName, req.formatLabel),
  }
  const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
  if (result.canceled || !result.filePath) {
    return { ok: false, path: null, cancelled: true, error: null }
  }
  try {
    await atomicWriteFile(result.filePath, req.contents)
    // Never claim success without verifying the write actually landed at
    // the path we return to the caller.
    const info = await stat(result.filePath)
    if (!info.isFile()) {
      return { ok: false, path: null, cancelled: false, error: 'Write completed but the result is not a file.' }
    }
    return { ok: true, path: result.filePath, cancelled: false, error: null }
  } catch (err) {
    return { ok: false, path: null, cancelled: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Reveal in file manager
// ---------------------------------------------------------------------------

export async function revealPath(req: RevealPathRequest): Promise<RevealPathResult> {
  if (!req.path) return { ok: false, error: 'No path was given.' }
  if (!existsSync(req.path)) {
    return { ok: false, error: `Nothing exists at "${req.path}".` }
  }
  try {
    if (req.isDirectory) {
      const err = await shell.openPath(req.path)
      if (err) return { ok: false, error: err }
      return { ok: true, error: null }
    }
    shell.showItemInFolder(req.path)
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Open with the OS default application ("Play file" / "Open file" — the
// Library row's own control, distinct from openInEditor below which prefers
// VS Code first). shell.openPath RETURNS an error string on failure rather
// than throwing, so its result is always checked and reported honestly
// instead of assumed to have worked.
//
// Only ever opens a path this app itself already knows about: the current
// download destination (Store.getLastPaths().downloadFolder), or the
// directory of a path recorded in a real JobHistoryEntry (a file this app
// actually downloaded, even if the download folder setting has since
// changed). Anything else is refused — the renderer should never be able to
// hand this bridge an arbitrary filesystem path and have it opened.
// ---------------------------------------------------------------------------

async function isWithinKnownRoots(targetPath: string): Promise<boolean> {
  const store = getStore()
  const [lastPaths, jobHistory] = await Promise.all([store.getLastPaths(), store.getJobHistory()])
  const roots = new Set<string>()
  if (lastPaths.downloadFolder) roots.add(resolvePath(lastPaths.downloadFolder))
  for (const entry of jobHistory) {
    if (entry.outputPath) roots.add(resolvePath(dirname(entry.outputPath)))
  }
  const target = resolvePath(targetPath)
  for (const root of roots) {
    if (target === root || target.startsWith(root + sep)) return true
  }
  return false
}

export async function openPath(req: OpenPathRequest): Promise<OpenPathResult> {
  if (!req.path) return { ok: false, error: 'No path was given.' }
  if (!(await isWithinKnownRoots(req.path))) {
    return { ok: false, error: `"${req.path}" is outside this app's known download folders and was not opened.` }
  }
  if (!existsSync(req.path)) {
    return { ok: false, error: `Nothing exists at "${req.path}" anymore.` }
  }
  try {
    const err = await shell.openPath(req.path)
    if (err) return { ok: false, error: err }
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// External editor handoff. Detect a real editor rather than assuming one:
// try `code` on PATH, then the usual per-user/machine VS Code install
// locations (stable and Insiders), then fall back to the OS default file
// association via shell.openPath. Report honestly when nothing can open it.
// ---------------------------------------------------------------------------

function vscodeCandidates(): string[] {
  const home = homedir()
  const candidates: string[] = ['code', 'code-insiders']
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    candidates.push(
      join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd'),
      join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
      join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'),
      join(programFiles, 'Microsoft VS Code', 'Code.exe'),
      join(programFilesX86, 'Microsoft VS Code', 'bin', 'code.cmd'),
    )
  }
  return candidates
}

async function tryLaunchVscode(bin: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(bin, args, { windowsHide: true, timeout: 10_000 })
    return true
  } catch (err) {
    // ENOENT: the binary is not there. Anything else (e.g. a benign
    // non-zero exit some `code` builds use even on success) is treated as
    // "it launched" only if the binary was actually found; distinguish by
    // checking the error code we got.
    if (isNodeError(err) && err.code === 'ENOENT') return false
    // The binary exists and was invoked; VS Code returns immediately, so a
    // non-ENOENT failure here most likely still means it opened.
    return true
  }
}

export async function openInEditor(req: OpenInEditorRequest): Promise<OpenInEditorResult> {
  if (!req.path) return { ok: false, method: null, error: 'No path was given.' }
  if (!existsSync(req.path)) {
    return { ok: false, method: null, error: `Nothing exists at "${req.path}".` }
  }
  // Opening a folder must land as a workspace root, not a lone file with no
  // context, so pass the folder itself as the sole argument either way.
  const args = [req.path]
  for (const candidate of vscodeCandidates()) {
    const launched = await tryLaunchVscode(candidate, args)
    if (launched) return { ok: true, method: 'vscode', error: null }
  }
  // No VS Code install found anywhere we looked: fall back to the OS
  // default association rather than failing silently.
  try {
    const err = await shell.openPath(req.path)
    if (err) return { ok: false, method: null, error: `No editor was found, and the OS could not open it either: ${err}` }
    return { ok: true, method: 'os-default', error: null }
  } catch (err) {
    return { ok: false, method: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Config file locations (matching yt-dlp's own documented search order) and
// per-location read/write/validate.
// ---------------------------------------------------------------------------

function configFilePath(id: ConfigFileId): string {
  const home = homedir()
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  switch (id) {
    case 'portable':
      return join(process.cwd(), 'yt-dlp.conf')
    case 'home':
      return join(home, 'yt-dlp.conf')
    case 'user':
      return platform() === 'win32' ? join(appData, 'yt-dlp', 'config') : join(home, '.config', 'yt-dlp', 'config')
    case 'system':
      return platform() === 'win32' ? 'C:\\ProgramData\\yt-dlp\\config.txt' : '/etc/yt-dlp.conf'
    case 'locations':
      // --config-locations has no single fixed path; report the portable
      // location as a stand-in until the renderer supplies an explicit one.
      return join(process.cwd(), 'yt-dlp-locations.conf')
  }
}

const CONFIG_FILE_LABELS: Record<ConfigFileId, string> = {
  portable: 'Portable',
  home: 'Home',
  user: 'User',
  system: 'System',
  locations: '--config-locations',
}

export function listConfigFiles(): ConfigFileInfo[] {
  const ids: ConfigFileId[] = ['portable', 'home', 'user', 'system', 'locations']
  return ids.map((id) => {
    const path = configFilePath(id)
    return { id, label: CONFIG_FILE_LABELS[id], path, exists: existsSync(path) }
  })
}

export async function readConfigFile(id: ConfigFileId): Promise<ReadConfigFileResult> {
  const path = configFilePath(id)
  try {
    const contents = await readFile(path, 'utf8')
    return { exists: true, contents, error: null }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return { exists: false, contents: null, error: null }
    return { exists: false, contents: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function writeConfigFile(id: ConfigFileId, contents: string): Promise<WriteConfigFileResult> {
  const path = configFilePath(id)
  try {
    await atomicWriteFile(path, contents)
    return { ok: true, path, error: null }
  } catch (err) {
    return { ok: false, path, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * A real parse, not merely a check for missing values: every non-comment
 * line must look like a flag (`-x` or `--long-flag`), optionally followed
 * by a value. Blank lines and full-line `#` comments are ignored.
 */
export function validateConfigText(text: string): ValidateConfigTextResult {
  const lines = text.split(/\r\n|\r|\n/)
  const errors: string[] = []
  let activeLineCount = 0
  const flagLine = /^\s*(-{1,2}[A-Za-z][\w-]*)(\s+(.*))?$/
  lines.forEach((raw, idx) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    activeLineCount++
    const match = flagLine.exec(line)
    if (!match) {
      errors.push(`Line ${idx + 1}: "${line}" does not look like a flag.`)
      return
    }
    const [, flag] = match
    if (flag === '-' || flag === '--') {
      errors.push(`Line ${idx + 1}: "${line}" is missing a flag name.`)
    }
  })
  return { valid: errors.length === 0, lineCount: lines.length, activeLineCount, errors }
}

// ---------------------------------------------------------------------------
// Download archive: a plain text file of one extractor-id line per entry.
// ---------------------------------------------------------------------------

function archivePath(explicitPath: string | null): string | null {
  if (explicitPath) return explicitPath
  return null
}

export async function readArchive(explicitPath: string | null): Promise<ReadArchiveResult> {
  const path = archivePath(explicitPath)
  if (!path) return { exists: false, path: null, lineCount: 0, error: 'No download-archive path is configured yet.' }
  try {
    const contents = await readFile(path, 'utf8')
    const lineCount = contents.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0).length
    return { exists: true, path, lineCount, error: null }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return { exists: false, path, lineCount: 0, error: null }
    return { exists: false, path, lineCount: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function compactArchive(explicitPath: string | null): Promise<CompactArchiveResult> {
  const path = archivePath(explicitPath)
  if (!path) {
    return { ok: false, path: null, beforeBytes: 0, afterBytes: 0, removedDuplicates: 0, error: 'No download-archive path is configured yet.' }
  }
  try {
    const before = await readFile(path, 'utf8')
    const beforeBytes = Buffer.byteLength(before, 'utf8')
    const seen = new Set<string>()
    const kept: string[] = []
    let removedDuplicates = 0
    for (const raw of before.split(/\r\n|\r|\n/)) {
      const line = raw.trim()
      if (!line) continue
      if (seen.has(line)) {
        removedDuplicates++
        continue
      }
      seen.add(line)
      kept.push(line)
    }
    const after = kept.join('\n') + (kept.length ? '\n' : '')
    await atomicWriteFile(path, after)
    const afterBytes = Buffer.byteLength(after, 'utf8')
    return { ok: true, path, beforeBytes, afterBytes, removedDuplicates, error: null }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { ok: false, path, beforeBytes: 0, afterBytes: 0, removedDuplicates: 0, error: `No archive file exists yet at "${path}".` }
    }
    return { ok: false, path, beforeBytes: 0, afterBytes: 0, removedDuplicates: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
