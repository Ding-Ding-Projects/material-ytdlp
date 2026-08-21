// wire-extension-install.mjs
//
// Wires the desktop side of the yt-dlp Studio Companion browser extension
// (extension/ at the repository root, app/src/main/protocol.ts for the
// receiving end):
//
//   1. A real "Browser extension" dialog -- reachable from the command
//      palette (Ctrl+Shift+F) -- that shows the three real install steps,
//      the exact extension folder path on THIS machine, an "Open folder"
//      button, and a "Copy path" button. Chrome and Edge both refuse to let
//      an external app open chrome://extensions / edge://extensions for
//      them, so those addresses are offered as copy-to-clipboard text
//      instead of a button that would silently do nothing.
//
//   2. The receiving half of the ytdlp-studio:// handoff: when the
//      extension sends a link and this app is already open,
//      window.ytdlpStudioExtension.onIncomingUrl() (exposed by the small
//      preload app/src/main/protocol.ts registers at runtime -- see that
//      file for why it is not app/src/preload/index.ts) fires, and this
//      pre-fills Easy mode's URL field and switches to it. It deliberately
//      does NOT auto-start the download: the user still presses Download,
//      exactly as if they had pasted the link themselves. A toast confirms
//      the link arrived either way, so nothing about the handoff is silent.
//
// window.ytdlpStudioExtension is a SEPARATE bridge from window.ytdlpStudio
// (the main one every other wire-*.mjs lane uses) -- see protocol.ts for why
// this feature could not be added to the shared preload/index.ts.

