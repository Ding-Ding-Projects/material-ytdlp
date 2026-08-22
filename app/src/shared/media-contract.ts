/**
 * Shared contract for the in-app media player.
 *
 * TYPES ONLY — must never import `electron` at runtime, so both the main
 * process (app/src/main/media.ts) and this feature's own small renderer-side
 * bridge preload (registered by that same module, NOT app/src/preload/
 * index.ts — see the comment on MEDIA_BRIDGE_PRELOAD_SOURCE there for why)
 * can import this file freely.
 *
 * Scope, deliberately narrow: this module's only job is the one thing that
 * MUST happen in the main process — turning a completed download or a
 * pasted link into ONE same-origin stream URL the renderer's CSP is allowed
 * to load into a <video>/<audio> element. The queue itself, its ordering,
 * and play/pause/seek/volume all live in renderer component state; they
 * need no main-process involvement and are not part of this contract.
 *
 * Why a "resolve" round-trip exists at all, rather than the renderer just
 * building a ytdlp-media:// URL itself: a playable stream has to come from
 * somewhere untrusted (a filesystem path recorded by an earlier download,
 * or yt-dlp's own extraction of a user-pasted link), and both of those are
 * exactly the kind of input this app never lets the renderer hand straight
 * to a resource loader. Local playback is authorized by proving the exact
 * path matches a real completed download already recorded in job-history.json
 * (see resolveLocal in app/src/main/media.ts) — never by trusting a raw path
 * as a license to read it. Remote playback is authorized by spawning yt-dlp
 * with an argv array (never a shell) against a URL that has already been
 * checked to be http/https and nothing else.
 */

export const MediaIpcChannel = {
  ResolveLocal: 'media:resolve-local',
  ResolveRemote: 'media:resolve-remote',
  Cancel: 'media:cancel',
} as const

export type MediaIpcChannelName = (typeof MediaIpcChannel)[keyof typeof MediaIpcChannel]

/**
 * The one custom protocol scheme every playable stream — a completed local
 * download or a resolved remote link — is served through. Registered
 * privileged (protocol.registerSchemesAsPrivileged, at module load time —
 * see app/src/main/media.ts) and handled (protocol.handle, inside
 * registerMediaProtocol()) entirely in the main process. The renderer's CSP
 * `media-src` directive allowlists exactly this one scheme (see the surgical
 * edit to the CSP meta tag in scripts/build-renderer-from-design.mjs) — a
 * <video>/<audio> element's `src` is NEVER set to a raw http(s) URL or a
 * file:// path, so the CSP never has to widen beyond 'self' plus this scheme.
 */
export const MEDIA_PROTOCOL_SCHEME = 'ytdlp-media'

export type MediaKind = 'video' | 'audio'

export interface MediaResolveError {
  kind:
    | 'invalid-url'
    | 'not-in-library'
    | 'file-missing'
    | 'no-playable-stream'
    | 'spawn-failed'
    | 'timeout'
    | 'cancelled'
    | 'non-zero-exit'
    | 'unknown'
  /** The real, honest reason — the yt-dlp stderr tail, or a plain description of what was checked and failed. Never fabricated, never generic when a specific reason is known. */
  message: string
}

export interface MediaResolveSuccess {
  ok: true
  /** A same-origin `ytdlp-media://<token>` URL — the ONLY value a <video>/<audio> element's `src` is ever set to for this item. */
  streamUrl: string
  /** Which element the renderer should feed this into: <audio> for 'audio', <video> for 'video'. */
  mediaKind: MediaKind
  /**
   * True when the caller requested 'video' but no single combined
   * audio+video stream exists for this source (the normal case for most
   * current YouTube uploads — verified against the bundled yt-dlp: even a
   * single-format `-f "b/best"` request returns "Requested format is not
   * available" for videos that only expose separate video-only and
   * audio-only tracks, and the vendored ffmpeg has no TLS/network protocol
   * support at all so it cannot remux two live HTTPS streams on the fly —
   * see docs/features/playback/remote-link-playback.md for the full
   * investigation). When true, `mediaKind` is 'audio': the renderer plays
   * the audio track and must say plainly that video was unavailable rather
   * than silently downgrading.
   */
  videoFallenBackToAudio: boolean
  error: null
}

export interface MediaResolveFailure {
  ok: false
  streamUrl: null
  mediaKind: null
  videoFallenBackToAudio: false
  error: MediaResolveError
}

export type MediaResolveResult = MediaResolveSuccess | MediaResolveFailure

export interface ResolveLocalRequest {
  /**
   * The exact `outputPath` of a completed download, as already shown to the
   * user in the Library view (app/src/main/store.ts's JobHistoryEntry —
   * wired into the renderer by scripts/wire-download-history.mjs, which
   * this lane does not own and does not edit). This is never treated as
   * "any path the caller supplies": the main process only ever serves a
   * path that matches an `outputPath` already recorded against a `state:
   * 'done'` entry in job-history.json, so a protocol handler that would
   * otherwise be a file-read primitive is bounded to exactly the files this
   * app itself already downloaded.
   */
  path: string
  requestId: string
}

export interface ResolveRemoteRequest {
  /** http/https only — re-validated in the main process before yt-dlp ever sees it, regardless of what the renderer already checked. */
  url: string
  mediaKind: MediaKind
  requestId: string
}
