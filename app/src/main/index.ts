import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'

// Code signing is permanently prohibited for this project. This build is
// intentionally unsigned; nothing here requests, discovers, or invokes a
// signer.

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
