import { app } from 'electron'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ValidateCookiesFileResult } from '../shared/stubs-contract'
import type { CookiePasteFormat, ParseCookiePasteRequest, ParseCookiePasteResult } from '../shared/cookies-contract'

// ---------------------------------------------------------------------------
// Real validation for a user-picked Netscape-format cookie jar (the format
// yt-dlp's --cookies flag, and browser cookie-export extensions, both use).
//
// A Netscape cookie file is plain text:
//   - blank lines are ignored;
//   - a line starting with "#" is a comment, EXCEPT a line starting with
//     "#HttpOnly_" — that prefix marks a real cookie whose HttpOnly flag is
//     set, so the "#HttpOnly_" prefix is stripped before the field split;
//   - every other non-blank line is exactly 7 TAB-separated fields:
//       domain, includeSubdomains (TRUE/FALSE), path, secure (TRUE/FALSE),
//       expiry (integer seconds, 0 for a session cookie), name, value.
//
// This is a real structural parse, not merely "does the first line have a
// comment": every candidate cookie line is field-counted and field-checked,
// and the file is rejected as not a cookie jar when nothing in it actually
// parses as a cookie line.
// ---------------------------------------------------------------------------

const HEADER_PREFIXES = ['# Netscape HTTP Cookie File', '# HTTP Cookie File']
const HTTP_ONLY_PREFIX = '#HttpOnly_'

function isCookieLine(line: string): boolean {
  const stripped = line.startsWith(HTTP_ONLY_PREFIX) ? line.slice(HTTP_ONLY_PREFIX.length) : line
  const fields = stripped.split('\t')
  if (fields.length !== 7) return false
  const [domain, includeSubdomains, path, secure, expiry] = fields
  if (!domain) return false
  if (!/^(TRUE|FALSE)$/i.test(includeSubdomains)) return false
  if (!path.startsWith('/')) return false
  if (!/^(TRUE|FALSE)$/i.test(secure)) return false
  if (!/^\d+$/.test(expiry)) return false
  return true
}

export async function validateCookiesFile(path: string): Promise<ValidateCookiesFileResult> {
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (err) {
    return {
      ok: false,
      cookieCount: 0,
      hasHeader: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const lines = contents.split(/\r\n|\r|\n/)
  let hasHeader = false
  let cookieCount = 0
  let firstNonBlankSeen = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!firstNonBlankSeen) {
      firstNonBlankSeen = true
      hasHeader = HEADER_PREFIXES.some((h) => line.startsWith(h))
    }
    if (line.startsWith('#') && !line.startsWith(HTTP_ONLY_PREFIX)) continue // a genuine comment line
    if (isCookieLine(line)) cookieCount++
  }

  if (cookieCount === 0) {
    return {
      ok: false,
      cookieCount: 0,
      hasHeader,
      error: firstNonBlankSeen
        ? 'This file has no valid Netscape-format cookie lines (7 tab-separated fields per line).'
        : 'This file is empty.',
    }
  }

  return { ok: true, cookieCount, hasHeader, error: null }
}

// ---------------------------------------------------------------------------
// "Paste a cookie value" -- the second cookie route. The above validates a
// file the user already exported with a browser extension; everything below
// lets the user skip that extension entirely by pasting whatever they
// copied straight out of devtools, and turns it into the same Netscape file
// format yt-dlp's --cookies flag reads.
//
// THIS IS CREDENTIAL MATERIAL. A session cookie is a live credential for
// someone's account, exactly as much as a password is. Every function below
// that ever holds an actual cookie VALUE in a variable does so only long
// enough to format one Netscape line, and:
//
//   - never calls console.*, the shared logger (logging.ts), or anything
//     that writes to the app's diagnostics log with a cookie value -- this
//     file simply never passes a value to those, at all, rather than
//     relying on logging.ts's redact-by-field-name safety net;
//   - every error string below is either a fixed constant or interpolates
//     only a COUNT, a FORMAT label, a DOMAIN, or a byte length of the whole
//     paste -- never a cookie name, never a cookie value, never a slice of
//     the raw pasted text;
//   - the only place a value is ever written is the one private file at
//     `pastedCookiesFilePath()`, inside this app's own userData directory,
//     never next to the user's downloads, never in a temp directory that
//     outlives the write, never in the repository, and never in the
//     renderer's own persisted state, export, or local-history record (the
//     renderer only ever holds the pasted text in transient component
//     state for the one round trip to this module -- see wire-cookie-
//     paste.mjs for how that state is cleared).
// ---------------------------------------------------------------------------

