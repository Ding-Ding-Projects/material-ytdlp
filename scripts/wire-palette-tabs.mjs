// scripts/wire-palette-tabs.mjs
//
// Wires the command palette + browser-style tabs contract that
// docs/contract-audit.md marked SURFACE-ONLY, closing the specific gaps the
// audit named rather than rebuilding what already works:
//
//  - Ctrl+Shift+F is ALREADY bound as a real renderer keydown listener
//    (componentDidMount, unpatched by this lane) plus the toolbar button —
//    left untouched.
//  - The palette's live inline controls, teleport, and its own regex-driven
//    search are ALREADY real client-side behaviour (the `palette` array's
//    `control`/`apply`/`run` fields, `this.teleport`) — left untouched.
//  - The regex/"Pattern builder" popover ALREADY evaluates a real
//    `new RegExp(...)` against the sample text and reports a genuine
//    match/no-match/invalid state, and the four tab searches and the
//    bulk-close preview/authorize gate already call the same real
//    `this.match()` (regex-with-plain-text-fallback) — left untouched.
//
// What was genuinely missing, and what this lane adds:
//
//  1. PERSISTENCE. Tab order, pinned state, groups, dock edge, and the
//     palette's preference values (`prefs`) lived only in React state —
//     gone on restart. This wires them to the new `tabsState` bridge
//     namespace (app/src/main/tabs-state.ts via app/src/main/ipc.ts),
//     loading on mount and saving (debounced) on every relevant change via
//     a real `componentDidUpdate`.
//  2. REAL GROUPS. `createGroup` / `renameGroup` / `collapseGroup` were
//     toast-only stubs that never touched any group data, and the group
//     picker (`tabGroups`) was a hardcoded four-item list. Both are now
//     backed by real `state.customGroups`, persisted like everything else.
//  3. THE MISSING HALF OF BULK CLOSE. "Close tabs containing" existed;
//     "Close tabs NOT containing" (the documented inverse, required to
//     negate the exact same match predicate) did not. Added as a mode
//     toggle that both `previewClose` and `closePreview` honour.
//
// Same discipline as every other lane: every replacement is asserted via
// the caller-supplied `replaceExact` to match EXACTLY ONCE against the html
// produced by every lane that runs before this one.

