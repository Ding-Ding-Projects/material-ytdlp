import { app } from 'electron'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { atomicWriteFile } from './store'
import {
  APP_RENAME_MAX_LENGTH,
  RAINBOW_ACCENT_SENTINEL,
  shippedRenameState,
  type ElementAppearanceOverride,
  type ElementAppearanceOverrides,
  type RenameSetResult,
  type RenameState,
} from '../shared/appearance-contract'

// ---------------------------------------------------------------------------
// Persistence for this lane's two features: the app display-name rename,
// and per-element "Edit appearance…" overrides. Both are plain JSON files
// beside the app's other persisted state (`preferences.json`,
// `app-mark.png`, …), written with the shared atomic-write helper so a
// mid-write antivirus/indexer sharing violation on Windows retries rather
// than silently losing the file (see `store.ts` for why a single rename
// attempt is not atomic-in-practice on that platform).
//
// Rename is DISPLAY ONLY: `dataDir()` below is a fixed function of Electron's
// own `userData` path, never of the stored display name, so renaming can
// never orphan a profile. The real product name (SHIPPED_APP_NAME) is what a
// diagnostic/crash report should use, never the user's chosen display name.
// ---------------------------------------------------------------------------

const RENAME_FILENAME = 'appearance-rename.json'
const ELEMENTS_FILENAME = 'appearance-elements.json'
const MAX_ELEMENT_OVERRIDES = 500

function dataDir(): string {
  return app.getPath('userData')
}

function renamePath(): string {
  return join(dataDir(), RENAME_FILENAME)
}

function elementsPath(): string {
  return join(dataDir(), ELEMENTS_FILENAME)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    // Missing, unreadable, or corrupt: fail closed to the fallback rather
    // than crashing the app. The next write atomically replaces it.
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

interface StoredRename {
  displayName: string
  updatedAt: number
}

export async function getRenameState(): Promise<RenameState> {
  const stored = await readJson<StoredRename | null>(renamePath(), null)
  if (!stored || typeof stored.displayName !== 'string' || !stored.displayName.trim()) {
    return shippedRenameState()
  }
  return { active: true, displayName: stored.displayName, updatedAt: stored.updatedAt ?? null }
}

export async function setRenameDisplayName(name: string): Promise<RenameSetResult> {
  const trimmed = (name ?? '').trim()
  if (!trimmed) {
    return { ok: false, error: 'Enter a name — it cannot be blank.', state: await getRenameState() }
  }
  if (trimmed.length > APP_RENAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Keep it to ${APP_RENAME_MAX_LENGTH} characters or fewer.`,
      state: await getRenameState(),
    }
  }
  const stored: StoredRename = { displayName: trimmed, updatedAt: Date.now() }
  await atomicWriteFile(renamePath(), JSON.stringify(stored, null, 2))
  return { ok: true, error: null, state: { active: true, displayName: trimmed, updatedAt: stored.updatedAt } }
}

export async function resetRenameDisplayName(): Promise<RenameState> {
  // Reset means "revert to the shipped name" — write an explicit empty
  // marker rather than deleting the file, so a concurrent read never races
  // an unlink and sees an inconsistent partial state mid-transition.
  // `getRenameState()` treats an empty/whitespace `displayName` as
  // "no custom name active" and falls back to `shippedRenameState()`.
  await atomicWriteFile(renamePath(), JSON.stringify({ displayName: '', updatedAt: null }, null, 2))
  return shippedRenameState()
}

// ---------------------------------------------------------------------------
// Per-element appearance overrides
// ---------------------------------------------------------------------------

function sanitizeOverride(input: Partial<ElementAppearanceOverride>): Omit<ElementAppearanceOverride, 'updatedAt'> {
  const out: Omit<ElementAppearanceOverride, 'updatedAt'> = {}
  if (input.theme === 'dark' || input.theme === 'light') out.theme = input.theme
  if (typeof input.font === 'string' && input.font.trim()) out.font = input.font.trim().slice(0, 60)
  if (typeof input.accent === 'string') {
    const a = input.accent.trim()
    if (a === RAINBOW_ACCENT_SENTINEL || /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(a)) out.accent = a
  }
  if (typeof input.scale === 'number' && Number.isFinite(input.scale)) {
    out.scale = Math.min(1.3, Math.max(0.9, input.scale))
  }
  if (typeof input.weight === 'number' && Number.isFinite(input.weight)) {
    out.weight = Math.min(700, Math.max(300, Math.round(input.weight / 100) * 100))
  }
  if (typeof input.radius === 'number' && Number.isFinite(input.radius)) {
    out.radius = Math.min(28, Math.max(4, Math.round(input.radius)))
  }
  return out
}

export async function getElementOverrides(): Promise<ElementAppearanceOverrides> {
  return readJson<ElementAppearanceOverrides>(elementsPath(), {})
}

export async function setElementOverride(
  targetId: string,
  override: Partial<ElementAppearanceOverride>,
): Promise<ElementAppearanceOverrides> {
  const id = (targetId ?? '').trim()
  if (!id) return getElementOverrides()
  const existing = await getElementOverrides()
  const clean = sanitizeOverride(override)
  const next: ElementAppearanceOverrides = {
    ...existing,
    [id]: { ...clean, updatedAt: Date.now() },
  }
  // Bound the map so an app used for years with many distinct element
  // labels cannot grow this file without limit — drop the oldest entries.
  const entries = Object.entries(next).sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  const bounded = entries.slice(Math.max(0, entries.length - MAX_ELEMENT_OVERRIDES))
  const result = Object.fromEntries(bounded) as ElementAppearanceOverrides
  await atomicWriteFile(elementsPath(), JSON.stringify(result, null, 2))
  return result
}

export async function resetElementOverride(targetId: string): Promise<ElementAppearanceOverrides> {
  const id = (targetId ?? '').trim()
  const existing = await getElementOverrides()
  if (!id || !(id in existing)) return existing
  const next = { ...existing }
  delete next[id]
  await atomicWriteFile(elementsPath(), JSON.stringify(next, null, 2))
  return next
}

export async function resetAllElementOverrides(): Promise<ElementAppearanceOverrides> {
  await atomicWriteFile(elementsPath(), JSON.stringify({}, null, 2))
  return {}
}
