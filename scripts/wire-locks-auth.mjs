/**
 * wireLocksAuth(html, replaceExact) — per-element toy locks, the built-in
 * TOTP authenticator, and the two-key + slider destructive gate.
 *
 * Owned files: app/src/main/locks.ts, app/src/main/authenticator.ts,
 * app/src/shared/locks-contract.ts, this script, plus surgical additions to
 * app/src/main/ipc.ts and app/src/preload/index.ts (registering the
 * `window.ytdlpStudio.locks` and `window.ytdlpStudio.authenticator`
 * bridges). This module does NOT read or write files itself — it is pure
 * string transformation, imported and called by
 * scripts/build-renderer-from-design.mjs, which owns the overall build
 * order and passes in its own asserted `replaceExact(source, needle,
 * replacement, expected = 1)` helper.
 *
 * The design already ships a complete, entirely client-simulated version
 * of all three surfaces: a two-key + slider destructive-confirm dialog
 * whose "Authorize" button never actually runs anything; a per-element
 * lock wizard whose "password" is only ever compared by length and whose
 * "TOTP secret" is a hard-coded literal string; and a "Built-in
 * authenticator" panel that already derives real RFC 4226 HOTP/SHA-1 codes
 * client-side via WebCrypto from whatever secret is pasted into component
 * state, with no persistence and no vault.
 *
 * This lane keeps every one of those UI surfaces exactly as designed and
 * replaces only their behaviour: real credential verification, real
 * OS-vault-backed storage (via `safeStorage`), a real RFC 6238 engine
 * across SHA-1/256/512 (verified against all 18 published Appendix B test
 * vectors — see the report this script's caller assembles), and a locally
 * rendered QR code with no network request of any kind.
 *
 * Every replacement is asserted to occur EXACTLY ONCE (or the stated exact
 * count) against the generated renderer source. If an earlier lane's edits
 * or a design change move this text, this throws loudly rather than
 * shipping a half-wired app.
 */

