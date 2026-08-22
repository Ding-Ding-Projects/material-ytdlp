// wire-media-player.mjs
//
// The in-app media player: a real queue the user can add to from a
// completed Library download OR a pasted link, with transport controls
// (play/pause/seek/next/previous/volume), that keeps playing while
// downloads run in the background.
//
// ---------------------------------------------------------------------------
// What this lane owns, and what it deliberately does not
// ---------------------------------------------------------------------------
//
// All actual stream resolution — turning a completed download's recorded
// output path or a pasted link into ONE same-origin `ytdlp-media://` URL —
// happens in the main process (app/src/main/media.ts). This lane is
// entirely the renderer half: the queue (add/remove/reorder/clear), the
// transport UI, and the two real <audio>/<video> elements that actually
// play the resolved stream. Nothing here spawns a process, reads a file, or
// trusts a path — every "is this real?" question is answered by the main
// process's own resolve calls, and this lane only ever renders what those
// calls report.
//
// The design ships no player at all (verified against the checked-in
// design/yt-dlp Studio.dc.html — there is no <video>/<audio> element and no
// player-shaped state anywhere in it), so this is new UI. It is built to
// match the design's own idiom exactly rather than inventing a new visual
// language: the same surface colors (#0f1414/#171d1d/#1b2121/#252b2b), the
// same accent (#82d5cc / #003733 on-primary), the same Material Symbols
// Outlined ligature icons already used throughout (play_arrow already
// appears in the design's own "Save as PDF" action), the same pill-shaped
// buttons and range-input styling already used for the destructive-
// confirmation slider (`disabled="{{ sliderDisabled }}"` is an existing,
// working pattern this lane reuses verbatim).
//
// The player bar is ALWAYS rendered (not gated behind "queue has items"),
// on purpose: gating it would mean the very first thing a user needs — a
// way to add a link — is only reachable from a control that does not exist
// yet when the queue is empty. An always-visible, honestly-idle bar (with
// its own "Queue" button that opens the add-a-link drawer) is what makes
// the feature discoverable at all, and matches the Library's own honest-
// empty-state philosophy (an app with the feature but no way to find it is
// the same as an app without the feature).
//
// ---------------------------------------------------------------------------
// Why <audio> and <video> elements are looked up by id, not by ref
// ---------------------------------------------------------------------------
//
// Nothing anywhere in the design file uses a ref-based DOM handle (no
// `ref="{{ ... }}"`, no createRef/useRef of any kind — verified by search).
// Rather than guess whether this project's runtime templating layer
// (design/support.js) forwards refs correctly, this lane controls playback
// the same way `_key`'s keydown listener in the design's own
// componentDidMount already does: a stable DOM id
// (`document.getElementById('ytdlp-audio-el' | 'ytdlp-video-el')`), looked
// up fresh at the moment it is needed. Both elements are ALWAYS mounted
// (never conditionally, via sc-if) specifically so that lookup is never
// racing a mount/unmount.
//
// The <video> element is visually a small 36x36 inline preview, shown only
// while a resolved VIDEO item is actually playing; for an audio item the
// <audio> element (which has no visual surface at all) is what plays, so an
// item the user only wants to hear never forces a video surface onto
// screen. See app/src/main/media.ts's own module comment for why a
// requested 'video' item can legitimately end up playing through the audio
// element anyway (no combined stream existed) — that fallback is always
// disclosed to the user, never silent.

export function wireMediaPlayer(html, replaceExact) {
  html = addMediaState(html, replaceExact)
  html = wireLibraryPlayButton(html, replaceExact)
  html = addMediaMethods(html, replaceExact)
  html = addMediaRenderVals(html, replaceExact)
  html = addMediaMarkup(html, replaceExact)
  return html
}

// ---------------------------------------------------------------------------
// 1. New state fields for the queue, the currently-selected item, and
//    transport/volume state. Anchored on the exact `jobHistory: [],` field
//    scripts/wire-download-history.mjs already added (unique, and this
//    lane's whole feature is naturally adjacent to it — the Library is one
//    of this player's two add-to-queue sources).
// ---------------------------------------------------------------------------