const FAR_FUTURE_EXPIRY = 2147483647 // 2038-01-19T03:14:07Z -- the classic Netscape/Unix 32-bit "effectively never" value. yt-dlp and every cookiejar reader treat it as non-expiring for any realistic download session.
const MAX_PASTE_LENGTH = 200_000 // generous headroom over any real paste (a whole cookies.txt export easily fits); guards against pathological input, not a meaningful attack surface.
const COOKIE_NAME_RE = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/ // RFC 6265 cookie-name token charset

function cookiesDir(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, 'cookies')
}

/**
 * Where the pasted-cookie route writes. One stable path, overwritten on
 * every successful paste -- so pasting again replaces the previous jar
 * rather than accumulating old, possibly-stale credentials on disk.
 */
function pastedCookiesFilePath(userDataDir?: string): string {
  return join(cookiesDir(userDataDir), 'pasted.cookies.txt')
}

/**
 * Writes `contents` privately: the same write-temp-then-rename-with-retry
 * shape as `atomicWriteFile` in store.ts (Windows can refuse a rename onto
 * a momentarily-open destination -- antivirus, the search indexer, and
 * OneDrive-style sync clients all do this for a few milliseconds right
 * after a file lands; a bounded retry is safe because a rename is one
 * indivisible operation that can never produce a torn write), duplicated
 * here rather than imported so this module never has to reach into
 * store.ts (out of this lane's owned files) for something this small.
 *
 * The temp file is created at mode 0o600 from the start, and the final
 * path additionally gets a best-effort `chmod(0o600)` after the rename
 * lands. On Windows, `mode`/`chmod` do not map onto NTFS ACLs the way they
 * do on POSIX -- Node can really only toggle the read-only attribute there
 * -- so this is honest best-effort tightening, not a claim of a security
 * boundary. The real protection on Windows is that the file lives under
 * this app's own `userData` directory, inside the signed-in user's own
 * profile, not shared or world-readable by default.
 */
