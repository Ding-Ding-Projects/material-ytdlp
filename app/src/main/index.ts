import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { handleSquirrelEvent } from './squirrel-startup'

// Code signing is permanently prohibited for this project. This build is
// intentionally unsigned; nothing here requests, discovers, or invokes a
// signer.

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
  runApp()
}

function runApp(): void {
  let mainWindow: BrowserWindow | null = null

  function getMainWindow(): BrowserWindow | null {
    return mainWindow
  }

  function createWindow(): void {
    const win = new BrowserWindow({
      width: 1360,
      height: 860,
      minWidth: 960,
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

  app.whenReady().then(() => {
    registerIpcHandlers(getMainWindow)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