export function wirePaletteTabs(html, replaceExact) {
  html = addInitialState(html, replaceExact)
  html = addLifecycleHooks(html, replaceExact)
  html = addHelperMethods(html, replaceExact)
  html = wireRealGroups(html, replaceExact)
  html = wireBulkCloseInverse(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 1. Initial state: add customGroups (persisted group records) and
//    tabCloseMode (bulk-close predicate direction) beside the existing
//    tabs/dialog state block.
// ---------------------------------------------------------------------------

function addInitialState(html, replaceExact) {
  const needle = `    activeTab: 1, nextTab: 4,
    dialog: null, regexTarget: null, regexPattern: '(?i)\\\\b(4k|2160p)\\\\b', regexFlags: 'iu',`
  const replacement = `    activeTab: 1, nextTab: 4,
    // Real groups (scripts/wire-palette-tabs.mjs): {name,color,collapsed,order}.
    // Starts empty — the design's four-item picker fell back to a hardcoded
    // list before any group had ever really been created; the real list is
    // now customGroups plus whatever group names live on state.tabs, so a
    // freshly-restored profile with no created groups still shows
    // 'Ungrouped' and whatever a tab is already tagged with.
    customGroups: [],
    // Bulk-close predicate direction: 'containing' (default) or
    // 'not-containing' — the documented inverse of the same match(), never
    // a second, independently-drifting query.
    tabCloseMode: 'containing',
    dialog: null, regexTarget: null, regexPattern: '(?i)\\\\b(4k|2160p)\\\\b', regexFlags: 'iu',`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 2. Lifecycle: load persisted state on mount, save (debounced) on every
//    relevant change via componentDidUpdate, flush/clear the debounce
//    timer on unmount.
// ---------------------------------------------------------------------------

function addLifecycleHooks(html, replaceExact) {
  html = replaceExact(
    html,
    `    this._wire.fetchExtractorCount(this);
    this._wireBridge();
  }
  componentWillUnmount() { clearInterval(this._timer); clearInterval(this._totpTimer); window.removeEventListener('keydown', this._key); this._unwireBridge(); }`,
    `    this._wire.fetchExtractorCount(this);
    this._wireBridge();
    this._wire.loadTabsState(this);
  }
  componentDidUpdate(prevProps, prevState) {
    this._wire.maybeSaveTabsState(this, prevState);
  }
  componentWillUnmount() { clearInterval(this._timer); clearInterval(this._totpTimer); clearTimeout(this._tabsStateSaveTimer); window.removeEventListener('keydown', this._key); this._unwireBridge(); }`
  )
  return html
}

// ---------------------------------------------------------------------------
// 3. Helper methods on the wiring runtime (this._wire.*), appended right
//    before the WIRING_METHODS block's own closing so every earlier lane's
//    helpers stay intact. Anchored on the same 'class Component extends
//    DCLogic {' opening every other lane anchors on, via a distinct,
//    already-unique marker comment inserted by build-renderer-from-design's
//    own WIRING_METHODS block: '_totalRateLabel' (used by wire-truth.mjs as
//    an anchor already) is a safe, stable anchor here too since it is
//    guaranteed present and unique by the time this lane runs (after
//    wireTruth in the orchestrator's declared order... but this lane is
//    registered to run independently, so anchor on the class-open marker
//    directly instead, which every lane already proves is unique).
// ---------------------------------------------------------------------------

function addHelperMethods(html, replaceExact) {
  const anchor = 'class Component extends DCLogic {\n'
  const methods = `  // Palette + tabs persistence (scripts/wire-palette-tabs.mjs) --------------
  //
  // Loads once on mount; merges onto the design's seed tabs/dialog state
  // rather than replacing it wholesale, so a first-ever launch (nothing
  // persisted yet) renders exactly the same seed tabs the design ships,
  // and a restored launch overlays the saved order/pins/groups/prefs on
  // top of that same shape.
  async _loadTabsState() {
    try {
      if (!window.ytdlpStudio || !window.ytdlpStudio.tabsState) return;
      const saved = await window.ytdlpStudio.tabsState.get();
      if (!saved) return;
      this.setState(st => {
        const next = {};
        if (Array.isArray(saved.tabs) && saved.tabs.length) {
          // Persisted tabs now carry view/groupId themselves. The merge against
          // a live tab of the same id stays as a fallback, for state written by
          // an older build that did not save them -- but a persisted view now
          // wins over the seed, because the user's own tab is the truth about
          // where that tab points.
          //
          // A tab that ends up with no view at all after both routes is dropped
          // rather than restored: a tab that cannot resolve its own content is
          // a dead entry in the strip, and silently keeping it is worse than
          // losing it, because it looks operable and is not.
          const byId = new Map(st.tabs.map(t => [t.id, t]));
          next.tabs = saved.tabs
            .map(pt => {
              const live = byId.get(pt.id) || {};
              const merged = { ...live, ...pt };
              if (merged.view == null && live.view != null) merged.view = live.view;
              if (merged.groupId == null && live.groupId != null) merged.groupId = live.groupId;
              return merged;
            })
            .filter(t => t.view != null);
          if (!next.tabs.length) delete next.tabs;
          next.nextTab = Math.max(st.nextTab, ...saved.tabs.map(t => (typeof t.id === 'number' ? t.id : 0)), 0) + 1;
        }
        if (Array.isArray(saved.groups)) next.customGroups = saved.groups;
        if (typeof saved.dock === 'string' && saved.dock) next.dock = saved.dock;
        if (saved.prefs && typeof saved.prefs === 'object') next.prefs = { ...(st.prefs || {}), ...saved.prefs };
        return next;
      });
    } catch (err) {
      // Fail open to the design's seed state — a missing/corrupt persisted
      // file is the honest first-launch state, never a crash.
      console.warn('tabsState: load failed', err);
    }
  }

  // Debounced save: componentDidUpdate calls this on every render, and it
  // only actually persists (after a short debounce, so a drag-reorder or a
  // held slider does not fire a write per frame) when one of the persisted
  // slices actually changed since the previous state.
  _maybeSaveTabsState(component, prevState) {
    const st = component.state;
    const changed =
      prevState.tabs !== st.tabs ||
      prevState.customGroups !== st.customGroups ||
      prevState.dock !== st.dock ||
      prevState.prefs !== st.prefs;
    if (!changed) return;
    clearTimeout(component._tabsStateSaveTimer);
    component._tabsStateSaveTimer = setTimeout(() => {
      if (!window.ytdlpStudio || !window.ytdlpStudio.tabsState) return;
      const payload = {
        // Persist view and groupId, the fields the runtime actually uses.
        //
        // This previously saved neither. view is what every lookup resolves a
        // tab's content from, and group was read off t.group -- a property
        // the runtime does not have; it uses groupId -- so it evaluated to
        // undefined every time and every tab was saved as 'Ungrouped'.
        //
        // The load side merged the missing fields back from a live tab of the
        // same id, which hid the problem for the three tabs the design seeds
        // and only those. Any tab the USER created has no live counterpart, so
        // it was restored with no view at all -- observed on a real profile
        // with a user-made tab labelled "History" that could no longer reach
        // the view it was named after.
        tabs: (st.tabs || []).map(t => ({
          id: t.id,
          label: t.label,
          pinned: !!t.pinned,
          view: t.view != null ? t.view : null,
          groupId: t.groupId != null ? t.groupId : null,
        })),
        groups: st.customGroups || [],
        dock: st.dock || 'left',
        prefs: st.prefs || {},
      };
      window.ytdlpStudio.tabsState.set(payload).catch(err => console.warn('tabsState: save failed', err));
    }, 400);
  }

`
  const withMethods = replaceExact(html, anchor, anchor + methods)

  // Expose the two new instance methods through the existing `this._wire`
  // dispatch object the way every other lane's helpers are reached (grep
  // shows call sites as `this._wire.someMethod(this)`), by wrapping them as
  // plain bound methods rather than requiring a second registration point:
  // `this._wire.loadTabsState` / `this._wire.maybeSaveTabsState` are wired
  // onto the shared `_wire` object at construction time via the same
  // pattern used for `_wire.fetchExtractorCount` — that object is built
  // once in `_wireBridge()`, so add these two entries there.
  const wireBridgeAnchor = `  _wireBridge() {`
  const wireBridgeReplacement = `  _wireBridge() {
    this._wire = this._wire || {};
    this._wire.loadTabsState = (component) => component._loadTabsState();
    this._wire.maybeSaveTabsState = (component, prevState) => component._maybeSaveTabsState(component, prevState);`
  return replaceExact(withMethods, wireBridgeAnchor, wireBridgeReplacement)
}

// ---------------------------------------------------------------------------
// 4. Real groups: replace the hardcoded four-item `tabGroups` list and the
//    three toast-only stubs with real state mutations against
//    state.customGroups, persisted by the hooks added above.
// ---------------------------------------------------------------------------

function wireRealGroups(html, replaceExact) {
  const needle = `      tabGroups: ['Ungrouped', 'Downloads', 'Options', 'Diagnostics'].map(v => ({ v })),
      tabGroup: s.tabGroup || 'Ungrouped', setTabGroup: e => this.setState({ tabGroup: e.target.value }),
      createGroup: () => this.toast('Group created', 'New tab group'),
      renameGroup: () => this.toast('Group renamed', s.tabGroup || 'Ungrouped'),
      collapseGroup: () => this.toast('Group collapsed', s.tabGroup || 'Ungrouped'),`
  const replacement = `      // Real groups (scripts/wire-palette-tabs.mjs): the union of every
      // custom group ever created (state.customGroups), every group name a
      // real tab already carries, and 'Ungrouped' as the permanent fallback
      // — never a hardcoded sample list a user could not have produced.
      tabGroups: (() => {
        const names = new Set(['Ungrouped']);
        (s.customGroups || []).forEach(g => names.add(g.name));
        (s.tabs || []).forEach(t => names.add(t.group || 'Ungrouped'));
        return Array.from(names).map(v => ({ v }));
      })(),
      tabGroup: s.tabGroup || 'Ungrouped', setTabGroup: e => this.setState({ tabGroup: e.target.value }),
      createGroup: () => {
        const name = (s.tabGroup || '').trim() || ('Group ' + ((s.customGroups || []).length + 1));
        this.setState(st => {
          if ((st.customGroups || []).some(g => g.name === name)) {
            return { tabGroup: name };
          }
          const order = (st.customGroups || []).length;
          return {
            customGroups: [...(st.customGroups || []), { name, color: '#82d5cc', collapsed: false, order }],
            tabGroup: name,
          };
        });
        this.toast('Group created', name);
      },
      renameGroup: () => {
        const from = s.tabGroup || 'Ungrouped';
        if (from === 'Ungrouped') { this.toast('Cannot rename', "'Ungrouped' is the permanent fallback group"); return; }
        const to = window.prompt ? (window.prompt('Rename group', from) || '').trim() : '';
        if (!to || to === from) return;
        this.setState(st => ({
          customGroups: (st.customGroups || []).map(g => g.name === from ? { ...g, name: to } : g),
          tabs: (st.tabs || []).map(t => (t.group || 'Ungrouped') === from ? { ...t, group: to } : t),
          tabGroup: to,
        }));
        this.toast('Group renamed', from + ' → ' + to);
      },
      collapseGroup: () => {
        const name = s.tabGroup || 'Ungrouped';
        this.setState(st => ({
          customGroups: (st.customGroups || []).some(g => g.name === name)
            ? (st.customGroups || []).map(g => g.name === name ? { ...g, collapsed: !g.collapsed } : g)
            : [...(st.customGroups || []), { name, color: '#82d5cc', collapsed: true, order: (st.customGroups || []).length }],
        }));
        this.toast('Group collapsed', name);
      },`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 5. Bulk close inverse: "Close tabs NOT containing", negating the exact
//    same match() predicate the existing 'containing' preview already
//    uses, driven by one shared tabCloseMode toggle so flags/casing cannot
//    drift between the two directions.
// ---------------------------------------------------------------------------

function wireBulkCloseInverse(html, replaceExact) {
  // 5a. previewClose / closePreview: honour tabCloseMode.
  const logicNeedle = `      previewClose: () => {
        const q = s.tabCloseContaining || s.tabMasterSearch || '';
        const hits = s.tabs.filter(t => q && this.match(t.label, q) && (s.includePinned || !t.pinned));
        this.setState({ closePreviewText: hits.length ? hits.length + ' tab(s) match and would close: ' + hits.map(t => t.label).join(', ') : 'No tab matches that query — nothing would close.', closeArmed: hits.length > 0 });
      },`
  const logicReplacement = `      tabCloseMode: s.tabCloseMode || 'containing',
      closeModeContainingBg: (s.tabCloseMode || 'containing') === 'containing' ? '#324b48' : 'transparent',
      closeModeContainingFg: (s.tabCloseMode || 'containing') === 'containing' ? '#cfe9e5' : '#82d5cc',
      closeModeNotContainingBg: s.tabCloseMode === 'not-containing' ? '#324b48' : 'transparent',
      closeModeNotContainingFg: s.tabCloseMode === 'not-containing' ? '#cfe9e5' : '#82d5cc',
      setCloseModeContaining: () => this.setState({ tabCloseMode: 'containing', closeArmed: false, closePreviewText: 'Direction set to containing — preview again before authorizing.' }),
      setCloseModeNotContaining: () => this.setState({ tabCloseMode: 'not-containing', closeArmed: false, closePreviewText: 'Direction set to NOT containing — preview again before authorizing.' }),
      previewClose: () => {
        const q = (s.tabCloseContaining || s.tabMasterSearch || '').trim();
        const invert = s.tabCloseMode === 'not-containing';
        if (!q) { this.setState({ closePreviewText: 'Enter one close query first — an empty query never runs.', closeArmed: false }); return; }
        // this.match() itself falls back to a valid state on an invalid
        // pattern (plain substring match), so guard invalidity explicitly
        // here rather than trusting a fallback to mean "safe to run".
        try { new RegExp(q); } catch (err) {
          this.setState({ closePreviewText: 'Invalid pattern: ' + err.message + ' — nothing would close.', closeArmed: false });
          return;
        }
        const eligible = s.tabs.filter(t => s.includePinned || !t.pinned);
        const hits = eligible.filter(t => invert ? !this.match(t.label, q) : this.match(t.label, q));
        const verb = invert ? 'NOT containing "' + q + '" match and would close: ' : 'containing "' + q + '" match and would close: ';
        this.setState({
          closePreviewText: hits.length ? hits.length + ' tab(s) ' + verb + hits.map(t => t.label).join(', ') : 'No tab matches that ' + (invert ? 'inverse ' : '') + 'query — nothing would close.',
          closeArmed: hits.length > 0,
        });
      },`
  html = replaceExact(html, logicNeedle, logicReplacement)

  // 5b. Markup: a two-way toggle beside the existing 'Include pinned tabs'
  // checkbox, so the direction is a visible, deliberate choice rather than
  // an implicit default nobody can see.
  const markupNeedle = `          <label style="display:flex;gap:10px;align-items:center;font-size:14px;color:#dee4e3;margin-bottom:10px">
            <input type="checkbox" checked="{{ includePinned }}" onChange="{{ toggleIncludePinned }}" style="width:18px;height:18px;accent-color:#82d5cc" /> Include pinned tabs after preview
          </label>`
  const markupReplacement = `          <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:13px;color:#bec9c7">
            <span>Close tabs</span>
            <button onClick="{{ setCloseModeContaining }}" style="height:30px;padding:0 14px;border-radius:15px;background:{{ closeModeContainingBg }};color:{{ closeModeContainingFg }};border:1px solid #889391;font-size:12px;font-weight:500">containing</button>
            <button onClick="{{ setCloseModeNotContaining }}" style="height:30px;padding:0 14px;border-radius:15px;background:{{ closeModeNotContainingBg }};color:{{ closeModeNotContainingFg }};border:1px solid #889391;font-size:12px;font-weight:500">NOT containing</button>
            <span>the query above</span>
          </div>
          <label style="display:flex;gap:10px;align-items:center;font-size:14px;color:#dee4e3;margin-bottom:10px">
            <input type="checkbox" checked="{{ includePinned }}" onChange="{{ toggleIncludePinned }}" style="width:18px;height:18px;accent-color:#82d5cc" /> Include pinned tabs after preview
          </label>`
  html = replaceExact(html, markupNeedle, markupReplacement)

  return html
}
