// Custom-protocol handoff from the yt-dlp Studio Companion browser
// extension (see extension/ at the repository root) to this app.
//
// ---------------------------------------------------------------------------
// Why a custom protocol, and not the two obvious alternatives
// ---------------------------------------------------------------------------
//
// Native messaging needs a host manifest listing the extension's ID in
// `allowed_origins`, and an unpacked extension's ID is only STABLE across
// reloads if manifest.json pins a `key` field -- which means generating and
// shipping an extension signing key pair. Code signing (browser-extension
// signing explicitly included) is permanently prohibited in this project, so
// native messaging is not an option here, full stop.
//
// A local HTTP server in this app would work, but it means opening a
// listening port on the user's machine for a feature that does not need
// one, with everything that invites (port scanning, another process racing
// to bind it first, a firewall prompt on first launch).
//
// A registered custom protocol (`ytdlp-studio://`) needs neither. Chrome/Edge
// prompt the user once ("Open yt-dlp Studio?"), remember the choice, and no
// key, no port, and no native-messaging host manifest are involved anywhere.
//
// ---------------------------------------------------------------------------
// The three things that make this actually work end to end
// ---------------------------------------------------------------------------
//
// 1. app.setAsDefaultProtocolClient('ytdlp-studio') registers this app as the
//    handler. Called with no explicit path/args so Electron uses
//    process.execPath itself -- re-running this on every ordinary launch
//    (see initProtocolHandling below) keeps the registered path current
//    across a Squirrel update, which moves the running executable into a
//    new app-<version> folder on every release.
//
// 2. Windows delivers a ytdlp-studio://... link to a brand new PROCESS, not
//    an event inside the already-running one. Without
//    app.requestSingleInstanceLock() (requested in app/src/main/index.ts)
//    and the 'second-instance' handler wired up here, clicking a link while
//    the app is already open would just launch a second, useless copy of
//    the app instead of handing the link to the one already on screen.
//
// 3. The renderer cannot see this at all without a preload script exposing
//    it, and app/src/preload/index.ts is owned by other work in flight. So
//    this module registers its OWN small, self-contained preload via
//    Electron's session-level `registerPreloadScript()` API instead of
//    editing that file -- see initExtensionInstallBridge() and the
//    BRIDGE_PRELOAD_SOURCE comment below for exactly why that has to be
//    generated at runtime rather than checked in as its own source file.

import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFile } from './store'

export const PROTOCOL_SCHEME = 'ytdlp-studio'

const INCOMING_URL_CHANNEL = 'extension:incoming-url'
const GET_INFO_CHANNEL = 'extension-install:get-info'
const OPEN_FOLDER_CHANNEL = 'extension-install:open-folder'
const BRIDGE_PRELOAD_FILENAME = 'extension-bridge-preload.js'

// ---------------------------------------------------------------------------
// The companion preload, generated at runtime rather than checked in.
//
// electron.vite.config.ts's `main`/`preload` builds each bundle exactly one
// entry file (src/main/index.ts, src/preload/index.ts) and everything they
// statically import -- a sibling .js file sitting in src/main/ that nothing
// imports would never be copied into out/ by that build, and so would not
// exist on disk at runtime. Writing this out to this app's own userData
// directory on every startup (atomicWriteFile already retries the Windows
// rename-onto-an-open-destination race — see app/src/main/store.ts) means
// this module needs zero changes to electron.vite.config.ts and behaves
// identically in `electron-vite dev`/`preview` and in the packaged app.
//
// It is plain CommonJS on purpose: Electron loads a preload script directly,
// with no bundling step, and the main BrowserWindow already runs with
// `sandbox: false` (app/src/main/index.ts), so `require('electron')` here
// works exactly as it does in the primary preload.
// ---------------------------------------------------------------------------

const BRIDGE_PRELOAD_SOURCE = `"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ytdlpStudioExtension", {
  getInstallInfo: () => ipcRenderer.invoke(${JSON.stringify(GET_INFO_CHANNEL)}),
  openExtensionFolder: () => ipcRenderer.invoke(${JSON.stringify(OPEN_FOLDER_CHANNEL)}),
  onIncomingUrl: (handler) => {
    const listener = (_event, url) => handler(url);
    ipcRenderer.on(${JSON.stringify(INCOMING_URL_CHANNEL)}, listener);
    return () => ipcRenderer.removeListener(${JSON.stringify(INCOMING_URL_CHANNEL)}, listener);
  },
});
`

/**
 * Resolves the extension's folder on disk for THIS running app, in both
 * dev and packaged shapes. Never guessed at the call site -- every caller
 * (the IPC handlers below) goes through this one function.
 */
function resolveExtensionFolderPath(): string {
  if (app.isPackaged) {
    // app/electron-builder.yml ships extension/ via extraResources as
    // `to: extension`, landing it beside the already-bundled `bin/` at
    // resources/extension in the installed layout.
    return join(process.resourcesPath, 'extension')
  }
  // electron-vite dev/preview: app.isPackaged is false and the compiled main
  // process runs from app/out/main/index.js, so three levels up is the repo
  // root -- verified against this repository's own layout, the same way
  // squirrel-startup.ts resolves Update.exe relative to a known install
  // shape rather than assuming a fixed absolute path.
  return join(__dirname, '..', '..', '..', 'extension')
}

