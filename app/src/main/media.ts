// In-app media player: turns a completed download or a pasted link into ONE
// same-origin stream URL a <video>/<audio> element can load, and serves the
// bytes for that URL — including HTTP Range requests, so seeking and long
// files both work.
//
// ---------------------------------------------------------------------------
// Why a custom protocol, and why it streams rather than downloads first
// ---------------------------------------------------------------------------
//
// The renderer's CSP (see the surgical edit to the CSP meta tag in
// scripts/build-renderer-from-design.mjs) has no `media-src` beyond 'self'
// plus this module's own scheme, on purpose: opening it to `https:` or `*`
// would let a <video src="..."> reach ANY host on the internet, which is a
// far bigger hole than "play one resolved stream" needs. A registered
// custom protocol, handled entirely in this process, is the narrow version
// of that: the CSP only ever has to trust bytes THIS module decided to
// serve, for a URL THIS module minted, never a raw URL the renderer chose.
//
// Local playback streams the real file straight off disk with Range
// support, so a multi-gigabyte download is never re-read into memory.
// Remote playback proxies the resolved upstream URL byte-for-byte (Range
// header forwarded, upstream status/headers relayed) — nothing is written
// to disk first, matching "nothing downloaded, played directly."
//
// ---------------------------------------------------------------------------
// The single-URL constraint, and why VIDEO_FORMAT_SELECTOR falls back to audio
// ---------------------------------------------------------------------------
//
// A <video>/<audio> element takes exactly one `src`. yt-dlp's usual download
// selector (`bv*+ba/b`) resolves to TWO urls — a video-only stream and an
// audio-only stream muxed together only once both are fully downloaded —
// which is exactly why a *download* needs ffmpeg and this in-app player
// cannot use that selector at all. VIDEO_FORMAT_SELECTOR below asks yt-dlp
// for a single combined (progressive) format instead.
//
// VERIFIED against the bundled binary (vendor/bin/yt-dlp.exe 2026.08.19),
// live, against real YouTube videos:
//   - `-f "b/best" --get-url` prints exactly ONE url for a source that has a
//     genuine combined format.
//   - It FAILS ("Requested format is not available") for both a brand-new
//     upload and the oldest video on YouTube ("Me at the zoo") — confirmed
//     via `-F` that neither exposes a single format with both an audio AND
//     a video codec any more; every format is video-only or audio-only.
//     This is normal, current YouTube behaviour, not an edge case: most
//     videos on the site today have NO progressive format at all.
//   - `-f "ba[ext=m4a]/ba/bestaudio" --get-url` prints exactly ONE url in
//     every case tried, since an audio-only stream is inherently a single
//     file.
//
// The obvious fix — resolve the two-URL selector and remux the video+audio
// streams together on the fly with ffmpeg, piping the muxed result straight
// into the HTTP response — was tried and is NOT available here: the
// vendored ffmpeg build (vendor/bin/ffmpeg.exe, `ffmpeg -protocols`) has
// only the plain `http` protocol compiled in, no `https`, no TLS at all
// ("https or dtls protocol not found, recompile FFmpeg with openssl, gnutls
// or securetransport enabled"). It cannot open a googlevideo.com URL as an
// input, so it cannot remux two live network streams no matter how it is
// invoked. Rebuilding that vendored binary with a TLS backend is a real
// packaging change well outside this module's ownership.
//
// So: a 'video' request tries the single progressive selector first; if
// (and, for most YouTube sources, when) that fails, it automatically falls
// back to the verified single-URL AUDIO selector and reports
// `videoFallenBackToAudio: true` rather than either silently playing no
// sound or presenting a hard, avoidable failure. The renderer is required
// to say so out loud (never a silent downgrade) — see
// scripts/wire-media-player.mjs. Downloading the item (the app's existing,
// unrelated feature) still gets the real muxed video, via yt-dlp's own
// Python-side muxing after a full download — this module only affects
// in-app *streaming* playback.

import { app, ipcMain, protocol, session } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MediaIpcChannel,
  MEDIA_PROTOCOL_SCHEME,
  type MediaKind,
  type MediaResolveError,
  type MediaResolveResult,
  type ResolveLocalRequest,
  type ResolveRemoteRequest,
} from '../shared/media-contract'
import { resolveBinary } from './resolve-binaries'
import { getStore, atomicWriteFile } from './store'
import { logMain } from './logging'

