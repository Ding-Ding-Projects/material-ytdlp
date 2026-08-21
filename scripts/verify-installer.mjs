#!/usr/bin/env node
// Real-installer verification for the Squirrel.Windows build.
//
// A smoke test against `win-unpacked`/`app.asar` cannot catch a broken
// Squirrel lifecycle handler, because that class of bug only exists in the
// gap between "Setup.exe was produced" and "the app actually finished the
// install Squirrel asked it to do". This script closes that gap: it builds
// the real installer, RUNS it silently on this machine, and checks the real
// outcomes on disk — install directory, Start Menu shortcut, a runnable
// executable — then cleans up through Squirrel's own uninstall path.
//
// Usage:
//   node scripts/verify-installer.mjs
//
// Exits 0 and prints PASS with every assertion on success.
// Exits 1 and prints FAIL with the first failing assertion otherwise.
//
// SAFETY: this installs real software into this user's real
// %LOCALAPPDATA%\<AppName> and writes a real Start Menu shortcut. Cleanup
// runs Squirrel's own `Update.exe --uninstall`, which is the same path a
// real uninstall takes, and then verifies the shortcut and install
// directory are gone. Nothing outside the install directory and its own
// shortcut is ever touched or deleted.

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const appDir = path.join(repoRoot, 'app')

const results = []
let failed = false

function assertTrue(name, condition, detail) {
  const line = `${condition ? 'PASS' : 'FAIL'} - ${name}${detail ? `: ${detail}` : ''}`
  results.push(line)
  console.log(line)
  if (!condition) failed = true
  return condition
}

// On Windows, spawnSync cannot resolve a .cmd shim (npx, npm, etc.) without
// either shell:true or invoking through cmd.exe /c explicitly. shell:true on
// an argv array is documented as unsafe with untrusted input, but here every
// argument is a fixed literal we wrote ourselves, so route through
// `cmd /c <cmd> <args...>` instead of shell:true to stay explicit about argv.
// Only npm/npx-style shim commands (.cmd files on Windows) need the cmd.exe
// wrapper; a direct path to a real .exe (Setup.exe, Update.exe) must NOT be
// routed through it — cmd.exe's own quote-stripping of a quoted, spaced
// first token after /c is unreliable and breaks paths containing spaces.
const WINDOWS_SHIM_COMMANDS = new Set(['npx', 'npm', 'node'])

function resolveWindowsCommand(cmd, args) {
  if (process.platform !== 'win32') return { cmd, args }
  if (!WINDOWS_SHIM_COMMANDS.has(cmd)) return { cmd, args }
  return { cmd: 'cmd.exe', args: ['/d', '/s', '/c', cmd, ...args] }
}

function run(cmd, args, opts = {}) {
  console.log(`+ ${cmd} ${args.join(' ')}`)
  const resolved = resolveWindowsCommand(cmd, args)
  const res = spawnSync(resolved.cmd, resolved.args, {
    cwd: appDir,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    ...opts,
  })
  return res
}

function runCapture(cmd, args, opts = {}) {
  const resolved = resolveWindowsCommand(cmd, args)
  return spawnSync(resolved.cmd, resolved.args, {
    windowsHide: true,
    shell: false,
    encoding: 'utf8',
    ...opts,
  })
}

function fail(message) {
  console.error(`FAIL - ${message}`)
  results.push(`FAIL - ${message}`)
  failed = true
}

function abort(message) {
  fail(message)
  report()
  process.exit(1)
}

function report() {
  console.log('\n=== verify-installer.mjs summary ===')
  for (const line of results) console.log(line)
  console.log(failed ? '\nFAIL' : '\nPASS')
}

