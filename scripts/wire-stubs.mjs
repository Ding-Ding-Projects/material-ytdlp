// scripts/wire-stubs.mjs
//
// "honest_stubs_pig" lane: closes two of the five admitted `toast('Not
// implemented', ...)` gaps in the design (cookie handoff / sign-in, and
// writing a real yt-dlp.conf), and leaves three deliberately alone because
// after inspection they are genuinely honest — there is no real record for
// them to act on. See the module-level comments below each wire function
// for the reasoning, and the pig's own report for the summary.
//
// Runs LAST in the wiring chain (five other lanes already rewrote parts of
// this HTML), so every needle here is captured from the GENERATED output,
// not from the design source. Same asserted-replacement discipline as
// `build-renderer-from-design.mjs`: every needle is matched byte-exact and
// asserted to occur exactly once via the caller-supplied `replaceExact`, so
// a needle that stops matching fails the build loudly instead of silently
// shipping a half-wired app.
//
// This module owns ONLY the `replaceExact` targets below. It never touches
// `app/src/renderer/**` directly — it only returns modified HTML text for
// the orchestrator to write out.

/**
 * @param {string} html
 * @param {(source: string, needle: string, replacement: string, expected?: number) => string} replaceExact
 * @returns {string}
 */
export function wireStubs(html, replaceExact) {
  html = wireCookieDialog(html, replaceExact)
  html = wireSaveConf(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// Gap 1: cookie handoff / sign-in.
//
// A real embedded sign-in surface (an in-app browser view with its own
// credential-vault storage) is genuinely out of scope for this pass. What
// IS realistically achievable, and is wired here for real:
//
//   - --cookies-from-browser: the user picks a real installed browser from
//     yt-dlp's own supported list, and the flag is set for real. This
//     covers most "please sign me in" cases without touching a single
//     cookie file.
//   - --cookies <file>: a native file picker (dialogs.pickCookiesFile,
//     already wired end-to-end by another lane) whose result is now run
//     through a REAL structural validator (app/src/main/cookies.ts) that
//     checks it is actually 7-field, tab-separated Netscape cookie lines
//     before the flag is set — never a blind "looks fine, trust it".
//
// The dialog's old copy claimed an embedded sign-in view existed ("sign in
// normally — nothing is typed for you"); that was not true, so it is
// replaced with an honest explanation plus the two real actions above. The
// status bar's cookie indicator already reads `s.values['--cookies-from-
// browser'] || s.values['--cookies']` (another lane's work), so setting
// either flag here makes it reflect reality with no further changes.
// ---------------------------------------------------------------------------

function wireCookieDialog(html, replaceExact) {
  const dialogNeedle = `<sc-if value="{{ dialogLogin }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeDialog }}" style="position:fixed;inset:0;background:#0009;backdrop-filter:blur(3px);display:grid;place-items:center;overflow:auto;padding:24px 0;z-index:40">
      <div onClick="{{ stop }}" style="width:min(860px,calc(100vw - 40px));background:#1b2121;border:1px solid #3f4948;border-radius:18px;overflow:hidden;box-shadow:0 20px 70px #000b">
        <div style="height:40px;background:#0a0f0f;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #2a3130">
          <span style="width:11px;height:11px;border-radius:50%;background:#ff5f57"></span>
          <span style="width:11px;height:11px;border-radius:50%;background:#febc2e"></span>
          <span style="width:11px;height:11px;border-radius:50%;background:#28c840"></span>
          <div style="flex:1;margin-left:10px;background:#252b2b;border-radius:8px;padding:5px 10px;font-family:'Roboto Mono',Consolas,monospace;font-size:11.5px;color:#bec9c7">{{ loginUrl }}</div>
          <button onClick="{{ closeDialog }}" style="background:transparent;color:#bec9c7;font-size:18px;width:28px">×</button>
        </div>
        <div style="padding:26px;display:grid;grid-template-columns:1fr 300px;gap:22px">
          <div style="background:#0a0f0f;border-radius:12px;min-height:280px;display:grid;place-items:center;background-image:repeating-linear-gradient(135deg,#151b1c 0 10px,#0a0f0f 10px 20px)">
            <div style="text-align:center;color:#889391;font-family:'Roboto Mono',Consolas,monospace;font-size:12px">
              <div style="font-size:30px;margin-bottom:8px;color:#3f4948">▤</div>
              embedded sign-in view<br />sign in normally — nothing is typed for you
            </div>
          </div>
          <div>
            <p style="margin:0 0 5px;color:#82d5cc;font-size:11px;text-transform:uppercase;letter-spacing:1.3px;font-weight:800">Cookie handback</p>
            <h2 style="font-size:11px;margin:0 0 9px;letter-spacing:.9px;text-transform:uppercase;color:#bec9c7;font-weight:800">When you finish</h2>
            <p style="color:#bec9c7;margin:0 0 14px;font-size:12.5px">The session cookie jar is written to a Netscape file and wired to <code style="color:#82d5cc">--cookies</code>. Nothing leaves this machine.</p>
            <div style="display:grid;gap:7px;font-size:12px">
              <div style="display:flex;justify-content:space-between;padding:9px 11px;border-radius:10px;background:#252b2b"><span style="color:#bec9c7">Jar</span><b style="font-family:'Roboto Mono',Consolas,monospace">yt.cookies.txt</b></div>
              <div style="display:flex;justify-content:space-between;padding:9px 11px;border-radius:10px;background:#252b2b"><span style="color:#bec9c7">Cookies captured</span><b>{{ loginCookieCount }}</b></div>
              <div style="display:flex;justify-content:space-between;padding:9px 11px;border-radius:10px;background:#252b2b"><span style="color:#bec9c7">Session</span><b style="color:#82d5cc">isolated</b></div>
            </div>
            <button onClick="{{ finishLogin }}" style="width:100%;margin-top:16px;padding:11px;border-radius:22px;font-weight:700;background:#82d5cc;color:#003733">Hand cookies back</button>
            <button onClick="{{ closeDialog }}" style="width:100%;margin-top:8px;padding:11px;border-radius:22px;font-weight:700;background:transparent;border:1px solid #3f4948;color:#dee4e3">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </sc-if>`

  const dialogReplacement = `<sc-if value="{{ dialogLogin }}" hint-placeholder-val="{{ false }}">
    <div onClick="{{ closeDialog }}" style="position:fixed;inset:0;background:#0009;backdrop-filter:blur(3px);display:grid;place-items:center;overflow:auto;padding:24px 0;z-index:40">
      <div onClick="{{ stop }}" style="width:min(700px,calc(100vw - 40px));background:#1b2121;border:1px solid #3f4948;border-radius:18px;overflow:hidden;box-shadow:0 20px 70px #000b">
        <div style="height:40px;background:#0a0f0f;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #2a3130">
          <div style="flex:1;margin-left:2px;font-size:12.5px;font-weight:700;letter-spacing:.4px;color:#dee4e3">{{ loginUrl }}</div>
          <button onClick="{{ closeDialog }}" style="background:transparent;color:#bec9c7;font-size:18px;width:28px">×</button>
        </div>
        <div style="padding:22px 26px 26px">
          <p style="color:#889391;margin:0 0 18px;font-size:12px;line-height:1.5">There is no embedded sign-in browser here — a real one would need its own credential-vault storage this build does not have. Both routes below are real and work today.</p>

          <div style="background:#161c1c;border-radius:12px;padding:14px 16px;margin-bottom:12px">
            <p style="margin:0 0 4px;color:#82d5cc;font-size:11px;text-transform:uppercase;letter-spacing:1.3px;font-weight:800">Already signed in somewhere</p>
            <p style="color:#bec9c7;margin:0 0 11px;font-size:12.5px">Read the session cookies straight out of a browser already installed on this machine. Nothing is copied out of the browser's own storage — <code style="color:#82d5cc">--cookies-from-browser</code> reads it directly at download time.</p>
            <div style="display:flex;gap:8px;align-items:center">
              <select value="{{ cookieBrowser }}" onChange="{{ setCookieBrowser }}" style="flex:1;height:36px;background:#252b2b;border:1px solid #3f4948;border-radius:9px;color:#dee4e3;padding:0 10px;font-size:12.5px">
                <sc-for list="{{ cookieBrowsers }}" as="b" hint-placeholder-count="8"><option value="{{ b.v }}">{{ b.label }}</option></sc-for>
              </select>
              <button onClick="{{ useCookieBrowser }}" style="padding:9px 16px;border-radius:20px;font-weight:700;background:#82d5cc;color:#003733;flex:0 0 auto">Use this browser</button>
            </div>
          </div>

          <div style="background:#161c1c;border-radius:12px;padding:14px 16px">
            <p style="margin:0 0 4px;color:#82d5cc;font-size:11px;text-transform:uppercase;letter-spacing:1.3px;font-weight:800">Have a cookie jar already</p>
            <p style="color:#bec9c7;margin:0 0 11px;font-size:12.5px">Pick a Netscape-format cookies file — exported with a browser extension, or written by a previous run — and it is checked and wired to <code style="color:#82d5cc">--cookies</code>. Nothing leaves this machine.</p>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
              <span style="color:#bec9c7;font-size:12px">{{ cookieFileStatus }}</span>
              <button onClick="{{ pickCookiesFile }}" style="padding:9px 16px;border-radius:20px;font-weight:700;background:transparent;border:1px solid #889391;color:#82d5cc;flex:0 0 auto">Browse for a cookie file…</button>
            </div>
          </div>

          <button onClick="{{ closeDialog }}" style="width:100%;margin-top:16px;padding:11px;border-radius:22px;font-weight:700;background:transparent;border:1px solid #3f4948;color:#dee4e3">Close</button>
        </div>
      </div>
    </div>
  </sc-if>`

  html = replaceExact(html, dialogNeedle, dialogReplacement, 1)

  // The `_wire` object's fake finishLogin handler becomes two real actions.
  const wireNeedle = `finishLogin(comp) {
        comp.setState({ dialog: null });
        comp.toast('Not implemented', 'Cookie handoff needs a real embedded sign-in surface and OS-vault storage — see design/HANDOFF.md');
      },`

  const wireReplacement = `useCookieBrowser(comp) {
        const browser = (comp.state.cookieBrowser || 'firefox');
        comp.setV('--cookies-from-browser', browser);
        comp.setState({ dialog: null });
        comp.toast('Cookie source set', '--cookies-from-browser ' + browser);
      },
      pickCookiesFile(comp) {
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

  html = replaceExact(html, wireNeedle, wireReplacement, 1)

  // New per-instance default state for the browser select and the picked
  // cookie-file path, alongside the existing configFile default.
  html = replaceExact(
    html,
    `settingsSearch: '', ppSearch: '', configFile: 'user',`,
    `settingsSearch: '', ppSearch: '', configFile: 'user', cookieBrowser: 'firefox', cookieFilePath: '',`,
    1,
  )

  // Render bindings: the fake sign-in URL and dead finishLogin binding are
  // replaced with the real browser list, selection, and file-picker
  // bindings the new dialog markup above uses.
  const bindingsNeedle = `      loginUrl: 'https://accounts.google.com/signin — isolated session',
      loginCookieCount: s.loginCookieCount,
      finishLogin: () => this._wire.finishLogin(this),`

  const bindingsReplacement = `      loginUrl: 'Cookie source',
      loginCookieCount: s.loginCookieCount,
      cookieBrowsers: [
        { v: 'firefox', label: 'Firefox' }, { v: 'chrome', label: 'Chrome' }, { v: 'chromium', label: 'Chromium' },
        { v: 'edge', label: 'Edge' }, { v: 'brave', label: 'Brave' }, { v: 'opera', label: 'Opera' },
        { v: 'safari', label: 'Safari' }, { v: 'vivaldi', label: 'Vivaldi' },
      ],
      cookieBrowser: s.cookieBrowser || 'firefox',
      setCookieBrowser: e => this.setState({ cookieBrowser: e.target.value }),
      useCookieBrowser: () => this._wire.useCookieBrowser(this),
      pickCookiesFile: () => this._wire.pickCookiesFile(this),
      cookieFileStatus: s.cookieFilePath ? (s.cookieFilePath + ' · ' + s.loginCookieCount + ' cookie(s)') : 'No file picked yet',`

  html = replaceExact(html, bindingsNeedle, bindingsReplacement, 1)

  return html
}

// ---------------------------------------------------------------------------
// Gap 2: writing a real yt-dlp.conf.
//
// Another lane (fileops.ts) already implements the full host side of this —
// listConfigFiles/readConfigFile/writeConfigFile/validateConfigText, all
// wired end-to-end through ipc.ts and the preload's `bridge.fileOps` — and
// the renderer's `readConfigFile`/`listConfigFiles` calls are already wired
// by another lane. `saveConf` was the one remaining stub: it never called
// `writeConfigFile` at all. Wired here to do a real, atomic write (via the
// existing `atomicWriteFile` in store.ts, reused by fileops.ts) to whichever
// of the five standard locations is currently selected, and to confirm
// before silently overwriting a file that already exists there.
// ---------------------------------------------------------------------------

function wireSaveConf(html, replaceExact) {
  const needle = `saveConf(comp, configFile, confLines) {
        comp.toast('Not implemented', 'Writing to a real yt-dlp.conf location needs a host-side file write — see design/HANDOFF.md "Config files"');
      },`

  const replacement = `saveConf(comp, configFile, confLines) {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.fileOps) { comp.toast('Not connected', 'window.ytdlpStudio.fileOps is missing'); return; }
        const text = comp.state.configText !== undefined
          ? comp.state.configText
          : confLines.map(l => (l.on ? '' : '# ') + l.flag + (l.value ? ' ' + l.value : '')).join('\\n');
        const doWrite = () => bridge.fileOps.writeConfigFile(configFile, text).then(res => {
          if (!res || !res.ok) { comp.toast('Save failed', (res && res.error) || 'Unknown error'); return; }
          comp.toast('Saved', res.path);
        }).catch(err => comp.toast('Save failed', String(err && err.message ? err.message : err)));
        bridge.fileOps.listConfigFiles().then(files => {
          const info = (files || []).find(f => f.id === configFile);
          if (info && info.exists) {
            comp.askDestructive(
              'Overwrite ' + info.path + '?',
              'This replaces the existing yt-dlp configuration file at that location. The write is atomic, so a crash mid-write cannot corrupt it — but the previous contents are gone once it lands.',
              doWrite,
            );
          } else {
            doWrite();
          }
        }).catch(() => doWrite());
      },`

  return replaceExact(html, needle, replacement, 1)
}
