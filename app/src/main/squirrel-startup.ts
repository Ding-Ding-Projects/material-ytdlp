// Squirrel.Windows lifecycle handling.
//
// Squirrel.Windows invokes the installed executable with one of these
// argv[1] flags at install/update/uninstall time, and expects the app to
// react and then exit immediately rather than opening its normal window:
//
//   --squirrel-install <version>    first install: create shortcuts, then quit
//   --squirrel-updated <version>    after an update: recreate shortcuts, then quit
//   --squirrel-obsolete <version>   this version is being replaced: just quit
//   --squirrel-uninstall <version>  uninstalling: remove shortcuts, then quit
//   --squirrel-firstrun             real first launch after install: do NOT quit
//
// With no handling at all, Electron launches the app for every one of these
// events, the app opens its normal window and sits there, and Squirrel's own
// install/update/uninstall sequence never gets a chance to finish. That is
// exactly why a fresh install can silently create no Start Menu shortcut and
// look like it "did nothing": the shortcut-creation step (spawning
// Update.exe) never ran, because nothing in the app ever called it.
//
// This module must be imported and called as the very first thing app
// startup does, before app.whenReady(), before any window is created, and
// before anything else that could delay process exit.

import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const SPAWN_WAIT_MS = 15_000

type SquirrelEvent =
  | 'install'
  | 'updated'
  | 'obsolete'
  | 'uninstall'
  | 'firstrun'
  | null

function parseSquirrelEvent(argv: string[]): SquirrelEvent {
  const flag = argv[1]
  switch (flag) {
    case '--squirrel-install':
      return 'install'
    case '--squirrel-updated':
      return 'updated'
    case '--squirrel-obsolete':
      return 'obsolete'
    case '--squirrel-uninstall':
      return 'uninstall'
    case '--squirrel-firstrun':
      return 'firstrun'
    default:
      return null
  }
}

/**
 * Squirrel.Windows lays out an installed app as:
 *
 *   <install root>\Update.exe
 *   <install root>\app-<version>\<AppName>.exe   <- process.execPath
 *
 * so Update.exe always sits exactly two path segments above the running
 * executable's directory (one to leave app-<version>\, one more is not
 * needed since Update.exe is a sibling of the app-<version> folder itself:
 * <install root>\Update.exe is process.execPath's grandparent directory's
 * child). Resolve it relative to process.execPath rather than assuming a
 * fixed absolute path, since the install root varies per machine/user.
 */
function resolveUpdateExe(): string {
  return path.resolve(process.execPath, '..', '..', 'Update.exe')
}

function exeName(): string {
  return path.basename(process.execPath)
}

/**
 * Bounded, synchronous run of Update.exe. Using spawnSync keeps this
 * dependency-free and guarantees we do not proceed to app.quit() until
 * Update.exe has finished (or the bound elapses), which is what actually
 * prevents the "shortcut never got written before we exited" failure.
 */
function runUpdateExeSync(updateExePath: string, args: string[]): void {
  try {
    spawnSync(updateExePath, args, {
      windowsHide: true,
      timeout: SPAWN_WAIT_MS,
      stdio: 'ignore',
    })
  } catch (err) {
    // Never let a failure to shell out to Update.exe crash the installer
    // lifecycle handling; log and let the caller quit normally regardless.
    // eslint-disable-next-line no-console
    console.error('[squirrel-startup] failed to run Update.exe:', err)
  }
}

function createShortcuts(): void {
  const updateExePath = resolveUpdateExe()
  if (!existsSync(updateExePath)) {
    // eslint-disable-next-line no-console
    console.error(
      `[squirrel-startup] Update.exe not found at expected path: ${updateExePath}. ` +
        'Shortcut creation skipped; this is not a normal Squirrel install layout.',
    )
    return
  }
  runUpdateExeSync(updateExePath, [`--createShortcut=${exeName()}`])
}

function removeShortcuts(): void {
  const updateExePath = resolveUpdateExe()
  if (!existsSync(updateExePath)) {
    // eslint-disable-next-line no-console
    console.error(
      `[squirrel-startup] Update.exe not found at expected path: ${updateExePath}. ` +
        'Shortcut removal skipped.',
    )
    return
  }
  runUpdateExeSync(updateExePath, [`--removeShortcut=${exeName()}`])
}

/**
 * Handle a Squirrel.Windows lifecycle event if this launch is one.
 *
 * Returns true when the caller must quit the app immediately (no window
 * should be created, no further startup work should run). Returns false
 * when startup should proceed normally (ordinary launch, or
 * --squirrel-firstrun, which is a real user-visible launch).
 *
 * No-op (returns false) on non-Windows platforms and outside a packaged
 * build, since Squirrel.Windows only exists on Windows and these argv flags
 * are never present in `electron-vite dev`/`electron-vite preview`.
 */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false
  if (!app.isPackaged) return false

  const event = parseSquirrelEvent(process.argv)
  if (event === null) return false

  switch (event) {
    case 'install':
      createShortcuts()
      return true
    case 'updated':
      createShortcuts()
      return true
    case 'obsolete':
      // Nothing to do: this version is being replaced by a newer one that
      // will manage its own shortcuts. Just let Squirrel finish and quit.
      return true
    case 'uninstall':
      removeShortcuts()
      return true
    case 'firstrun':
      // This is the real first user-visible launch, immediately after
      // install finished. Do not quit — run normally. The update feed may
      // not be reachable/ready yet; callers should tolerate that.
      return false
    default:
      return false
  }
}
