import type { Bridge } from '../preload/index'

declare global {
  interface Window {
    /** Exposed by app/src/preload/index.ts via contextBridge.exposeInMainWorld('ytdlpStudio', bridge). */
    ytdlpStudio: Bridge
  }
}

export {}