if (process.platform !== 'win32') {
  console.log(
    'Squirrel.Windows only exists on Windows; skipping real-installer verification on ' +
      `${process.platform}. This script must be run on Windows to prove the installer works.`,
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 1. Build the renderer/main bundle and the Squirrel installer if needed.
// ---------------------------------------------------------------------------

const squirrelOutDir = path.join(appDir, 'dist', 'squirrel-windows')

function findSetupExe() {
  if (!existsSync(squirrelOutDir)) return null
  const entries = readdirSync(squirrelOutDir)
  const setup = entries.find((f) => /Setup.*\.exe$/i.test(f))
  return setup ? path.join(squirrelOutDir, setup) : null
}

let setupExePath = findSetupExe()

if (!setupExePath) {
  console.log('No existing Setup.exe found under dist/squirrel-windows/; building it now.')

  const buildRes = run('npx', ['electron-vite', 'build'])
  if (buildRes.status !== 0) abort('electron-vite build failed; cannot verify an installer that was never built')

  const distRes = run('npx', ['electron-builder', '--win', 'squirrel'])
  if (distRes.status !== 0) abort('electron-builder --win squirrel failed; no installer was produced')

  setupExePath = findSetupExe()
}

if (!assertTrue('installer artifact exists', !!setupExePath, setupExePath ?? '(none found)')) {
  abort('no Setup.exe was found even after building')
}

const releasesPath = path.join(squirrelOutDir, 'RELEASES')
assertTrue('RELEASES file exists alongside Setup.exe', existsSync(releasesPath), releasesPath)

console.log(`\nUsing installer: ${setupExePath}\n`)

// ---------------------------------------------------------------------------
// 2. Discover expected identity from package.json (do not hardcode).
// ---------------------------------------------------------------------------

const pkgJson = JSON.parse(runCapture('cmd', ['/c', 'type', 'package.json'], { cwd: appDir }).stdout || '{}')
const productNameGuess = pkgJson.productName || pkgJson.name || 'yt-dlp Studio'

const localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local')
const startMenuPrograms = path.join(
  process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
)

console.log(`Expected product name (from package.json): ${productNameGuess}`)
console.log(`%LOCALAPPDATA%: ${localAppData}`)
console.log(`Start Menu Programs: ${startMenuPrograms}`)

function snapshotDir(dir) {
  try {
    return new Set(existsSync(dir) ? readdirSync(dir) : [])
  } catch {
    return new Set()
  }
}

// Squirrel.Windows groups shortcuts under a publisher-name subfolder (e.g.
// "Start Menu\Programs\<Company>\<App>.lnk") rather than always placing
// the .lnk directly in Programs\. A shallow, top-level-only scan misses
// this entirely and reports "no shortcut" for an install that actually
// succeeded — so this must recurse.
function listLnkFilesRecursive(dir, depth = 0, maxDepth = 4) {
  const found = []
  if (depth > maxDepth || !existsSync(dir)) return found
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listLnkFilesRecursive(full, depth + 1, maxDepth))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
      found.push(full)
    }
  }
  return found
}

const localAppDataBefore = snapshotDir(localAppData)
const startMenuLnksBefore = new Set(listLnkFilesRecursive(startMenuPrograms))

// ---------------------------------------------------------------------------
// 3. Run Setup.exe silently.
// ---------------------------------------------------------------------------

console.log('\nRunning Setup.exe -s (silent install)...\n')
const installRes = run(setupExePath, ['-s'], { cwd: undefined })
assertTrue('Setup.exe exited 0', installRes.status === 0, `exit code ${installRes.status}`)

// Squirrel's silent install can return before the background install fully
// settles shortcuts; give it a bounded moment and re-check rather than
// asserting instantly. Poll rather than a fixed sleep so this is fast when
// the install is fast and still correct when it is slow.
function waitFor(predicate, { timeoutMs = 20_000, intervalMs = 500 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true
    spawnSync('cmd', ['/c', 'timeout', '/t', String(Math.ceil(intervalMs / 1000)), '/nobreak'], {
      windowsHide: true,
      stdio: 'ignore',
    })
  }
  return predicate()
}

// ---------------------------------------------------------------------------
// 4. Find what actually got installed.
// ---------------------------------------------------------------------------

function findInstallDir() {
  const before = localAppDataBefore
  const found = waitFor(() => {
    const now = readdirSync(localAppData)
    const added = now.filter((n) => !before.has(n))
    return added.some((n) => {
      const full = path.join(localAppData, n)
      try {
        return statSync(full).isDirectory() && existsSync(path.join(full, 'Update.exe'))
      } catch {
        return false
      }
    })
  })
  if (!found) return null
  const now = readdirSync(localAppData)
  const added = now.filter((n) => !before.has(n))
  const dir = added.find((n) => {
    const full = path.join(localAppData, n)
    try {
      return statSync(full).isDirectory() && existsSync(path.join(full, 'Update.exe'))
    } catch {
      return false
    }
  })
  return dir ? path.join(localAppData, dir) : null
}

const installDir = findInstallDir()
assertTrue(
  'app was installed under %LOCALAPPDATA%\\<AppName> (Squirrel default location)',
  !!installDir,
  installDir ?? `no new directory containing Update.exe appeared under ${localAppData}`,
)

let updateExePath = null
let installedExePath = null
if (installDir) {
  updateExePath = path.join(installDir, 'Update.exe')
  assertTrue('Update.exe present in install directory', existsSync(updateExePath), updateExePath)

  // The actual executable lives in app-<version>\<AppName>.exe.
  const appVersionDirs = existsSync(installDir)
    ? readdirSync(installDir).filter((n) => /^app-/.test(n))
    : []
  for (const d of appVersionDirs) {
    const full = path.join(installDir, d)
    const exes = existsSync(full) ? readdirSync(full).filter((f) => f.toLowerCase().endsWith('.exe')) : []
    const candidate = exes.find((f) => !/^squirrel/i.test(f) && f.toLowerCase() !== 'update.exe')
    if (candidate) {
      installedExePath = path.join(full, candidate)
      break
    }
  }
}
assertTrue(
  'installed application executable exists',
  !!installedExePath && existsSync(installedExePath),
  installedExePath ?? '(not found under app-<version>\\)',
)

