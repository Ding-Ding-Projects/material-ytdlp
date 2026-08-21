/**
 * Shared IPC contract for two independent feature lanes:
 *
 *  - ADHD modes + School mode ("modes:*" channels) — persisted, real,
 *    off-by-default accommodation toggles. School mode is a user-experience
 *    lock, never a security boundary; its recovery route (delete the local
 *    record) is documented on the state itself so the app never has to lie
 *    about what protects what.
 *  - The local Ollama model-suite manager ("ollama:*" channels) — talks
 *    only to Ollama's documented local HTTP API (default
 *    http://127.0.0.1:11434), never an invented proxy and never a cloud
 *    service. No payment semantics anywhere: a "pull" is a local download,
 *    never a purchase.
 *
 * TYPES + CHANNEL NAMES ONLY — never import `electron` here, so both the
 * main process and the renderer (via the preload bridge) can import this
 * file freely. Channel name strings are new and do not collide with any
 * entry in ipc-contract.ts, history-contract.ts, vocabulary-contract.ts,
 * probes-contract.ts, settings-actions-contract.ts, fileops-contract.ts, or
 * stubs-contract.ts.
 */

// ---------------------------------------------------------------------------
// ADHD modes + School mode
// ---------------------------------------------------------------------------

export const ModesIpcChannel = {
  GetState: 'modes:get-state',
  SetAdhdFlag: 'modes:set-adhd-flag',
  SetOneThingAction: 'modes:set-one-thing-action',
  SetMomentumSnooze: 'modes:set-momentum-snooze',
  SchoolEnable: 'modes:school-enable',
  SchoolDisable: 'modes:school-disable',
  SchoolRename: 'modes:school-rename',
  SchoolReset: 'modes:school-reset',
} as const

export type ModesIpcChannelName = (typeof ModesIpcChannel)[keyof typeof ModesIpcChannel]

/** The five independently-toggleable ADHD accommodation modes. All default to `false`. */
export interface AdhdFlags {
  /** Bring the active surface forward, push the rest back. Never hides anything the user cannot get back in one action. */
  focus: boolean
  /** Fewer moving things, quieter colour, fewer notifications. Composes with (never overrides) the OS reduced-motion preference. */
  lowStim: boolean
  /** Shows elapsed session time and time-since-last-change where the work happens. Stating the number is the whole feature. */
  timeAwareness: boolean
  /** A single, user-chosen, persisted "current next action" shown prominently. */
  oneThing: boolean
  /** A gentle, dismissible nudge when the current action has sat untouched; "not now" is respected for a stated period. */
  momentum: boolean
}

export const DEFAULT_ADHD_FLAGS: AdhdFlags = {
  focus: false,
  lowStim: false,
  timeAwareness: false,
  oneThing: false,
  momentum: false,
}

export interface SchoolState {
  enabled: boolean
  /** User-chosen display name for the mode; defaults to "School mode". Never reveals the shipped name once renamed. */
  name: string
  /** Whether an unlock credential has ever been set (never the credential itself). */
  hasCredential: boolean
}

export const DEFAULT_SCHOOL_STATE: SchoolState = {
  enabled: false,
  name: 'School mode',
  hasCredential: false,
}

export interface ModesState {
  adhd: AdhdFlags
  /** The single persisted "current next action" text, or null when unset. */
  oneThingAction: string | null
  /** Epoch ms until which the momentum nudge is snoozed, or null. */
  momentumSnoozedUntil: number | null
  /** Epoch ms the current session started, for the time-awareness elapsed-time readout. */
  sessionStartedAt: number
  school: SchoolState
}

export interface SchoolCredentialResult {
  ok: boolean
  error: string | null
  state: ModesState
}

// ---------------------------------------------------------------------------
// Local Ollama model-suite manager
// ---------------------------------------------------------------------------

export const OllamaIpcChannel = {
  Probe: 'ollama:probe',
} as const

export type OllamaIpcChannelName = (typeof OllamaIpcChannel)[keyof typeof OllamaIpcChannel]

/** Where the local Ollama HTTP API is expected. Never a cloud endpoint. */
export const OLLAMA_LOCAL_BASE_URL = 'http://127.0.0.1:11434'

export type OllamaFitVerdict = 'runs-well' | 'runs-with-limits' | 'unlikely' | 'unknown'

export interface OllamaModelInfo {
  name: string
  /** Real reported size in bytes, from the local API — never inferred from the model's name. */
  sizeBytes: number
  digest: string
  modifiedAt: string
  parameterSize: string | null
  quantizationLevel: string | null
  family: string | null
  fit: OllamaFitVerdict
  /** The real evidence behind `fit`, so the verdict is checkable rather than asserted. */
  fitEvidence: string
}

export type OllamaStatus = 'unreachable' | 'reachable'

export interface OllamaProbeResult {
  status: OllamaStatus
  /** Human-readable reason when `status === 'unreachable'` (e.g. connection refused). */
  error: string | null
  version: string | null
  models: OllamaModelInfo[]
  /** Real detected host RAM in bytes, used to compute each model's fit evidence. */
  hostTotalMemBytes: number
  hostFreeMemBytes: number
}
