/**
 * Typed copy of design/ytdlp-flags.js.
 *
 * This is a COPY, not an import across the design boundary — the design
 * folder is read-only reference material and is never loaded by the product
 * UI. Every value below (groups, flags, presets, template fields) is
 * transcribed verbatim from the design file; only TypeScript types were
 * added. Keeping the two in sync is enforced by
 * scripts/check-catalog-drift.mjs, which parses both files and fails when
 * the flag sets diverge.
 *
 * f = flag, s = short flag, a = argument placeholder, t = control type,
 * h = one-line help, rx = takes a regular expression, o = choices for
 * select controls, d = this is yt-dlp's own default behavior.
 */

export type FlagControlType =
  | 'bool'
  | 'text'
  | 'int'
  | 'path'
  | 'select'
  | 'password'

export interface FlagDef {
  /** Long flag, e.g. "--proxy". */
  f: string
  /** Short flag, e.g. "-p". */
  s?: string
  /** Argument placeholder shown in the control, e.g. "URL". */
  a?: string
  /** Control type used to render this flag. */
  t: FlagControlType
  /** One-line help text. */
  h: string
  /** True when this is yt-dlp's own default behavior. */
  d?: true
  /** Choices, for select controls. */
  o?: string[]
  /** True when the argument accepts a regular expression. */
  rx?: true
}

export interface FlagGroup {
  id: string
  label: string
  /** Material Symbols ligature name for the group's rail/tab icon. */
  glyph: string
  blurb: string
  flags: FlagDef[]
}

