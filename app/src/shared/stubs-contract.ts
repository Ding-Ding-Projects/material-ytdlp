// ---------------------------------------------------------------------------
// Contract for the "honest stubs" lane: real, host-side validation for a
// user-picked Netscape-format cookie jar. Types only — no Electron import
// here, so both the main process and the preload bridge can share it.
// ---------------------------------------------------------------------------

export enum CookiesIpcChannel {
  ValidateFile = 'cookies:validate-file',
}

export interface ValidateCookiesFileResult {
  ok: boolean
  /** Number of real cookie lines found (comments and blank lines excluded). */
  cookieCount: number
  /** True when the file's first non-blank line is a recognized Netscape/curl header comment. */
  hasHeader: boolean
  error: string | null
}
