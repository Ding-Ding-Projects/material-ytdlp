// scripts/wire-cookie-paste.mjs
//
// "cookie_paste_pig" lane: adds a "paste a cookie value" route beside the
// design's existing "Have a cookie jar already" file-picker card, so a user
// who copied a `Cookie:` header, a bare value, a "Copy as cURL" command, a
// full cookies.txt, or a devtools JSON/table export straight out of
// devtools can wire it to --cookies without exporting a file with a
// browser extension first.
//
// Runs AFTER wireStubs (see build-renderer-from-design.mjs's wiring chain)
// -- every needle below is captured from the output wireStubs already
// produced: the real "Have a cookie jar already" card markup, the real
// `pickCookiesFile` handler, and the real per-instance default state it
// added. Anchoring here rather than on the design source means this lane
// cannot silently stop matching the moment wireStubs' own output changes
// shape without anyone noticing -- the assertion in replaceExact still
// fires either way.
//
// THIS FILE HAS NO REGEX OF ITS OWN, DELIBERATELY. All of the actual cookie
// parsing (Cookie-header/curl/JSON/table/Netscape detection, name=value
// extraction, domain derivation) lives in app/src/main/cookies.ts -- a real
// .ts file, compiled normally, where a backslash in a regex means what it
// looks like it means. The renderer code emitted here only ever collects
// the pasted text and an optional domain into component state and makes
// ONE round trip to bridge.cookies.parsePaste(...); it never re-parses,
// re-displays, or logs the pasted text or any cookie value itself. That
// split exists specifically to stay clear of the documented trap where
// `\d`/`\s`/`\/` inside a plain (non-raw) JS template literal silently
// lose their backslash before this script ever runs -- there is nothing
// here for that trap to bite.
//
// This module owns ONLY the `replaceExact` targets below. It never touches
// `app/src/renderer/**` directly -- it only returns modified HTML text for
// the orchestrator to write out.

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireCookiePaste(html, replaceExact) {
  html = wireCookiePasteMarkup(html, replaceExact)
  html = wireCookiePasteHandlers(html, replaceExact)
  html = wireCookiePasteDefaultState(html, replaceExact)
  html = wireCookiePasteBindings(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 1. Markup: a new card in the same visual idiom as the two cards beside it
//    (same background/radius/padding, same uppercase-label header style,
//    same body-paragraph style, same primary-button style), inserted right
//    after the "Have a cookie jar already" card and before the dialog's
//    Close button.
// ---------------------------------------------------------------------------

function wireCookiePasteMarkup(html, replaceExact) {
  const needle = `              <button onClick="{{ pickCookiesFile }}" style="padding:9px 16px;border-radius:20px;font-weight:700;background:transparent;border:1px solid #889391;color:#82d5cc;flex:0 0 auto">Browse for a cookie file…</button>
            </div>
          </div>

          <button onClick="{{ closeDialog }}" style="width:100%;margin-top:16px;padding:11px;border-radius:22px;font-weight:700;background:transparent;border:1px solid #3f4948;color:#dee4e3">Close</button>`

  const replacement = `              <button onClick="{{ pickCookiesFile }}" style="padding:9px 16px;border-radius:20px;font-weight:700;background:transparent;border:1px solid #889391;color:#82d5cc;flex:0 0 auto">Browse for a cookie file…</button>
            </div>
          </div>

          <div style="background:#161c1c;border-radius:12px;padding:14px 16px;margin-top:12px">
            <p style="margin:0 0 4px;color:#82d5cc;font-size:11px;text-transform:uppercase;letter-spacing:1.3px;font-weight:800">Paste a cookie value</p>
            <p style="color:#bec9c7;margin:0 0 11px;font-size:12.5px">Copied a <code style="color:#82d5cc">Cookie:</code> header, a plain value, a "Copy as cURL" command, a whole cookies.txt, or a devtools JSON/table export? Paste it below — it is parsed on this machine, written to a private Netscape file, and wired to <code style="color:#82d5cc">--cookies</code>. The value itself is never logged, exported, or saved anywhere else.</p>
            <textarea value="{{ cookiePasteText }}" onChange="{{ setCookiePasteText }}" placeholder="Cookie: name=value; name2=value2 — or a Copy as cURL command, or a whole cookies.txt" style="width:100%;min-height:60px;background:#252b2b;border:1px solid #3f4948;border-radius:9px;color:#dee4e3;padding:8px 10px;font-size:12px;font-family:'Roboto Mono',Consolas,monospace;resize:vertical;box-sizing:border-box"></textarea>
            <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
              <input value="{{ cookiePasteDomain }}" onChange="{{ setCookiePasteDomain }}" placeholder="Domain, e.g. .youtube.com (optional if the paste has a URL)" style="flex:1;height:36px;background:#252b2b;border:1px solid #3f4948;border-radius:9px;color:#dee4e3;padding:0 10px;font-size:12.5px;box-sizing:border-box" />
              <button onClick="{{ parseCookiePaste }}" disabled="{{ cookiePasteBusy }}" style="padding:9px 16px;border-radius:20px;font-weight:700;background:#82d5cc;color:#003733;flex:0 0 auto">{{ cookiePasteButtonLabel }}</button>
            </div>
            <p style="color:{{ cookiePasteError ? '#ffb4ab' : '#889391' }};margin:8px 0 0;font-size:11.5px">{{ cookiePasteStatusText }}</p>
          </div>

          <button onClick="{{ closeDialog }}" style="width:100%;margin-top:16px;padding:11px;border-radius:22px;font-weight:700;background:transparent;border:1px solid #3f4948;color:#dee4e3">Close</button>`

  return replaceExact(html, needle, replacement, 1)
}

// ---------------------------------------------------------------------------
// 2. `_wire` handlers: two trivial state setters plus the one real action.
//    `parseCookiePaste` makes exactly one IPC round trip
//    (bridge.cookies.parsePaste) and reads back only ok/cookieCount/
//    cookieNames/domain/format/path/error -- it never inspects, logs, or
//    re-displays a cookie value, and the pasted text is cleared from
//    component state on success so it does not linger in the DOM/state
//    tree any longer than the one parse it was needed for.
// ---------------------------------------------------------------------------

function wireCookiePasteHandlers(html, replaceExact) {
  const needle = `      pickCookiesFile(comp) {
        const bridge = window.ytdlpStudio;
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        bridge.dialogs.pickCookiesFile().then(p => {
          if (!p) return; // cancelled dialog is not an error
          if (!bridge.cookies) { comp.toast('Not connected', 'window.ytdlpStudio.cookies is missing'); return; }
          return bridge.cookies.validateFile(p).then(res => {
            if (!res || !res.ok) { comp.toast('Not a cookie jar', (res && res.error) || 'That file could not be validated'); return; }
            comp.setV('--cookies', p);
            comp.setState({ loginCookieCount: res.cookieCount, cookieFilePath: p, dialog: null });
            comp.toast('Cookie jar wired', res.cookieCount + ' cookie(s) from ' + p);
          });
        }).catch(err => comp.toast('Picker failed', String(err && err.message ? err.message : err)));
      },`

  const replacement = `      pickCookiesFile(comp) {
        const bridge = window.ytdlpStudio;
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        bridge.dialogs.pickCookiesFile().then(p => {
          if (!p) return; // cancelled dialog is not an error
          if (!bridge.cookies) { comp.toast('Not connected', 'window.ytdlpStudio.cookies is missing'); return; }
          return bridge.cookies.validateFile(p).then(res => {
            if (!res || !res.ok) { comp.toast('Not a cookie jar', (res && res.error) || 'That file could not be validated'); return; }
            comp.setV('--cookies', p);
            comp.setState({ loginCookieCount: res.cookieCount, cookieFilePath: p, dialog: null });
            comp.toast('Cookie jar wired', res.cookieCount + ' cookie(s) from ' + p);
          });
        }).catch(err => comp.toast('Picker failed', String(err && err.message ? err.message : err)));
      },
      setCookiePasteText(comp, e) {
        comp.setState({ cookiePasteText: e.target.value, cookiePasteError: null });
      },
      setCookiePasteDomain(comp, e) {
        comp.setState({ cookiePasteDomain: e.target.value, cookiePasteError: null });
      },
      parseCookiePaste(comp) {
        if (comp.state.cookiePasteBusy) return; // one paste in flight at a time -- no double-submit
        const bridge = window.ytdlpStudio;
        if (!bridge) { comp.toast('Not connected', 'window.ytdlpStudio is missing'); return; }
        if (!bridge.cookies || !bridge.cookies.parsePaste) { comp.toast('Not connected', 'window.ytdlpStudio.cookies.parsePaste is missing'); return; }
        const text = comp.state.cookiePasteText || '';
        if (!text.trim()) { comp.setState({ cookiePasteError: 'Paste something first.' }); return; }
        const domain = comp.state.cookiePasteDomain || '';
        comp.setState({ cookiePasteBusy: true, cookiePasteError: null });
        bridge.cookies.parsePaste({ text: text, domain: domain.trim() ? domain : null }).then(res => {
          if (!res || !res.ok) {
            comp.setState({ cookiePasteBusy: false, cookiePasteError: (res && res.error) || 'That could not be parsed.' });
            return;
          }
          comp.setV('--cookies', res.path);
          comp.setState({
            cookiePasteBusy: false,
            cookiePasteError: null,
            cookiePasteLastResult: { cookieCount: res.cookieCount, domain: res.domain, format: res.format, path: res.path },
            cookiePasteText: '',
          });
          comp.toast('Cookie jar wired', res.cookieCount + ' cookie(s) for ' + res.domain);
        }).catch(err => {
          comp.setState({ cookiePasteBusy: false, cookiePasteError: String(err && err.message ? err.message : err) });
        });
      },`

  return replaceExact(html, needle, replacement, 1)
}

// ---------------------------------------------------------------------------
// 3. Per-instance default state.
// ---------------------------------------------------------------------------

function wireCookiePasteDefaultState(html, replaceExact) {
  return replaceExact(
    html,
    `settingsSearch: '', ppSearch: '', configFile: 'user', cookieBrowser: 'firefox', cookieFilePath: '',`,
    `settingsSearch: '', ppSearch: '', configFile: 'user', cookieBrowser: 'firefox', cookieFilePath: '', cookiePasteText: '', cookiePasteDomain: '', cookiePasteBusy: false, cookiePasteError: null, cookiePasteLastResult: null,`,
    1,
  )
}

// ---------------------------------------------------------------------------
// 4. Render bindings. `cookiePasteStatusText` is one honest ternary chain
//    covering every state the card can be in: nothing pasted yet, parsing,
//    failed with the exact reason, and wired/in-use (recognised as "the
//    currently active --cookies value is the file this card last wrote").
//    There is no fifth "just parsed, not yet applied" state to represent --
//    parseCookiePaste sets --cookies in the same state update that records
//    the result, so a successful parse and "in use" become true together.
// ---------------------------------------------------------------------------

function wireCookiePasteBindings(html, replaceExact) {
  const needle = `      cookieFileStatus: s.cookieFilePath ? (s.cookieFilePath + ' · ' + s.loginCookieCount + ' cookie(s)') : 'No file picked yet',`

  const replacement = `      cookieFileStatus: s.cookieFilePath ? (s.cookieFilePath + ' · ' + s.loginCookieCount + ' cookie(s)') : 'No file picked yet',
      cookiePasteText: s.cookiePasteText || '',
      setCookiePasteText: e => this._wire.setCookiePasteText(this, e),
      cookiePasteDomain: s.cookiePasteDomain || '',
      setCookiePasteDomain: e => this._wire.setCookiePasteDomain(this, e),
      cookiePasteBusy: !!s.cookiePasteBusy,
      cookiePasteError: s.cookiePasteError || null,
      parseCookiePaste: () => this._wire.parseCookiePaste(this),
      cookiePasteButtonLabel: s.cookiePasteBusy ? 'Parsing…' : 'Parse & wire',
      cookiePasteStatusText: s.cookiePasteBusy
        ? 'Parsing…'
        : s.cookiePasteError
          ? ('Failed: ' + s.cookiePasteError)
          : (s.cookiePasteLastResult && s.values['--cookies'] === s.cookiePasteLastResult.path)
            ? ('In use — ' + s.cookiePasteLastResult.cookieCount + ' cookie(s) for ' + s.cookiePasteLastResult.domain + '.')
            : 'Nothing pasted yet.',`

  return replaceExact(html, needle, replacement, 1)
}