export const GROUPS: FlagGroup[] = [
  {
    id: 'general', label: 'General', glyph: 'terminal',
    blurb: 'Program behaviour, update channel, extractor selection, config loading, aliases and presets.',
    flags: [
      { f: '--help', s: '-h', t: 'bool', h: 'Print this help text and exit' },
      { f: '--version', t: 'bool', h: 'Print program version and exit' },
      { f: '--update', s: '-U', t: 'bool', h: 'Update this program to the latest version' },
      { f: '--no-update', t: 'bool', h: 'Do not check for updates (default)', d: true },
      { f: '--update-to', a: '[CHANNEL]@[TAG]', t: 'text', h: 'Upgrade/downgrade to a specific version. Channels: stable, nightly, master' },
      { f: '--ignore-errors', s: '-i', t: 'bool', h: 'Ignore download and postprocessing errors; the download is still considered successful' },
      { f: '--no-abort-on-error', t: 'bool', h: 'Continue with next video on download errors (default)', d: true },
      { f: '--abort-on-error', t: 'bool', h: 'Abort downloading of further videos if an error occurs (Alias: --no-ignore-errors)' },
      { f: '--list-extractors', t: 'bool', h: 'List all supported extractors and exit' },
      { f: '--extractor-descriptions', t: 'bool', h: 'Output descriptions of all supported extractors and exit' },
      { f: '--use-extractors', a: 'NAMES', t: 'text', rx: true, h: 'Extractor names to use, comma separated. Regexes, "all", "default" and "end" are accepted (Alias: --ies)' },
      { f: '--default-search', a: 'PREFIX', t: 'text', h: 'Prefix for unqualified URLs, e.g. "gvsearch2:". "auto", "error", "fixup_error" (default)' },
      { f: '--ignore-config', t: 'bool', h: 'Do not load any more configuration files except those given to --config-locations' },
      { f: '--no-config-locations', t: 'bool', h: 'Do not load any custom configuration files (default)', d: true },
      { f: '--config-locations', a: 'PATH', t: 'path', h: 'Location of the main configuration file, or its containing directory ("-" for stdin)' },
      { f: '--plugin-dirs', a: 'DIR', t: 'path', h: 'Additional directory to search for plugins. Repeatable. "default" searches the defaults' },
      { f: '--no-plugin-dirs', t: 'bool', h: 'Clear plugin directories to search, including defaults' },
      { f: '--js-runtimes', a: 'RUNTIME[:PATH]', t: 'text', h: 'Additional JavaScript runtime to enable: deno, node, quickjs, bun. Only deno is default' },
      { f: '--no-js-runtimes', t: 'bool', h: 'Clear JavaScript runtimes to enable, including defaults' },
      { f: '--remote-components', a: 'COMPONENT', t: 'select', o: ['ejs:npm', 'ejs:github'], h: 'Remote components yt-dlp may fetch when required. None are allowed by default' },
      { f: '--no-remote-components', t: 'bool', h: 'Disallow fetching of all remote components' },
      { f: '--flat-playlist', t: 'bool', h: 'Do not extract a playlist URL result entries; some entry metadata may be missing' },
      { f: '--no-flat-playlist', t: 'bool', h: 'Fully extract the videos of a playlist (default)', d: true },
      { f: '--live-from-start', t: 'bool', h: 'Download livestreams from the start. Experimental; YouTube, Twitch, TVer, mellow-fan' },
      { f: '--no-live-from-start', t: 'bool', h: 'Download livestreams from the current time (default)', d: true },
      { f: '--wait-for-video', a: 'MIN[-MAX]', t: 'text', h: 'Wait for scheduled streams to become available; seconds or a range between retries' },
      { f: '--no-wait-for-video', t: 'bool', h: 'Do not wait for scheduled streams (default)', d: true },
      { f: '--mark-watched', t: 'bool', h: 'Mark videos watched (even with --simulate)' },
      { f: '--no-mark-watched', t: 'bool', h: 'Do not mark videos watched (default)', d: true },
      { f: '--color', a: '[STREAM:]POLICY', t: 'select', o: ['always', 'auto', 'never', 'no_color', 'auto-tty', 'no_color-tty'], h: 'Whether to emit color codes in output, optionally prefixed by stdout: or stderr:' },
      { f: '--compat-options', a: 'OPTS', t: 'text', h: 'Options that help keep compatibility with youtube-dl or youtube-dlc configurations' },
      { f: '--alias', a: 'ALIASES OPTIONS', t: 'text', h: 'Create aliases for an option string, parsed with the Python string formatting mini-language' },
      { f: '--preset-alias', s: '-t', a: 'PRESET', t: 'select', o: ['mp3', 'aac', 'mp4', 'mkv', 'sleep'], h: 'Apply a predefined set of options. Repeatable' },
    ],
  },
  {
    id: 'network', label: 'Network', glyph: 'lan',
    blurb: 'Proxies, timeouts, source binding, client impersonation and IP family.',
    flags: [
      { f: '--proxy', a: 'URL', t: 'text', h: 'HTTP/HTTPS/SOCKS proxy, e.g. socks5://user:pass@127.0.0.1:1080/. Empty string = direct' },
      { f: '--socket-timeout', a: 'SECONDS', t: 'int', h: 'Time to wait before giving up, in seconds' },
      { f: '--source-address', a: 'IP', t: 'text', h: 'Client-side IP address to bind to' },
      { f: '--impersonate', a: 'CLIENT[:OS]', t: 'text', h: 'Client to impersonate for requests, e.g. chrome-110, chrome:windows-10' },
      { f: '--list-impersonate-targets', t: 'bool', h: 'List available clients to impersonate' },
      { f: '--force-ipv4', s: '-4', t: 'bool', h: 'Make all connections via IPv4' },
      { f: '--force-ipv6', s: '-6', t: 'bool', h: 'Make all connections via IPv6' },
      { f: '--enable-file-urls', t: 'bool', h: 'Enable file:// URLs. Disabled by default for security reasons' },
    ],
  },
  {
    id: 'geo', label: 'Geo-restriction', glyph: 'public_off',
    blurb: 'Verification proxy and X-Forwarded-For spoofing for region-locked extractors.',
    flags: [
      { f: '--geo-verification-proxy', a: 'URL', t: 'text', h: 'Proxy used to verify the IP address for some geo-restricted sites' },
      { f: '--xff', a: 'VALUE', t: 'text', h: 'How to fake X-Forwarded-For: "default", "never", a CIDR block, or an ISO 3166-2 code' },
    ],
  },
  {
    id: 'selection', label: 'Video Selection', glyph: 'filter_alt',
    blurb: 'Which entries of a URL or playlist actually get downloaded.',
    flags: [
      { f: '--playlist-items', s: '-I', a: 'ITEM_SPEC', t: 'text', h: 'Comma-separated playlist_index to download; ranges "[START]:[STOP][:STEP]", negatives count from the right' },
      { f: '--min-filesize', a: 'SIZE', t: 'text', h: 'Abort download if filesize is smaller than SIZE, e.g. 50k or 44.6M' },
      { f: '--max-filesize', a: 'SIZE', t: 'text', h: 'Abort download if filesize is larger than SIZE, e.g. 50k or 44.6M' },
      { f: '--date', a: 'DATE', t: 'text', h: 'Only videos uploaded on this date. YYYYMMDD or [now|today|yesterday][-N[day|week|month|year]]' },
      { f: '--datebefore', a: 'DATE', t: 'text', h: 'Only videos uploaded on or before this date' },
      { f: '--dateafter', a: 'DATE', t: 'text', h: 'Only videos uploaded on or after this date' },
      { f: '--match-filters', a: 'FILTER', t: 'text', rx: true, h: 'Generic video filter over any output template field. Repeatable (OR). "-" asks interactively' },
      { f: '--no-match-filters', t: 'bool', h: 'Do not use any --match-filters (default)', d: true },
      { f: '--break-match-filters', a: 'FILTER', t: 'text', rx: true, h: 'Same as --match-filters but stops the download process when a video is rejected' },
      { f: '--no-break-match-filters', t: 'bool', h: 'Do not use any --break-match-filters (default)', d: true },
      { f: '--no-playlist', t: 'bool', h: 'Download only the video, if the URL refers to a video and a playlist' },
      { f: '--yes-playlist', t: 'bool', h: 'Download the playlist, if the URL refers to a video and a playlist' },
      { f: '--age-limit', a: 'YEARS', t: 'int', h: 'Download only videos suitable for the given age' },
      { f: '--download-archive', a: 'FILE', t: 'path', h: 'Download only videos not listed in the archive file; record downloaded IDs in it' },
      { f: '--no-download-archive', t: 'bool', h: 'Do not use archive file (default)', d: true },
      { f: '--max-downloads', a: 'NUMBER', t: 'int', h: 'Abort after downloading NUMBER files' },
      { f: '--break-on-existing', t: 'bool', h: 'Stop when encountering a file that is in the archive supplied with --download-archive' },
      { f: '--no-break-on-existing', t: 'bool', h: 'Do not stop on a file already in the archive (default)', d: true },
      { f: '--break-per-input', t: 'bool', h: 'Reset --max-downloads, --break-on-existing, --break-match-filters and autonumber per input URL' },
      { f: '--no-break-per-input', t: 'bool', h: '--break-on-existing and similar options terminate the entire download queue', d: true },
      { f: '--skip-playlist-after-errors', a: 'N', t: 'int', h: 'Number of allowed failures until the rest of the playlist is skipped' },
    ],
  },
  {
    id: 'download', label: 'Download', glyph: 'download',
    blurb: 'Concurrency, rate limits, retries, fragments, sections and external downloaders.',
    flags: [
      { f: '--concurrent-fragments', s: '-N', a: 'N', t: 'int', h: 'Number of dash/hlsnative fragments to download concurrently (default 1)' },
      { f: '--limit-rate', s: '-r', a: 'RATE', t: 'text', h: 'Maximum download rate in bytes per second, e.g. 50K or 4.2M' },
      { f: '--throttled-rate', a: 'RATE', t: 'text', h: 'Minimum rate below which throttling is assumed and the video data is re-extracted' },
      { f: '--retries', s: '-R', a: 'RETRIES', t: 'text', h: 'Number of retries (default 10), or "infinite"' },
      { f: '--file-access-retries', a: 'RETRIES', t: 'text', h: 'Number of times to retry on file access error (default 3), or "infinite"' },
      { f: '--fragment-retries', a: 'RETRIES', t: 'text', h: 'Number of retries for a fragment (default 10), or "infinite" (DASH, hlsnative, ISM)' },
      { f: '--retry-sleep', a: '[TYPE:]EXPR', t: 'text', h: 'Sleep between retries; TYPE is http, fragment, file_access or extractor. linear= or exp=' },
      { f: '--skip-unavailable-fragments', t: 'bool', h: 'Skip unavailable fragments for DASH, hlsnative and ISM downloads (default)', d: true },
      { f: '--abort-on-unavailable-fragments', t: 'bool', h: 'Abort download if a fragment is unavailable' },
      { f: '--keep-fragments', t: 'bool', h: 'Keep downloaded fragments on disk after downloading is finished' },
      { f: '--no-keep-fragments', t: 'bool', h: 'Delete downloaded fragments after downloading is finished (default)', d: true },
      { f: '--buffer-size', a: 'SIZE', t: 'text', h: 'Size of download buffer, e.g. 1024 or 16K (default 1024)' },
      { f: '--resize-buffer', t: 'bool', h: 'The buffer size is automatically resized from --buffer-size (default)', d: true },
      { f: '--no-resize-buffer', t: 'bool', h: 'Do not automatically adjust the buffer size' },
      { f: '--http-chunk-size', a: 'SIZE', t: 'text', h: 'Chunk size for chunk-based HTTP downloading, e.g. 10M. Useful against throttling' },
      { f: '--playlist-random', t: 'bool', h: 'Download playlist videos in random order' },
      { f: '--lazy-playlist', t: 'bool', h: 'Process entries as they are received; disables n_entries, --playlist-random and reverse' },
      { f: '--no-lazy-playlist', t: 'bool', h: 'Process videos only after the entire playlist is parsed (default)', d: true },
      { f: '--hls-use-mpegts', t: 'bool', h: 'Use the mpegts container for HLS videos; playable while downloading. Default for live' },
      { f: '--no-hls-use-mpegts', t: 'bool', h: 'Do not use the mpegts container for HLS videos' },
      { f: '--download-sections', a: 'REGEX', t: 'text', rx: true, h: 'Download only chapters matching the regex. "*" prefix = time range. Needs ffmpeg' },
      { f: '--downloader', a: '[PROTO:]NAME', t: 'select', o: ['native', 'aria2c', 'axel', 'curl', 'ffmpeg', 'httpie', 'wget'], h: 'External downloader, optionally prefixed by protocols (http, ftp, m3u8, dash, rtmp)' },
      { f: '--downloader-args', a: 'NAME:ARGS', t: 'text', h: 'Arguments for the external downloader; NAME:ARGS, repeatable (Alias: --external-downloader-args)' },
    ],
  },
  {
    id: 'filesystem', label: 'Filesystem', glyph: 'folder_open',
    blurb: 'Batch files, paths, output templates, overwrite policy, sidecar files, cookies and cache.',
    flags: [
      { f: '--batch-file', s: '-a', a: 'FILE', t: 'path', h: 'File containing URLs to download, one per line ("-" for stdin)' },
      { f: '--no-batch-file', t: 'bool', h: 'Do not read URLs from batch file (default)', d: true },
      { f: '--paths', s: '-P', a: '[TYPES:]PATH', t: 'path', h: 'Where files should be downloaded; also "home" (default) and "temp" paths' },
      { f: '--output', s: '-o', a: '[TYPES:]TEMPLATE', t: 'text', h: 'Output filename template; see OUTPUT TEMPLATE' },
      { f: '--output-na-placeholder', a: 'TEXT', t: 'text', h: 'Placeholder for unavailable fields in --output (default "NA")' },
      { f: '--restrict-filenames', t: 'bool', h: 'Restrict filenames to ASCII characters, and avoid "&" and spaces' },
      { f: '--no-restrict-filenames', t: 'bool', h: 'Allow Unicode characters, "&" and spaces in filenames (default)', d: true },
      { f: '--windows-filenames', t: 'bool', h: 'Force filenames to be Windows-compatible' },
      { f: '--no-windows-filenames', t: 'bool', h: 'Sanitize filenames only minimally' },
      { f: '--trim-filenames', a: 'LENGTH', t: 'int', h: 'Limit the filename length (excluding extension) to this number of characters' },
      { f: '--no-overwrites', s: '-w', t: 'bool', h: 'Do not overwrite any files' },
      { f: '--force-overwrites', t: 'bool', h: 'Overwrite all video and metadata files. Includes --no-continue' },
      { f: '--no-force-overwrites', t: 'bool', h: 'Do not overwrite the video, but overwrite related files (default)', d: true },
      { f: '--continue', s: '-c', t: 'bool', h: 'Resume partially downloaded files/fragments (default)', d: true },
      { f: '--no-continue', t: 'bool', h: 'Do not resume partially downloaded fragments; restart the entire file' },
      { f: '--part', t: 'bool', h: 'Use .part files instead of writing directly into the output file (default)', d: true },
      { f: '--no-part', t: 'bool', h: 'Do not use .part files - write directly into the output file' },
      { f: '--mtime', t: 'bool', h: 'Use the Last-modified header to set the file modification time' },
      { f: '--no-mtime', t: 'bool', h: 'Do not use the Last-modified header to set the modification time (default)', d: true },
      { f: '--write-description', t: 'bool', h: 'Write video description to a .description file' },
      { f: '--no-write-description', t: 'bool', h: 'Do not write video description (default)', d: true },
      { f: '--write-info-json', t: 'bool', h: 'Write video metadata to a .info.json file (may contain personal information)' },
      { f: '--no-write-info-json', t: 'bool', h: 'Do not write video metadata (default)', d: true },
      { f: '--write-playlist-metafiles', t: 'bool', h: 'Write playlist metadata in addition to the video metadata (default)', d: true },
      { f: '--no-write-playlist-metafiles', t: 'bool', h: 'Do not write playlist metadata when using --write-info-json etc.' },
      { f: '--clean-info-json', t: 'bool', h: 'Remove some internal metadata such as filenames from the infojson (default)', d: true },
      { f: '--no-clean-info-json', t: 'bool', h: 'Write all fields to the infojson' },
      { f: '--write-comments', t: 'bool', h: 'Retrieve video comments to be placed in the infojson (Alias: --get-comments)' },
      { f: '--no-write-comments', t: 'bool', h: 'Do not retrieve video comments unless extraction is known to be quick' },
      { f: '--load-info-json', a: 'FILE', t: 'path', h: 'JSON file containing the video information, created with --write-info-json' },
      { f: '--cookies', a: 'FILE', t: 'path', h: 'Netscape formatted file to read cookies from and dump cookie jar in' },
      { f: '--no-cookies', t: 'bool', h: 'Do not read/dump cookies from/to file (default)', d: true },
      { f: '--cookies-from-browser', a: 'BROWSER[+KEYRING][:PROFILE][::CONTAINER]', t: 'text', h: 'Browser to load cookies from: brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale' },
      { f: '--no-cookies-from-browser', t: 'bool', h: 'Do not load cookies from browser (default)', d: true },
      { f: '--cache-dir', a: 'DIR', t: 'path', h: 'Where yt-dlp stores downloaded information permanently. Default ${XDG_CACHE_HOME}/yt-dlp' },
      { f: '--no-cache-dir', t: 'bool', h: 'Disable filesystem caching' },
      { f: '--rm-cache-dir', t: 'bool', h: 'Delete all filesystem cache files' },
    ],
  },
  {
    id: 'thumbnail', label: 'Thumbnail', glyph: 'image',
    blurb: 'Writing and listing thumbnail images.',
    flags: [
      { f: '--write-thumbnail', t: 'bool', h: 'Write thumbnail image to disk' },
      { f: '--no-write-thumbnail', t: 'bool', h: 'Do not write thumbnail image to disk (default)', d: true },
      { f: '--write-all-thumbnails', t: 'bool', h: 'Write all thumbnail image formats to disk' },
      { f: '--list-thumbnails', t: 'bool', h: 'List available thumbnails of each video. Simulate unless --no-simulate is used' },
    ],
  },
  {
    id: 'shortcut', label: 'Shortcuts', glyph: 'link',
    blurb: 'Internet shortcut files written beside the media.',
    flags: [
      { f: '--write-link', t: 'bool', h: 'Write an internet shortcut file appropriate to the current platform' },
      { f: '--write-url-link', t: 'bool', h: 'Write a .url Windows internet shortcut' },
      { f: '--write-webloc-link', t: 'bool', h: 'Write a .webloc macOS internet shortcut' },
      { f: '--write-desktop-link', t: 'bool', h: 'Write a .desktop Linux internet shortcut' },
    ],
  },
  {
    id: 'verbosity', label: 'Verbosity', glyph: 'bug_report',
    blurb: 'Simulation, printing, JSON dumps, progress rendering and debug traffic.',
    flags: [
      { f: '--quiet', s: '-q', t: 'bool', h: 'Activate quiet mode. With --verbose, print the log to stderr' },
      { f: '--no-quiet', t: 'bool', h: 'Deactivate quiet mode (default)', d: true },
      { f: '--no-warnings', t: 'bool', h: 'Ignore warnings' },
      { f: '--simulate', s: '-s', t: 'bool', h: 'Do not download the video and do not write anything to disk' },
      { f: '--no-simulate', t: 'bool', h: 'Download the video even if printing/listing options are used' },
      { f: '--ignore-no-formats-error', t: 'bool', h: 'Ignore "No video formats" error; useful for extracting metadata (experimental)' },
      { f: '--no-ignore-no-formats-error', t: 'bool', h: 'Throw error when no downloadable video formats are found (default)', d: true },
      { f: '--skip-download', t: 'bool', h: 'Do not download the video but write all related files (Alias: --no-download)' },
      { f: '--print', s: '-O', a: '[WHEN:]TEMPLATE', t: 'text', h: 'Field name or output template to print to screen. Implies --quiet and --simulate' },
      { f: '--print-to-file', a: '[WHEN:]TEMPLATE FILE', t: 'text', h: 'Append the given template to a file; FILE uses the output template syntax' },
      { f: '--dump-json', s: '-j', t: 'bool', h: 'Quiet, but print JSON information for each video' },
      { f: '--dump-single-json', s: '-J', t: 'bool', h: 'Quiet, but print JSON information for each URL or infojson passed, in a single line' },
      { f: '--force-write-archive', t: 'bool', h: 'Force download archive entries to be written even when simulating' },
      { f: '--newline', t: 'bool', h: 'Output progress bar as new lines' },
      { f: '--no-progress', t: 'bool', h: 'Do not print progress bar' },
      { f: '--progress', t: 'bool', h: 'Show progress bar, even if in quiet mode' },
      { f: '--console-title', t: 'bool', h: 'Display progress in console titlebar' },
      { f: '--progress-template', a: '[TYPES:]TEMPLATE', t: 'text', h: 'Template for progress outputs; info and progress keys are available' },
      { f: '--progress-delta', a: 'SECONDS', t: 'text', h: 'Time between progress output (default 0)' },
      { f: '--verbose', s: '-v', t: 'bool', h: 'Print various debugging information' },
      { f: '--dump-pages', t: 'bool', h: 'Print downloaded pages encoded using base64 to debug problems (very verbose)' },
      { f: '--write-pages', t: 'bool', h: 'Write downloaded intermediary pages to files in the current directory' },
      { f: '--print-traffic', t: 'bool', h: 'Display sent and read HTTP traffic' },
    ],
  },
  {
    id: 'workarounds', label: 'Workarounds', glyph: 'handyman',
    blurb: 'Encoding, TLS leniency, custom headers and sleep intervals.',
    flags: [
      { f: '--encoding', a: 'ENCODING', t: 'text', h: 'Force the specified encoding (experimental)' },
      { f: '--legacy-server-connect', t: 'bool', h: 'Allow HTTPS connection to servers without RFC 5746 secure renegotiation' },
      { f: '--no-check-certificates', t: 'bool', h: 'Suppress HTTPS certificate validation' },
      { f: '--prefer-insecure', t: 'bool', h: 'Use an unencrypted connection to retrieve information about the video' },
      { f: '--add-headers', a: 'FIELD:VALUE', t: 'text', h: 'Custom HTTP header and its value, separated by a colon. Repeatable' },
      { f: '--bidi-workaround', t: 'bool', h: 'Work around terminals that lack bidirectional text support. Requires bidiv or fribidi' },
      { f: '--sleep-requests', a: 'SECONDS', t: 'text', h: 'Seconds to sleep between requests during data extraction' },
      { f: '--sleep-interval', a: 'SECONDS', t: 'text', h: 'Seconds to sleep before each download (Alias: --min-sleep-interval)' },
      { f: '--max-sleep-interval', a: 'SECONDS', t: 'text', h: 'Maximum number of seconds to sleep. Only with --min-sleep-interval' },
      { f: '--sleep-subtitles', a: 'SECONDS', t: 'text', h: 'Seconds to sleep before each subtitle download' },
    ],
  },
  {
    id: 'format', label: 'Video Format', glyph: 'high_quality',
    blurb: 'Format selection, sorting, multistreams and merge containers.',
    flags: [
      { f: '--format', s: '-f', a: 'FORMAT', t: 'text', h: 'Video format code; see FORMAT SELECTION' },
      { f: '--format-sort', s: '-S', a: 'SORTORDER', t: 'text', h: 'Sort the formats by the fields given; see Sorting Formats' },
      { f: '--format-sort-reset', t: 'bool', h: 'Disregard previous user specified sort order and reset to the default' },
      { f: '--format-sort-force', t: 'bool', h: 'Force user specified sort order to have precedence over all fields (Alias: --S-force)' },
      { f: '--no-format-sort-force', t: 'bool', h: 'Some fields have precedence over the user specified sort order (default)', d: true },
      { f: '--video-multistreams', t: 'bool', h: 'Allow multiple video streams to be merged into a single file' },
      { f: '--no-video-multistreams', t: 'bool', h: 'Only one video stream is downloaded for each output file (default)', d: true },
      { f: '--audio-multistreams', t: 'bool', h: 'Allow multiple audio streams to be merged into a single file' },
      { f: '--no-audio-multistreams', t: 'bool', h: 'Only one audio stream is downloaded for each output file (default)', d: true },
      { f: '--prefer-free-formats', t: 'bool', h: 'Prefer video formats with free containers over non-free ones of the same quality' },
      { f: '--no-prefer-free-formats', t: 'bool', h: 'Do not give any special preference to free containers (default)', d: true },
      { f: '--check-formats', t: 'bool', h: 'Make sure formats are selected only from those that are actually downloadable' },
      { f: '--check-all-formats', t: 'bool', h: 'Check all formats for whether they are actually downloadable' },
      { f: '--no-check-formats', t: 'bool', h: 'Do not check that the formats are actually downloadable' },
      { f: '--list-formats', s: '-F', t: 'bool', h: 'List available formats of each video. Simulate unless --no-simulate is used' },
      { f: '--merge-output-format', a: 'FORMAT', t: 'select', o: ['avi', 'flv', 'mkv', 'mov', 'mp4', 'webm'], h: 'Containers that may be used when merging formats, separated by "/"' },
    ],
  },
  {
    id: 'subtitle', label: 'Subtitles', glyph: 'subtitles',
    blurb: 'Subtitle writing, language selection and formats.',
    flags: [
      { f: '--write-subs', t: 'bool', h: 'Write subtitle file' },
      { f: '--no-write-subs', t: 'bool', h: 'Do not write subtitle file (default)', d: true },
      { f: '--write-auto-subs', t: 'bool', h: 'Write automatically generated subtitle file (Alias: --write-automatic-subs)' },
      { f: '--no-write-auto-subs', t: 'bool', h: 'Do not write auto-generated subtitles (default)', d: true },
      { f: '--list-subs', t: 'bool', h: 'List available subtitles of each video. Simulate unless --no-simulate is used' },
      { f: '--sub-format', a: 'FORMAT', t: 'text', h: 'Subtitle format preference separated by "/", e.g. "srt" or "ass/srt/best"' },
      { f: '--sub-langs', a: 'LANGS', t: 'text', rx: true, h: 'Languages of the subtitles to download (can be regex) or "all", comma separated' },
    ],
  },
  {
    id: 'auth', label: 'Authentication', glyph: 'key',
    blurb: 'Account credentials, netrc, Adobe Pass and client certificates.',
    flags: [
      { f: '--username', s: '-u', a: 'USERNAME', t: 'text', h: 'Login with this account ID' },
      { f: '--password', s: '-p', a: 'PASSWORD', t: 'password', h: 'Account password. If left out, yt-dlp will ask interactively' },
      { f: '--twofactor', s: '-2', a: 'TWOFACTOR', t: 'text', h: 'Two-factor authentication code' },
      { f: '--netrc', s: '-n', t: 'bool', h: 'Use .netrc authentication data' },
      { f: '--netrc-location', a: 'PATH', t: 'path', h: 'Location of .netrc authentication data. Defaults to ~/.netrc' },
      { f: '--netrc-cmd', a: 'NETRC_CMD', t: 'text', h: 'Command to execute to get the credentials for an extractor' },
      { f: '--video-password', a: 'PASSWORD', t: 'password', h: 'Video-specific password' },
      { f: '--ap-mso', a: 'MSO', t: 'text', h: 'Adobe Pass multiple-system operator (TV provider) identifier' },
      { f: '--ap-username', a: 'USERNAME', t: 'text', h: 'Multiple-system operator account login' },
      { f: '--ap-password', a: 'PASSWORD', t: 'password', h: 'Multiple-system operator account password' },
      { f: '--ap-list-mso', t: 'bool', h: 'List all supported multiple-system operators' },
      { f: '--client-certificate', a: 'CERTFILE', t: 'path', h: 'Path to client certificate file in PEM format. May include the private key' },
      { f: '--client-certificate-key', a: 'KEYFILE', t: 'path', h: 'Path to private key file for client certificate' },
      { f: '--client-certificate-password', a: 'PASSWORD', t: 'password', h: 'Password for client certificate private key, if encrypted' },
    ],
  },
  {
    id: 'postproc', label: 'Post-Processing', glyph: 'linked_services',
    blurb: 'Audio extraction, remux, recode, embedding, metadata parsing, chapters and exec hooks.',
    flags: [
      { f: '--extract-audio', s: '-x', t: 'bool', h: 'Convert video files to audio-only files (requires ffmpeg and ffprobe)' },
      { f: '--audio-format', a: 'FORMAT', t: 'select', o: ['best', 'aac', 'alac', 'flac', 'm4a', 'mp3', 'opus', 'vorbis', 'wav'], h: 'Format to convert the audio to when -x is used' },
      { f: '--audio-quality', a: 'QUALITY', t: 'text', h: 'ffmpeg audio quality: 0 (best) to 10 (worst) for VBR, or a bitrate like 128K (default 5)' },
      { f: '--remux-video', a: 'FORMAT', t: 'text', h: 'Remux into another container if necessary; rules like "aac>m4a/mov>mp4/mkv"' },
      { f: '--recode-video', a: 'FORMAT', t: 'text', h: 'Re-encode the video into another format if necessary; same syntax as --remux-video' },
      { f: '--postprocessor-args', a: 'NAME:ARGS', t: 'text', h: 'Arguments for the postprocessors, e.g. "Merger+ffmpeg_i1:-v quiet" (Alias: --ppa)' },
      { f: '--keep-video', s: '-k', t: 'bool', h: 'Keep the intermediate video file on disk after post-processing' },
      { f: '--no-keep-video', t: 'bool', h: 'Delete the intermediate video file after post-processing (default)', d: true },
      { f: '--post-overwrites', t: 'bool', h: 'Overwrite post-processed files (default)', d: true },
      { f: '--no-post-overwrites', t: 'bool', h: 'Do not overwrite post-processed files' },
      { f: '--embed-subs', t: 'bool', h: 'Embed subtitles in the video (only for mp4, webm and mkv videos)' },
      { f: '--no-embed-subs', t: 'bool', h: 'Do not embed subtitles (default)', d: true },
      { f: '--embed-thumbnail', t: 'bool', h: 'Embed thumbnail in the video as cover art' },
      { f: '--no-embed-thumbnail', t: 'bool', h: 'Do not embed thumbnail (default)', d: true },
      { f: '--embed-metadata', t: 'bool', h: 'Embed metadata to the video file; also chapters and infojson (Alias: --add-metadata)' },
      { f: '--no-embed-metadata', t: 'bool', h: 'Do not add metadata to file (default)', d: true },
      { f: '--embed-chapters', t: 'bool', h: 'Add chapter markers to the video file (Alias: --add-chapters)' },
      { f: '--no-embed-chapters', t: 'bool', h: 'Do not add chapter markers (default)', d: true },
      { f: '--embed-info-json', t: 'bool', h: 'Embed the infojson as an attachment to mkv/mka video files' },
      { f: '--no-embed-info-json', t: 'bool', h: 'Do not embed the infojson as an attachment to the video file' },
      { f: '--parse-metadata', a: '[WHEN:]FROM:TO', t: 'text', rx: true, h: 'Parse additional metadata like title/artist from other fields; see MODIFYING METADATA' },
      { f: '--replace-in-metadata', a: '[WHEN:]FIELDS REGEX REPLACE', t: 'text', rx: true, h: 'Replace text in a metadata field using the given regex. Repeatable' },
      { f: '--xattrs', t: 'bool', h: 'Write metadata to the video file xattrs (using Dublin Core and XDG standards)' },
      { f: '--concat-playlist', a: 'POLICY', t: 'select', o: ['never', 'always', 'multi_video'], h: 'Concatenate videos in a playlist. Default multi_video' },
      { f: '--fixup', a: 'POLICY', t: 'select', o: ['never', 'warn', 'detect_or_warn', 'force'], h: 'Automatically correct known faults of the file. Default detect_or_warn' },
      { f: '--ffmpeg-location', a: 'PATH', t: 'path', h: 'Location of the ffmpeg binary, or its containing directory' },
      { f: '--exec', a: '[WHEN:]CMD', t: 'text', h: 'Execute a command; output template fields may be passed as arguments. Repeatable' },
      { f: '--no-exec', t: 'bool', h: 'Remove any previously defined --exec' },
      { f: '--convert-subs', a: 'FORMAT', t: 'select', o: ['none', 'ass', 'lrc', 'srt', 'vtt'], h: 'Convert the subtitles to another format (Alias: --convert-subtitles)' },
      { f: '--convert-thumbnails', a: 'FORMAT', t: 'select', o: ['none', 'jpg', 'png', 'webp'], h: 'Convert the thumbnails to another format; multiple rules allowed' },
      { f: '--split-chapters', t: 'bool', h: 'Split video into multiple files based on internal chapters' },
      { f: '--no-split-chapters', t: 'bool', h: 'Do not split video based on chapters (default)', d: true },
      { f: '--remove-chapters', a: 'REGEX', t: 'text', rx: true, h: 'Remove chapters whose title matches the given regular expression. Repeatable' },
      { f: '--no-remove-chapters', t: 'bool', h: 'Do not remove any chapters from the file (default)', d: true },
      { f: '--force-keyframes-at-cuts', t: 'bool', h: 'Force keyframes at cuts when downloading/splitting/removing sections; slow but cleaner' },
      { f: '--no-force-keyframes-at-cuts', t: 'bool', h: 'Do not force keyframes around the chapters when cutting/splitting (default)', d: true },
      { f: '--use-postprocessor', a: 'NAME[:ARGS]', t: 'text', h: 'Enable a plugin postprocessor; ARGS is a ";" delimited list of NAME=VALUE' },
    ],
  },
  {
    id: 'sponsorblock', label: 'SponsorBlock', glyph: 'block',
    blurb: 'Mark or remove sponsor, intro, outro and other segments using the SponsorBlock API.',
    flags: [
      { f: '--sponsorblock-mark', a: 'CATS', t: 'text', h: 'Categories to create chapters for, comma separated. "-" prefix excludes' },
      { f: '--sponsorblock-remove', a: 'CATS', t: 'text', h: 'Categories to be removed from the video file. Remove takes precedence over mark' },
      { f: '--sponsorblock-chapter-title', a: 'TEMPLATE', t: 'text', h: 'Title template for created chapters. Default "[SponsorBlock]: %(category_names)l"' },
      { f: '--no-sponsorblock', t: 'bool', h: 'Disable both --sponsorblock-mark and --sponsorblock-remove' },
      { f: '--sponsorblock-api', a: 'URL', t: 'text', h: 'SponsorBlock API location, defaults to https://sponsor.ajay.app' },
    ],
  },
  {
    id: 'extractor', label: 'Extractor', glyph: 'extension',
    blurb: 'Extractor retries, DASH/HLS handling and per-extractor arguments.',
    flags: [
      { f: '--extractor-retries', a: 'RETRIES', t: 'text', h: 'Number of retries for known extractor errors (default 3), or "infinite"' },
      { f: '--allow-dynamic-mpd', t: 'bool', h: 'Process dynamic DASH manifests (default) (Alias: --no-ignore-dynamic-mpd)', d: true },
      { f: '--ignore-dynamic-mpd', t: 'bool', h: 'Do not process dynamic DASH manifests (Alias: --no-allow-dynamic-mpd)' },
      { f: '--hls-split-discontinuity', t: 'bool', h: 'Split HLS playlists to different formats at discontinuities such as ad breaks' },
      { f: '--no-hls-split-discontinuity', t: 'bool', h: 'Do not split HLS playlists at discontinuities (default)', d: true },
      { f: '--extractor-args', a: 'IE_KEY:ARGS', t: 'text', h: 'Pass ARGS to the IE_KEY extractor; see EXTRACTOR ARGUMENTS. Repeatable' },
    ],
  },
]

