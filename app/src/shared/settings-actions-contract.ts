/**
 * Shared IPC contract for the "settings actions" lane: the custom
 * application mark (title-bar / tray logo) and the local-only Support
 * Tickets surface.
 *
 * TYPES + CHANNEL NAMES + SCHEMA CONSTANTS ONLY — never import `electron`
 * here at runtime, so both the main process and the renderer (via the
 * preload bridge) can import this file freely. Channel names below are
 * plain strings that do not collide with any entry in `ipc-contract.ts`,
 * `history-contract.ts`, or `vocabulary-contract.ts` (all owned elsewhere).
 */

// ---------------------------------------------------------------------------
// Application mark (custom logo)
// ---------------------------------------------------------------------------

export const AppMarkIpcChannel = {
  /** Opens a native file picker, validates the selection, and (on success) stores it as the active mark. */
  PickAndApply: 'app-mark:pick-and-apply',
  /** Re-reads the on-disk mark, returning the current state. */
  GetState: 'app-mark:get-state',
  /** Deletes the custom mark, reverting display to the shipped mark. */
  Reset: 'app-mark:reset',
} as const

export type AppMarkIpcChannelName = (typeof AppMarkIpcChannel)[keyof typeof AppMarkIpcChannel]

/** Hard ceiling on the raw file size, in bytes, before it is even inspected. */
export const APP_MARK_MAX_FILE_BYTES = 2_000_000 // 2 MB

/** Only PNG is accepted. The mark is stored and displayed as-is (no re-encode), so only a format the OS/renderer can render directly natively is allowlisted. */
export const APP_MARK_MIN_DIMENSION_PX = 16
export const APP_MARK_MAX_DIMENSION_PX = 4096

export interface AppMarkState {
  /** True once a validated custom mark is stored and in effect. False is the honest, ever-present shipped-mark state. */
  active: boolean
  widthPx: number | null
  heightPx: number | null
  /** Epoch ms the currently-active mark was validated and stored, or null when none is active. */
  updatedAt: number | null
}

export function emptyAppMarkState(): AppMarkState {
  return { active: false, widthPx: null, heightPx: null, updatedAt: null }
}

/** Result of a pick-and-apply round trip: the user may cancel, the file may be rejected, or it may succeed. */
export interface AppMarkApplyResult {
  ok: boolean
  /** True when the user dismissed the file picker without choosing anything — never an error. */
  cancelled: boolean
  /** Null on success or cancellation; a specific, human-readable rejection reason on failure. */
  error: string | null
  /** The resulting state after this operation — on failure, whatever was in effect before (fail-closed, never partial). */
  state: AppMarkState
}

// ---------------------------------------------------------------------------
// Support Tickets (entirely local; no ticket ever leaves the machine)
// ---------------------------------------------------------------------------

export const SupportTicketsIpcChannel = {
  /** Creates a new local ticket record and returns it. */
  Create: 'support-tickets:create',
  /** Lists every locally recorded ticket, newest first. */
  List: 'support-tickets:list',
  /**
   * The "resolution": opens the application's own local data folder in the
   * platform file manager so the user can delete it themselves. This NEVER
   * deletes anything on the user's behalf.
   */
  OpenDataFolder: 'support-tickets:open-data-folder',
} as const

export type SupportTicketsIpcChannelName = (typeof SupportTicketsIpcChannel)[keyof typeof SupportTicketsIpcChannel]

export type TicketSeverity = 'trivial' | 'moderate' | 'severe' | 'catastrophic (not really)'
export type TicketStatus = 'received' | 'triaged' | 'the-fix-is-you' | 'awaiting-your-click'

export interface SupportTicket {
  id: string
  /** A short, locally generated, human-friendly ticket number, e.g. "T-0007". */
  number: string
  category: string
  description: string
  severity: TicketSeverity
  status: TicketStatus
  createdAt: number
}

export interface TicketCreateRequest {
  category: string
  description: string
}

export interface TicketCreateResult {
  ok: boolean
  error: string | null
  ticket: SupportTicket | null
}

/**
 * The one plain, unmissable, un-styled disclosure line that must accompany
 * every rendering of the Support Tickets surface: nothing here is sent
 * anywhere, no ticket exists outside this machine, no network request is
 * made, and nobody is reading it. Kept as a single shared constant so the
 * exact wording cannot drift between the main-process ticket record and the
 * renderer surface that displays it.
 */
export const SUPPORT_TICKETS_DISCLOSURE =
  'This is a local joke, not a real help desk: nothing here is ever sent anywhere, no ticket exists outside this computer, no network request is made, and nobody is reading it. Nobody is coming. The button below opens this app’s own data folder so you can delete it yourself.'