// ---------------------------------------------------------------------------
// Privileged scheme registration.
//
// Electron requires this to happen before the app's 'ready' event, and has
// no effect (silently) if called any later. Running it here, as a top-level
// module side effect, guarantees it happens the moment this module is first
// imported — which app/src/main/index.ts does in its very first import
// block, before the Squirrel-lifecycle check and before app.whenReady().
// `registerMediaProtocol()` below (the part that actually HANDLES requests
// and needs `app` to be ready) is a separate, explicitly-called function.
// ---------------------------------------------------------------------------

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

// ---------------------------------------------------------------------------
// Format selectors — see the module comment above for how these were
// verified against the bundled binary.
// ---------------------------------------------------------------------------

const VIDEO_FORMAT_SELECTOR = 'b/best'
const AUDIO_FORMAT_SELECTOR = 'ba[ext=m4a]/ba/bestaudio'

// ---------------------------------------------------------------------------
// Bounded, cancellable yt-dlp `--get-url` runner.
//
// Deliberately self-contained rather than importing app/src/main/probes.ts:
// that module owns its own concurrency pool, timeout tuning, and output
// parsing for a different shape of call (human-readable listings), and
// duplicating this narrow slice here keeps the two lanes independently
// editable — the same reasoning app/src/main/probes.ts itself gives for not
// importing killTree from app/src/main/ytdlp.ts.
// ---------------------------------------------------------------------------

const RESOLVE_TIMEOUT_MS = 25_000
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_CONCURRENT_RESOLVES = 2

let activeResolves = 0
const waitQueue: Array<() => void> = []

async function acquireResolveSlot(): Promise<() => void> {
  if (activeResolves < MAX_CONCURRENT_RESOLVES) {
    activeResolves++
    return releaseResolveSlot
  }
  await new Promise<void>((res) => waitQueue.push(res))
  activeResolves++
  return releaseResolveSlot
}

function releaseResolveSlot(): void {
  activeResolves--
  const next = waitQueue.shift()
  if (next) next()
}

const liveByRequestId = new Map<string, { pid: number | null; cancelled: boolean }>()

/** Called from the Cancel IPC channel below — lets the renderer kill an in-flight resolve (e.g. the user removed the item from the queue while it was still resolving). */
export function cancelResolve(requestId: string): void {
  const entry = liveByRequestId.get(requestId)
  if (!entry) return
  entry.cancelled = true
  if (entry.pid != null) killTree(entry.pid)
}

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => {
      try {
        process.kill(pid)
      } catch {
        /* already gone */
      }
    })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
}

interface GetUrlOutcome {
  ok: boolean
  urls: string[]
  stderrTail: string
  errorKind: 'timeout' | 'cancelled' | 'spawn-failed' | 'non-zero-exit' | null
}

/**
 * Spawns `<yt-dlp> --no-playlist --no-warnings -f <selector> --get-url -- <url>`
 * as an argv array (NEVER shell: true — a pasted URL must never reach
 * anything that could interpret it as more than one opaque argument) and
 * captures stdout (the URL(s), one per line) and stderr (yt-dlp's own
 * diagnostics, e.g. "Requested format is not available") SEPARATELY, so a
 * failure can report the real reason instead of a guess.
 */
function runGetUrl(binaryPath: string, formatSelector: string, targetUrl: string, requestId: string): Promise<GetUrlOutcome> {
  return new Promise((resolvePromise) => {
    if (liveByRequestId.get(requestId)?.cancelled) {
      resolvePromise({ ok: false, urls: [], stderrTail: '', errorKind: 'cancelled' })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let child: ChildProcess

    try {
      child = spawn(binaryPath, ['--no-playlist', '--no-warnings', '-f', formatSelector, '--get-url', '--', targetUrl], {
        windowsHide: true,
      })
    } catch (err) {
      resolvePromise({
        ok: false,
        urls: [],
        stderrTail: err instanceof Error ? err.message : String(err),
        errorKind: 'spawn-failed',
      })
      return
    }

    liveByRequestId.set(requestId, { pid: child.pid ?? null, cancelled: false })

    const finish = (outcome: GetUrlOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      liveByRequestId.delete(requestId)
      resolvePromise(outcome)
    }

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid != null) killTree(child.pid)
    }, RESOLVE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      finish({ ok: false, urls: [], stderrTail: err.message, errorKind: 'spawn-failed' })
    })

    child.on('close', (code) => {
      const wasCancelled = liveByRequestId.get(requestId)?.cancelled ?? false
      if (wasCancelled) {
        finish({ ok: false, urls: [], stderrTail: '', errorKind: 'cancelled' })
        return
      }
      if (timedOut) {
        finish({ ok: false, urls: [], stderrTail: '', errorKind: 'timeout' })
        return
      }
      const urls = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).slice(-4).join(' ')
        finish({ ok: false, urls, stderrTail: tail || `yt-dlp exited with code ${code}.`, errorKind: 'non-zero-exit' })
        return
      }
      finish({ ok: urls.length === 1, urls, stderrTail: stderr.trim(), errorKind: null })
    })
  })
}