async function writeCookiesFilePrivately(targetPath: string, contents: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = join(dirname(targetPath), `.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  await writeFile(tempPath, contents, { encoding: 'utf8', mode: 0o600 })

  const RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
  let lastError: unknown = null
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await rename(tempPath, targetPath)
      lastError = null
      break
    } catch (err) {
      lastError = err
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as NodeJS.ErrnoException).code) : ''
      if (RETRYABLE_CODES.has(code)) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
        continue
      }
      break
    }
  }
  if (lastError) {
    await unlink(tempPath).catch(() => undefined)
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }
  await chmod(targetPath, 0o600).catch(() => undefined) // best-effort; see comment above
}

interface ParsedCookie {
  name: string
  value: string
  /** null only transiently, during parsing, before the request/derived domain is merged in. */
  domain: string | null
  path: string
  secure: boolean
  includeSubdomains: boolean
  expiry: number
}

/**
 * Accepts a bare domain ("youtube.com", ".youtube.com") or a full URL and
 * returns a bare hostname either way. Returns null when the input cannot be
 * made sense of as either -- this is what stands between a typo and a
 * cookie silently written against a nonsense domain.
 */
function deriveDomain(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const hostname = new URL(trimmed).hostname
      return hostname || null
    } catch {
      return null
    }
  }
  const candidate = trimmed.replace(/\/.*$/, '') // tolerate a trailing path the user left on a bare domain
  if (!/^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(candidate)) return null
  if (!candidate.includes('.') && candidate.toLowerCase() !== 'localhost') return null
  return candidate
}

/** Scans arbitrary pasted text (a curl command, typically) for the first http(s) URL and returns its hostname. */
function firstUrlHostname(text: string): string | null {
  const match = /https?:\/\/[^\s'"<>]+/i.exec(text)
  if (!match) return null
  try {
    const hostname = new URL(match[0]).hostname
    return hostname || null
  } catch {
    return null
  }
}

/**
 * Splits a `name=value; name2=value2` string into pairs. Every segment must
 * have a non-empty name matching the RFC 6265 cookie-name token charset --
 * that whitelist is what keeps this from "successfully" parsing an
 * unrelated sentence that happens to contain a semicolon and an equals
 * sign. Returns null (not an empty array) when nothing in the string
 * qualifies, so the caller can tell "found zero cookies" apart from
 * "this was not name=value shaped at all".
 */
function parseNameValuePairs(raw: string): Array<{ name: string; value: string }> | null {
  const segments = raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return null
  const pairs: Array<{ name: string; value: string }> = []
  for (const seg of segments) {
    const eq = seg.indexOf('=')
    if (eq <= 0) return null
    const name = seg.slice(0, eq).trim()
    const value = seg.slice(eq + 1).trim()
    if (!name || !COOKIE_NAME_RE.test(name)) return null
    pairs.push({ name, value })
  }
  return pairs
}

/** Finds a `-H 'Cookie: ...'` / `--header "Cookie: ..."` or `-b '...'` / `--cookie '...'` argument inside a "Copy as cURL" command and returns just the cookie text inside the quotes. Null when neither shape is present. */
function extractCurlCookieText(text: string): string | null {
  const headerMatch = /(?:-H|--header)\s+(['"])\s*cookie\s*:\s*([\s\S]*?)\1/i.exec(text)
  if (headerMatch) return headerMatch[2]
  const bMatch = /(?:^|\s)(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/i.exec(text)
  if (bMatch) return bMatch[2]
  return null
}

/** True only when EVERY non-blank, non-comment line is a valid 7-field Netscape cookie line -- a header/value/curl paste fails this immediately, since none of those are tab-separated 7-field lines. */
function looksLikeNetscapeText(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/)
  let sawCookieLine = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (HEADER_PREFIXES.some((h) => line.startsWith(h))) {
      sawCookieLine = true
      continue
    }
    if (line.startsWith('#') && !line.startsWith(HTTP_ONLY_PREFIX)) continue
    if (isCookieLine(line)) {
      sawCookieLine = true
      continue
    }
    return false
  }
  return sawCookieLine
}

function parseNetscapeText(text: string): ParsedCookie[] | null {
  const out: ParsedCookie[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#') && !line.startsWith(HTTP_ONLY_PREFIX)) continue
    if (!isCookieLine(line)) continue
    const stripped = line.startsWith(HTTP_ONLY_PREFIX) ? line.slice(HTTP_ONLY_PREFIX.length) : line
    const [domain, includeSubdomains, path, secure, expiry, name, value] = stripped.split('\t')
    out.push({
      name,
      value,
      domain,
      path,
      secure: /^true$/i.test(secure),
      includeSubdomains: /^true$/i.test(includeSubdomains),
      expiry: Number.parseInt(expiry, 10) || FAR_FUTURE_EXPIRY,
    })
  }
  return out.length > 0 ? out : null
}

/** A single devtools "Copy all as JSON" cookie object -- only the fields this module reads, everything else on the real object is ignored. */
interface DevtoolsJsonCookie {
  name?: unknown
  value?: unknown
  domain?: unknown
  path?: unknown
  secure?: unknown
  expires?: unknown
  expirationDate?: unknown
}

/** Chrome/Edge devtools' Application > Cookies panel "Copy all as JSON" export: a JSON array (or, tolerantly, a single object) of cookie objects that already carry a real per-cookie domain/path/secure/expiry -- the most unambiguous paste shape this module accepts, so real values are used wherever the object provides them instead of the header/value/curl defaults. */
function parseJsonPaste(text: string): ParsedCookie[] | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null // cheap reject before the JSON.parse cost
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return null
  }
  const list: unknown[] = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []
  const out: ParsedCookie[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const c = item as DevtoolsJsonCookie
    if (typeof c.name !== 'string' || !c.name || typeof c.value !== 'string') continue
    const domain = typeof c.domain === 'string' && c.domain ? c.domain : null
    const path = typeof c.path === 'string' && c.path ? c.path : '/'
    const secure = typeof c.secure === 'boolean' ? c.secure : true
    const rawExpiry = typeof c.expirationDate === 'number' ? c.expirationDate : typeof c.expires === 'number' ? c.expires : null
    const expiry = rawExpiry !== null && Number.isFinite(rawExpiry) && rawExpiry > 0 ? Math.round(rawExpiry) : FAR_FUTURE_EXPIRY
    out.push({ name: c.name, value: c.value, domain, path, secure, includeSubdomains: (domain ?? '').startsWith('.'), expiry })
  }
  return out.length > 0 ? out : null
}

/** A tab-separated paste with a header row naming its columns (devtools' other common "copy the cookie table" shape). Requires at minimum a "Name" and a "Value" column, case-insensitively, or this is refused rather than guessed at positionally. */
function parseTablePaste(text: string): ParsedCookie[] | null {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return null
  if (!lines[0].includes('\t')) return null
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase())
  const nameIdx = header.indexOf('name')
  const valueIdx = header.indexOf('value')
  if (nameIdx === -1 || valueIdx === -1) return null
  const domainIdx = header.indexOf('domain')
  const pathIdx = header.indexOf('path')
  const secureIdx = header.indexOf('secure')

  const out: ParsedCookie[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    if (cells.length <= Math.max(nameIdx, valueIdx)) continue // a ragged row is skipped, not fatal to the whole paste
    const name = (cells[nameIdx] ?? '').trim()
    if (!name) continue
    const value = (cells[valueIdx] ?? '').trim()
    const domain = domainIdx !== -1 ? (cells[domainIdx] ?? '').trim() || null : null
    const path = pathIdx !== -1 && (cells[pathIdx] ?? '').trim() ? cells[pathIdx].trim() : '/'
    const secure = secureIdx !== -1 ? /^(true|✓|yes)$/i.test((cells[secureIdx] ?? '').trim()) : true
    out.push({ name, value, domain, path, secure, includeSubdomains: (domain ?? '').startsWith('.'), expiry: FAR_FUTURE_EXPIRY })
  }
  return out.length > 0 ? out : null
}

/**
 * Detects the shape of `text` and extracts cookies from it, trying the
 * most structurally unambiguous shapes first so a full cookies.txt or a
 * devtools JSON export is never mistaken for a bare value.
 */
function detectAndExtract(text: string): { cookies: ParsedCookie[]; format: CookiePasteFormat } | null {
  if (looksLikeNetscapeText(text)) {
    const cookies = parseNetscapeText(text)
    if (cookies) return { cookies, format: 'netscape' }
  }

  const jsonCookies = parseJsonPaste(text)
  if (jsonCookies) return { cookies: jsonCookies, format: 'json' }

  const tableCookies = parseTablePaste(text)
  if (tableCookies) return { cookies: tableCookies, format: 'table' }

  const curlCookieText = extractCurlCookieText(text)
  if (curlCookieText !== null) {
    const pairs = parseNameValuePairs(curlCookieText)
    if (pairs) {
      const cookies = pairs.map((p) => ({
        name: p.name,
        value: p.value,
        domain: null as string | null, // resolved by the caller from the explicit field or the curl command's own URL
        path: '/',
        secure: true,
        includeSubdomains: false,
        expiry: FAR_FUTURE_EXPIRY,
      }))
      return { cookies, format: 'curl' }
    }
  }

  const headerMatch = /^\s*cookie\s*:\s*(.+)$/im.exec(text)
  const bareText = headerMatch ? headerMatch[1] : text.trim()
  const pairs = parseNameValuePairs(bareText)
  if (pairs) {
    const cookies = pairs.map((p) => ({
      name: p.name,
      value: p.value,
      domain: null as string | null,
      path: '/',
      secure: true,
      includeSubdomains: false,
      expiry: FAR_FUTURE_EXPIRY,
    }))
    return { cookies, format: headerMatch ? 'header' : 'value' }
  }

  return null
}

/**
 * Parses whatever the user pasted, resolves a real domain for every cookie
 * (never inventing one), writes a private Netscape-format cookie file, and
 * returns counts/names/domain/format/path -- never a cookie value. See the
 * "SECRET MATERIAL" comment above for the rules this function and
 * everything it calls are held to.
 */
export async function parseCookiePasteAndWrite(req: ParseCookiePasteRequest): Promise<ParseCookiePasteResult> {
  const text = typeof req.text === 'string' ? req.text : ''
  const explicitDomainRaw = typeof req.domain === 'string' ? req.domain : ''

  const fail = (error: string, format: CookiePasteFormat | null = null): ParseCookiePasteResult => ({
    ok: false,
    cookieCount: 0,
    cookieNames: [],
    domain: null,
    format,
    path: null,
    error,
  })

  if (!text.trim()) {
    return fail('Paste something first -- a Cookie header, a plain value, a curl command, or a cookies.txt.')
  }
  if (text.length > MAX_PASTE_LENGTH) {
    return fail(`That paste is too long (${text.length} characters, ${MAX_PASTE_LENGTH} max). Paste just the cookie value or header, not the whole page.`)
  }

  const detected = detectAndExtract(text)
  if (!detected || detected.cookies.length === 0) {
    return fail(
      'Could not recognise that as a Cookie header, a plain "name=value; name2=value2" string, a "Copy as cURL" command, a full cookies.txt, or a devtools cookie export (JSON or a Name/Value table). Check that it has at least one name=value pair.',
    )
  }
  const { cookies, format } = detected

  let explicitDomain: string | null = null
  if (explicitDomainRaw.trim()) {
    explicitDomain = deriveDomain(explicitDomainRaw)
    if (!explicitDomain) {
      return fail(
        `"${explicitDomainRaw.trim()}" does not look like a domain or URL. Try something like ".youtube.com" or "https://www.youtube.com/watch?v=...".`,
        format,
      )
    }
  }

  // curl is the one format that may derive a domain from text the user
  // pasted rather than typed, per the requirement that a plain header/value
  // paste (which carries no URL of its own) must never have a domain
  // invented for it -- only an explicit domain/URL the user actually
  // supplied, or the URL embedded in a curl command they actually copied.
  const curlDerivedDomain = format === 'curl' && !explicitDomain ? firstUrlHostname(text) : null

  const resolved: ParsedCookie[] = []
  for (const c of cookies) {
    const domain = c.domain ?? explicitDomain ?? curlDerivedDomain
    if (!domain) {
      return fail(
        format === 'curl'
          ? 'No domain found. Type a domain above, or paste the full curl command including its target URL.'
          : 'No domain to write these cookies against. Type a domain (e.g. ".youtube.com") or a page URL above.',
        format,
      )
    }
    resolved.push({ ...c, domain, includeSubdomains: c.includeSubdomains || domain.startsWith('.') })
  }

  const domains = Array.from(new Set(resolved.map((c) => c.domain as string)))
  const contents = [
    '# Netscape HTTP Cookie File',
    '# Written by yt-dlp Studio from a pasted cookie value. Do not share this file -- it may contain live session credentials.',
    ...resolved.map((c) => [c.domain, c.includeSubdomains ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(c.expiry), c.name, c.value].join('\t')),
    '',
  ].join('\n')

  const targetPath = pastedCookiesFilePath()
  try {
    await writeCookiesFilePrivately(targetPath, contents)
  } catch (err) {
    return fail(`Could not write the cookie file: ${err instanceof Error ? err.message : String(err)}`, format)
  }

  return {
    ok: true,
    cookieCount: resolved.length,
    cookieNames: resolved.map((c) => c.name),
    domain: domains.join(', '),
    format,
    path: targetPath,
    error: null,
  }
}