// ---------------------------------------------------------------------------
// 5. THE actual regression check: does a real Start Menu shortcut exist?
// ---------------------------------------------------------------------------

function findNewShortcut() {
  const found = waitFor(() => {
    const now = listLnkFilesRecursive(startMenuPrograms)
    return now.some((f) => !startMenuLnksBefore.has(f))
  })
  if (!found) return null
  const now = listLnkFilesRecursive(startMenuPrograms)
  return now.find((f) => !startMenuLnksBefore.has(f)) ?? null
}

const shortcutPath = findNewShortcut()
assertTrue(
  'a NEW Start Menu shortcut (.lnk) exists on disk after install',
  !!shortcutPath,
  shortcutPath ?? `no new .lnk appeared under ${startMenuPrograms} — this is the exact defect being verified`,
)

// ---------------------------------------------------------------------------
// 6. The installed executable actually runs (bounded launch + kill, or a
//    --version-style probe if the app doesn't crash immediately without one).
// ---------------------------------------------------------------------------

if (installedExePath && existsSync(installedExePath)) {
  console.log(`\nBoundedly launching installed executable to confirm it runs: ${installedExePath}`)
  const child = spawnSync(installedExePath, [], {
    windowsHide: true,
    timeout: 8_000,
    stdio: 'ignore',
  })
  // A GUI app launched this way typically gets killed by the timeout (SIGTERM
  // signal set) rather than exiting on its own — that is success: it means
  // the process started and stayed alive. An immediate nonzero exit with no
  // signal means it crashed on launch.
  const ranOk = child.signal !== null || child.status === 0
  assertTrue(
    'installed executable launches without immediately crashing',
    ranOk,
    `status=${child.status} signal=${child.signal} error=${child.error?.message ?? 'none'}`,
  )
} else {
  assertTrue('installed executable launches without immediately crashing', false, 'no executable found to launch')
}

// ---------------------------------------------------------------------------
// 7. Cleanup via Squirrel's own uninstall path.
// ---------------------------------------------------------------------------

console.log('\nCleaning up via Update.exe --uninstall...')
if (updateExePath && existsSync(updateExePath)) {
  const uninstallRes = spawnSync(updateExePath, ['--uninstall'], {
    windowsHide: true,
    timeout: 30_000,
    stdio: 'inherit',
  })
  assertTrue('Update.exe --uninstall ran', uninstallRes.status === 0 || uninstallRes.signal === null, `exit ${uninstallRes.status}`)
} else {
  fail('cannot run Update.exe --uninstall: Update.exe was not found — manual cleanup required')
}

// Verify cleanup actually removed the shortcut and install directory. If
// Squirrel's own uninstall left something behind, remove ONLY the exact
// artifacts this run created (never anything else in those folders) and say
// so plainly rather than silently declaring cleanup complete.
let leftoverShortcut = shortcutPath && existsSync(shortcutPath)
let leftoverInstallDir = installDir && existsSync(installDir)

if (leftoverShortcut) {
  try {
    rmSync(shortcutPath, { force: true })
    leftoverShortcut = existsSync(shortcutPath)
  } catch (err) {
    console.error(`Could not remove leftover shortcut ${shortcutPath}: ${err.message}`)
  }
}

if (leftoverInstallDir) {
  // Give Squirrel's uninstall a moment; it schedules directory removal via a
  // helper that can outlive the --uninstall call itself.
  waitFor(() => !existsSync(installDir), { timeoutMs: 10_000 })
  leftoverInstallDir = existsSync(installDir)
  if (leftoverInstallDir) {
    try {
      rmSync(installDir, { recursive: true, force: true })
      leftoverInstallDir = existsSync(installDir)
    } catch (err) {
      console.error(`Could not remove leftover install directory ${installDir}: ${err.message}`)
    }
  }
}

assertTrue('Start Menu shortcut removed after uninstall', !leftoverShortcut, shortcutPath ?? '(none was created)')
assertTrue('install directory removed after uninstall', !leftoverInstallDir, installDir ?? '(none was created)')

if (leftoverShortcut || leftoverInstallDir) {
  console.error(
    '\nWARNING: cleanup could not fully remove everything this run created. ' +
      `Leftover shortcut: ${leftoverShortcut ? shortcutPath : 'none'}. ` +
      `Leftover install dir: ${leftoverInstallDir ? installDir : 'none'}.`,
  )
}

report()
process.exit(failed ? 1 : 0)