// ---------------------------------------------------------------------------
// Token store: maps an opaque, minted token to the ONE thing it is allowed
// to serve. The renderer only ever sees `ytdlp-media://<token>` — never a
// filesystem path, never the resolved upstream URL. Bounded to a small
// number of live tokens so a long session cannot grow this without limit;
// eviction is safe because a stale token simply 404s (the renderer only
// dereferences a token it just received and is about to play).
// ---------------------------------------------------------------------------

interface LocalTokenEntry {
  type: 'local'
  path: string
  mime: string
}

interface RemoteTokenEntry {
  type: 'remote'
  upstreamUrl: string
}

type TokenEntry = LocalTokenEntry | RemoteTokenEntry

const MAX_LIVE_TOKENS = 64
const tokenStore = new Map<string, TokenEntry>()

function mintToken(entry: TokenEntry): string {
  const token = randomUUID()
  tokenStore.set(token, entry)
  while (tokenStore.size > MAX_LIVE_TOKENS) {
    const oldest = tokenStore.keys().next().value
    if (oldest === undefined) break
    tokenStore.delete(oldest)
  }
  return token
}

function streamUrlFor(token: string): string {
  return `${MEDIA_PROTOCOL_SCHEME}://${token}`
}

// ---------------------------------------------------------------------------
// MIME guessing (local files only — a remote response's own Content-Type
// header is relayed as-is in serveRemoteStream, since the upstream CDN
// already knows better than any extension-based guess here).
// ---------------------------------------------------------------------------

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',
}

const AUDIO_EXTS = new Set(['m4a', 'mp3', 'opus', 'ogg', 'oga', 'wav', 'flac', 'aac', 'wma'])

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

function guessKindFromExt(path: string): MediaKind {
  return AUDIO_EXTS.has(extOf(path)) ? 'audio' : 'video'
}

function guessMime(path: string, fallbackKind: MediaKind): string {
  return EXT_MIME[extOf(path)] ?? (fallbackKind === 'audio' ? 'audio/mp4' : 'video/mp4')
}

// ---------------------------------------------------------------------------
// Resolve: local
// ---------------------------------------------------------------------------

function failure(kind: MediaResolveError['kind'], message: string): MediaResolveResult {
  return { ok: false, streamUrl: null, mediaKind: null, videoFallenBackToAudio: false, error: { kind, message } }
}

function success(streamUrl: string, mediaKind: MediaKind, fellBack: boolean): MediaResolveResult {
  return { ok: true, streamUrl, mediaKind, videoFallenBackToAudio: fellBack, error: null }
}

/**
 * The ENTIRE security boundary for local playback: a path is only ever
 * served if it is byte-for-byte the recorded `outputPath` of a `state:
 * 'done'` entry in job-history.json — i.e. a file this app itself already
 * downloaded. The renderer never supplies a job id or anything else this
 * module would have to trust; it supplies the exact path already shown to
 * it in the Library view (scripts/wire-download-history.mjs, which this
 * lane does not own), and that path is re-verified against the real store
 * here rather than trusted as license to read it.
 */
export async function resolveLocal(req: ResolveLocalRequest): Promise<MediaResolveResult> {
  const history = await getStore().getJobHistory()
  const entry = history.find((h) => h.state === 'done' && h.outputPath === req.path)
  if (!entry) {
    return failure('not-in-library', 'This is not the recorded output path of a completed download.')
  }

  let stat
  try {
    stat = await fsp.stat(entry.outputPath as string)
  } catch {
    return failure('file-missing', `The file is no longer on disk at "${entry.outputPath}".`)
  }
  if (!stat.isFile()) {
    return failure('file-missing', `"${entry.outputPath}" is no longer a regular file.`)
  }

  const path = entry.outputPath as string
  const mediaKind = guessKindFromExt(path)
  const token = mintToken({ type: 'local', path, mime: guessMime(path, mediaKind) })
  return success(streamUrlFor(token), mediaKind, false)
}

