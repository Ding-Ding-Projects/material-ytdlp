import { BrowserWindow, app, dialog } from 'electron'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  APP_MARK_MAX_DIMENSION_PX,
  APP_MARK_MAX_FILE_BYTES,
  APP_MARK_MIN_DIMENSION_PX,
  emptyAppMarkState,
  type AppMarkApplyResult,
  type AppMarkState,
} from '../shared/settings-actions-contract'

// ---------------------------------------------------------------------------
// Custom application mark: a user-picked local image applied as the DISPLAY
// mark only (title bar / tray). Changing it never touches the userData
// directory's identity, the installer identity, the update feed, or any
// other stable installed identity — those are separate constants elsewhere
// in the app and are never derived from this file.
//
// Only PNG is accepted. The file is stored and rendered as-is — never
// re-encoded — so the only format that can be safely allowlisted without a
// decoding library is one every target platform and the renderer's own
// <img>/CSS can already render natively without us touching a pixel.
// Verification is therefore: the real magic bytes (never the extension),
// the real IHDR-reported dimensions bounded to a sane range, and a hard
// ceiling on the raw file size — all checked BEFORE anything is written to
// disk, so a malformed or oversized file is rejected wholesale rather than
// partially applied.
// ---------------------------------------------------------------------------

const MARK_FILENAME = 'app-mark.png'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function markPath(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, MARK_FILENAME)
}

interface PngInspection {
  widthPx: number
  heightPx: number
}

/**
 * Verifies the real PNG signature and reads width/height straight out of
 * the mandatory leading IHDR chunk (always the first chunk in a valid PNG,
 * always 25 bytes long including its own length/type/CRC). This is not a
 * full decode — no pixel data is ever touched — which is deliberate: the
 * file is stored and displayed byte-for-byte, so all that is needed here is
 * proof the bytes are really a PNG and a bound on its declared dimensions.
 */
function inspectPng(bytes: Buffer): PngInspection | null {
  if (bytes.length < 8 + 25) return null
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  // IHDR chunk: 4-byte length, 4-byte type "IHDR", then 4-byte width, 4-byte height (big-endian).
  const chunkType = bytes.toString('ascii', 12, 16)
  if (chunkType !== 'IHDR') return null
  const widthPx = bytes.readUInt32BE(16)
  const heightPx = bytes.readUInt32BE(20)
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx)) return null
  return { widthPx, heightPx }
}

export type AppMarkValidation = { ok: true; widthPx: number; heightPx: number } | { ok: false; reason: string }

/**
 * Validates the COMPLETE raw file bytes before anything is stored: size
 * ceiling, real PNG signature (never the file extension or a claimed MIME
 * type), and bounded declared dimensions. Any failure returns a specific
 * reason and applies nothing.
 */
export function validateAppMarkBytes(bytes: Buffer): AppMarkValidation {
  if (bytes.length === 0) return { ok: false, reason: 'The selected file is empty.' }
  if (bytes.length > APP_MARK_MAX_FILE_BYTES) {
    return { ok: false, reason: `File is ${bytes.length} bytes, which exceeds the ${APP_MARK_MAX_FILE_BYTES}-byte limit.` }
  }
  const inspected = inspectPng(bytes)
  if (!inspected) {
    return { ok: false, reason: 'That file is not a valid PNG image (checked by its actual bytes, not its name).' }
  }
  const { widthPx, heightPx } = inspected
  if (
    widthPx < APP_MARK_MIN_DIMENSION_PX ||
    heightPx < APP_MARK_MIN_DIMENSION_PX ||
    widthPx > APP_MARK_MAX_DIMENSION_PX ||
    heightPx > APP_MARK_MAX_DIMENSION_PX
  ) {
    return {
      ok: false,
      reason: `Image is ${widthPx}x${heightPx}px; it must be between ${APP_MARK_MIN_DIMENSION_PX} and ${APP_MARK_MAX_DIMENSION_PX}px on each side.`,
    }
  }
  return { ok: true, widthPx, heightPx }
}

