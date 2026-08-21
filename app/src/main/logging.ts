// ---------------------------------------------------------------------------
// Local diagnostics logging.
//
// Writes a real, rotating text log under `app.getPath('userData')/logs/`.
// This is the fix for a specific, concrete gap: main-process code already
// catches startup/lifecycle failures into `console.error` (see history.ts,
// squirrel-startup.ts, ipc.ts), and in a packaged build there is no console
// anyone is watching — those lines go nowhere. On the renderer side, a
// single error was observed throwing 476 times in one reload with nothing
// visible on screen and nothing left behind afterward. Everything captured
// here lands on disk instead, so a user (or whoever is helping them) can
// find out what happened after the app has already closed.
//
// Two hard rules shape everything below:
//
//   1. A logger that can crash the app it is diagnosing is worse than none.
//      Every public function here is wrapped so a failure inside logging
//      itself never throws into its caller — swallow and move on.
//   2. Logs get pasted into GitHub issues. Redact by FIELD NAME (password,
//      token, cookie, secret, authorization, ...) before anything reaches
//      disk. Never redact by pattern-matching the message text — that is
//      guesswork, and it is exactly as likely to hide a URL as a secret.
// ---------------------------------------------------------------------------

import { app, shell, type WebContents } from 'electron'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { appendFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LogFaultReport, LogLevel, LogSource, LogWriteRequest, OpenLogFolderResult } from '../shared/logging-contract'

const LOG_FILENAME = 'main.log'
// Small and cheap by design — this is a diagnostics trail, not an archive.
// A log that grows without bound is its own bug.
const MAX_BYTES = 5 * 1024 * 1024 // 5 MiB per generation
const MAX_BACKUPS = 2 // main.log -> main.log.1 -> main.log.2, oldest dropped

const VALID_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

// Never log these fields' VALUES, whatever the message otherwise says.
// Matched case-insensitively with separators stripped, so `api_key`,
// `apiKey`, and `API-KEY` are all caught by one entry.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pass',
  'pin',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'cookie',
  'cookies',
  'secret',
  'clientsecret',
  'apikey',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'sessionid',
  'privatekey',
  'signature',
])

let logDir = ''
let logPath = ''
let initialized = false
let currentBytes = 0
// Serializes writes so bursts (476 renderer errors in one reload, for
// example) cannot interleave lines or race a rotation.
let writeChain: Promise<void> = Promise.resolve()

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s]/g, '')
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (depth > 6) return '[truncated: too deep]'
  if (SENSITIVE_KEYS.has(normalizeKey(key))) return '[redacted]'
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? null }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item, index) => redactValue(String(index), item, depth + 1))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v, depth + 1)
    }
    return out
  }
  return value
}

function redactMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    out[key] = redactValue(key, value, 0)
  }
  return out
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '"[unserializable meta]"'
  }
}

/**
 * `JSON.stringify(err)` on a real `Error` yields `"{}"` — message and stack
 * live on non-enumerable-to-JSON accessor-less own properties that
 * `JSON.stringify` does not walk the way a plain object's do in every
 * engine build, and depending on that is exactly the kind of log line that
 * tells you nothing. Serialize explicitly instead.
 */
