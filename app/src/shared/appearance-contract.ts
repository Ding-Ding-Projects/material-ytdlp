/**
 * Shared IPC contract for the "appearance" lane, owned by this lane only:
 *
 *  - App display-name rename (title bar / About / notifications). Display
 *    only — never touches userData directory identity, installer identity,
 *    or the update feed. Those stay derived from a fixed constant elsewhere;
 *    this file only ever reads/writes a display string.
 *  - Per-element "Edit appearance…" overrides, keyed by the element's own
 *    target label (e.g. "Queue surface"), so distinct elements can carry
 *    distinct persisted overrides rather than sharing one global draft.
 *
 * Global theme/density/scale/weight/font/corner-radius/reduced-motion
 * preferences are NOT duplicated here — they already have a real,
 * end-to-end-wired home in `ipc-contract.ts`'s `Preferences` type via the
 * `store:get-preferences` / `store:set-preferences` channels and the
 * preload `store` namespace. This lane's job for those is to make the
 * renderer actually *use* that existing bridge (hydrate on load, persist on
 * change) and to give three previously-unread preference fields
 * (theme, cornerRadius, reducedMotion) a real visual consumer — not to
 * build a second, competing preferences store.
 *
 * TYPES + CHANNEL NAMES ONLY — never import `electron` here at runtime, so
 * both the main process and the renderer (via the preload bridge) can
 * import this file freely. Channel names below are plain strings chosen not
 * to collide with any entry in `ipc-contract.ts`, `history-contract.ts`,
 * `vocabulary-contract.ts`, or `settings-actions-contract.ts` (all owned
 * elsewhere).
 */

// ---------------------------------------------------------------------------
// App display-name rename
// ---------------------------------------------------------------------------

export const AppearanceIpcChannel = {
  /** Reads the current display-name state. */
  GetRename: 'appearance:get-rename',
  /** Sets a new display name. Empty/whitespace-only is rejected. */
  SetRename: 'appearance:set-rename',
  /** Clears any custom display name, reverting to the shipped name. */
  ResetRename: 'appearance:reset-rename',

  /** Reads every persisted per-element appearance override. */
  GetElementOverrides: 'appearance:get-element-overrides',
  /** Sets (replaces) the override for one element target. */
  SetElementOverride: 'appearance:set-element-override',
  /** Clears the override for one element target. */
  ResetElementOverride: 'appearance:reset-element-override',
  /** Clears every per-element override at once ("reset globally"). */
  ResetAllElementOverrides: 'appearance:reset-all-element-overrides',
} as const

export type AppearanceIpcChannelName = (typeof AppearanceIpcChannel)[keyof typeof AppearanceIpcChannel]

/** The one product name every surface falls back to when no custom name is set. */
export const SHIPPED_APP_NAME = 'yt-dlp Studio'

/** Hard bound so a pasted essay cannot be typed into the title bar. */
export const APP_RENAME_MAX_LENGTH = 60

export interface RenameState {
  /** True when a validated custom display name is currently active. */
  active: boolean
  /** The name to actually render — the custom one when active, the shipped one otherwise. Never empty. */
  displayName: string
  /** Epoch ms the custom name was last set, or null when none is active. */
  updatedAt: number | null
}

export function shippedRenameState(): RenameState {
  return { active: false, displayName: SHIPPED_APP_NAME, updatedAt: null }
}

export interface RenameSetResult {
  ok: boolean
  /** Human-readable rejection reason on failure (e.g. empty, too long). Null on success. */
  error: string | null
  state: RenameState
}

// ---------------------------------------------------------------------------
// Per-element "Edit appearance…" overrides
// ---------------------------------------------------------------------------

/**
 * One element's persisted appearance override. Every field is optional so a
 * user can override only the properties they touched; an absent field means
 * "inherit the app-wide preference for this property". `accent` may be a
 * literal hex color OR the animated-rainbow sentinel below — never both, and
 * a literal color string can never equal the sentinel by construction (the
 * sentinel is not a valid `#rrggbb`/`#rrggbbaa` string).
 */
export interface ElementAppearanceOverride {
  theme?: 'dark' | 'light'
  font?: string
  /** Accent color as `#rrggbb` / `#rrggbbaa`, OR the `RAINBOW_ACCENT_SENTINEL` below. */
  accent?: string
  scale?: number
  weight?: number
  radius?: number
  updatedAt: number
}

/**
 * Sentinel marking "animated rainbow accent" instead of a fixed color. This
 * is intentionally NOT a valid CSS color string (real colors here are always
 * `#rrggbb`/`#rrggbbaa`), so it can never collide with a real stored value,
 * and it is never placed into any swatch/recent-colors array — only ever
 * compared against directly before an accent value is used as a literal
 * CSS color, exactly so a stray `sentinel + alpha` string concatenation
 * (a real failure mode: appending alpha to a stored accent for a tint)
 * produces an obviously-wrong string rather than a silently-dropped
 * declaration.
 */
export const RAINBOW_ACCENT_SENTINEL = '__dc_rainbow__'

export function isRainbowAccent(value: string | null | undefined): boolean {
  return value === RAINBOW_ACCENT_SENTINEL
}

/** Map of element target label -> its persisted override. */
export type ElementAppearanceOverrides = Record<string, ElementAppearanceOverride>

export interface SetElementOverrideRequest {
  targetId: string
  override: Omit<ElementAppearanceOverride, 'updatedAt'>
}
