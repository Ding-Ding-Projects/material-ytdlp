import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { handleSquirrelEvent } from './squirrel-startup'
import { attachWebContentsLogging, initLogging } from './logging'
import { attachProtocolBridge, initExtensionInstallBridge, initProtocolHandling } from './protocol'

// Code signing is permanently prohibited for this project. This build is
// intentionally unsigned; nothing here requests, discovers, or invokes a
// signer.

// Local diagnostics logging MUST be initialised before anything else: main-
// process code already catches startup/lifecycle failures into
// `console.error` (Squirrel lifecycle handling included), and in a packaged
// build there is no console anyone is watching — those lines go nowhere.
// Initialising this first means even a Squirrel-lifecycle failure below
// lands in app/logging/main.log instead of vanishing.
initLogging()

let mainWindow: BrowserWindow | null = null

function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

// Squirrel.Windows install/update/uninstall lifecycle handling MUST run
// before anything else: before app.whenReady(), before any window is
// created, before IPC registration. If this launch is a Squirrel lifecycle
// event (install/updated/obsolete/uninstall), quit immediately once it is
// handled so Squirrel's own install sequence can finish and the shortcut it
// depends on actually gets created. Otherwise (an ordinary launch, or
// --squirrel-firstrun) proceed with normal startup below.
if (handleSquirrelEvent()) {
  app.quit()
} else {
  // The browser-extension protocol handoff (app/src/main/protocol.ts) needs
  // exactly one running instance: Windows starts a brand new PROCESS for a
  // ytdlp-studio://... click, delivered to it as an argv entry, and without
  // this lock that second process would just open a second, useless copy of
  // the app instead of handing the link to the one already running. This is
  // requested only for an ordinary launch — never during a Squirrel
  // lifecycle event above, where failing the lock must never skip shortcut
  // creation/removal.
  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  if (!gotSingleInstanceLock) {
    app.quit()
  } else {
    initProtocolHandling(getMainWindow)
    runApp()
  }
}

function runApp(): void {
  function createWindow(): void {
    const win = new BrowserWindow({
      width: 1360,
      height: 860,
      // The design's root wrapper carries a hard min-width:1180px. A floor
      // below that does not shrink the layout, it hides it: at 960px the
      // document was measured overflowing its own viewport by 231px, with
      // the mode toggle, a quality card and the whole status bar cut off at
      // the right edge and no scrollbar to reach them. Any width in the
      // 960-1179 range was reachable by ordinary dragging or window snapping.
      minWidth: 1180,
      minHeight: 600,
      show: false,
      // Frameless with a custom Material title bar — never expose the OS
      // default title bar as product chrome.
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#111318',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    // Capture renderer console output (including console.error/console.warn
    // and Chromium's own "Uncaught ..." logging) and preload failures for
    // this window's WebContents. See app/src/main/logging.ts.
    attachWebContentsLogging(win.webContents)

    // Delivers a ytdlp-studio://... link (from the browser extension) to
    // this window's renderer, whether it arrived before or after this
    // point. See app/src/main/protocol.ts.
    attachProtocolBridge(win)

    win.once('ready-to-show', () => {
      win.show()
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    // electron-vite injects these at build/dev time.
    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    if (devServerUrl) {
      win.loadURL(devServerUrl)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    win.on('closed', () => {
      mainWindow = null
    })

    mainWindow = win
  }

  app.whenReady().then(async () => {
    registerIpcHandlers(getMainWindow)
    // Registers window.ytdlpStudioExtension for the renderer (the guided-
    // install surface + incoming-link handoff) before the first window's
    // page ever loads. See app/src/main/protocol.ts for why this is a
    // separately-registered preload rather than an edit to
    // app/src/preload/index.ts.
    await initExtensionInstallBridge()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