export interface PresetDef {
  name: string
  expands: string
}

export const PRESETS: PresetDef[] = [
  { name: 'mp3', expands: "-f 'ba[acodec^=mp3]/ba/b' -x --audio-format mp3" },
  { name: 'aac', expands: "-f 'ba[acodec^=aac]/ba[acodec^=mp4a.40.]/ba/b' -x --audio-format aac" },
  { name: 'mp4', expands: '--merge-output-format mp4 --remux-video mp4 -S vcodec:h264,lang,quality,res,fps,hdr:12,acodec:aac' },
  { name: 'mkv', expands: '--merge-output-format mkv --remux-video mkv' },
  { name: 'sleep', expands: '--sleep-subtitles 5 --sleep-requests 0.75 --sleep-interval 10 --max-sleep-interval 20' },
]

export interface TemplateFieldGroup {
  g: string
  items: string[]
}

export const TEMPLATE_FIELDS: TemplateFieldGroup[] = [
  { g: 'Identity', items: ['id', 'title', 'fulltitle', 'ext', 'alt_title', 'display_id', 'webpage_url', 'webpage_url_domain', 'original_url', 'extractor', 'extractor_key', 'epoch', 'autonumber'] },
  { g: 'People', items: ['uploader', 'uploader_id', 'uploader_url', 'channel', 'channel_id', 'channel_url', 'channel_follower_count', 'channel_is_verified', 'creators', 'license'] },
  { g: 'Time', items: ['timestamp', 'upload_date', 'release_timestamp', 'release_date', 'release_year', 'modified_timestamp', 'modified_date', 'duration', 'duration_string'] },
  { g: 'Counts', items: ['view_count', 'concurrent_view_count', 'like_count', 'dislike_count', 'repost_count', 'average_rating', 'comment_count', 'age_limit'] },
  { g: 'State', items: ['live_status', 'is_live', 'was_live', 'playable_in_embed', 'availability', 'media_type', 'categories', 'tags', 'cast', 'location'] },
  { g: 'Series', items: ['series', 'series_id', 'season', 'season_number', 'season_id', 'episode', 'episode_number', 'episode_id', 'chapter', 'chapter_number', 'chapter_id'] },
  { g: 'Music', items: ['track', 'track_number', 'track_id', 'artists', 'genres', 'album', 'album_type', 'album_artists', 'disc_number'] },
  { g: 'Playlist', items: ['playlist', 'playlist_id', 'playlist_title', 'playlist_uploader', 'playlist_uploader_id', 'playlist_index', 'playlist_autonumber', 'playlist_count', 'n_entries'] },
  { g: 'Format', items: ['format', 'format_id', 'format_note', 'width', 'height', 'aspect_ratio', 'resolution', 'fps', 'dynamic_range', 'vcodec', 'vbr', 'acodec', 'abr', 'asr', 'audio_channels', 'filesize', 'filesize_approx', 'tbr', 'protocol', 'language'] },
]

export const OUTPUT_TYPES: string[] = ['default', 'thumbnail', 'description', 'annotation', 'subtitle', 'infojson', 'link', 'pl_thumbnail', 'pl_description', 'pl_infojson', 'chapter', 'pl_video']

export const SORT_FIELDS: string[] = ['hasvid', 'hasaud', 'ie_pref', 'lang', 'quality', 'source', 'proto', 'vcodec', 'acodec', 'codec', 'ext', 'filesize', 'fs_approx', 'size', 'height', 'width', 'res', 'fps', 'hdr', 'channels', 'tbr', 'vbr', 'abr', 'br', 'asr', 'vext', 'aext', 'id']

export const FILTER_OPS: string[] = ['<', '<=', '>', '>=', '=', '!=', '^=', '$=', '*=', '~=']

/** Every long flag across every group, for lookup by name. */
export const ALL_FLAGS: FlagDef[] = GROUPS.flatMap((g) => g.flags)

export function findFlag(f: string): FlagDef | undefined {
  return ALL_FLAGS.find((flag) => flag.f === f)
}