// ---------------------------------------------------------------------------
// Resolve: remote
// ---------------------------------------------------------------------------

export async function resolveRemote(req: ResolveRemoteRequest): Promise<MediaResolveResult> {
  let parsed: URL
  try {
    parsed = new URL(req.url)
  } catch {
    return failure('invalid-url', 'That is not a valid URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return failure('invalid-url', 'Only http:// and https:// links can be played.')
  }

  const bin = resolveBinary('yt-dlp')
  if (!bin.path) {
    return failure('spawn-failed', `yt-dlp was not found. Checked: ${bin.searched.join(', ')}`)
  }
  const binaryPath = bin.path

  const release = await acquireResolveSlot()
  try {
    if (req.mediaKind === 'audio') {
      const audio = await runGetUrl(binaryPath, AUDIO_FORMAT_SELECTOR, parsed.toString(), req.requestId)
      if (audio.errorKind === 'cancelled') return failure('cancelled', 'Cancelled.')
      if (audio.errorKind === 'timeout') return failure('timeout', 'yt-dlp did not respond in time.')
      if (!audio.ok || audio.urls.length !== 1) {
        return failure('no-playable-stream', audio.stderrTail || 'No playable audio stream was found for this link.')
      }
      const token = mintToken({ type: 'remote', upstreamUrl: audio.urls[0] })
      return success(streamUrlFor(token), 'audio', false)
    }

    const video = await runGetUrl(binaryPath, VIDEO_FORMAT_SELECTOR, parsed.toString(), req.requestId)
    if (video.errorKind === 'cancelled') return failure('cancelled', 'Cancelled.')
    if (video.ok && video.urls.length === 1) {
      const token = mintToken({ type: 'remote', upstreamUrl: video.urls[0] })
      return success(streamUrlFor(token), 'video', false)
    }

    // No single combined stream — verified (see the module comment at the
    // top of this file) to be the normal case for most current YouTube
    // sources. Fall back to the already-verified single-URL audio
    // selector rather than failing outright.
    const audio = await runGetUrl(binaryPath, AUDIO_FORMAT_SELECTOR, parsed.toString(), req.requestId)
    if (audio.errorKind === 'cancelled') return failure('cancelled', 'Cancelled.')
    if (audio.ok && audio.urls.length === 1) {
      const token = mintToken({ type: 'remote', upstreamUrl: audio.urls[0] })
      return success(streamUrlFor(token), 'audio', true)
    }

    const message =
      video.stderrTail ||
      audio.stderrTail ||
      'No playable video or audio-only stream was found for this link.'
    return failure('no-playable-stream', message)
  } finally {
    release()
  }
}

// ---------------------------------------------------------------------------
// Byte serving.
// ---------------------------------------------------------------------------

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const [, startRaw, endRaw] = match
  if (startRaw === '' && endRaw === '') return null

  let start: number
  let end: number
  if (startRaw === '') {
    const suffixLen = Number.parseInt(endRaw, 10)
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null
    start = Math.max(0, size - suffixLen)
    end = size - 1
  } else {
    start = Number.parseInt(startRaw, 10)
    end = endRaw === '' ? size - 1 : Number.parseInt(endRaw, 10)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

async function serveLocalFile(entry: LocalTokenEntry, request: Request): Promise<Response> {
  let stat
  try {
    stat = await fsp.stat(entry.path)
  } catch {
    return new Response('The file is no longer on disk.', { status: 404 })
  }
  const size = stat.size
  const range = parseRange(request.headers.get('range'), size)

  const headers = new Headers({
    'content-type': entry.mime,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  })

  if (request.method === 'HEAD') {
    headers.set('content-length', String(size))
    return new Response(null, { status: 200, headers })
  }

  if (range) {
    headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`)
    headers.set('content-length', String(range.end - range.start + 1))
    const nodeStream = createReadStream(entry.path, { start: range.start, end: range.end })
    return new Response(Readable.toWeb(nodeStream) as unknown as ReadableStream, { status: 206, headers })
  }

  headers.set('content-length', String(size))
  const nodeStream = createReadStream(entry.path)
  return new Response(Readable.toWeb(nodeStream) as unknown as ReadableStream, { status: 200, headers })
}

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

async function serveRemoteStream(entry: RemoteTokenEntry, request: Request): Promise<Response> {
  const upstreamHeaders: Record<string, string> = {}
  const range = request.headers.get('range')
  if (range) upstreamHeaders.range = range

  let upstream: Response
  try {
    upstream = await fetch(entry.upstreamUrl, { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: upstreamHeaders })
  } catch (err) {
    return new Response(`Could not reach the resolved stream: ${err instanceof Error ? err.message : String(err)}`, {
      status: 502,
    })
  }

  // A previously-resolved link that has since expired (googlevideo-style
  // `expire=` signed URLs) or been revoked shows up here as a 403/404 from
  // the upstream host. This layer reports it honestly; the renderer's own
  // media element `error` handler is what decides to re-resolve and retry
  // once (see scripts/wire-media-player.mjs) — this handler has no
  // knowledge of "the same logical queue item," only of one token.
  if (!upstream.ok && upstream.status !== 206) {
    const status = upstream.status === 403 || upstream.status === 404 ? upstream.status : 502
    return new Response(`Upstream responded ${upstream.status}.`, { status })
  }

  const outHeaders = new Headers()
  for (const key of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(key)
    if (value) outHeaders.set(key, value)
  }
  if (!outHeaders.has('accept-ranges')) outHeaders.set('accept-ranges', 'bytes')
  outHeaders.set('cache-control', 'no-store')

  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: outHeaders })
}

async function mediaProtocolHandler(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed.', { status: 405 })
    }
    const token = new URL(request.url).hostname
    const entry = tokenStore.get(token)
    if (!entry) {
      return new Response('Unknown or expired stream token.', { status: 404 })
    }
    return entry.type === 'local' ? serveLocalFile(entry, request) : serveRemoteStream(entry, request)
  } catch (err) {
    logMain('error', 'media protocol handler failed', { message: err instanceof Error ? err.message : String(err) })
    return new Response('Internal error.', { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Renderer bridge.
//
// app/src/preload/index.ts is owned by other work in flight, so — exactly
// like app/src/main/protocol.ts's own extension-install bridge — this
// module registers its OWN small, self-contained preload via Electron's
// session-level registerPreloadScript() API instead of editing that file.
// It is plain CommonJS: Electron loads a preload script directly, with no
// bundling step, and the main BrowserWindow already runs with
// `sandbox: false` (app/src/main/index.ts), so `require('electron')` here
// works exactly as it does in the primary preload.
// ---------------------------------------------------------------------------

const MEDIA_BRIDGE_PRELOAD_FILENAME = 'media-bridge-preload.js'

const MEDIA_BRIDGE_PRELOAD_SOURCE = `"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ytdlpStudioMedia", {
  resolveLocal: (path, requestId) => ipcRenderer.invoke(${JSON.stringify(MediaIpcChannel.ResolveLocal)}, { path, requestId }),
  resolveRemote: (url, mediaKind, requestId) => ipcRenderer.invoke(${JSON.stringify(MediaIpcChannel.ResolveRemote)}, { url, mediaKind, requestId }),
  cancel: (requestId) => ipcRenderer.invoke(${JSON.stringify(MediaIpcChannel.Cancel)}, requestId),
});
`

/**
 * Call once, inside app.whenReady(), before the first BrowserWindow is
 * created — mirrors initExtensionInstallBridge() in app/src/main/protocol.ts.
 * Registers the protocol.handle() byte-serving callback, the three IPC
 * handlers, and the bridge preload that exposes window.ytdlpStudioMedia.
 */
export async function registerMediaProtocol(): Promise<void> {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, mediaProtocolHandler)

  ipcMain.handle(MediaIpcChannel.ResolveLocal, (_event, req: ResolveLocalRequest) => resolveLocal(req))
  ipcMain.handle(MediaIpcChannel.ResolveRemote, (_event, req: ResolveRemoteRequest) => resolveRemote(req))
  ipcMain.handle(MediaIpcChannel.Cancel, (_event, requestId: string) => {
    cancelResolve(requestId)
  })

  try {
    const preloadPath = join(app.getPath('userData'), MEDIA_BRIDGE_PRELOAD_FILENAME)
    await atomicWriteFile(preloadPath, MEDIA_BRIDGE_PRELOAD_SOURCE)
    session.defaultSession.registerPreloadScript({ type: 'frame', filePath: preloadPath })
  } catch (err) {
    logMain('error', 'failed to register the media bridge preload', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
