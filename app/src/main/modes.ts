/**
 * ADHD modes + School mode: persistence and the one real piece of School
 * mode's "not a security boundary" credential check.
 *
 * Storage: a single `modes.json` in the app's userData directory, written
 * atomically via the same retrying rename `store.ts` already uses (Windows'
 * transient sharing-violation codes on rename-over-existing apply here too).
 *
 * School mode's credential is NOT an OS-vault secret and is not presented as
 * one anywhere in this app: the feature contract is explicit that this is a
 * user-experience lock, and its documented recovery path is deleting the
 * local application-data record. A salted scrypt hash is still used instead
 * of a plaintext comparison so the file itself does not read as "the
 * password", but nothing here claims to protect the user from anyone who
 * has the machine.
 */

import { app } from 'electron'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './store'
import {
  DEFAULT_ADHD_FLAGS,
  DEFAULT_SCHOOL_STATE,
  type AdhdFlags,
  type ModesState,
  type SchoolCredentialResult,
} from '../shared/tools-contract'

const MODES_FILENAME = 'modes.json'
const SCRYPT_KEYLEN = 32

interface StoredModes {
  adhd: AdhdFlags
  oneThingAction: string | null
  momentumSnoozedUntil: number | null
  school: { enabled: boolean; name: string; credential: { salt: string; hash: string } | null }
}

function defaultStored(): StoredModes {
  return {
    adhd: { ...DEFAULT_ADHD_FLAGS },
    oneThingAction: null,
    momentumSnoozedUntil: null,
    school: { enabled: false, name: DEFAULT_SCHOOL_STATE.name, credential: null },
  }
}

function modesPath(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, MODES_FILENAME)
}

async function readStored(): Promise<StoredModes> {
  try {
    const raw = await readFile(modesPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredModes>
    const fallback = defaultStored()
    return {
      adhd: { ...fallback.adhd, ...(parsed.adhd ?? {}) },
      oneThingAction: typeof parsed.oneThingAction === 'string' ? parsed.oneThingAction : null,
      momentumSnoozedUntil: typeof parsed.momentumSnoozedUntil === 'number' ? parsed.momentumSnoozedUntil : null,
      school: {
        enabled: Boolean(parsed.school?.enabled),
        name: typeof parsed.school?.name === 'string' && parsed.school.name.trim() ? parsed.school.name : fallback.school.name,
        credential:
          parsed.school?.credential &&
          typeof parsed.school.credential.salt === 'string' &&
          typeof parsed.school.credential.hash === 'string'
            ? parsed.school.credential
            : null,
      },
    }
  } catch {
    return defaultStored()
  }
}

async function writeStored(stored: StoredModes): Promise<void> {
  await atomicWriteFile(modesPath(), JSON.stringify(stored, null, 2))
}

// Session start is process-lifetime, not persisted: "how long has this
// session been open" is meaningless across a restart.
const sessionStartedAt = Date.now()

function toPublicState(stored: StoredModes): ModesState {
  return {
    adhd: stored.adhd,
    oneThingAction: stored.oneThingAction,
    momentumSnoozedUntil: stored.momentumSnoozedUntil,
    sessionStartedAt,
    school: {
      enabled: stored.school.enabled,
      name: stored.school.name,
      hasCredential: stored.school.credential !== null,
    },
  }
}

function hashCredential(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, SCRYPT_KEYLEN)
}

export async function getModesState(): Promise<ModesState> {
  return toPublicState(await readStored())
}

export async function setAdhdFlag(flag: keyof AdhdFlags, value: boolean): Promise<ModesState> {
  const stored = await readStored()
  stored.adhd = { ...stored.adhd, [flag]: value }
  await writeStored(stored)
  return toPublicState(stored)
}

export async function setOneThingAction(text: string | null): Promise<ModesState> {
  const stored = await readStored()
  stored.oneThingAction = text && text.trim() ? text.trim().slice(0, 200) : null
  await writeStored(stored)
  return toPublicState(stored)
}

export async function setMomentumSnooze(untilMs: number | null): Promise<ModesState> {
  const stored = await readStored()
  stored.momentumSnoozedUntil = typeof untilMs === 'number' ? untilMs : null
  await writeStored(stored)
  return toPublicState(stored)
}

/** Sets (or replaces) the unlock credential and turns School mode on. */
export async function schoolEnable(password: string): Promise<SchoolCredentialResult> {
  const stored = await readStored()
  if (!password || password.length < 1) {
    return { ok: false, error: 'Choose a password or PIN first — it can be anything, this is just a speed bump.', state: toPublicState(stored) }
  }
  const salt = randomBytes(16)
  const hash = hashCredential(password, salt)
  stored.school.credential = { salt: salt.toString('hex'), hash: hash.toString('hex') }
  stored.school.enabled = true
  await writeStored(stored)
  return { ok: true, error: null, state: toPublicState(stored) }
}

/** Verifies the credential and, only on a match, turns School mode off. */
export async function schoolDisable(password: string): Promise<SchoolCredentialResult> {
  const stored = await readStored()
  if (!stored.school.credential) {
    // Nothing was ever set (or the record was reset) — off is the fail-safe state already.
    stored.school.enabled = false
    await writeStored(stored)
    return { ok: true, error: null, state: toPublicState(stored) }
  }
  const salt = Buffer.from(stored.school.credential.salt, 'hex')
  const expected = Buffer.from(stored.school.credential.hash, 'hex')
  const actual = hashCredential(password, salt)
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual)
  if (!matches) {
    return {
      ok: false,
      error: 'That did not match. This is a for-fun lock, not security — you can also recover by deleting this app’s local data folder.',
      state: toPublicState(stored),
    }
  }
  stored.school.enabled = false
  await writeStored(stored)
  return { ok: true, error: null, state: toPublicState(stored) }
}

export async function schoolRename(name: string): Promise<ModesState> {
  const stored = await readStored()
  const trimmed = name.trim().slice(0, 60)
  stored.school.name = trimmed || DEFAULT_SCHOOL_STATE.name
  await writeStored(stored)
  return toPublicState(stored)
}

/** The documented recovery route: wipes the shared local record (mode, name, and credential) back to defaults. */
export async function schoolReset(): Promise<ModesState> {
  const stored = defaultStored()
  await writeStored(stored)
  return toPublicState(stored)
}
