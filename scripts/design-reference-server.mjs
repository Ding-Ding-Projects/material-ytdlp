#!/usr/bin/env node
/**
 * Tiny static file server (Node http, no dependencies) that serves the
 * checked-in design/ folder as-is, and opens the design's main reference
 * file in the default browser. This lets the real reference file be viewed
 * side by side with the built app; it never copies, transcribes, or
 * reimplements the reference — it serves the actual files in place.
 */

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, sep } from 'node:path'
import { exec } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const designRoot = join(repoRoot, 'design')

const PORT = process.env.DESIGN_SERVER_PORT ? Number(process.env.DESIGN_SERVER_PORT) : 4173
const ENTRY_FILE = 'yt-dlp Studio.dc.html'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function mimeFor(path) {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  return MIME[path.slice(dot)] ?? 'application/octet-stream'
}

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (urlPath === '/') urlPath = `/${ENTRY_FILE}`

    // Resolve strictly inside designRoot; refuse any path that escapes it
    // (e.g. via "..") rather than serving arbitrary filesystem content.
    const resolved = normalize(join(designRoot, urlPath))
    if (!resolved.startsWith(designRoot + sep) && resolved !== designRoot) {
      res.writeHead(403).end('Forbidden')
      return
    }

    const st = await stat(resolved).catch(() => null)
    if (!st || !st.isFile()) {
      res.writeHead(404).end('Not found')
      return
    }

    const body = await readFile(resolved)
    res.writeHead(200, { 'Content-Type': mimeFor(resolved) })
    res.end(body)
  } catch (err) {
    res.writeHead(500).end(`Internal error: ${err instanceof Error ? err.message : String(err)}`)
  }
})

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`
  console.log(`Design reference server serving ${designRoot}`)
  console.log(`  -> ${url}`)
  console.log('Press Ctrl+C to stop.')

  const openCommand =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  exec(openCommand, (err) => {
    if (err) {
      console.log(`(Could not auto-open a browser: ${err.message}. Open ${url} manually.)`)
    }
  })
})