function extractIncomingUrl(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.toLowerCase().startsWith(`${PROTOCOL_SCHEME}://`)) {
      return arg
    }
  }
  return null
}

/**
 * Validates and decodes a `ytdlp-studio://download?url=<encoded>` link.
 *
 * This is attacker-influenced input: it arrives from whatever page the
 * extension happened to be looking at, forwarded to this process through
 * the operating system's own URL-handoff mechanism, and nothing about it is
 * trusted implicitly as a result. Only the exact scheme, host, and query
 * shape this app defines is accepted here; the DECODED target is then
 * re-validated as a genuine http/https URL before it is used for anything.
 * It stays a plain string the whole way through -- nothing here or
 * downstream (app/src/main/ytdlp.ts's spawn call, which already uses an
 * argv array) ever passes it through a shell.
 */
export function parseIncomingProtocolUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null
  if (parsed.hostname !== 'download') return null

  const target = parsed.searchParams.get('url')
  if (!target) return null

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return null
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') return null
  return targetUrl.toString()
}

// A link can arrive before any window exists to receive it (a cold start
// launched directly via a ytdlp-studio:// click). Queued here and flushed
// the moment attachProtocolBridge() has a window whose page has finished
// loading, so it is never silently dropped.
let pendingIncomingUrl: string | null = null
let deliverToRenderer: ((url: string) => void) | null = null

function deliverOrQueue(url: string): void {
  if (deliverToRenderer) deliverToRenderer(url)
  else pendingIncomingUrl = url
}

function handleIncomingArgv(argv: string[], source: string): void {
  const raw = extractIncomingUrl(argv)
  if (!raw) return
  const validated = parseIncomingProtocolUrl(raw)
  if (!validated) {
    // eslint-disable-next-line no-console
    console.error(
      `[protocol] ${source} carried an unrecognised or invalid ${PROTOCOL_SCHEME}:// link (ignored):`,
      raw,
    )
    return
  }
  deliverOrQueue(validated)
}

/**
 * Call exactly once, as early in startup as possible: after Squirrel
 * lifecycle handling has already decided this is an ordinary launch (see
 * handleSquirrelEvent() in app/src/main/squirrel-startup.ts, which must run
 * first and unconditionally), and only once
 * app.requestSingleInstanceLock() has actually been won.
 */
export function initProtocolHandling(getMainWindow: () => BrowserWindow | null): void {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)

  app.on('second-instance', (_event, argv) => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    handleIncomingArgv(argv, 'second-instance')
  })

  // Cold start: THIS process's own argv may already carry the link, if the
  // very first launch of the app was the user clicking a ytdlp-studio://
  // link before any instance of the app was running yet.
  handleIncomingArgv(process.argv, 'startup argv')
}

/**
 * Call once per BrowserWindow, right after it is constructed (before it
 * finishes loading). Wires delivery of the incoming URL -- whether it
 * arrived before or after this call -- to that window's renderer, over the
 * bridge preload registered by initExtensionInstallBridge().
 */
export function attachProtocolBridge(win: BrowserWindow): void {
  deliverToRenderer = (url: string) => {
    win.webContents.send(INCOMING_URL_CHANNEL, url)
  }
  win.webContents.once('did-finish-load', () => {
    if (pendingIncomingUrl) {
      const url = pendingIncomingUrl
      pendingIncomingUrl = null
      deliverToRenderer?.(url)
    }
  })
  win.on('closed', () => {
    deliverToRenderer = null
  })
}

/**
 * Call once, inside app.whenReady(), before the first BrowserWindow is
 * created. Registers:
 *
 *  - the two IPC handlers the guided-install surface
 *    (scripts/wire-extension-install.mjs) calls to show and open the real
 *    extension folder path;
 *  - the small bridge preload (see BRIDGE_PRELOAD_SOURCE above) that is the
 *    only thing exposing window.ytdlpStudioExtension to the renderer.
 *
 * A failure here is logged and swallowed rather than thrown: the guided-
 * install dialog and the incoming-link handoff would be unavailable, but
 * that must never take the rest of the app down with it.
 */
export async function initExtensionInstallBridge(): Promise<void> {
  ipcMain.handle(GET_INFO_CHANNEL, () => {
    const folderPath = resolveExtensionFolderPath()
    return { folderPath, exists: existsSync(folderPath) }
  })

  ipcMain.handle(OPEN_FOLDER_CHANNEL, async () => {
    const folderPath = resolveExtensionFolderPath()
    if (!existsSync(folderPath)) {
      return {
        ok: false,
        error: `The extension folder was not found at "${folderPath}". This build may not have bundled it.`,
      }
    }
    try {
      const err = await shell.openPath(folderPath)
      if (err) return { ok: false, error: err }
      return { ok: true, error: null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  try {
    const preloadPath = join(app.getPath('userData'), BRIDGE_PRELOAD_FILENAME)
    await atomicWriteFile(preloadPath, BRIDGE_PRELOAD_SOURCE)
    session.defaultSession.registerPreloadScript({
      type: 'frame',
      filePath: preloadPath,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[protocol] failed to register the extension bridge preload:', err)
  }
}
