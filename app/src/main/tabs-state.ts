import { app } from 'electron'
import { join } from 'node:path'
import { atomicWriteFile } from './store'
import { readFile } from 'node:fs/promises'
import { emptyTabsState, type TabsState } from '../shared/tabs-contract'

// ---------------------------------------------------------------------------
// Persistence for the tab strip's order, pinned state, groups, collapsed
// state and docking edge, plus the command palette's live-control
// preferences. Everything the palette's "control"/"apply" rows and the tab
// manager's pin/group/reorder actions mutate lands here, disk-backed the
// same way every other store in this app is (see store.ts's atomicWriteFile
// — retried rename-over-temp, safe under a Windows Defender/indexer/OneDrive
// race), so it survives a restart instead of resetting to the design's seed
// data every launch.
// ---------------------------------------------------------------------------

const FILE_NAME = 'tabs-state.json'

function filePath(userDataDir: string = app.getPath('userData')): string {
  return join(userDataDir, FILE_NAME)
}

function isValidTabsState(value: unknown): value is TabsState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.tabs) && Array.isArray(v.groups) && typeof v.dock === 'string' && typeof v.prefs === 'object'
}

/**
 * Reads the persisted state. A missing file is the honest first-launch
 * state (empty); a corrupt or unreadable file falls back the same way
 * rather than crashing the app — the next save atomically replaces it.
 */
export async function getTabsState(): Promise<TabsState> {
  try {
    const raw = await readFile(filePath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (isValidTabsState(parsed)) return parsed
    return emptyTabsState()
  } catch {
    return emptyTabsState()
  }
}

/** Persists the complete state, replacing whatever was stored before. */
export async function setTabsState(state: TabsState): Promise<TabsState> {
  const safe: TabsState = isValidTabsState(state) ? state : emptyTabsState()
  await atomicWriteFile(filePath(), JSON.stringify(safe, null, 2))
  return safe
}