export function wireLocksAuth(html, replaceExact) {
  // -------------------------------------------------------------------
  // 1. Two-key + slider destructive gate: give `askDestructive` a real,
  //    optional third `run` callback (scripts/wire-stubs.mjs already
  //    calls it with one — `comp.askDestructive(title, copy, doWrite)` —
  //    on the assumption that this lane would land it), and make
  //    `authorizeDestructive` actually invoke it once the gate is armed,
  //    instead of only closing the dialog and toasting a canned
  //    "Authorized" with no effect. A `run` that throws (or whose promise
  //    rejects) reports the real failure rather than pretending the
  //    action succeeded; a caller that passes no `run` at all keeps the
  //    original toast-only behaviour so no existing call site breaks.
  // -------------------------------------------------------------------
  // An earlier lane (wire-settings-actions) already extended this gate with the
  // `run` callback, so the two-argument form may no longer exist by the time
  // this module runs. Apply it only if it is still there: asserting on work
  // another lane has already done would fail the build for the wrong reason.
  if (html.includes(`  askDestructive(title, copy) {`)) {
    // Same situation as askDestructive above: an earlier lane may already have
  // bound the action to this gate. Apply only if the original body is intact.
  if (html.includes(`      authorizeDestructive: () => {
        if (((s.confirm || {}).slider || 0) < 100)`)) {
    html = replaceExact(
        html,
        `  askDestructive(title, copy) {
      this.setState({ dialog: 'confirm', confirm: { title, copy, a: false, l: false, slider: 0 } });
    }`,
        `  askDestructive(title, copy, run) {
      this.setState({ dialog: 'confirm', confirm: { title, copy, run: run || null, a: false, l: false, slider: 0 } });
    }`,
      )
    }

    html = replaceExact(
      html,
      `      authorizeDestructive: () => {
          if (((s.confirm || {}).slider || 0) < 100) { this.toast('Not armed', 'The gate is not satisfied yet'); return; }
          this.setState({ dialog: null, confirm: null, closeArmed: false });
          this.toast('Authorized', (s.confirm || {}).title || 'Action completed');
        },`,
      `      authorizeDestructive: () => {
          if (((s.confirm || {}).slider || 0) < 100) { this.toast('Not armed', 'The gate is not satisfied yet'); return; }
          const run = (s.confirm || {}).run;
          const title = (s.confirm || {}).title || 'Action completed';
          this.setState({ dialog: null, confirm: null, closeArmed: false });
          if (typeof run === 'function') {
            try {
              const result = run();
              if (result && typeof result.catch === 'function') {
                result.catch(err => this.toast('Action failed', String(err && err.message ? err.message : err)));
              }
            } catch (err) {
              this.toast('Action failed', String(err && err.message ? err.message : err));
            }
          } else {
            this.toast('Authorized', title);
          }
        },`,
    )
  }

  // -------------------------------------------------------------------
  // 2. Load real state from the main process on mount, and add the one
  //    helper method both the lock wizard and the authenticator panel
  //    call after any mutation to stay in sync with the real store.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `  componentDidMount() {
    import('./dc-ytdlp-flags.js').then(m => this.setState({ groups: m.GROUPS, presets: m.PRESETS }));`,
    `  componentDidMount() {
    import('./dc-ytdlp-flags.js').then(m => this.setState({ groups: m.GROUPS, presets: m.PRESETS }));
    this.refreshLocksAndAuth();`,
  )

  html = replaceExact(
    html,
    `  askDestructive(title, copy, run) {
    this.setState({ dialog: 'confirm', confirm: { title, copy, run: run || null, a: false, l: false, slider: 0 } });
  }`,
    `  askDestructive(title, copy, run) {
    this.setState({ dialog: 'confirm', confirm: { title, copy, run: run || null, a: false, l: false, slider: 0 } });
  }
  refreshLocksAndAuth() {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.locks || !bridge.authenticator) return;
    bridge.locks.list().then(locks => this.setState({ locks: locks || [] })).catch(() => {});
    bridge.authenticator.list().then(entries => this.setState({ authEntries: entries || [] })).catch(() => {});
    bridge.locks.recoveryPath().then(p => this.setState({ lockRecoveryPath: p })).catch(() => {});
  }`,
  )

  // -------------------------------------------------------------------
  // 3. Per-element lock context menu: pass the real lock id through so
  //    unlock can target it, and point the "Forgot it?" recovery copy at
  //    the real userData path instead of a hard-coded guess at it.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `    const lk = (this.state.locks || []).find(L => L.target === title);
    if (lk) {
      this.setState({ menu: { title, items: [
        { glyph: '🔒', label: 'Locked — ' + (lk.method === 'totp' ? 'authenticator' : 'password') + ' · ' + lk.duration, run: () => {} },
        { glyph: '🗝', label: 'Unlock this element…', run: () => this.setState({ lock: { target: title, step: 1, method: lk.method, mode: 'unlock', x: Math.min(x, window.innerWidth - 368), y: Math.min(y, window.innerHeight - 360) } }) },
        { glyph: '?', label: 'Forgot it? The recovery path', run: () => this.toast('Recovery', 'Delete %APPDATA%\\\\yt-dlp-studio to clear every lock — a local ticket records the reset') },
      ], x, y }, menuSearch: '' });
      return;
    }`,
    `    const lk = (this.state.locks || []).find(L => L.target === title);
    if (lk) {
      this.setState({ menu: { title, items: [
        { glyph: '🔒', label: 'Locked — ' + (lk.method === 'totp' ? 'authenticator' : 'password') + ' · ' + lk.duration, run: () => {} },
        { glyph: '🗝', label: 'Unlock this element…', run: () => this.setState({ lock: { target: title, id: lk.id, step: 1, method: lk.method, mode: 'unlock', x: Math.min(x, window.innerWidth - 368), y: Math.min(y, window.innerHeight - 360) } }) },
        { glyph: '?', label: 'Forgot it? The recovery path', run: () => this.toast('Recovery', 'Delete ' + (this.state.lockRecoveryPath || '%APPDATA%\\\\yt-dlp-studio') + ' to clear every lock — this is a toy lock, not security, and there is no reset ticket') },
      ], x, y }, menuSearch: '' });
      return;
    }`,
  )

  // -------------------------------------------------------------------
  // 4. The lock wizard itself. Replace the fake fixed-length "password"
  //    check and the client-only `locks` array mutation with real IPC
  //    calls: `bridge.locks.create` / `bridge.locks.unlock`, refreshed
  //    from the real store afterward rather than optimistically
  //    reshaping local state. Picking the "authenticator code" method
  //    now registers a fresh, real TOTP entry (via
  //    `bridge.authenticator.register` with no input, which the main
  //    process treats as "generate one for me") whose real manual secret
  //    and locally rendered QR back the wizard's existing step-2 markup.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `        return { glyph, label, help, bg: on ? '#324b48' : '#252b2b', border: on ? '#82d5cc' : 'transparent', fg: on ? '#cfe9e5' : '#dee4e3',
          pick: () => this.setState(st => ({ lock: { ...st.lock, method: id, step: 1 } })) };
      }),`,
    `        return { glyph, label, help, bg: on ? '#324b48' : '#252b2b', border: on ? '#82d5cc' : 'transparent', fg: on ? '#cfe9e5' : '#dee4e3',
          pick: () => {
            this.setState(st => ({ lock: { ...st.lock, method: id, step: 1 } }));
            if (id === 'totp') {
              const bridge = window.ytdlpStudio;
              if (!bridge || !bridge.authenticator) { this.toast('Not connected', 'window.ytdlpStudio.authenticator is missing'); return; }
              bridge.authenticator.register({ input: '', issuer: 'yt-dlp Studio', account: (this.state.lock || {}).target || 'element' }).then(res => {
                if (!res || !res.ok || !res.entry) { this.toast('Could not pair', (res && res.error) || 'Unknown error'); return; }
                this.setState(st => ({ lock: { ...st.lock, authEntryId: res.entry.id, manualSecret: res.manualSecret || '', qrSvg: res.qrSvg || '' } }));
              }).catch(err => this.toast('Could not pair', String(err && err.message ? err.message : err)));
            }
          } };
      }),`,
  )

  html = replaceExact(
    html,
    `      lockSecret: 'JBSWY3DPEHPK3PXP · yt-dlp Studio (' + ((s.lock || {}).target || 'element') + ')',`,
    `      lockSecret: (s.lock || {}).manualSecret || 'Preparing a secret and QR code…',
      lockQrBg: (s.lock || {}).qrSvg ? 'url("data:image/svg+xml;base64,' + (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent((s.lock || {}).qrSvg))) : '') + '")' : 'none',`,
  )

  html = replaceExact(
    html,
    `                <div style="width:104px;height:104px;border-radius:10px;background:#dee4e3;display:grid;place-items:center;flex:0 0 auto">
                  <i class="msym" style="font-size:74px;color:#0f1414">qr_code_2</i>
                </div>`,
    `                <div style="width:104px;height:104px;border-radius:10px;background-color:#dee4e3;background-image:{{ lockQrBg }};background-size:96px 96px;background-repeat:no-repeat;background-position:center;display:grid;place-items:center;flex:0 0 auto">
                  <sc-if value="{{ !lockQrBg }}" hint-placeholder-val="{{ false }}">
                    <i class="msym" style="font-size:74px;color:#0f1414">qr_code_2</i>
                  </sc-if>
                </div>`,
  )

  html = replaceExact(
    html,
    `      lockNext: () => {
        const l = s.lock || {};
        if (l.mode === 'unlock') {
          if (!(l.password || '').length) { this.toast('Still locked', 'Type the credential first'); return; }
          this.setState(st => ({ locks: (st.locks || []).filter(x => x.target !== l.target), lock: null }));
          this.toast('Unlocked', l.target);
        } else if ((l.step || 0) >= 2) {
          this.setState(st => ({
            locks: [...(st.locks || []), { target: l.target, method: l.method || 'password', duration: l.duration || 'Until the app closes' }],
            lock: null,
          }));
          this.toast('Element locked', l.target + ' — ' + (l.method === 'totp' ? 'authenticator' : 'password'));
        } else this.setState(st => ({ lock: { ...st.lock, step: (st.lock.step || 0) + 1 } }));
      },`,
    `      lockNext: () => {
        const l = s.lock || {};
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.locks) { this.toast('Not connected', 'window.ytdlpStudio.locks is missing'); return; }
        if (l.mode === 'unlock') {
          if (!(l.password || '').length) { this.toast('Still locked', 'Type the credential first'); return; }
          bridge.locks.unlock({ id: l.id, credential: l.password }).then(res => {
            if (!res || !res.ok) { this.toast('Still locked', (res && res.error) || 'That did not match'); return; }
            this.setState({ lock: null });
            this.refreshLocksAndAuth();
            this.toast('Unlocked', l.target);
          }).catch(err => this.toast('Unlock failed', String(err && err.message ? err.message : err)));
        } else if ((l.step || 0) >= 2) {
          const req = { target: l.target, method: l.method || 'password', duration: this.lockDurationCode(l.duration) };
          if ((l.method || 'password') === 'password') req.password = l.password || '';
          else req.authenticatorEntryId = l.authEntryId || '';
          bridge.locks.create(req).then(res => {
            if (!res || !res.ok) { this.toast('Could not lock', (res && res.error) || 'Unknown error'); return; }
            this.setState({ lock: null });
            this.refreshLocksAndAuth();
            this.toast('Element locked', l.target + ' — ' + (l.method === 'totp' ? 'authenticator' : 'password'));
          }).catch(err => this.toast('Could not lock', String(err && err.message ? err.message : err)));
        } else this.setState(st => ({ lock: { ...st.lock, step: (st.lock.step || 0) + 1 } }));
      },`,
  )

  // Small helper the lockNext rewrite above depends on: the wizard's
  // duration picker uses human sentences ("Until the app closes") as its
  // own state key, but the store's contract uses a small closed set of
  // duration codes. Translate once, here, rather than smuggling the
  // sentence itself into storage.
  html = replaceExact(
    html,
    `  refreshLocksAndAuth() {`,
    `  lockDurationCode(label) {
    if (label === '5 minutes') return '5m';
    if (label === '1 hour') return '1h';
    if (label === 'Until I unlock it') return 'until-relocked';
    return 'session';
  }
  refreshLocksAndAuth() {`,
  )

  // -------------------------------------------------------------------
  // 5. The "Built-in authenticator" (--twofactor) panel: replace the
  //    client-only, unpersisted WebCrypto derivation with the real,
  //    vault-backed authenticator. Pasting a secret or an otpauth:// URI
  //    registers a real entry (immediately confirmed by round-tripping
  //    one freshly computed code through `confirmPairing`, since this
  //    screen — unlike the lock wizard — has no separate "type the code
  //    back" step of its own); the live code display now polls the main
  //    process every second instead of recomputing in the renderer.
  // -------------------------------------------------------------------
  html = replaceExact(
    html,
    `      totpSecret: s.totpSecret || '',
      setTotpSecret: e => {`,
    `      totpSecret: s.totpSecret || '',
      totpEntryId: s.totpEntryId || '',
      setTotpSecretReal: input => {
        const bridge = window.ytdlpStudio;
        if (!bridge || !bridge.authenticator) { this.toast('Not connected', 'window.ytdlpStudio.authenticator is missing'); return; }
        bridge.authenticator.register({ input, issuer: 'yt-dlp Studio', account: '--twofactor' }).then(res => {
          if (!res || !res.ok || !res.entry) { this.setState({ totpValue: '', totpError: (res && res.error) || 'Could not derive a code from that secret' }); return; }
          this.setState({ totpEntryId: res.entry.id, totpValue: '', totpError: '' });
          return bridge.authenticator.currentCode({ id: res.entry.id }).then(code => {
            if (code && code.ok && code.code) {
              return bridge.authenticator.confirmPairing({ id: res.entry.id, code: code.code });
            }
          });
        }).catch(err => this.setState({ totpValue: '', totpError: String(err && err.message ? err.message : err) }));
      },
      setTotpSecret: e => {`,
  )

  html = replaceExact(
    html,
    `    this.setState({ totpSecret: m ? m[1] : raw, totpValue: '' });
        this._totpStep = null;
      },
      pasteTotp: () => { this.setState({ totpSecret: 'JBSWY3DPEHPK3PXP', totpValue: '' }); this._totpStep = null; },`,
    `    const value = m ? m[1] : raw;
        this.setState({ totpSecret: value, totpValue: '', totpEntryId: '' });
        this._totpStep = null;
        this.setTotpSecretReal(value);
      },
      pasteTotp: () => {
        this.setState({ totpSecret: 'JBSWY3DPEHPK3PXP', totpValue: '', totpEntryId: '' });
        this._totpStep = null;
        this.setTotpSecretReal('JBSWY3DPEHPK3PXP');
      },`,
  )

  html = replaceExact(
    html,
    `      forgetTotp: () => { this.setState({ totpSecret: '', totpValue: '' }); this.toast('Forgotten', 'The secret was removed from this machine'); },`,
    `      forgetTotp: () => {
        const bridge = window.ytdlpStudio;
        const id = s.totpEntryId;
        this.setState({ totpSecret: '', totpValue: '', totpEntryId: '' });
        if (bridge && bridge.authenticator && id) {
          bridge.authenticator.remove(id).catch(() => {});
        }
        this.toast('Forgotten', 'The secret was removed from this machine');
      },`,
  )

  // The 1-second refresh loop previously called `refreshTotp()`, which
  // derived the code itself from `this.state.totpSecret` via WebCrypto.
  // It now polls the real, vault-backed entry instead — the entry id is
  // the only thing the renderer still holds locally.
  html = replaceExact(
    html,
    `  refreshTotp() {
    const secret = this.state.totpSecret;
    const now = Math.floor(Date.now() / 1000);
    const step = Math.floor(now / 30);
    this.setState({ totpRemaining: 30 - (now % 30) });
    if (!secret) { if (this.state.totpValue) this.setState({ totpValue: '', totpError: '' }); return; }
    if (this._totpStep === step && this.state.totpValue) return;
    this._totpStep = step;
    this.totpCode(secret, step)
      .then(code => this.setState({ totpValue: code || '', totpError: code ? '' : 'That does not look like a base32 secret' }))
      .catch(() => this.setState({ totpValue: '', totpError: 'Could not derive a code from that secret' }));
  }`,
    `  refreshTotp() {
    const entryId = this.state.totpEntryId;
    const now = Math.floor(Date.now() / 1000);
    this.setState({ totpRemaining: 30 - (now % 30) });
    if (!entryId) { if (this.state.totpValue) this.setState({ totpValue: '', totpError: '' }); return; }
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.authenticator) return;
    bridge.authenticator.currentCode({ id: entryId })
      .then(res => {
        if (!res || !res.ok || !res.code) { this.setState({ totpValue: '', totpError: (res && res.error) || 'Could not derive a code' }); return; }
        this.setState({ totpValue: res.code, totpError: res.clockSkewWarning ? 'This machine\\'s clock looks off — codes may be refused elsewhere' : '', totpRemaining: res.secondsRemaining != null ? res.secondsRemaining : this.state.totpRemaining });
      })
      .catch(() => this.setState({ totpValue: '', totpError: 'Could not reach the authenticator' }));
  }`,
  )

  return html
}
