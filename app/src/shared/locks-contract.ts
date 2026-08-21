/**
 * Shared IPC contract for per-element toy locks and the built-in TOTP
 * authenticator.
 *
 * TYPES ONLY — must never import anything from `electron` at runtime, so
 * both the main process and the renderer (via the preload bridge) can
 * import it without pulling in Node/Electron internals.
 *
 * Both features are described in the project's canonical instructions as
 * "for fun" — a self-imposed speed bump, never a security boundary. The
 * copy shown to the user must say so every time, and the recovery route
 * for a forgotten lock credential is always "delete the app's local data
 * folder"; there is no reset ticket and no support channel.
 */

// ---------------------------------------------------------------------------
// Per-element toy locks
// ---------------------------------------------------------------------------

export const LocksIpcChannel = {
  List: 'locks:list',
  Create: 'locks:create',
  Unlock: 'locks:unlock',
  Remove: 'locks:remove',
  RecoveryPath: 'locks:recovery-path',
} as const

export type LockMethod = 'password' | 'totp'

/** How long an unlock stays in effect once granted. */
export type LockDuration = 'session' | '5m' | '1h' | 'until-relocked'

/** Public summary of a lock — never carries credential material. */
export interface LockSummary {
  /** Stable id for this lock, distinct from the human-readable target label. */
  id: string
  /** The human-readable label of the locked element, e.g. a menu/tab title. */
  target: string
  method: LockMethod
  duration: LockDuration
  createdAt: string
}

export interface CreateLockRequest {
  target: string
  method: LockMethod
  duration: LockDuration
  /** For `password`: the plain password (hashed before it ever touches disk). */
  password?: string
  /** For `totp`: a registered authenticator entry id to pair this lock to. */
  authenticatorEntryId?: string
}

export interface CreateLockResult {
  ok: boolean
  lock?: LockSummary
  error?: string
}

export interface UnlockRequest {
  id: string
  /** Password attempt, or the current 6–8 digit TOTP code. */
  credential: string
}

export interface UnlockResult {
  ok: boolean
  error?: string
}

export interface RemoveLockResult {
  ok: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Built-in TOTP authenticator (RFC 6238 / RFC 4226)
// ---------------------------------------------------------------------------

export const AuthenticatorIpcChannel = {
  List: 'authenticator:list',
  Register: 'authenticator:register',
  ConfirmPairing: 'authenticator:confirm-pairing',
  CurrentCode: 'authenticator:current-code',
  Remove: 'authenticator:remove',
  RunTestVectors: 'authenticator:run-test-vectors',
} as const

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/** Public summary of a registered entry — never carries the secret. */
export interface AuthenticatorEntrySummary {
  id: string
  issuer: string
  account: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  /** False until the user has typed back one live code after registering. */
  confirmed: boolean
  createdAt: string
}

export interface RegisterAuthenticatorRequest {
  /**
   * Either a manually entered base32 secret, or a complete `otpauth://`
   * URI (which may itself carry issuer/account/algorithm/digits/period —
   * those override the other fields below when present).
   */
  input: string
  issuer?: string
  account?: string
  algorithm?: TotpAlgorithm
  digits?: number
  period?: number
}

export interface RegisterAuthenticatorResult {
  ok: boolean
  entry?: AuthenticatorEntrySummary
  /** The exact otpauth:// URI that was registered, for display/QR use. */
  otpauthUri?: string
  /** Manual entry secret, grouped in 4-character blocks, base32. */
  manualSecret?: string
  /** Locally rendered QR code as an inline SVG string. Never fetched remotely. */
  qrSvg?: string
  error?: string
}

export interface ConfirmPairingRequest {
  id: string
  code: string
}

export interface ConfirmPairingResult {
  ok: boolean
  error?: string
}

export interface CurrentCodeRequest {
  id: string
}

export interface CurrentCodeResult {
  ok: boolean
  code?: string
  nextCode?: string
  secondsRemaining?: number
  /** True when the local system clock looks skewed enough that codes may be refused. */
  clockSkewWarning?: boolean
  error?: string
}

export interface RemoveAuthenticatorResult {
  ok: boolean
  error?: string
}

/** One RFC 6238 published test vector result, for verification reporting. */
export interface TotpVectorResult {
  algorithm: TotpAlgorithm
  timeSeconds: number
  expected: string
  actual: string
  pass: boolean
}

export interface RunTestVectorsResult {
  ok: boolean
  results: TotpVectorResult[]
  allPassed: boolean
}

/** Shown by the renderer alongside every lock-creation and unlock surface. */
export const TOY_LOCK_DISCLOSURE =
  'This is just for fun — a tidiness and oops-prevention toy, not a security boundary. Forgot it? Delete the app’s local data folder to reset every lock at once; there is no reset ticket.'
