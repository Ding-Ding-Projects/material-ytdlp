// ---------------------------------------------------------------------------
// Local diagnostics logging contract: channel names and payload/result
// types shared between the main process (app/src/main/logging.ts) and the
// preload bridge (app/src/preload/index.ts). No Electron import here —
// this file is safe to import from either side (and, transitively, from
// the renderer's type-only usage) without pulling in Node/Electron APIs.
//
// This exists to close one specific gap: main-process code already catches
// startup/lifecycle failures into `console.error`, and in a packaged build
// nobody is watching that console — it goes nowhere. A renderer error can
// throw hundreds of times per reload with nothing visible on screen and
// nothing left behind afterward. Every write in this feature lands on real
// disk, under the app's own userData directory, so a user (or whoever is
// helping them) can find out what happened after the fact.
// ---------------------------------------------------------------------------

export enum LoggingIpcChannel {
  /** Renderer -> main, request/response: write one explicit log entry. */
  Write = 'logging:write',
  /** Renderer -> main, request/response: get the absolute path to the active log file. */
  GetPath = 'logging:get-path',
  /** Renderer -> main, request/response: open the log folder in the OS file manager. */
  OpenFolder = 'logging:open-folder',
  /**
   * Renderer -> main, fire-and-forget (`ipcRenderer.send` / `ipcMain.on`,
   * never `invoke`): automatic capture of `window.onerror` and
   * `window.onunhandledrejection`. This path exists specifically to survive
   * things already going wrong, so it must never itself depend on a
   * request/response round trip that could hang or reject.
   */
  ReportFault = 'logging:report-fault',
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Which process/world a log line originated in. */
export type LogSource = 'main' | 'renderer'

export interface LogWriteRequest {
  level: LogLevel
  message: string
  /**
   * Optional structured context. Redacted by FIELD NAME (password, token,
   * cookie, secret, authorization, etc.) before it is ever written to disk
   * — never by pattern-matching the text, which is guesswork. A URL is not
   * redacted: this app downloads user-supplied URLs, and logging them is
   * the point.
   */
  meta?: Record<string, unknown> | null
}

export type LogFaultKind = 'window-error' | 'unhandled-rejection'

export interface LogFaultReport {
  kind: LogFaultKind
  message: string
  stack?: string | null
  /** Script/file the fault was attributed to, when the browser reports one. */
  source?: string | null
  line?: number | null
  column?: number | null
}

export interface OpenLogFolderResult {
  ok: boolean
  error: string | null
}
