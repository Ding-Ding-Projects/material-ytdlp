// wire-window-chrome.mjs
//
// The app runs frameless (frame: false, titleBarStyle: 'hidden'), so the
// operating system draws no chrome at all and the design's own header is the
// entire title bar. Two things were missing from it, and both read to a user
// as a broken application rather than a missing feature:
//
//   1. The Minimize / Maximize / Close buttons had no handler. The full path
//      behind them was already built and working -- ipc.ts implements
//      WindowMinimize / WindowMaximize / WindowUnmaximize / WindowClose, and
//      preload exposes window.ytdlpStudio.window.* for all of them -- but no
//      wiring lane ever connected the two ends. The buttons rendered with the
//      right icons and the right hover styling and did nothing at all.
//
//   2. No drag region existed anywhere in the repository. A frameless window
//      cannot be moved unless something declares itself draggable, so the
//      window was pinned wherever it happened to open.
//
// The design cannot carry either of these: -webkit-app-region is meaningless
// in a browser, and the design tool has no window to minimize. So this is a
// legitimate host-only addition rather than a departure from the contract --
// it adds the behaviour the design's own chrome implies, and changes none of
// its appearance.

export function wireWindowChrome(html, replaceExact) {
  // 1. The drag region, as CSS rather than per-element edits. The header
  //    becomes draggable and every interactive descendant opts back out --
  //    without the no-drag half, a draggable region swallows clicks and the
  //    search box and buttons inside the header would stop responding, which
  //    would be a worse bug than the one being fixed.
  //
  //    Plain element selectors on purpose: appearance rules in this project
  //    that were scoped `x-dc ...` were measured to match zero elements in the
  //    real app, because the runtime does not leave that element in the tree.
  //    Anchored on a rule from the design's own stylesheet, which the
  //    generator preserves verbatim.
  html = replaceExact(
    html,
    `  @keyframes slide{from`,
    `  /* Frameless window: the design's header IS the title bar, so it has to
     carry the drag region the operating system would otherwise provide.
     Every interactive descendant opts out again, or the region would
     swallow their clicks. */
  header{-webkit-app-region:drag}
  header button,header input,header select,header textarea,header a,header [contenteditable],header [role="button"],header [role="textbox"]{-webkit-app-region:no-drag}
  @keyframes slide{from`,
  )

  // 2. Bind the three buttons. Their markup is otherwise untouched -- only an
  //    onClick is added, so the design's own sizing, radius, colour and icon
  //    survive exactly.
  const BUTTONS = [
    ['Minimize', 'winMinimize', '20px', 'remove'],
    ['Maximize', 'winMaximize', '18px', 'crop_square'],
    ['Close', 'winClose', '20px', 'close'],
  ]

  for (const [title, handler, fontSize, glyph] of BUTTONS) {
    html = replaceExact(
      html,
      `<button title="${title}" style="width:40px;height:40px;border-radius:20px;background:transparent;color:#bec9c7"><i class="msym" style="font-size:${fontSize}">${glyph}</i></button>`,
      `<button onClick="{{ ${handler} }}" title="${title}" style="width:40px;height:40px;border-radius:20px;background:transparent;color:#bec9c7"><i class="msym" style="font-size:${fontSize}">${glyph}</i></button>`,
    )
  }

  // 3. The handlers themselves, beside the sibling header button that already
  //    had one. Maximize genuinely toggles: it asks the main process whether
  //    the window is currently maximized rather than tracking a guess in
  //    renderer state, which would drift the moment the user double-clicked
  //    the title bar or used a keyboard shortcut.
  //
  //    Each call reports its own failure. A window control that silently does
  //    nothing is exactly the defect being fixed here, so a failed IPC call
  //    must not be swallowed into the same silence.
  html = replaceExact(
    html,
    `      openNotifications: () => this.setState({ dialog: 'notifications' }),`,
    `      openNotifications: () => this.setState({ dialog: 'notifications' }),
      winMinimize: () => {
        const w = window.ytdlpStudio && window.ytdlpStudio.window;
        if (!w) return this.toast('Window controls unavailable', 'Running outside the packaged app.');
        w.minimize().catch(e => this.toast('Could not minimize', String(e && e.message ? e.message : e)));
      },
      winMaximize: () => {
        const w = window.ytdlpStudio && window.ytdlpStudio.window;
        if (!w) return this.toast('Window controls unavailable', 'Running outside the packaged app.');
        w.isMaximized()
          .then(isMax => (isMax ? w.unmaximize() : w.maximize()))
          .catch(e => this.toast('Could not resize the window', String(e && e.message ? e.message : e)));
      },
      winClose: () => {
        const w = window.ytdlpStudio && window.ytdlpStudio.window;
        if (!w) return this.toast('Window controls unavailable', 'Running outside the packaged app.');
        w.close().catch(e => this.toast('Could not close the window', String(e && e.message ? e.message : e)));
      },`,
  )

  return html
}
