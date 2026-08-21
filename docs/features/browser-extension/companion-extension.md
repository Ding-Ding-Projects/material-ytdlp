# The Companion extension

## Behavior

`extension/` at the repository root is the yt-dlp Studio Companion: a Manifest V3 Chrome/Edge
extension whose entire job is reading the current tab's URL and handing it to the desktop app.
It ships as its own, independent package — a `manifest.json`, a popup, an options page, and a
static install-help page — bundled into the installer via `electron-builder.yml`'s
`extraResources` (`from: ../extension` → `to: extension`) so an installed copy of yt-dlp Studio
always carries a matching copy of the extension on disk, resolved at runtime by
`app/src/main/protocol.ts`.

**Popup (`popup.html` / `popup.js`).** On open, it calls `chrome.tabs.query({ active: true,
currentWindow: true })` to read the active tab's `url` and `title`. If the URL is not `http:` or
`https:` (a `chrome://` page, a `file://` page, another extension's page, or no URL at all), the
card shows an honest explanation — *"This page isn't a link this extension can send. Open a video
page (http/https) first…"* — and the **Send to yt-dlp Studio** button stays disabled. Otherwise
the page's title and URL are shown and the button is live.

Clicking it builds `ytdlp-studio://download?url=<encodeURIComponent(pageUrl)>` and fires it by
creating a hidden, unattached `<a href="…">` element inside the popup's own document and
clicking it — not by navigating the tab the user is looking at (`chrome.tabs.update`), which
would leave the video page and replace it with a failed navigation attempt. A hidden-anchor click
is the standard way to trigger a custom-protocol handler prompt from a page without touching
whatever the user is actually viewing.

**Options page (`options.html` / `options.js`).** The extension's entire settings surface: one
real, working toggle, *"Confirm before sending a link"*, backed by `chrome.storage.local` (not
`.sync` — this never touches a Google account or leaves the machine) and defaulting to off. When
on, the popup's Send button requires a second click (see below) before it fires. A link to
`install.html` covers the case where the reader followed a link to this page without the
extension actually being usable yet.

**Install page (`install.html`).** A static reference page mirroring the same three-step guide
the desktop app's own **Browser extension** dialog shows (see
[protocol-handoff.md](protocol-handoff.md)), reachable from the popup and options page. It exists
because this page can only be *opened* from inside an already-loaded extension — a first-time
installer's actual starting point is the app's own dialog, which can show a live folder path;
this page is for reference afterward, or for handing off to someone else setting it up.

## Configuration

- **The one user-facing setting** is the confirm-before-sending toggle described above.
- Nothing else is configurable: there is no destination picker, no auto-download mode, no site
  allowlist. The extension does exactly one thing.

## Failure modes

- **The desktop app isn't installed, or isn't registered as the `ytdlp-studio://` handler.**
  Chrome and Edge give an extension **no signal at all** when a custom-protocol navigation
  attempt finds no registered handler — no error event, no rejected promise, nothing observable
  in JavaScript. The popup therefore never claims to know whether the handoff succeeded. Every
  click shows *"Sent to yt-dlp Studio."* immediately, and — because success genuinely cannot be
  confirmed — a second, muted line always appears about 2.2 seconds later: *"Nothing happened?
  yt-dlp Studio may not be installed yet, or Windows hasn't been told to open `ytdlp-studio://`
  links with it,"* linking to the install guide. This is a deliberate choice over a fake
  "Connected"/"Disconnected" status badge, which the extension has no way to back up honestly.
- **The current tab isn't a downloadable page.** Covered above — the button is disabled and the
  card explains why, rather than being clickable and silently doing nothing.
- **`chrome.storage.local` is unavailable or throws.** `options.js`'s load/save both catch and
  report the error inline rather than leaving the toggle in an indeterminate state;
  `popup.js`'s read of the confirm-before-send setting fails open to "no extra confirmation"
  rather than blocking the Send button entirely.

## Security considerations

- **Permissions are `activeTab` and `storage` only** — no `<all_urls>`, no `host_permissions`, no
  `tabs`. `activeTab` grants the extension the current tab's real `url`/`title` only in direct
  response to the user's own click on the toolbar icon (which is how the popup opens in the
  first place), and only for that tab; it never grants background access to browsing history or
  any other tab. `storage` backs the one settings toggle.
- **No `background` service worker.** The whole feature — read the tab, build a link, click a
  hidden anchor — runs synchronously inside the popup while it is open. There is nothing to keep
  alive, nothing for MV3's aggressive service-worker teardown to lose state from.
- **No native messaging host, no listening port, no signing key.** See
  [protocol-handoff.md](protocol-handoff.md) for why: code signing (browser-extension signing
  explicitly included) is permanently prohibited in this project, and a stable ID for an unpacked
  extension's native-messaging host manifest would require exactly that.
- **`manifest.json` carries no `key` field.** Its extension ID is therefore the normal
  content-hash-derived ID Chrome assigns to an unpacked load, which changes if the folder moves —
  this is expected and is why nothing in this project (including the protocol handoff) depends on
  a stable extension ID anywhere.
- **The outgoing link carries only the current page's URL**, URL-encoded, and nothing else — no
  cookies, no page content, no browsing history. `app/src/main/protocol.ts` treats it as
  untrusted input regardless (see that article for the validation it applies on arrival).

## Verification status

**Loaded and exercised in a real, unmodified Google Chrome install**, via the actual "Load
unpacked" flow (a real native folder picker, not a `--load-extension` command-line flag) driven
through the cheap Lowlevel headless-desktop route so the user's own visible browser session was
never touched. Observed directly, with real screenshots:

- The extension registers cleanly under Developer mode with no error banner, the correct name,
  description, version, and the app's own icon rasterized at 16/48/128px.
- `popup.html` (opened directly by URL, since this automation route could not reliably drive the
  native toolbar-icon click bubble — see the caveat below) renders the real dark/teal theme and
  correctly shows the honest disabled state, since the popup's own `chrome-extension://` URL is
  not an `http(s)` page.
- `options.html` renders, and the confirm-before-send toggle was flipped on and **survived a full
  page reload**, confirming `chrome.storage.local` persistence genuinely works rather than only
  updating in-memory state.
- `install.html` renders the three-step guide correctly.

**Not verified:** the actual toolbar-icon → popup-bubble → click flow. Chrome's extensions
dropdown (the puzzle-piece menu) is a `views::Widget` bubble that did not respond to the
background `PostMessage`-based clicks this automation route uses — clicking its row posted the
message successfully but never opened the popup window, most likely because that particular
control tracks real hover/capture state rather than accepting a synthetic click with no
preceding mouse movement. This is a limitation of the verification tooling used, not a
defect observed in the extension: the popup's own HTML/CSS/JS were confirmed to load and behave
correctly by navigating to it directly. Also not verified: an actual successful
`ytdlp-studio://` handoff reaching a running yt-dlp Studio and pre-filling Easy mode — that needs
the desktop app itself built, launched, and registered as the protocol handler, which was outside
this pass's scope (see [protocol-handoff.md](protocol-handoff.md)'s verification status).
