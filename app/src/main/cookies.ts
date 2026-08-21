import { readFile } from 'node:fs/promises'
import type { ValidateCookiesFileResult } from '../shared/stubs-contract'

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
