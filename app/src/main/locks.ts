import { app, safeStorage } from 'electron'
import { randomUUID, scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './store'
import { verifyAuthenticatorCode } from './authenticator'
import type {
  CreateLockRequest,
  CreateLockResult,
  LockDuration,
  LockMethod,
  LockSummary,
  RemoveLockResult,
  UnlockRequest,
  UnlockResult,
} from '../shared/locks-contract'

// ---------------------------------------------------------------------------
// Per-element toy locks.
//
// This is explicitly NOT a security boundary — it is a self-imposed speed
// bump the user can put on any one rendered element, described honestly as
// such everywhere it is offered. Recovery for a forgotten credential is
// always "delete this app's local data folder"; there is no reset ticket.
//
// Every lock carries its OWN credential. There is no master credential and
// no implicit inheritance between locks — unlocking one never unlocks
// another. A password is verified against a scrypt hash, never against a
// stored password; a TOTP-method lock delegates verification to the
// built-in authenticator (authenticator.ts) by a registered entry id.
// Credential material (the password hash+salt, or the linked entry id) is
// stored only as ciphertext produced by Electron's `safeStorage`, which is
// backed by the operating system's own credential facility.
// ---------------------------------------------------------------------------

const LOCKS_FILENAME = 'toy-locks.json'
const scrypt = promisify(scryptCb)

interface StoredLock {
  id: string
  target: string
  method: LockMethod
  duration: LockDuration
  createdAt: string
  /** base64 of the safeStorage-encrypted credential payload (JSON). */
  cipher: string
}

interface PasswordPayload {
  kind: 'password'
  saltB64: string
  hashB64: string
}

interface TotpPayload {
  kind: 'totp'
  authenticatorEntryId: string
}

type CredentialPayload = PasswordPayload | TotpPayload

interface LocksFile {
  locks: StoredLock[]
}

function locksPath(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, LOCKS_FILENAME)
}

async function readLocksFile(userDataDir?: string): Promise<LocksFile> {
  try {
    const raw = await readFile(locksPath(userDataDir), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LocksFile>
    return { locks: Array.isArray(parsed.locks) ? (parsed.locks as StoredLock[]) : [] }
  } catch {
    return { locks: [] }
  }
}

async function writeLocksFile(file: LocksFile, userDataDir?: string): Promise<void> {
  await atomicWriteFile(locksPath(userDataDir), JSON.stringify(file, null, 2))
}

function requireVault(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The operating system credential facility is unavailable, so no lock credential can be stored safely.')
  }
}

function encryptPayload(payload: CredentialPayload): string {
  requireVault()
  return safeStorage.encryptString(JSON.stringify(payload)).toString('base64')
}

function decryptPayload(cipherB64: string): CredentialPayload {
  requireVault()
  const json = safeStorage.decryptString(Buffer.from(cipherB64, 'base64'))
  return JSON.parse(json) as CredentialPayload
}

async function hashPassword(password: string): Promise<PasswordPayload> {
  const salt = randomBytes(16)
  const hash = (await scrypt(password, salt, 32)) as Buffer
  return { kind: 'password', saltB64: salt.toString('base64'), hashB64: hash.toString('base64') }
}

async function verifyPassword(password: string, payload: PasswordPayload): Promise<boolean> {
  const salt = Buffer.from(payload.saltB64, 'base64')
  const expected = Buffer.from(payload.hashB64, 'base64')
  const actual = (await scrypt(password, salt, 32)) as Buffer
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function toSummary(l: StoredLock): LockSummary {
  return { id: l.id, target: l.target, method: l.method, duration: l.duration, createdAt: l.createdAt }
}

export async function listLocks(): Promise<LockSummary[]> {
  const file = await readLocksFile()
  return file.locks.map(toSummary)
}

export async function createLock(req: CreateLockRequest): Promise<CreateLockResult> {
  try {
    if (!req.target || !req.target.trim()) return { ok: false, error: 'No element was targeted.' }

    let payload: CredentialPayload
    if (req.method === 'password') {
      if (!req.password || req.password.length === 0) {
        return { ok: false, error: 'Type a password first — it can be short, this is only for fun.' }
      }
      payload = await hashPassword(req.password)
    } else if (req.method === 'totp') {
      if (!req.authenticatorEntryId) {
        return { ok: false, error: 'Pair this lock with an authenticator entry first.' }
      }
      payload = { kind: 'totp', authenticatorEntryId: req.authenticatorEntryId }
    } else {
      return { ok: false, error: 'Unknown lock method.' }
    }

    const lock: StoredLock = {
      id: randomUUID(),
      target: req.target,
      method: req.method,
      duration: req.duration,
      createdAt: new Date().toISOString(),
      cipher: encryptPayload(payload),
    }
    const file = await readLocksFile()
    file.locks.push(lock)
    await writeLocksFile(file)
    return { ok: true, lock: toSummary(lock) }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function unlock(req: UnlockRequest): Promise<UnlockResult> {
  const file = await readLocksFile()
  const lock = file.locks.find((l) => l.id === req.id)
  if (!lock) return { ok: false, error: 'No such lock — it may already have been removed.' }

  try {
    const payload = decryptPayload(lock.cipher)
    let matched = false
    if (payload.kind === 'password') {
      matched = await verifyPassword(req.credential || '', payload)
    } else {
      matched = await verifyAuthenticatorCode(payload.authenticatorEntryId, req.credential || '')
    }
    if (!matched) {
      return { ok: false, error: 'That did not match. Delete the app’s local data folder to reset every lock if you have forgotten it.' }
    }
    file.locks = file.locks.filter((l) => l.id !== req.id)
    await writeLocksFile(file)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function removeLock(id: string): Promise<RemoveLockResult> {
  const file = await readLocksFile()
  const before = file.locks.length
  file.locks = file.locks.filter((l) => l.id !== id)
  if (file.locks.length === before) return { ok: false, error: 'No such lock.' }
  await writeLocksFile(file)
  return { ok: true }
}

/** The folder the recovery copy tells the user to delete to reset every lock. */
export function recoveryPath(): string {
  return app.getPath('userData')
}