// ---------------------------------------------------------------------------
// Atomic binary write, mirroring the retry discipline in `store.ts`'s
// string-only `atomicWriteFile` (kept local to this file rather than
// widening that helper's signature, since this lane owns only new files).
// A single rename-over-destination is not atomic-in-practice on Windows: a
// momentarily-open destination (antivirus scan, indexer, sync client) makes
// the rename fail with a transient EPERM/EACCES/EBUSY, so the rename is
// retried a bounded number of times rather than surfaced as data loss.
// ---------------------------------------------------------------------------

const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RETRY_ATTEMPTS = 6
const RETRY_DELAY_MS = 50
let tempCounter = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err
}

async function atomicWriteBinaryFile(targetPath: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = join(dirname(targetPath), `.${process.pid}-${tempCounter++}.mark.tmp`)
  await writeFile(tempPath, bytes)

  let lastError: unknown = null
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      await rename(tempPath, targetPath)
      return
    } catch (err) {
      lastError = err
      if (!isNodeError(err) || !RETRYABLE_CODES.has(err.code ?? '')) {
        try {
          await unlink(tempPath)
        } catch {
          // best effort cleanup
        }
        throw err
      }
      await sleep(RETRY_DELAY_MS)
    }
  }
  try {
    await unlink(tempPath)
  } catch {
    // best effort cleanup
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to write the application mark file.')
}

// ---------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------

async function readMarkState(userDataDir?: string): Promise<AppMarkState> {
  const path = markPath(userDataDir)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    return emptyAppMarkState()
  }
  const inspected = inspectPng(bytes)
  if (!inspected) return emptyAppMarkState()
  let updatedAt: number | null = null
  try {
    updatedAt = (await stat(path)).mtimeMs
  } catch {
    updatedAt = null
  }
  return { active: true, widthPx: inspected.widthPx, heightPx: inspected.heightPx, updatedAt }
}

/** Re-reads the on-disk mark. A missing, corrupt, or unreadable file fails closed to the empty (shipped-mark) state. */
export async function getAppMarkState(userDataDir?: string): Promise<AppMarkState> {
  return readMarkState(userDataDir)
}

/** Deletes the custom mark. Idempotent: resetting an already-shipped mark is not an error. */
export async function resetAppMark(userDataDir?: string): Promise<AppMarkState> {
  try {
    await unlink(markPath(userDataDir))
  } catch {
    // Already absent, or unreadable — either way there is nothing more to reset.
  }
  return emptyAppMarkState()
}

async function pickPngFile(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Application mark (PNG)', extensions: ['png'] }],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/**
 * Opens the native file picker, and on a real selection reads, validates by
 * real bytes, and (only on success) stores it as the active mark. On
 * cancellation or rejection, the previously-active mark (or the shipped
 * mark) is reported unchanged — a rejected file never applies partially.
 */
export async function pickAndApplyAppMark(userDataDir?: string): Promise<AppMarkApplyResult> {
  const path = await pickPngFile()
  if (path === null) {
    return { ok: true, cancelled: true, error: null, state: await readMarkState(userDataDir) }
  }

  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (err) {
    return {
      ok: false,
      cancelled: false,
      error: `Could not read the selected file: ${err instanceof Error ? err.message : String(err)}`,
      state: await readMarkState(userDataDir),
    }
  }

  const validated = validateAppMarkBytes(bytes)
  if (!validated.ok) {
    return { ok: false, cancelled: false, error: validated.reason, state: await readMarkState(userDataDir) }
  }

  await atomicWriteBinaryFile(markPath(userDataDir), bytes)
  const state: AppMarkState = {
    active: true,
    widthPx: validated.widthPx,
    heightPx: validated.heightPx,
    updatedAt: Date.now(),
  }
  return { ok: true, cancelled: false, error: null, state }
}
