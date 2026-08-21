// wire-lifecycle-repair.mjs
//
// Repairs two generator-only defects that made the built app behave very
// differently from the same design component rendered in the design tool.
// Neither exists in design/yt-dlp Studio.dc.html -- both were introduced by
// wiring lanes that could not see each other.
//
// ---------------------------------------------------------------------------
// DEFECT 1 -- _wireBridge() threw on its own first statement.
//
// wire-palette-tabs.mjs prepended `this._wire = this._wire || {}` to
// _wireBridge(), on the stated belief that `_wire` "is built once in
// _wireBridge()". It is not. `_wire` is a GETTER-ONLY accessor on the same
// class (build-renderer-from-design.mjs), rebuilt fresh on every read. Class
// bodies are strict mode, so assigning to a getter-only property throws
// immediately -- on line one of the method body.
//
// Everything after that line never ran: the real progress, log and state IPC
// listeners, and the capabilities probe. So a download could start and the
// interface would never learn that it had progressed, logged anything, or
// finished.
//
// The runtime's own componentDidMount wrapper catches and console.errors the
// exception, so React never unmounted and a screenshot still looked correct.
// Measured: 2 throws per mount, silent.
//
// Note the shape, because it is the reason this survived review: a comment
// asserted a property of the code ("built once") that nobody verified, and
// every later reader trusted it.
//
// ---------------------------------------------------------------------------
// DEFECT 2 -- two lanes defined componentDidUpdate, and the survivor crashed.
//
// wire-palette-tabs.mjs and wire-language.mjs each independently injected a
// `componentDidUpdate(prevProps, prevState)` into the one shared class.
// Ordinary class semantics mean the later definition silently replaces the
// earlier, so tab order/pin/group persistence was dead code that never ran.
//
// Worse, the survivor threw on every update: the design's runtime
// (design/support.js) calls the logic class's componentDidUpdate with ONE
// argument -- prevProps -- and never passes prevState. So `prevState.prefs`
// dereferenced undefined. Measured: 476 throws per reload, every one swallowed
// by the runtime's try/catch, so nothing was visible on screen. The only
// symptom was that language, narrator and tab settings silently never saved.
//
// The repair gives the method a single owner that keeps its own previous-state
// snapshot -- because the runtime will not supply one -- and calls each lane's
// hook behind its own guard, so one lane failing cannot silence the other.
// ---------------------------------------------------------------------------

export function wireLifecycleRepair(html, replaceExact) {
  // 1. Drop the assignment to the getter-only `_wire`, and the two entries
  //    hung off it. They are replaced by direct method calls below: the
  //    methods they delegated to (`_loadTabsState`, `_maybeSaveTabsState`)
  //    are already real methods on the class, so the indirection through
  //    `_wire` bought nothing even when it was expected to work.
  html = replaceExact(
    html,
    `  _wireBridge() {
    this._wire = this._wire || {};
    this._wire.loadTabsState = (component) => component._loadTabsState();
    this._wire.maybeSaveTabsState = (component, prevState) => component._maybeSaveTabsState(component, prevState);`,
    `  _wireBridge() {`,
  )

  // 2. The call site that used the now-removed indirection.
  html = replaceExact(
    html,
    `    this._wire.loadTabsState(this);`,
    `    this._loadTabsState();`,
  )

  // 3. Rename both lanes' componentDidUpdate to private hooks, so neither
  //    shadows the other and the dispatcher below owns the real lifecycle
  //    method. Anchored on each body's own first line, which is distinct
  //    between the two.
  html = replaceExact(
    html,
    `  componentDidUpdate(prevProps, prevState) {
    this._wire.maybeSaveTabsState(this, prevState);
  }`,
    `  _didUpdateTabs(prevProps, prevState) {
    this._maybeSaveTabsState(this, prevState);
  }`,
  )

  html = replaceExact(
    html,
    `  componentDidUpdate(prevProps, prevState) {
    const keys = ['mode', 'enFunny',`,
    `  _didUpdateLanguage(prevProps, prevState) {
    const keys = ['mode', 'enFunny',`,
  )

  // 4. One real componentDidUpdate, owning the snapshot the runtime does not
  //    provide. Anchored on _wireBridge()'s opening, which step 1 has just
  //    made unique again.
  const DISPATCHER = `  // The design's runtime calls this with prevProps ONLY -- it never passes a
  // second prevState argument. Both wiring lanes assumed it did, and both were
  // wrong in the same way. Keep the snapshot here so each hook can have the
  // previous state it needs, and guard each hook separately so one lane
  // throwing cannot stop the other from running.
  componentDidUpdate(prevProps) {
    const prevState = this._prevStateSnapshot || {};
    this._prevStateSnapshot = this.state;
    if (typeof this._didUpdateTabs === 'function') {
      try { this._didUpdateTabs(prevProps, prevState); }
      catch (e) { console.error('tab-state update hook failed', e); }
    }
    if (typeof this._didUpdateLanguage === 'function') {
      try { this._didUpdateLanguage(prevProps, prevState); }
      catch (e) { console.error('language-prefs update hook failed', e); }
    }
  }

  _wireBridge() {`

  html = replaceExact(html, `  _wireBridge() {`, DISPATCHER)

  return html
}
