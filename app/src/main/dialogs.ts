import { BrowserWindow, dialog } from 'electron'
import type { PickFileOptions, SaveFileOptions } from '../shared/ipc-contract'

function owner(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

async function showOpenDialogPath(options: Electron.OpenDialogOptions): Promise<string | null> {
  const win = owner()
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export async function pickFolder(): Promise<string | null> {
  return showOpenDialogPath({ properties: ['openDirectory', 'createDirectory'] })
}

export async function pickFile(options: PickFileOptions = {}): Promise<string | null> {
  return showOpenDialogPath({ properties: ['openFile'], filters: options.filters })
}

export async function pickBatchFile(): Promise<string | null> {
  return showOpenDialogPath({
    properties: ['openFile'],
    filters: [{ name: 'Batch file', extensions: ['txt'] }],
  })
}

export async function pickInfoJson(): Promise<string | null> {
  return showOpenDialogPath({
    properties: ['openFile'],
    filters: [{ name: 'Info JSON', extensions: ['json'] }],
  })
}

export async function pickCookiesFile(): Promise<string | null> {
  return showOpenDialogPath({
    properties: ['openFile'],
    filters: [{ name: 'Cookies (Netscape format)', extensions: ['txt'] }],
  })
}

export async function saveFile(options: SaveFileOptions = {}): Promise<string | null> {
  const win = owner()
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}