function addMediaState(html, replaceExact) {
  const needle = `    jobHistory: [],`
  const replacement = `    jobHistory: [],
    mediaQueue: [], mediaCurrentId: null, mediaPlaying: false,
    mediaStatus: 'idle', mediaStatusMessage: '',
    mediaPositionSec: 0, mediaDurationSec: 0,
    mediaVolume: 1, mediaMuted: false,
    mediaQueueOpen: false, mediaPasteUrl: '',`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 2. The Library's "Play file" menu item — an honest toast stub before this
//    lane, explicitly called out as this lane's natural hook. r[0] is the
//    row's title, r[1] is its recorded output path (both already real,
//    wired by wire-download-history.mjs). The path is what
//    app/src/main/media.ts's resolveLocal() re-verifies against
//    job-history.json — this lane never sends a job id, because the
//    libraryRows row shape (an array of display strings) never carried one
//    through to this closure in the first place.
// ---------------------------------------------------------------------------

function wireLibraryPlayButton(html, replaceExact) {
  // Anchored on wire-open-file.mjs's OUTPUT, not on the design's original
  // toast stub. Both lanes legitimately wanted this one line: open-file
  // rewrites the whole row menu, and the player wants "Play file" to mean
  // play here rather than hand the file to another application. Ordering
  // settles it -- open-file rewrites the row, then this re-claims the entry,
  // so "Play" plays in the app and "Open file" still opens externally.
  const needle = `          { glyph: '▶', label: 'Play file', run: openFile },`
  const replacement = `          { glyph: '▶', label: 'Play file', run: () => this._mediaAddLocal(r[1], r[0]) },`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 3. Class methods. Anchored on the exact, unique `_hydrateJobHistory()`
//    method body scripts/wire-download-history.mjs already added — narrow,
//    unique, and (like the anchor above) naturally adjacent to this
//    feature. This lane's methods are appended immediately after it, so
//    ordering never depends on any anchor this lane does not itself own.
// ---------------------------------------------------------------------------

function addMediaMethods(html, replaceExact) {
  const needle = `  _hydrateJobHistory() {
    const bridge = window.ytdlpStudio;
    if (!bridge || !bridge.store) return;
    bridge.store.getJobHistory().then(entries => {
      this.setState({ jobHistory: Array.isArray(entries) ? entries : [] });
    }).catch(() => {
      // The Library view already renders an honest "0 completed downloads"
      // from an empty jobHistory; a background refresh failing is not worth
      // interrupting the user with a toast for.
    });
  }`
  const replacement = needle + `

  // -------------------------------------------------------------------
  // In-app media player. Resolution (turning a library path or a pasted
  // link into one playable ytdlp-media:// URL) always happens in the main
  // process (app/src/main/media.ts, reached through window.ytdlpStudioMedia
  // — a separately-registered bridge, exactly like window.ytdlpStudioExtension
  // above). Everything here is queue bookkeeping and the two real media
  // elements' imperative control (see this file's own module comment for
  // why lookup-by-id rather than a ref).
  // -------------------------------------------------------------------

  _mediaEl(kind) {
    return document.getElementById(kind === 'audio' ? 'ytdlp-audio-el' : 'ytdlp-video-el');
  }
  _mediaAllEls() {
    return [document.getElementById('ytdlp-audio-el'), document.getElementById('ytdlp-video-el')].filter(Boolean);
  }
  _mediaFmtTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '--:--';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  }

  _mediaAddLocal(path, title) {
    if (!window.ytdlpStudioMedia) { this.toast('Not connected', 'window.ytdlpStudioMedia is missing — running outside the packaged app?'); return; }
    if (!path) { this.toast('No output path', 'This download has no recorded output path to play.'); return; }
    const item = {
      id: Math.random(), source: 'local', path, url: null, requestedKind: 'video',
      title: title || path, resolvedKind: null, fellBackToAudio: false,
      status: 'queued', statusMessage: '', streamUrl: null, retried: false,
    };
    const hadCurrent = !!this.state.mediaCurrentId;
    this.setState(st => ({ mediaQueue: [...st.mediaQueue, item] }));
    this.toast('Added to queue', title || path);
    if (!hadCurrent) this._mediaPlayItem(item.id);
  }

  _mediaAddRemote(url, kind) {
    if (!window.ytdlpStudioMedia) { this.toast('Not connected', 'window.ytdlpStudioMedia is missing — running outside the packaged app?'); return; }
    const trimmed = (url || '').trim();
    if (!/^https?:\\/\\//i.test(trimmed)) { this.toast('Invalid link', 'Only http:// and https:// links can be queued.'); return; }
    const item = {
      id: Math.random(), source: 'remote', path: null, url: trimmed, requestedKind: kind,
      title: trimmed, resolvedKind: null, fellBackToAudio: false,
      status: 'queued', statusMessage: '', streamUrl: null, retried: false,
    };
    const hadCurrent = !!this.state.mediaCurrentId;
    this.setState(st => ({ mediaQueue: [...st.mediaQueue, item], mediaPasteUrl: '' }));
    this.toast('Added to queue', trimmed);
    if (!hadCurrent) this._mediaPlayItem(item.id);
  }

  _mediaFindItem(id) {
    return (this.state.mediaQueue || []).find(q => q.id === id) || null;
  }
  _mediaPatchItem(id, patch) {
    this.setState(st => ({ mediaQueue: st.mediaQueue.map(q => q.id === id ? { ...q, ...patch } : q) }));
  }
  _mediaStopPlayback() {
    this._mediaAllEls().forEach(el => {
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch (err) { /* element already gone */ }
    });
  }

  _mediaPlayItem(id) {
    const item = this._mediaFindItem(id);
    if (!item) return;
    this._mediaStopPlayback();
    this._mediaPatchItem(id, { status: 'resolving', statusMessage: '', retried: false });
    this.setState({
      mediaCurrentId: id, mediaStatus: 'resolving', mediaStatusMessage: '',
      mediaPositionSec: 0, mediaDurationSec: 0, mediaPlaying: false,
    });
    this._mediaResolveAndStart(id);
  }

  _mediaResolveAndStart(id) {
    const bridge = window.ytdlpStudioMedia;
    const item = this._mediaFindItem(id);
    if (!bridge || !item) return;
    const requestId = 'media-' + Math.random().toString(36).slice(2);
    const req = item.source === 'local'
      ? bridge.resolveLocal(item.path, requestId)
      : bridge.resolveRemote(item.url, item.requestedKind, requestId);
    req.then(res => {
      // Stale guard: the user may already have moved on to a different item
      // (next/previous/removed) while this was resolving.
      if (this.state.mediaCurrentId !== id) return;
      if (!res || !res.ok) {
        const errKind = res && res.error ? res.error.kind : 'unknown';
        const message = (res && res.error && res.error.message) || 'That could not be played.';
        const status = errKind === 'file-missing' ? 'file-missing' : 'unavailable';
        this._mediaPatchItem(id, { status, statusMessage: message });
        this.setState({ mediaStatus: status, mediaStatusMessage: message });
        this.toast(status === 'file-missing' ? 'File no longer on disk' : 'Cannot play this', message);
        return;
      }
      this._mediaPatchItem(id, {
        status: 'ready', statusMessage: '', resolvedKind: res.mediaKind,
        fellBackToAudio: !!res.videoFallenBackToAudio, streamUrl: res.streamUrl,
      });
      if (res.videoFallenBackToAudio) {
        this.toast('Audio only', 'No combined video+audio stream is available for in-app playback — playing the audio track. Download it for the full video.');
      }
      this.setState({ mediaStatus: 'buffering', mediaStatusMessage: '' });
      const el = this._mediaEl(res.mediaKind);
      if (!el) return;
      el.src = res.streamUrl;
      el.volume = this.state.mediaMuted ? 0 : this.state.mediaVolume;
      el.load();
      const p = el.play();
      if (p && p.catch) p.catch(() => { /* autoplay refusal or a real error, which onError below will also report */ });
    }).catch(err => {
      if (this.state.mediaCurrentId !== id) return;
      const message = String(err && err.message ? err.message : err);
      this._mediaPatchItem(id, { status: 'unavailable', statusMessage: message });
      this.setState({ mediaStatus: 'unavailable', mediaStatusMessage: message });
    });
  }

  _mediaOnError() {
    const id = this.state.mediaCurrentId;
    const item = this._mediaFindItem(id);
    if (!item) return;
    // Only a remote link can plausibly be an expired signed URL (e.g. a
    // googlevideo-style \`expire=\` timestamp). A local file failing to play
    // is a real, unrecoverable playback error — retrying would just fail
    // again the same way.
    if (item.source === 'remote' && !item.retried) {
      this._mediaPatchItem(id, { status: 'expired-retrying', retried: true });
      this.setState({ mediaStatus: 'expired-retrying', mediaStatusMessage: 'The link expired — resolving a fresh one…' });
      this._mediaResolveAndStart(id);
      return;
    }
    const message = item.source === 'local'
      ? 'This file could not be played — it may be corrupted or in an unsupported format.'
      : 'This link stopped working, even after resolving it again.';
    this._mediaPatchItem(id, { status: 'unavailable', statusMessage: message });
    this.setState({ mediaStatus: 'unavailable', mediaStatusMessage: message });
  }

  _mediaOnLoadedMetadata(e) {
    const d = e.target.duration;
    this.setState({ mediaDurationSec: Number.isFinite(d) ? d : this.state.mediaDurationSec });
  }
  _mediaOnTimeUpdate(e) {
    this.setState({ mediaPositionSec: e.target.currentTime || 0 });
  }
  _mediaOnPlaying() { this.setState({ mediaStatus: 'playing', mediaPlaying: true }); }
  _mediaOnPause() {
    this.setState(st => ({ mediaStatus: st.mediaStatus === 'playing' ? 'paused' : st.mediaStatus, mediaPlaying: false }));
  }
  _mediaOnWaiting() { this.setState({ mediaStatus: 'buffering' }); }
  _mediaOnEnded() { this._mediaNext(); }

  _mediaToggle() {
    const st = this.state;
    const item = this._mediaFindItem(st.mediaCurrentId);
    if (!item) {
      if ((st.mediaQueue || []).length) this._mediaPlayItem(st.mediaQueue[0].id);
      return;
    }
    const el = item.resolvedKind ? this._mediaEl(item.resolvedKind) : null;
    if (!el || !item.streamUrl) { this._mediaPlayItem(item.id); return; }
    if (st.mediaPlaying) { el.pause(); } else { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
  }
  _mediaQueueIndex() {
    return (this.state.mediaQueue || []).findIndex(q => q.id === this.state.mediaCurrentId);
  }
  _mediaNext() {
    const q = this.state.mediaQueue || [];
    const idx = this._mediaQueueIndex();
    if (idx < 0 || idx >= q.length - 1) {
      this._mediaStopPlayback();
      this.setState({ mediaStatus: 'idle', mediaStatusMessage: '', mediaPlaying: false });
      return;
    }
    this._mediaPlayItem(q[idx + 1].id);
  }
  _mediaPrev() {
    const q = this.state.mediaQueue || [];
    const idx = this._mediaQueueIndex();
    if (idx <= 0) return;
    this._mediaPlayItem(q[idx - 1].id);
  }
  _mediaSeek(e) {
    const sec = Number(e.target.value);
    const item = this._mediaFindItem(this.state.mediaCurrentId);
    const el = item && item.resolvedKind ? this._mediaEl(item.resolvedKind) : null;
    if (el && Number.isFinite(sec)) { try { el.currentTime = sec; } catch (err) { /* not seekable yet */ } }
    this.setState({ mediaPositionSec: sec });
  }
  _mediaSetVolume(e) {
    const pct = Number(e.target.value);
    const vol = Math.max(0, Math.min(1, (Number.isFinite(pct) ? pct : 100) / 100));
    this._mediaAllEls().forEach(el => { el.volume = vol; });
    this.setState({ mediaVolume: vol, mediaMuted: false });
  }
  _mediaToggleMute() {
    const muted = !this.state.mediaMuted;
    this._mediaAllEls().forEach(el => { el.volume = muted ? 0 : this.state.mediaVolume; });
    this.setState({ mediaMuted: muted });
  }
  _mediaRemove(id) {
    const wasCurrent = this.state.mediaCurrentId === id;
    if (window.ytdlpStudioMedia) window.ytdlpStudioMedia.cancel('media-remove-' + id);
    this.setState(st => ({ mediaQueue: st.mediaQueue.filter(q => q.id !== id) }));
    if (wasCurrent) {
      this._mediaStopPlayback();
      this.setState({ mediaCurrentId: null, mediaStatus: 'idle', mediaStatusMessage: '', mediaPlaying: false, mediaPositionSec: 0, mediaDurationSec: 0 });
    }
  }
  _mediaMove(id, dir) {
    this.setState(st => {
      const q = st.mediaQueue.slice();
      const idx = q.findIndex(x => x.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= q.length) return null;
      const tmp = q[idx]; q[idx] = q[target]; q[target] = tmp;
      return { mediaQueue: q };
    });
  }
  _mediaClearQueue() {
    this._mediaStopPlayback();
    this.setState({ mediaQueue: [], mediaCurrentId: null, mediaStatus: 'idle', mediaStatusMessage: '', mediaPlaying: false, mediaPositionSec: 0, mediaDurationSec: 0 });
    this.toast('Queue cleared', 'Playback stopped.');
  }`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 4. renderVals() additions: every `{{ mediaXxx }}` binding the markup in
//    part 5 below reads. Anchored on the exact, unique `libraryCount: (()
//    => {...})(),` IIFE scripts/wire-download-history.mjs already added —
//    again narrow, unique, and adjacent to this lane's own feature.
// ---------------------------------------------------------------------------

function addMediaRenderVals(html, replaceExact) {
  const needle = `      libraryCount: (() => {
        const doneCount = (s.jobHistory || []).filter(h => h.state === 'done').length;
        return doneCount + (doneCount === 1 ? ' completed download' : ' completed downloads');
      })(),`
  const replacement = needle + `

      ...(() => {
        const queue = s.mediaQueue || [];
        const item = queue.find(q => q.id === s.mediaCurrentId) || null;
        const kind = item ? (item.resolvedKind || item.requestedKind) : 'video';
        const idx = queue.findIndex(q => q.id === s.mediaCurrentId);
        const fmt = sec => this._mediaFmtTime(sec);
        const statusLabelMap = {
          idle: 'Nothing queued', resolving: 'Resolving…', buffering: 'Buffering…',
          playing: 'Playing', paused: 'Paused',
          unavailable: s.mediaStatusMessage || 'Unavailable',
          'expired-retrying': 'Link expired — resolving a fresh one…',
          'file-missing': 'File no longer on disk',
        };
        return {
          mediaHasQueue: queue.length > 0,
          mediaQueueCount: queue.length,
          mediaCurrentTitle: item ? item.title : 'Nothing playing',
          mediaStatusLabel: statusLabelMap[s.mediaStatus] || s.mediaStatus,
          mediaStatusMessage: s.mediaStatusMessage,
          mediaStatusColor: (s.mediaStatus === 'unavailable' || s.mediaStatus === 'file-missing') ? '#ffb4ab'
            : (s.mediaStatus === 'resolving' || s.mediaStatus === 'buffering' || s.mediaStatus === 'expired-retrying') ? '#febc2e'
            : '#889391',
          mediaKindGlyph: kind === 'audio' ? 'music_note' : 'movie',
          mediaKindColor: item && item.fellBackToAudio ? '#febc2e' : '#82d5cc',
          mediaShowVideoFrame: kind === 'video' && !!item && item.status === 'ready' && !!item.streamUrl,
          mediaPlaying: s.mediaPlaying,
          mediaToggleGlyph: s.mediaPlaying ? 'pause' : 'play_arrow',
          mediaHasPrev: idx > 0,
          mediaHasNext: idx >= 0 && idx < queue.length - 1,
          mediaPositionSec: s.mediaPositionSec,
          mediaPositionLabel: fmt(s.mediaPositionSec),
          mediaDurationLabel: s.mediaDurationSec > 0 ? fmt(s.mediaDurationSec) : '--:--',
          mediaSeekMax: s.mediaDurationSec > 0 ? Math.floor(s.mediaDurationSec) : 0,
          mediaSeekable: s.mediaDurationSec > 0 && (s.mediaStatus === 'playing' || s.mediaStatus === 'paused' || s.mediaStatus === 'buffering'),
          mediaVolumePct: Math.round((s.mediaMuted ? 0 : s.mediaVolume) * 100),
          mediaVolumeGlyph: (s.mediaMuted || s.mediaVolume === 0) ? 'volume_off' : (s.mediaVolume < 0.5 ? 'volume_down' : 'volume_up'),
          mediaMuted: s.mediaMuted,
          mediaQueueOpen: s.mediaQueueOpen,
          mediaToggleQueueOpen: () => this.setState(st => ({ mediaQueueOpen: !st.mediaQueueOpen })),
          mediaCloseQueue: () => this.setState({ mediaQueueOpen: false }),
          mediaClearQueueClick: () => this._mediaClearQueue(),
          mediaPrev: () => this._mediaPrev(),
          mediaNext: () => this._mediaNext(),
          mediaToggle: () => this._mediaToggle(),
          mediaSeek: e => this._mediaSeek(e),
          mediaSetVolume: e => this._mediaSetVolume(e),
          mediaToggleMute: () => this._mediaToggleMute(),
          mediaPasteUrl: s.mediaPasteUrl,
          mediaSetPasteUrl: e => this.setState({ mediaPasteUrl: e.target.value }),
          mediaQueueVideo: () => this._mediaAddRemote(s.mediaPasteUrl, 'video'),
          mediaQueueAudio: () => this._mediaAddRemote(s.mediaPasteUrl, 'audio'),
          mediaOnLoadedMetadata: e => this._mediaOnLoadedMetadata(e),
          mediaOnTimeUpdate: e => this._mediaOnTimeUpdate(e),
          mediaOnPlaying: () => this._mediaOnPlaying(),
          mediaOnPause: () => this._mediaOnPause(),
          mediaOnWaiting: () => this._mediaOnWaiting(),
          mediaOnEnded: () => this._mediaOnEnded(),
          mediaOnError: () => this._mediaOnError(),
          mediaQueueRows: queue.map((q, i, arr) => {
            const rowActive = q.id === s.mediaCurrentId;
            const rowKind = q.resolvedKind || q.requestedKind;
            const rowGlyph = q.status === 'resolving' ? 'autorenew'
              : q.status === 'expired-retrying' ? 'sync_problem'
              : q.status === 'unavailable' ? 'error'
              : q.status === 'file-missing' ? 'warning'
              : rowKind === 'audio' ? 'music_note' : 'movie';
            const rowColor = (q.status === 'unavailable' || q.status === 'file-missing') ? '#ffb4ab'
              : (q.status === 'resolving' || q.status === 'expired-retrying') ? '#febc2e'
              : rowActive ? '#82d5cc' : '#889391';
            const rowStatusLabel = q.status === 'queued' ? (q.source === 'local' ? 'From your library' : 'Pasted link')
              : q.status === 'resolving' ? 'Resolving…'
              : q.status === 'expired-retrying' ? 'Link expired — retrying…'
              : q.status === 'unavailable' ? (q.statusMessage || 'Unavailable')
              : q.status === 'file-missing' ? 'File no longer on disk'
              : (q.fellBackToAudio ? 'Audio only (no video stream) · ready' : 'Ready');
            return {
              id: q.id, active: rowActive, glyph: rowGlyph, iconColor: rowColor,
              statusLabel: rowStatusLabel, statusColor: rowColor, title: q.title,
              isFirst: i === 0, isLast: i === arr.length - 1,
              play: () => this._mediaPlayItem(q.id),
              up: () => this._mediaMove(q.id, -1),
              down: () => this._mediaMove(q.id, 1),
              remove: () => this._mediaRemove(q.id),
            };
          }),
        };
      })(),`
  return replaceExact(html, needle, replacement)
}

// ---------------------------------------------------------------------------
// 5. Markup: the two always-mounted media elements, the always-visible
//    transport bar, and the queue drawer (which also carries the
//    add-a-link form — the drawer is reachable from the bar's own Queue
//    button regardless of whether anything is queued yet, which is what
//    makes adding the FIRST item possible at all). Anchored immediately
//    before the existing, unconditional 24px status bar's opening tag —
//    unique in the file, always rendered regardless of tab/mode, so the
//    player bar is visible everywhere the status bar already is.
// ---------------------------------------------------------------------------

function addMediaMarkup(html, replaceExact) {
  const needle = `      <div style="flex:0 0 auto;height:24px;background:#0b0f10;border-top:1px solid #1c2223;display:flex;align-items:center;gap:0;font-size:11px;color:#889391;font-family:'Roboto Mono',Consolas,monospace">`

  const mediaElements = `      <video id="ytdlp-video-el" style="{{ mediaShowVideoFrame ? 'width:36px;height:36px;object-fit:cover;display:block' : 'width:0;height:0;display:none' }}" onLoadedMetadata="{{ mediaOnLoadedMetadata }}" onTimeUpdate="{{ mediaOnTimeUpdate }}" onPlaying="{{ mediaOnPlaying }}" onPause="{{ mediaOnPause }}" onWaiting="{{ mediaOnWaiting }}" onEnded="{{ mediaOnEnded }}" onError="{{ mediaOnError }}"></video>
      <audio id="ytdlp-audio-el" style="display:none" onLoadedMetadata="{{ mediaOnLoadedMetadata }}" onTimeUpdate="{{ mediaOnTimeUpdate }}" onPlaying="{{ mediaOnPlaying }}" onPause="{{ mediaOnPause }}" onWaiting="{{ mediaOnWaiting }}" onEnded="{{ mediaOnEnded }}" onError="{{ mediaOnError }}"></audio>
`

  const playerBar = `      <div style="flex:0 0 auto;border-top:1px solid #2a3130;background:#12191a;display:flex;align-items:center;gap:12px;padding:0 14px;height:60px">
        <div style="width:36px;height:36px;border-radius:9px;background:#1b2121;display:grid;place-items:center;flex:0 0 auto;overflow:hidden">
          <sc-if value="{{ !mediaShowVideoFrame }}" hint-placeholder-val="{{ true }}">
            <i class="msym" style="font-size:20px;color:{{ mediaKindColor }}">{{ mediaKindGlyph }}</i>
          </sc-if>
        </div>
        <div style="min-width:0;width:200px;flex:0 0 auto">
          <div style="font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="{{ mediaCurrentTitle }}">{{ mediaCurrentTitle }}</div>
          <div style="font-size:10.5px;color:{{ mediaStatusColor }};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="{{ mediaStatusMessage }}">{{ mediaStatusLabel }}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0;flex:0 0 auto">
          <button onClick="{{ mediaPrev }}" title="Previous in queue" disabled="{{ !mediaHasPrev }}" style="width:32px;height:32px;border-radius:16px;background:transparent;color:{{ mediaHasPrev ? '#bec9c7' : '#4a5251' }}"><i class="msym" style="font-size:19px">skip_previous</i></button>
          <button onClick="{{ mediaToggle }}" title="{{ mediaPlaying ? 'Pause' : 'Play' }}" disabled="{{ !mediaHasQueue }}" style="width:38px;height:38px;border-radius:19px;background:{{ mediaHasQueue ? '#82d5cc' : '#252b2b' }};color:{{ mediaHasQueue ? '#003733' : '#4a5251' }};margin:0 2px"><i class="msym" style="font-size:21px">{{ mediaToggleGlyph }}</i></button>
          <button onClick="{{ mediaNext }}" title="Next in queue" disabled="{{ !mediaHasNext }}" style="width:32px;height:32px;border-radius:16px;background:transparent;color:{{ mediaHasNext ? '#bec9c7' : '#4a5251' }}"><i class="msym" style="font-size:19px">skip_next</i></button>
        </div>
        <div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px">
          <span style="font-size:10.5px;color:#889391;font-family:'Roboto Mono',Consolas,monospace;width:38px;text-align:right;flex:0 0 auto">{{ mediaPositionLabel }}</span>
          <input type="range" min="0" max="{{ mediaSeekMax }}" step="1" value="{{ mediaPositionSec }}" onChange="{{ mediaSeek }}" disabled="{{ !mediaSeekable }}" style="flex:1;accent-color:#82d5cc" />
          <span style="font-size:10.5px;color:#889391;font-family:'Roboto Mono',Consolas,monospace;width:38px;flex:0 0 auto">{{ mediaDurationLabel }}</span>
        </div>
        <div style="display:flex;align-items:center;gap:2px;flex:0 0 auto">
          <button onClick="{{ mediaToggleMute }}" title="{{ mediaMuted ? 'Unmute' : 'Mute' }}" style="width:30px;height:30px;border-radius:15px;background:transparent;color:#bec9c7"><i class="msym" style="font-size:18px">{{ mediaVolumeGlyph }}</i></button>
          <input type="range" min="0" max="100" step="1" value="{{ mediaVolumePct }}" onChange="{{ mediaSetVolume }}" style="width:64px;accent-color:#82d5cc" />
        </div>
        <button onClick="{{ mediaToggleQueueOpen }}" title="Play queue" style="width:32px;height:32px;border-radius:16px;background:{{ mediaQueueOpen ? '#252b2b' : 'transparent' }};color:#82d5cc;position:relative;flex:0 0 auto">
          <i class="msym" style="font-size:19px">queue_music</i>
          <sc-if value="{{ mediaQueueCount > 0 }}" hint-placeholder-val="{{ false }}">
            <span style="position:absolute;top:1px;right:1px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#82d5cc;color:#003733;font-size:9px;font-weight:700;display:grid;place-items:center;line-height:1">{{ mediaQueueCount }}</span>
          </sc-if>
        </button>
      </div>

      <sc-if value="{{ mediaQueueOpen }}" hint-placeholder-val="{{ false }}">
        <div onClick="{{ mediaCloseQueue }}" style="position:fixed;inset:0;z-index:31">
          <div onClick="{{ stop }}" style="position:fixed;right:14px;bottom:80px;width:400px;max-height:min(560px,calc(100vh - 140px));overflow:auto;background:#1b2121;border:1px solid #2a3130;border-radius:16px;box-shadow:0 14px 40px #000b;padding:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <i class="msym" style="font-size:19px;color:#82d5cc">queue_music</i>
              <b style="font-size:14px;font-weight:500;flex:1">Play queue · {{ mediaQueueCount }}</b>
              <button onClick="{{ mediaClearQueueClick }}" title="Clear queue" disabled="{{ !mediaHasQueue }}" style="width:30px;height:30px;border-radius:15px;background:transparent;color:{{ mediaHasQueue ? '#ffb4ab' : '#4a5251' }}"><i class="msym" style="font-size:18px">delete</i></button>
              <button onClick="{{ mediaCloseQueue }}" title="Close" style="width:30px;height:30px;border-radius:15px;background:transparent;color:#bec9c7"><i class="msym" style="font-size:18px">close</i></button>
            </div>

            <div style="background:#171d1d;border-radius:12px;padding:10px;margin-bottom:10px;display:grid;gap:8px">
              <div style="font-size:11px;color:#889391;letter-spacing:.3px">Play a link without downloading it</div>
              <input value="{{ mediaPasteUrl }}" onChange="{{ mediaSetPasteUrl }}" placeholder="Paste a video or audio URL" style="height:34px;background:#0f1414;border:1px solid #2a3130;border-radius:8px;color:#dee4e3;padding:0 10px;font-size:12.5px" />
              <div style="display:flex;gap:8px">
                <button onClick="{{ mediaQueueVideo }}" style="flex:1;height:32px;border-radius:16px;background:#252b2b;color:#bec9c7;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px"><i class="msym" style="font-size:16px">movie</i>Queue video</button>
                <button onClick="{{ mediaQueueAudio }}" style="flex:1;height:32px;border-radius:16px;background:#252b2b;color:#bec9c7;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:6px"><i class="msym" style="font-size:16px">music_note</i>Queue audio</button>
              </div>
            </div>

            <sc-if value="{{ !mediaHasQueue }}" hint-placeholder-val="{{ false }}">
              <div style="padding:20px 10px;text-align:center;color:#889391;font-size:12.5px">Nothing queued yet. Add a link above, or use "Play file" on a Library row.</div>
            </sc-if>

            <sc-for list="{{ mediaQueueRows }}" as="row" hint-placeholder-count="0">
              <div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:10px;background:{{ row.active ? '#213231' : 'transparent' }}">
                <i class="msym" style="font-size:18px;color:{{ row.iconColor }};flex:0 0 auto">{{ row.glyph }}</i>
                <button onClick="{{ row.play }}" style="flex:1;min-width:0;background:transparent;color:#dee4e3;text-align:left;padding:0">
                  <div style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ row.title }}</div>
                  <div style="font-size:10.5px;color:{{ row.statusColor }};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ row.statusLabel }}</div>
                </button>
                <button onClick="{{ row.up }}" title="Move up" disabled="{{ row.isFirst }}" style="width:26px;height:26px;border-radius:13px;background:transparent;color:{{ row.isFirst ? '#4a5251' : '#bec9c7' }}"><i class="msym" style="font-size:16px">arrow_upward</i></button>
                <button onClick="{{ row.down }}" title="Move down" disabled="{{ row.isLast }}" style="width:26px;height:26px;border-radius:13px;background:transparent;color:{{ row.isLast ? '#4a5251' : '#bec9c7' }}"><i class="msym" style="font-size:16px">arrow_downward</i></button>
                <button onClick="{{ row.remove }}" title="Remove from queue" style="width:26px;height:26px;border-radius:13px;background:transparent;color:#ffb4ab"><i class="msym" style="font-size:16px">close</i></button>
              </div>
            </sc-for>
          </div>
        </div>
      </sc-if>

`

  const replacement = mediaElements + playerBar + needle
  return replaceExact(html, needle, replacement)
}
