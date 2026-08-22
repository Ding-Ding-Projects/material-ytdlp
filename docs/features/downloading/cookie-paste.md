# Paste a cookie value

## Behavior

The "Cookie source" dialog (`design/…dc.html`'s `dialogLogin`) already offers two real cookie
routes: reading cookies live out of an installed browser (`--cookies-from-browser`), and picking
an already-exported Netscape-format cookie file (`--cookies <file>`, validated by
`app/src/main/cookies.ts`'s `validateCookiesFile`). Both require the user to either have a
supported browser installed on this machine, or to have already exported a file with a separate
browser extension.

This feature adds a third route beside them, in the same "Have a cookie jar already" section:
**paste whatever was copied out of the browser's own devtools directly**, with no export step.
The user pastes into a text area and, optionally, a domain field; the app detects the shape of
what was pasted, extracts the cookies, resolves a real domain for each one, writes a private
Netscape-format cookie file, and wires it to `--cookies` — exactly the same flag the file-picker
route sets.

### Accepted input shapes

Detected automatically, most structurally unambiguous first, in `app/src/main/cookies.ts`'s
`detectAndExtract`:

1. **A full Netscape `cookies.txt`**, pasted as text. Every non-blank, non-comment line must be a
   valid 7-tab-field cookie line (reusing the same `isCookieLine` check the file-picker route
   validates against) — this is checked first and is deliberately strict, so a header/value/curl
   paste can never be mistaken for it.
2. **A devtools "Copy all as JSON" cookie export** (Chrome/Edge's Application → Cookies panel). A
   JSON array (or a single object) of `{name, value, domain, path, secure, expirationDate}`-shaped
   objects. This is the one shape that already carries a *real* per-cookie domain/path/secure/
   expiry, so those real values are used instead of the defaults described below wherever the
   object actually supplies them.
3. **A devtools tab-separated table paste**, with a header row whose columns include at least
   `Name` and `Value` (case-insensitive); `Domain`, `Path`, and `Secure` columns are read too when
   present. A paste with no header row naming its columns is refused rather than guessed at
   positionally — parsing a table by column *position* alone is exactly the kind of "looks
   plausible" guess this feature avoids.
4. **A "Copy as cURL" command** (bash or PowerShell/cmd form), recognised by a `-H`/`--header`
   `Cookie: …` argument or a `-b`/`--cookie` argument. The domain is derived from the curl
   command's own target URL when the user did not type one into the domain field.
5. **A raw `Cookie:` request header line** (as pasted straight from the Network panel's Headers
   tab), recognised by a leading `cookie:` prefix (case-insensitive).
6. **A bare value** (`a=1; b=2; c=3`) — the fallback shape when nothing more specific matched.

Every `name=value` extraction (shapes 4–6) requires a non-empty name matching the RFC 6265
cookie-name token charset, so an unrelated sentence that happens to contain a semicolon and an
equals sign is not silently accepted as a cookie list.

### Domain resolution — never invented

A pasted header/value/curl paste carries no domain of its own (unlike a full `cookies.txt`, a JSON
export, or a table with a `Domain` column, which do). The Netscape format requires one per cookie,
so the dialog also has a "Domain" field, and the resolution order is:

1. **The cookie's own domain**, when the input shape supplied one (Netscape/JSON/table).
2. **The explicit "Domain" field**, if the user typed anything into it. Accepts either a bare
   domain (`.youtube.com`) or a full URL (`https://www.youtube.com/watch?v=…`) — `deriveDomain`
   in `cookies.ts` extracts the hostname from a URL the same way `firstUrlHostname` does for a
   curl command below.
3. **The curl command's own embedded URL** — *only* for a curl-shaped paste, and *only* when the
   domain field was left empty. `firstUrlHostname` scans the whole pasted text for the first
   `http(s)://` URL.

If none of these resolve a domain for a given cookie, the whole paste is refused with an exact,
actionable error (`"No domain to write these cookies against. Type a domain (e.g. ".youtube.com")
or a page URL above."` — or the curl-specific variant asking for the full command) rather than
guessing. **A cookie is never written against an invented or default domain.**

A domain field's own dot-prefix convention is honored: a domain starting with `.` sets the
Netscape "include subdomains" flag to `TRUE`; otherwise it is `FALSE`.

### What gets defaulted, and when it's honest to do so

The Netscape format needs `path`, `secure`, and `expiry` per cookie, and a header/value/curl/
bare-table paste does not carry them. When the source doesn't supply a field, this feature
defaults it plainly rather than guessing a "safer-sounding" wrong value:

- `path` defaults to `/`.
- `secure` defaults to `TRUE`.
- `expiry` defaults to `2147483647` (2038-01-19T03:14:07Z — the classic Netscape/Unix 32-bit
  "effectively never" value; yt-dlp and every cookiejar reader treat it as non-expiring for any
  realistic download session).

The JSON export shape is the exception: when the devtools object actually reports `secure`,
`path`, or `expirationDate`/`expires`, those real values are used instead of the defaults above.

### Where the file goes, and how it's protected

The parsed cookies are written to one stable path inside this app's own private data directory —
`<userData>/cookies/pasted.cookies.txt` — **never** next to the user's downloads, never in a
system temp directory, and never in the repository. A second paste overwrites the same file rather
than accumulating old, possibly-stale credentials on disk.

The write goes through `writeCookiesFilePrivately` in `cookies.ts`: the same write-temp-then-
rename-with-retry shape as `atomicWriteFile` in `store.ts` (a bounded retry on Windows'
`EPERM`/`EACCES`/`EBUSY` sharing-violation codes, since a rename can be momentarily refused by the
antivirus scanner, the search indexer, or a OneDrive-style sync client — see that file's own
comment for why a retry here is always safe), except the temp file is created at file mode `0o600`
from the start and the final path additionally gets a best-effort `chmod(0o600)` after the rename
lands.

**On Windows this is honest best-effort tightening, not a claimed security boundary** — Node's
`mode`/`chmod` do not map onto NTFS ACLs the way they do on POSIX; Node can really only toggle the
read-only attribute there. The real protection is that the file lives inside this app's own
`userData` directory, itself inside the signed-in user's own profile, which is not shared or
world-readable by default.

## Why the pasted value is never logged, exported, or displayed

A session cookie is a live credential for someone's account, exactly as much as a password is.
This feature is built around one hard rule, stated at the top of `app/src/main/cookies.ts`: no
function in the parsing/writing path ever calls `console.*`, the shared diagnostics logger
(`app/src/main/logging.ts`), or anything else that writes to disk or leaves the process, **with a
cookie value** — not by relying on `logging.ts`'s redact-by-field-name safety net (which does
cover the `cookie`/`cookies` keys, and still applies as defense in depth), but by simply never
passing a value to those call sites at all. Every error string in the module is either a fixed
constant or interpolates only a **count**, a **format label**, a **domain**, or the **byte length**
of the whole paste — never a cookie name, never a cookie value, never a slice of the raw pasted
text.

The IPC contract enforces the same rule structurally: `ParseCookiePasteRequest`
(`app/src/shared/cookies-contract.ts`) carries the raw pasted text into the main process exactly
once, and `ParseCookiePasteResult` carries back only `ok`, `cookieCount`, `cookieNames` (names
only — never a value), `domain`, `format`, `path`, and `error`. The renderer never re-parses,
inspects, or re-displays the pasted text or a cookie value itself; it only ever collects the
textarea/domain input into transient component state and makes one round trip to
`bridge.cookies.parsePaste(...)`. On a successful parse, the pasted text is cleared from component
state (`cookiePasteText: ''`) so it does not linger in memory or in the DOM any longer than the one
parse it was needed for.

This also does not appear in: the download history, an export, the local version history, a
screen capture, telemetry, or a crash report — none of those surfaces are ever given a cookie
value or the raw pasted text to begin with, so there is nothing for them to accidentally include.

## The card

Sits directly below the existing "Have a cookie jar already" file-picker card, in the same visual
idiom (same card background/radius/padding, same uppercase-label header style, same body-paragraph
style, same primary-button style). States, all honest — no control ever looks like it applied
something it did not:

- **Nothing pasted yet** — the default, empty state.
- **Parsing…** — while the one IPC round trip to `bridge.cookies.parsePaste` is in flight; the
  "Parse & wire" button is disabled and its own label changes to "Parsing…" for the same duration,
  and a second click while one parse is already in flight is a no-op (`parseCookiePaste` checks
  `comp.state.cookiePasteBusy` first).
- **Failed: `<exact reason>`** — the precise error string `cookies.ts` returned; the pasted text
  and domain field are left in place so the user can fix and retry rather than having to re-paste.
- **In use — `N` cookie(s) for `<domain>`.** — shown once a paste has succeeded *and* the app's
  current `--cookies` value still equals the path this card last wrote to (i.e. nothing else, such
  as the file-picker route beside it, has since replaced it).

## Files

- `app/src/shared/cookies-contract.ts` — the `CookiePasteIpcChannel` channel enum and the
  `ParseCookiePasteRequest`/`ParseCookiePasteResult` types shared between the main process and the
  preload bridge. Deliberately separate from `stubs-contract.ts`'s `CookiesIpcChannel`, which owns
  the unrelated file-picker validation route.
- `app/src/main/cookies.ts` — `parseCookiePasteAndWrite` and everything it calls: format
  detection, name=value extraction, domain derivation, and the private atomic write. Also still
  owns the pre-existing `validateCookiesFile` (file-picker route), unchanged.
- `app/src/main/ipc.ts` — registers `CookiePasteIpcChannel.Parse`.
- `app/src/preload/index.ts` — exposes `window.ytdlpStudio.cookies.parsePaste`.
- `scripts/wire-cookie-paste.mjs` — the renderer half: the card's markup, its three `_wire`
  handlers, its per-instance default state, and its render bindings. Runs after `wire-stubs.mjs`
  in `scripts/build-renderer-from-design.mjs`'s wiring chain, since its needles are the markup and
  handlers that lane already produced.

## Failure modes

- **Nothing recognisable was pasted** — every detector in `detectAndExtract` returned nothing. The
  error names every shape the feature does understand, so the user knows what to try instead of
  seeing a bare "invalid".
- **The paste is implausibly long** (over 200,000 characters) — refused before any parsing is
  attempted; this is a defensive bound against pathological input, not a meaningful attack
  surface, and no real cookie paste comes close to it.
- **No domain could be resolved** for one or more cookies — refused with the exact, actionable
  message described above, and *nothing* is written; a partially-domained cookie file is never
  produced.
- **The private write itself fails** (disk full, permissions) — reported as `Could not write the
  cookie file: <the underlying fs error's own message>`. That underlying message can only ever
  contain paths and OS error text; it is never built from cookie data.