function errorToText(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`
  }
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function normalizeLevel(level: unknown): LogLevel {
  return typeof level === 'string' && (VALID_LEVELS as readonly string[]).includes(level) ? (level as LogLevel) : 'info'
}

// ---------------------------------------------------------------------------
// Writer: append-only, size-capped rotation, never throws.
// ---------------------------------------------------------------------------

async function rotateIfNeeded(nextLineBytes: number): Promise<void> {
  if (currentBytes + nextLineBytes <= MAX_BYTES) return
  try {
    await rm(`${logPath}.${MAX_BACKUPS}`, { force: true })
    for (let generation = MAX_BACKUPS - 1; generation >= 1; generation--) {
      const src = `${logPath}.${generation}`
      const dest = `${logPath}.${generation + 1}`
      if (existsSync(src)) await rename(src, dest)
    }
    if (existsSync(logPath)) await rename(logPath, `${logPath}.1`)
  } catch {
    // Best-effort. If rotation itself fails (locked file, permissions), fall
    // through and keep appending to the same file rather than losing the
    // entry that triggered the rotation check.
  } finally {
    currentBytes = 0
  }
}

async function doWrite(line: string): Promise<void> {
  try {
    const buf = Buffer.from(line, 'utf8')
    await rotateIfNeeded(buf.byteLength)
    await appendFile(logPath, buf)
    currentBytes += buf.byteLength
  } catch {
    // A logger that can crash the app it is diagnosing is worse than none.
  }
}

function writeRaw(level: LogLevel, source: LogSource, message: string): void {
  if (!initialized) return
  try {
    const line = `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] [${source}] ${message}\n`
    // Chain onto the previous write so lines from concurrent sources (a
    // burst of console-message events, an uncaughtException mid-write)
    // cannot interleave or race the rotation check.
    writeChain = writeChain.then(() => doWrite(line)).catch(() => undefined)
  } catch {
    // Never throw into the caller this is trying to diagnose.
  }
}

function writeWithMeta(level: LogLevel, source: LogSource, message: string, meta?: Record<string, unknown> | null): void {
  const metaStr = meta ? ` ${safeStringify(redactMeta(meta))}` : ''
  writeRaw(level, source, `${message}${metaStr}`)
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export interface LoggingHandles {
  logPath: string
  logDir: string
}

/**
 * Sets up the log directory/file and installs process-wide failure hooks.
 * Call this once, as early as possible in main-process startup — before
 * Squirrel lifecycle handling, before `app.whenReady()`, before any window
 * exists — so a failure anywhere in startup lands on disk instead of
 * vanishing into a console nobody is watching.
 *
 * Idempotent: a second call is a no-op and returns the same paths.
 */
export function initLogging(): LoggingHandles {
  if (initialized) return { logPath, logDir }

  try {
    logDir = join(app.getPath('userData'), 'logs')
    logPath = join(logDir, LOG_FILENAME)
    mkdirSync(logDir, { recursive: true })
    try {
      currentBytes = statSync(logPath).size
    } catch {
      currentBytes = 0
    }
    initialized = true
  } catch {
    // If even the directory can't be created, logging degrades to a no-op
    // (writeRaw checks `initialized`) rather than throwing into startup.
    return { logPath, logDir }
  }

  writeRaw(
    'info',
    'main',
    `Logging started. ${app.getName()} v${app.getVersion()} on ${process.platform} ${process.arch}, ` +
      `Electron ${process.versions.electron}, Node ${process.versions.node}.`,
  )

  process.on('uncaughtException', (err) => {
    writeRaw('error', 'main', `Uncaught exception in main process: ${errorToText(err)}`)
  })
  process.on('unhandledRejection', (reason) => {
    writeRaw('error', 'main', `Unhandled promise rejection in main process: ${errorToText(reason)}`)
  })

  app.on('render-process-gone', (_event, contents, details) => {
    let url = '(unknown)'
    try {
      url = contents.getURL()
    } catch {
      // webContents may already be gone; the reason/exitCode below still matter.
    }
    writeRaw(
      'error',
      'main',
      `Renderer process gone: reason=${details.reason} exitCode=${details.exitCode} url=${url}`,
    )
  })

  app.on('child-process-gone', (_event, details) => {
    writeRaw(
      'error',
      'main',
      `Child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}` +
        (details.name ? ` name=${details.name}` : ''),
    )
  })

  return { logPath, logDir }
}

/**
 * Attaches renderer-side failure capture to one window's WebContents. Call
 * this immediately after creating each `BrowserWindow`.
 *
 * `console-message` is the important one: it is Electron's own supported
 * mechanism for observing every `console.log`/`warn`/`error` call a page
 * makes, fired from the main process against the real WebContents — it
 * does not depend on the renderer's own code cooperating, and it is not
 * defeated by contextIsolation the way patching `window.console` from a
 * preload script would be (preload's `window` is a different object from
 * the page's; see `app/src/preload/index.ts` for the belt-and-suspenders
 * `window.onerror`/`unhandledrejection` capture, which uses native
 * `addEventListener` instead and does cross that boundary). Chromium also
 * routes an uncaught page exception's own "Uncaught TypeError: ..." text
 * through this same console mechanism, so this alone already catches most
 * of what silently vanished before.
 */
export function attachWebContentsLogging(webContents: WebContents): void {
  webContents.on('console-message', (event) => {
    const level: LogLevel = event.level === 'warning' ? 'warn' : event.level === 'debug' ? 'debug' : event.level === 'error' ? 'error' : 'info'
    const location = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : ''
    writeRaw(level, 'renderer', `[console] ${event.message}${location}`)
  })

  webContents.on('preload-error', (_event, preloadPath, error) => {
    writeRaw('error', 'renderer', `Preload script error in ${preloadPath}: ${errorToText(error)}`)
  })
}

/** Renderer -> main explicit log write (the `logging.write` bridge call). Input is untrusted at runtime; level is normalized. */
export function handleRendererWrite(req: LogWriteRequest): void {
  writeWithMeta(normalizeLevel(req.level), 'renderer', String(req.message ?? ''), req.meta ?? undefined)
}

/** Renderer -> main automatic fault capture (`window.onerror` / `window.onunhandledrejection`, sent fire-and-forget). */
export function handleRendererFaultReport(report: LogFaultReport): void {
  const location = report.source
    ? ` at ${report.source}${report.line != null ? `:${report.line}${report.column != null ? `:${report.column}` : ''}` : ''}`
    : ''
  const stackPart = report.stack ? `\n${report.stack}` : ''
  writeRaw('error', 'renderer', `[${report.kind}] ${report.message}${location}${stackPart}`)
}

/** For use by other main-process modules that want to log without an IPC round trip. */
export function logMain(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  writeWithMeta(level, 'main', message, meta)
}

/** Absolute path to the active log file, for the "get log path" bridge call and for support-ticket-style handoffs. */
export function getLogPath(): string {
  if (logPath) return logPath
  // Defensive fallback: reachable only if a caller asks before initLogging()
  // has run, which should not happen given it is called first in index.ts.
  return join(app.getPath('userData'), 'logs', LOG_FILENAME)
}

/** Opens the log folder in the OS file manager. Mirrors `support-tickets.ts`'s `openSupportDataFolder`. */
export async function openLogFolder(): Promise<OpenLogFolderResult> {
  try {
    const dir = logDir || dirname(getLogPath())
    const errorMessage = await shell.openPath(dir)
    if (errorMessage) {
      return { ok: false, error: `Could not open the log folder: ${errorMessage}` }
    }
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