export function wireExtensionInstall(html, replaceExact) {
  // ---------------------------------------------------------------------
  // 1. Markup: a new dialog, styled like the existing "Support tickets"
  //    dialog it sits beside (same overlay, same card shape, same accent).
  //    Inserted right before the School-mode-enable dialog so it does not
  //    disturb any other lane's anchor.
  // ---------------------------------------------------------------------
  html = replaceExact(
    html,
    `  <sc-if value="{{ dialogSchoolEnable }}" hint-placeholder-val="{{ false }}">`,
    `  <sc-if value="{{ dialogExtensionInstall }}" hint-placeholder-val="{{ false }}">
    <div style="position:fixed;inset:0;background:#000b;display:grid;place-items:center;overflow:auto;padding:24px 0;z-index:48">
      <div style="width:min(560px,calc(100vw - 40px));background:#1b2121;border-radius:28px;padding:24px;box-shadow:0 8px 24px #000a">
        <div style="font-size:22px;font-weight:400;margin-bottom:6px">Browser extension</div>
        <div style="font-size:12px;color:#889391;margin-bottom:16px;line-height:1.5;text-wrap:pretty">The yt-dlp Companion extension sends the page you're on straight to this app. Chrome and Edge only allow installing it "unpacked" — three clicks, no store listing, no signing key. This is the closest thing to one-click this project is allowed to ship.</div>

        <div style="display:flex;gap:10px;align-items:start;margin-bottom:14px">
          <span style="width:22px;height:22px;border-radius:50%;background:#324b48;color:#82d5cc;font-size:12px;font-weight:800;display:grid;place-items:center;flex:0 0 auto">1</span>
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600">Open your browser's extensions page</div>
            <div style="font-size:11.5px;color:#889391;margin-top:2px">Chrome and Edge won't let another app open this page for you — copy one of these into the address bar.</div>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
              <button onClick="{{ copyChromeAddress }}" style="padding:6px 10px;border-radius:6px;background:#252b2b;color:#bec9c7;font-size:11px;font-family:'Roboto Mono',Consolas,monospace">chrome://extensions ⎘</button>
              <button onClick="{{ copyEdgeAddress }}" style="padding:6px 10px;border-radius:6px;background:#252b2b;color:#bec9c7;font-size:11px;font-family:'Roboto Mono',Consolas,monospace">edge://extensions ⎘</button>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:start;margin-bottom:14px">
          <span style="width:22px;height:22px;border-radius:50%;background:#324b48;color:#82d5cc;font-size:12px;font-weight:800;display:grid;place-items:center;flex:0 0 auto">2</span>
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600">Turn on Developer mode</div>
            <div style="font-size:11.5px;color:#889391;margin-top:2px">Top-right toggle on that page.</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;align-items:start;margin-bottom:16px">
          <span style="width:22px;height:22px;border-radius:50%;background:#324b48;color:#82d5cc;font-size:12px;font-weight:800;display:grid;place-items:center;flex:0 0 auto">3</span>
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600">Click "Load unpacked" and choose this folder</div>
            <div style="font-size:11.5px;color:#889391;margin-top:2px;word-break:break-all;font-family:'Roboto Mono',Consolas,monospace">{{ extensionFolderPath }}</div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button onClick="{{ openExtensionFolder }}" style="padding:6px 10px;border-radius:6px;background:#252b2b;color:#bec9c7;font-size:11px">Open folder</button>
              <button onClick="{{ copyExtensionPath }}" style="padding:6px 10px;border-radius:6px;background:#252b2b;color:#bec9c7;font-size:11px">Copy path ⎘</button>
            </div>
          </div>
        </div>

        <div style="font-size:11.5px;color:#889391;line-height:1.5;margin-bottom:14px;padding:10px;border-radius:8px;background:#12181a">Once loaded, click the extension's toolbar icon on any video page and choose "Send to yt-dlp Studio". The first time, Windows asks which app should open <code style="font-family:'Roboto Mono',Consolas,monospace">ytdlp-studio://</code> links — pick yt-dlp Studio and tick "always" so it only asks once.</div>

        <div style="display:flex;justify-content:end;gap:8px">
          <button onClick="{{ closeExtensionInstall }}" style="height:40px;padding:0 20px;border-radius:20px;background:#324b48;color:#cfe9e5;font-size:14px;font-weight:500">Close</button>
        </div>
      </div>
    </div>
  </sc-if>

  <sc-if value="{{ dialogSchoolEnable }}" hint-placeholder-val="{{ false }}">`,
  )

  // ---------------------------------------------------------------------
  // 2. JS bindings for the dialog above. Anchored right after the tickets
  //    dialog's own handlers end (`fileTicket`'s closing `},`), which is a
  //    stable seam regardless of whether other lanes have run yet.
  // ---------------------------------------------------------------------
  html = replaceExact(
    html,
    `      },

      hasWizard: !!s.wizard,`,
    `      },

      dialogExtensionInstall: s.dialog === 'extensionInstall',
      extensionFolderPath: s.extensionFolderPath || 'resolving…',
      openExtensionInstall: () => {
        this.setState({ dialog: 'extensionInstall' });
        this._hydrateExtensionInstall();
      },
      closeExtensionInstall: () => this.setState({ dialog: null }),
      openExtensionFolder: () => {
        const bridge = window.ytdlpStudioExtension;
        if (!bridge) { this.toast('Browser extension', 'The extension bridge is not available in this build.'); return; }
        bridge.openExtensionFolder().then(res => {
          if (!res || !res.ok) this.toast('Browser extension', (res && res.error) || 'Could not open the folder.');
        }).catch(err => this.toast('Browser extension', 'Could not open the folder: ' + (err && err.message ? err.message : String(err))));
      },
      copyExtensionPath: () => this.toast('Copied', s.extensionFolderPath || ''),
      copyChromeAddress: () => this.toast('Copied', 'chrome://extensions'),
      copyEdgeAddress: () => this.toast('Copied', 'edge://extensions'),

      hasWizard: !!s.wizard,`,
  )

  // ---------------------------------------------------------------------
  // 3. Discoverability: a real command-palette entry (Ctrl+Shift+F), right
  //    beside the other local-only dialog openers it sits next to.
  // ---------------------------------------------------------------------
  html = replaceExact(
    html,
    `      { label: 'Support tickets', hint: 'Local ticket file, searchable', run: () => this.setState({ dialog: 'notifications' }) },`,
    `      { label: 'Support tickets', hint: 'Local ticket file, searchable', run: () => this.setState({ dialog: 'notifications' }) },
      { label: 'Browser extension', hint: 'Install the Chrome/Edge companion — folder path + steps', run: () => { this.setState({ dialog: 'extensionInstall' }); this._hydrateExtensionInstall(); } },`,
  )

  // ---------------------------------------------------------------------
  // 4. Hydration (the real folder path) + the incoming-URL subscription,
  //    following the exact chain-friendly idiom scripts/wire-download-
  //    folder.mjs and scripts/wire-version-footer.mjs already established:
  //    each lane's replacement TEXT ends with the same needle it matched,
  //    so lane order (mine relative to theirs) never matters.
  // ---------------------------------------------------------------------
  html = replaceExact(
    html,
    `    this._wireHistoryBridge();`,
    `    this._hydrateExtensionInstall();
    this._wireExtensionUrlBridge();
    this._wireHistoryBridge();`,
  )

  html = replaceExact(
    html,
    `  _wireHistoryBridge() {`,
    `  _hydrateExtensionInstall() {
    const bridge = window.ytdlpStudioExtension;
    if (!bridge || typeof bridge.getInstallInfo !== 'function') {
      this.setState({ extensionFolderPath: 'Extension bridge unavailable in this build.' });
      return;
    }
    bridge.getInstallInfo().then(info => {
      this.setState({ extensionFolderPath: (info && info.folderPath) || 'unknown' });
    }).catch(err => {
      this.setState({ extensionFolderPath: 'Could not resolve the folder: ' + (err && err.message ? err.message : String(err)) });
    });
  }

  // Receiving half of the ytdlp-studio:// handoff (app/src/main/protocol.ts).
  // Pre-fills Easy mode and switches to it -- never auto-starts the
  // download, so a link from the browser is exactly as safe as one the
  // user pasted themselves; they still press Download.
  _wireExtensionUrlBridge() {
    const bridge = window.ytdlpStudioExtension;
    if (!bridge || typeof bridge.onIncomingUrl !== 'function') return;
    this._offExtensionUrl = bridge.onIncomingUrl(url => {
      this.setState({ mode: 'easy', easyUrl: url, dialog: null });
      if (this._wire && this._wire.probeEasyUrl) this._wire.probeEasyUrl(this, url);
      this.toast('Link received', 'Sent from the browser extension — press Download to start.');
    });
  }

  _wireHistoryBridge() {`,
  )

  // ---------------------------------------------------------------------
  // 5. Teardown: unsubscribe from the incoming-URL bridge alongside every
  //    other subscription _wireBridge() set up.
  // ---------------------------------------------------------------------
  html = replaceExact(
    html,
    `  _unwireBridge() {
    if (this._offProgress) this._offProgress();
    if (this._offLog) this._offLog();
    if (this._offState) this._offState();
    if (this._historyReloadTimer) clearInterval(this._historyReloadTimer);
  }`,
    `  _unwireBridge() {
    if (this._offProgress) this._offProgress();
    if (this._offLog) this._offLog();
    if (this._offState) this._offState();
    if (this._offExtensionUrl) this._offExtensionUrl();
    if (this._historyReloadTimer) clearInterval(this._historyReloadTimer);
  }`,
  )

  return html
}
