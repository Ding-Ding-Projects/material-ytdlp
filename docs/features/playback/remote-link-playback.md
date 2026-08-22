# Remote link playback

## Behavior

Pasting a link into the queue drawer and choosing "Queue video" or "Queue audio" does not download
anything. `app/src/main/media.ts`'s `resolveRemote()` spawns the bundled `yt-dlp` (argv array,
never a shell) with `--get-url` against a single-stream format selector, gets back one HTTPS URL,
and mints an opaque token mapped to it. The renderer never sees that URL — only a same-origin
`ytdlp-media://<token>` URL, which `<video src>`/`<audio src>` loads. The custom `ytdlp-media`
protocol, handled entirely inside this app's main process, proxies the request to the real
resolved URL: it forwards the incoming `Range` header (so seeking works) and relays the upstream's
status/headers/body straight through, so the player never has to know or care that the bytes came
from a remote host at all.

**Local playback works the same way**, minus the yt-dlp call: `resolveLocal()` re-verifies the
caller-supplied path against the store's own recorded completed downloads, mints a token pointing
at the real file, and the same protocol handler serves it — with real `fs.createReadStream(path,
{start, end})` Range support, so a multi-gigabyte file is never re-read into memory.

## Why a custom protocol, not widening the CSP

The renderer's Content-Security-Policy (`scripts/build-renderer-from-design.mjs`) has no
`media-src` beyond `'self'` before this feature. The tempting fix — add `https:` — was explicitly
ruled out by the task this feature was built against, and for good reason: it would let a
`<video src="...">` reach *any* host on the internet, not just the one resolved URL this feature
actually needs. The registered `ytdlp-media:` scheme (`protocol.registerSchemesAsPrivileged` +
`protocol.handle`, both in `app/src/main/media.ts`) is the narrow version of the same fix: the CSP
now trusts exactly one scheme, and everything that scheme can possibly serve is decided entirely
by this app's own main process, never by the renderer or by whatever page happened to produce the
pasted link.

## The single-URL constraint, verified against the bundled binary — and a dead end

A `<video>`/`<audio>` element takes exactly one `src`. yt-dlp's ordinary *download* selector
(`bv*+ba/b`) resolves to **two** URLs — a video-only stream and an audio-only stream, muxed
together only once both are fully downloaded, which is exactly why a real download needs ffmpeg
and this in-app player cannot use that selector at all. This was verified directly against the
repository's bundled binary (`vendor/bin/yt-dlp.exe`, version `2026.08.19`) before writing any
code:

```
yt-dlp --no-playlist --no-warnings -f "bv*+ba/b" --get-url -- <a real YouTube URL>
```

prints two `googlevideo.com` URLs (one `mime=video%2Fmp4`, one `mime=audio%2Fwebm`).

The obvious fix for "the player needs one URL" is a single combined ("progressive") format
selector instead. This was also verified live, and the result changed the design:

- `yt-dlp -f "b/best" --get-url -- <url>` prints **exactly one** URL when a genuine combined
  format exists.
- Against **both** a brand-new upload and "Me at the zoo" (the oldest video on YouTube), it fails
  outright: `ERROR: Requested format is not available.` `-F` on both confirms why — every format
  listed is `video only` or `audio only`; **no combined format exists for either video.** This is
  not an edge case. It is normal, current YouTube behavior: most video on the site today has no
  progressive format at all.
- `yt-dlp -f "ba[ext=m4a]/ba/bestaudio" --get-url -- <url>` prints **exactly one** URL in every
  case tried — an audio-only stream is inherently a single file, so this selector never hits the
  same problem.

**The dead end, worth recording so nobody retries it:** the obvious next idea is to resolve the
two-URL selector and remux video+audio together on the fly with ffmpeg, piping the muxed result
straight into the HTTP response — no combined stream ever exists on disk, matching "nothing
downloaded, played directly." This does not work with what is actually bundled. The vendored
`vendor/bin/ffmpeg.exe`'s own `-protocols` output lists only plain `http`, no `https`, no TLS at
all — confirmed live:

```
$ ffmpeg -i "https://...googlevideo.com/..." ...
https or dtls protocol not found, recompile FFmpeg with openssl, gnutls or securetransport enabled.
Error opening input: Protocol not found
```

This build was clearly compiled deliberately minimal (`--disable-doc --disable-ffplay
--disable-autodetect`, no TLS backend enabled) for its actual job — merging **local** files yt-dlp's
own Python networking already downloaded — and it simply cannot open an `https://` URL as an input
at all, so it cannot remux two live network streams no matter how it is invoked. Rebuilding that
vendored binary with a TLS backend is a real packaging change (a different toolchain flag, a
larger binary, a rebuild pipeline) that is well outside this feature's file ownership.

**The actual design**, given both of the above: a `video` request tries the single progressive
selector first; when that fails — the normal case for most current YouTube sources — it
automatically falls back to the verified single-URL audio selector, and the result carries
`videoFallenBackToAudio: true`. The renderer is required to say so out loud (a toast: "No combined
video+audio stream is available for in-app playback — playing the audio track"), never a silent
downgrade. Downloading the item — the app's existing, unrelated feature — still produces the real
muxed video, because that path already has yt-dlp's own Python-side post-processing (which does
have real ffmpeg availability for **local** merges) available to it; only in-app *streaming*
playback is affected by the vendored ffmpeg's missing TLS support.

## Expired links and retry

A resolved googlevideo-style URL carries its own `expire=` timestamp and is bound to the
requesting IP. This feature resolves **lazily** — only when a queue item is actually about to
play, never at the moment it is added to the queue — which already avoids the common case of
staleness. For the remaining case (a long pause, or returning to an earlier queue item well after
it was first resolved), the renderer's media `error` event handler
(`_mediaOnError` in `scripts/wire-media-player.mjs`) re-resolves the *same* item exactly once and
retries; if the retry also fails, the item is marked `unavailable` with the real reason rather than
retried forever. A local file's playback error is never treated as "maybe expired" — it is a real,
unrecoverable failure (corrupt file, unsupported codec), and retrying would just fail again the
same way.

## Configuration

None. The format selectors (`VIDEO_FORMAT_SELECTOR`, `AUDIO_FORMAT_SELECTOR` in
`app/src/main/media.ts`) are fixed, not user-configurable, in this pass.

## Failure modes

- **`yt-dlp` is not found**: `resolveRemote()` reports the exact list of paths checked
  (`resolveBinary('yt-dlp')`'s own `searched` array), matching how every other yt-dlp-spawning
  feature in this app reports a missing binary.
- **Neither the video nor the audio-only selector resolves**: the real yt-dlp stderr tail is
  surfaced as the error message (e.g. "This video is only available to subscribers"), never a
  generic "could not play."
- **The resolve is cancelled** (the user removed the item from the queue while it was still
  resolving): the in-flight child process is killed via the same `taskkill /T /F` (Windows) /
  process-group `SIGKILL` (other platforms) approach `app/src/main/probes.ts` already uses,
  duplicated narrowly here rather than imported, matching that module's own stated reasoning for
  not importing `killTree` from `app/src/main/ytdlp.ts`.
- **The upstream stream host responds with an error** (expired link → typically `403`; removed
  video → `404`; anything else): relayed as that real status where meaningful, `502` otherwise —
  never silently swallowed into a generic failure at the protocol-handler layer, since the
  renderer's retry logic (above) depends on actually seeing a real media-element `error` event.
- **A live token is looked up after this app's `MAX_LIVE_TOKENS` (64) cap has evicted it** (an
  extremely long session with many distinct queue items played): a fresh `404` from the protocol
  handler, which the renderer treats as an ordinary playback error and re-resolves via the same
  retry path described above — nothing distinguishes "evicted" from "genuinely gone" at the
  renderer, which is the honest state since the renderer has no way to know the difference either.

## Security considerations

