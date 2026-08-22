// ---------------------------------------------------------------------------
// Contract for the "paste a cookie value" route: the user copies a
// `Cookie:` request header, a bare `a=1; b=2` value, a browser devtools
// "Copy as cURL" command, a full Netscape cookies.txt, or a devtools
// "Copy all as JSON" / tab-separated table cookie export straight out of
// their browser and pastes it here instead of exporting a file with a
// browser extension first.
//
// Types only -- no Electron import, so both the main process and the
// preload bridge can share this file (same shape as ../shared/stubs-
// contract.ts, which owns the separate "pick an existing cookie file"
// route and is left untouched by this one).
//
// This is credential material. The main process (app/src/main/cookies.ts)
// does 100% of the parsing and never returns a cookie VALUE across this
// channel in either direction -- only counts, cookie NAMES, a domain, and
// a format label. See cookies.ts for the full reasoning.
// ---------------------------------------------------------------------------

export enum CookiePasteIpcChannel {
  Parse = 'cookies:paste-parse',
}

/** Which shape the pasted text was recognised as. */
export type CookiePasteFormat = 'netscape' | 'json' | 'table' | 'curl' | 'header' | 'value'

export interface ParseCookiePasteRequest {
  /**
   * The raw text the user pasted. Sent to the main process exactly once
   * for parsing and never round-tripped, logged, exported, or persisted
   * anywhere else -- see the "SECRET MATERIAL" rules at the top of
   * cookies.ts.
   */
  text: string
  /**
   * An explicit domain (e.g. ".youtube.com") or a full URL the user typed
   * into the accompanying "Domain" field. Optional: a curl-shaped paste
   * can derive its own domain from the URL curl was copied for, and a
   * full Netscape/JSON/table paste already carries a domain per cookie.
   */
  domain: string | null
}

export interface ParseCookiePasteResult {
  ok: boolean
  /** How many cookies were parsed. Never a value. */
  cookieCount: number
  /** Cookie NAMES only, in parse order -- never a cookie value. */
  cookieNames: string[]
  /** The domain (or comma-joined domains, for a multi-domain paste) the cookies were written against. */
  domain: string | null
  /** Which input shape was recognised, or null when nothing was recognised or the paste was refused. */
  format: CookiePasteFormat | null
  /** Absolute path to the generated Netscape-format cookies file, private to this app's own data directory, or null on failure. */
  path: string | null
  /** The exact reason for a failure. Never contains a cookie value or the raw pasted text. */
  error: string | null
}
