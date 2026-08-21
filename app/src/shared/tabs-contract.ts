/**
 * Shared IPC contract for the "palette + tabs" lane: persistence for the
 * browser-style tab strip (order, pinned state, groups, collapsed state)
 * and the command-palette live-control preferences that used to live only
 * in transient React state.
 *
 * TYPES + CHANNEL NAMES ONLY — never import `electron` here at runtime, so
 * both the main process and the renderer (via the preload bridge) can
 * import this file freely. Channel names below are plain strings that do
 * not collide with any entry in `ipc-contract.ts`, `history-contract.ts`,
 * `vocabulary-contract.ts`, `settings-actions-contract.ts`,
 * `fileops-contract.ts`, `probes-contract.ts`, or `stubs-contract.ts`
 * (all owned elsewhere).
 */

export const TabsStateIpcChannel = {
  /** Reads the persisted tab/group/palette-preference state, or the default empty state if none was ever saved. */
  Get: 'tabs-state:get',
  /** Persists the complete tab/group/palette-preference state, replacing whatever was stored before. */
  Set: 'tabs-state:set',
} as const

export type TabsStateIpcChannelName = (typeof TabsStateIpcChannel)[keyof typeof TabsStateIpcChannel]

// ---------------------------------------------------------------------------
// Persisted shapes
// ---------------------------------------------------------------------------

export interface PersistedTab {
  id: string
  label: string
  pinned: boolean
  /** Group name, or 'Ungrouped'. */
  group: string
}

export interface PersistedGroup {
  name: string
  color: string
  collapsed: boolean
  /** Sort position among sibling groups. */
  order: number
}

/**
 * Palette/appearance preferences that must survive a restart. This mirrors
 * the shape of the renderer's own `prefs` state object (see the palette's
 * `control`/`apply` rows in the generated component) but is owned here so
 * it has one real, disk-backed source of truth instead of living only in
 * memory for the life of one window.
 */
export type PersistedPrefs = Record<string, string | number | boolean>

export interface TabsState {
  /** Tab order IS array order — no separate index field, so persisting the array is persisting the order. */
  tabs: PersistedTab[]
  groups: PersistedGroup[]
  /** Which docking edge the strip is pinned to: 'left' | 'right' | 'top' | 'bottom' | 'float'. */
  dock: string
  prefs: PersistedPrefs
}

export function emptyTabsState(): TabsState {
  return { tabs: [], groups: [], dock: 'left', prefs: {} }
}