- **Local files: no path is ever trusted from the renderer.** `resolveLocal()` accepts a `path`
  string, but the ONLY thing it does with it is look for a `job-history.json` entry whose own
  recorded `state: 'done'` `outputPath` matches it byte-for-byte. A path that is not the exact
  output of a real completed download in this app is refused (`not-in-library`). This is
  deliberately *not* a directory-prefix/"is it under the downloads folder" check — it is a stronger
  bound: only a file this app itself already downloaded is ever servable, regardless of what
  directory it happens to live in (the user can, and does, choose an arbitrary download folder).
- **A pasted link is never passed to a shell.** `spawn()` is called with the URL as one element of
  an argv array (`['--no-playlist', '--no-warnings', '-f', selector, '--get-url', '--', url]`);
  `shell: true` is never used anywhere in this feature. The `--` before the URL additionally stops
  a URL that happens to start with `-` from being parsed as a flag.
- **Only http/https links are ever accepted.** `resolveRemote()` re-validates the URL's protocol
  in the main process regardless of what the renderer's own (also-present, but non-authoritative)
  regex check already did — `new URL(req.url)`, reject anything whose `.protocol` is not
  `http:`/`https:`. A `file://`, `data:`, or any other scheme is refused with `invalid-url` before
  yt-dlp ever sees it.
- **The renderer never receives a raw stream URL, local or remote.** Every successful resolve
  returns only a same-origin `ytdlp-media://<token>` string; the actual filesystem path or
  upstream URL lives only in an in-process `Map` in `app/src/main/media.ts`, never serialized to
  the renderer, a log, or disk.
- **The bridge is its own separately-registered preload**, exactly like the existing browser-
  extension install bridge in `app/src/main/protocol.ts` — `app/src/preload/index.ts` is owned by
  other work in flight and was not edited. `window.ytdlpStudioMedia` is registered via
  `session.defaultSession.registerPreloadScript()` against a small, self-contained CommonJS source
  written to this app's own `userData` directory, following the exact pattern
  `initExtensionInstallBridge()` already established. No new channel was added to
  `app/src/main/ipc.ts`; the three IPC handlers this feature needs (`media:resolve-local`,
  `media:resolve-remote`, `media:cancel`) are registered directly by `registerMediaProtocol()` in
  `app/src/main/media.ts`.

## Verification status

**Format selectors verified live against the bundled binary; not yet run end-to-end inside the
packaged app.**

- Every claim in "The single-URL constraint" and "The dead end" sections above was verified by
  actually running the exact commands shown against `vendor/bin/yt-dlp.exe` (`2026.08.19`) and
  `vendor/bin/ffmpeg.exe`, not inferred from documentation — see the exact transcripts in this
  feature's implementation notes. `-f "b/best"` and `-f "ba[ext=m4a]/ba/bestaudio"` were each
  confirmed to print exactly one URL when they succeed, and to fail cleanly (empty stdout, a
  single-line stderr message, non-zero exit) rather than partially/ambiguously when they do not.
- `cd app && npm run typecheck` — real exit code `0`.
- The protocol registration, IPC handlers, and Range-parsing logic in `app/src/main/media.ts` were
  typechecked but have **not** been exercised against a running Electron process — no window has
  actually loaded a `ytdlp-media://` URL into a `<video>`/`<audio>` element, so Range-request
  behavior against Chromium's real media-loading pipeline, the exact interaction between the
  privileged-scheme registration and this app's existing CSP, and the video-element-hidden-vs-
  audio-element playback distinction described in `media-player.md` are all unverified beyond
  static review and the reasoning above. Building and launching the packaged app to capture this
  was explicitly out of scope for this task ("do not build one yourself").
- The renderer-side expired-link retry path (`_mediaOnError`) has not been exercised against a
  real expired googlevideo URL (which requires waiting out a real link's `expire=` window, or
  faking a `403` from the protocol handler) — its logic is reasoned about and syntax-checked (see
  `media-player.md`'s verification section) but not behaviorally observed.
