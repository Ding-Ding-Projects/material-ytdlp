# yt-dlp Studio

![status](https://img.shields.io/badge/status-in%20development-yellow)
![platform](https://img.shields.io/badge/platform-Windows-blue)
![license](https://img.shields.io/badge/license-Unlicense-lightgrey)
![build](https://img.shields.io/badge/build-Squirrel.Windows-informational)
![signed](https://img.shields.io/badge/code%20signing-none%20(intentional)-orange)

A Material Design 3 desktop application for [yt-dlp](https://github.com/yt-dlp/yt-dlp) on
Windows. yt-dlp Studio gives yt-dlp's enormous flag surface a guided, searchable interface —
Easy mode for a one-click download, Expert mode for every option grouped and explained, and
Plain mode for typing raw arguments — plus a queue, a live console with error-repair wizards,
and a companion browser extension.

**Nothing to install but the app.** yt-dlp is compiled from pinned upstream source at build
time, and ffmpeg is compiled from the FFmpeg source tree. Both ship inside the installer. No
Python, no PATH setup, no hunting for an ffmpeg build.

- Documentation: see [`docs/`](docs/README.md) for the full feature index.
- Design reference: see [`design/`](design/) and [`design/HANDOFF.md`](design/HANDOFF.md).

## Every feature

Screenshots for each are in the [gallery](#screenshot-gallery) below. Anything not yet built is
listed in [Not built yet](#not-built-yet) rather than quietly omitted.

### Downloading

| Feature | What it does |
| --- | --- |
| **Easy mode** | Paste a URL, pick a folder, press Download. Quality, subtitles and thumbnail switches, nothing else in the way. |
| **Expert mode** | All **16 option groups and 250 flags** from yt-dlp's own documentation, each rendered as the right control — switch, text, slider, select, date, path or chips — with its real help text. |
| **Plain mode** | A raw argument box for when you already know exactly what you want. |
| **Live command preview** | The exact arguments that will be spawned, updating as you change anything. |
| **Argument-array execution** | The command is passed as an array, never through a shell, so a URL can never be interpreted as one. |
| **Real progress** | Parsed from `--progress-template` and aggregated across fragments, not scraped off the human-readable bar. |
| **Queue** | Multiple jobs with per-job state, cancel, retry and remove. |
| **Live console** | Real stdout and stderr, with errors and warnings marked. |
| **Honest pause** | Windows has no `SIGSTOP`, so the control reads *Stop (resume continues the file)* and resumes with `--continue` rather than pretending to suspend a process. |

### What is inside the installer

| Feature | What it does |
| --- | --- |
| **yt-dlp built from source** | Compiled from the pinned `vendor/yt-dlp` submodule with PyInstaller during the build. Not downloaded, not a binary of unknown provenance. |
| **ffmpeg built from source** | Compiled from the pinned `vendor/ffmpeg` submodule. An **LGPL** build: `--enable-gpl` is never passed and `--enable-nonfree` never will be. |
| **Dependencies track upstream** | Both submodules follow `master` and are advanced on every pull, because yt-dlp breaks when a site changes and is fixed upstream within days. |
| **Build provenance in every release** | Release notes carry the yt-dlp version, the exact submodule commit it was built from, and the SHA-256 of both the binary and the installer. |
| **One-click builds** | `build.bat` and `build-installer.bat` install every dependency themselves, from a bare Windows machine, with a silent `/s` mode. |

### Interface

| Feature | What it does |
| --- | --- |
| **Material Design 3** | Tokens, typography, shape and elevation throughout, on a dark teal palette. |
| **Frameless window** | A custom Material title bar rather than the operating system's default chrome. |
| **Navigation rail** | Destinations down the left, with unbuilt ones plainly labelled as unbuilt. |
| **Catalog drift guard** | A test fails the build if the shipped option catalog and the design reference ever disagree — verified by breaking it on purpose and watching it go red. |

### The site

| Feature | What it does |
| --- | --- |
| **Landing and documentation site** | Fully self-contained: no CDN, no remote fonts, no analytics, nothing fetched at page load. |
| **Command planner** | Composes a real yt-dlp command from form inputs, with copy-to-clipboard and a graceful fallback. |
| **Page search with a regex builder** | Plain text by default, regex as an explicit opt-in, with an anchored builder popover. |
| **Light and dark themes** | Follows the system by default, with a toggle that persists. |
| **Genuinely mobile** | Verified at 375px: no off-screen controls, a 57px header, no sideways scroll. |

## Committed but not built yet

Everything below is a real commitment with a roadmap row, **not a claim about the current
build**. None of it ships today. It is listed in full because an absence that reads as a
decision is better than one that reads as an oversight — and because this is the standard every
surface in the project is eventually held to. See [`ROADMAP.md`](ROADMAP.md).

### Language and voice

| Planned | What it will do |
| --- | --- |
| **Three language modes** | English, playful Hong Kong Cantonese, and a bilingual mode showing both without crowding the layout. |
| **Two playfulness sliders** | One per language, 1 (fully serious) to 5 (maximum playfulness), wired to the copy the app actually renders. Voice changes; the facts never do — a warning still names exactly what will happen at every level. |
| **Emoji toggle** | Decorative emoji in dialogs and message boxes, on or off, never inside button or control labels. |
| **Spoken narrator** | Text-to-speech for app events, **off by default**, with per-language voice, rate and pitch selection, a serialised queue so lines never overlap, and deference to an active screen reader. |

### Accessibility and focus

| Planned | What it will do |
| --- | --- |
| **ADHD modes** | Five independent toggles — Focus, Low stimulation, Time awareness, One thing at a time, Momentum — all off by default. Interface accommodations, never medical claims, and never scolding copy, streaks or scores. |
| **School mode** | One shared switch that hides the playful capabilities across every app at once, renameable by the user, and unlocked with a locally verified credential. A user-experience lock, not a security boundary, and it says so. |
| **Unlock ladder** | Locked out? Play your way out: identify a dim sum dish, then ten quick sums, then whack-a-mole. It clears the *waiting*, never the credential — you still need your password — and it is budgeted so it can never become a cheaper brute force. |

### Customisation

| Planned | What it will do |
| --- | --- |
| **Per-element appearance editor** | Right-click any rendered element and restyle it: word-processor-depth typography, every installed font, spacing, shape, elevation and state. |
| **Infinite colour picker** | A continuous spectrum with numeric entry, plus a translator converting between HEX, RGB, HSL, HSV, HWB, CIELAB, OKLCH and CMYK, with contrast readouts — and an animated rainbow option. |
| **Rename the app** | Change the name the app calls itself. Display only: the data directory, installer identity and update feed never move. |
| **App-mark customisation** | Swap the application mark for shipped presets or your own image, converted locally with no upload. |
| **Themes, density, scale** | Light and dark, density, accent colour, font family and size, corner radius, reduced motion — all persisted, exportable and importable. |
| **Scheduled settings** | Put any of the above on a schedule, or drive it from a local API or a Home Assistant switch. |

### Getting around

| Planned | What it will do |
| --- | --- |
| **Command palette** | `Ctrl+Shift+F` opens every command, page and setting, with live controls inline in the results and teleport-with-highlight to the exact element. |
| **Browser-style tabs** | Dockable to any edge (left by default), with overflow, reordering, pinning, groups, and four separate tab searches. |
| **Regex builder on every search** | Every search field, dropdown and right-click menu gets a filter with an anchored regex builder beside it. Plain text stays the default. |
| **Guided forms** | Pickers populated from real data instead of empty boxes, and every disabled control names the exact condition it is waiting on. |

### Your data

| Planned | What it will do |
| --- | --- |
| **Local version history** | A local Git-backed history of the download list and every setting, with a day-grouped manager, a diff inspector, restore points and rich filters. Restoring is itself a new entry, so an undo can be undone. |
| **Export everything** | Every list and record exportable as JSON, JSONL, YAML, TOML, XML, CSV, TSV, Markdown, HTML and SQL, plus ZIP and 7z archives with the full 7z option surface. |
| **Bulk actions everywhere** | Multi-select, range select, honest select-all, inverse selection, and every single-item action available in bulk with a reviewable preview first. |
| **Built-in authenticator** | Standards-compliant TOTP with QR pairing, generated locally with no network call, secrets held in the operating-system credential vault. |
| **Per-element toy locks** | Lock any element behind its own password or one-time code. Explicitly for fun, not security, and it tells you exactly how to recover. |
| **File converter** | A local converter with a categorised adapter catalog, honest disclosure of what each conversion loses, and an unlimited queue that never loads every file into memory. |
| **Local model suite** | Manage locally installed Ollama models, with conservative hardware-fit verdicts backed by evidence rather than guesses. |

### Everywhere else

| Planned | What it will do |
| --- | --- |
| **Non-blocking notifications** | Corner toasts with a reviewable history. Modals reserved for decisions you must actually make. |
| **Two-key destructive gate** | Anything irreversible needs two independent keys and a full-range slider before it will run. |
| **Changelog viewer** | Every released version in-app, with a date picker, search and a link to the commit behind each entry. |
| **Automatic updates** | Chrome-style background updates with a non-blocking ready banner, honest about the artifacts being unsigned. |
| **Companion browser extension** | Popup, injected page controls, and an options page, with real download start, progress and completion surfaces. |
| **Automated tests** | This build ships with **none**, by decision, and the records say so everywhere rather than implying coverage that does not exist. |

## Screenshot gallery

<!-- HUISHOT-GALLERY -->
Every image below is a capture of the **real packaged application**, launched from a fresh profile
on an off-screen desktop. None is a mockup, a design export, or a hand-edited image. Where a number
cannot be true yet on a fresh profile — a download count, a history size — the app shows a dash
rather than inventing a plausible-looking figure; several captures below show that dash on purpose.

<details open>
<summary><b>Downloading</b> — Easy mode, the Expert queue, and Plain mode's raw command</summary>

![Easy mode on a fresh profile: an empty link field, a "Waiting for a link" card, quality presets from best-available through 4K, 1080p, 720p, small-file and audio-only, a save-to path with a browse control, and subtitle, cover-art and skip-sponsors switches. The exact yt-dlp command is previewed underneath, and the status bar reads zero active, zero queued, zero failed.](site/screenshots/01-easy-mode.png)
Easy mode: paste a link, pick a quality, and watch the real yt-dlp command build itself underneath.

![Expert mode's Download tab: an intake box for URLs, batch files or --load-info-json dumps, quick chips for mp3/aac/mp4/mkv/sleep presets, a session panel with active/queued/failed counters and a dash for total rate, per-flag concurrent-fragments/limit-rate/downloader/archive fields, and an empty queue and console each with their own search field.](site/screenshots/02-download-queue.png)
Expert mode's Download tab: the intake box, the session panel, and the queue and console, each independently searchable.

![Plain mode: a bare command textbox holding a full yt-dlp invocation, a scrollable user-configuration panel below it showing the -f, --merge-output-format, -o, -N, -r and other flags as plain text, an empty output pane, and a single Run button — no wizards or pickers anywhere on the screen.](site/screenshots/21-plain-mode.png)
Plain mode: no wizards, no pickers — just the command and the config exactly as you'd type them in a terminal.

</details>

<details>
<summary><b>Expert options</b> — per-flag groups, the format explorer, and a flag's own guide</summary>

![The Video Format options group: a "Search this group" field showing 16 of 16 flags, and rows for -f/--format, -S/--format-sort, --format-sort-reset, --format-sort-force, --no-format-sort-force, --video-multistreams and --no-video-multistreams, each with an info icon, a help line, and either a value field or an on/off toggle.](site/screenshots/03-expert-video-format.png)
The Video Format group: every format-selection flag, searchable, with live values and toggles.

![The Post-Processing options group showing 37 of 37 flags: -x/--extract-audio, --audio-format, --audio-quality, --remux-video, --recode-video, --postprocessor-args and -k/--keep-video, each with its own help text, value field, dropdown or toggle.](site/screenshots/04-expert-post-processing.png)
The Post-Processing group: audio extraction, remuxing, recoding and postprocessor arguments, all in one searchable list.

![The Format explorer tab: an -f selector field building "bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/b", clickable selector-syntax tokens like bv*, ba, [height<=1080] and (bv+ba/b), an -S sort-order field with clickable sort fields such as res, fps, hdr and vcodec, and a list of named format recipes (Best video + best audio, Best mp4 else best video, Smallest video available) that apply with one click.](site/screenshots/05-formats.png)
The Format explorer: build an -f/-S expression from clickable tokens, or start from a named recipe.

![A "Picture quality" flag-guide popover anchored beside the --format flag: a plain question "How good should the picture be?", a searchable list of choices — The best there is, Very sharp (4K), Sharp (1080p) selected with a check mark, Normal (720p), Smallest file, Sound only — each with an icon and a one-line consequence.](site/screenshots/27-flag-guide-popover.png)
Every flag's info icon opens a plain-language guide like this one, translating --format into a question anyone can answer.

</details>

<details>
<summary><b>Output, library and processing</b> — filename templates, the archive, and the postprocessor chain</summary>

![The Output template studio: an -o template field reading "%(uploader)s/%(playlist|)s/%(title)s [%(id)s].%(ext)s", a live filename preview showing a real resolved path and a matching .part temp-file path, quick-insert chips for default/thumbnail/description/subtitle/infojson/link/chapter, and a searchable panel of 120+ template fields grouped under Identity, People, Time and Counts.](site/screenshots/06-output.png)
The Output template studio: compose -o against every template field, with a live filename preview.

![The Library and archive tab on a fresh profile: a search field reading "0 of 0 files · – archive ids", and an otherwise empty panel — no seeded downloads, no invented history.](site/screenshots/07-library.png)
Library and archive on a fresh profile: genuinely empty, with a dash where a count can't be true yet.

![The Config files tab: a left list of Portable, Home, User and System config file locations plus --config-locations, with User selected; a right panel titled User configuration listing numbered flag rows (-f, --merge-output-format, -o, -N, -r) each with a toggle, value field and remove button, a note that later files override earlier ones, and an Effective configuration panel merging every file.](site/screenshots/09-config.png)
Config files: every config file yt-dlp would read, the merge order, and the effective result of stacking them.

![The Processing chain tab: a left column listing every postprocessor stage in run order — pre_process, after_filter, video, before_dl, post_process (with Merger, ExtractAudio, VideoRemuxer, EmbedThumbnail and more), after_move, after_video and playlist — and a right column of configured --exec hooks (after_move, after_video, playlist) plus a --postprocessor-args entry for Merger.](site/screenshots/10-chain.png)
The Processing chain: every yt-dlp postprocessor in the order it actually runs, with --exec hooks attached to each stage.

![The SponsorBlock (Segments and chapters) tab: a searchable list of categories — sponsor, intro, outro, selfpromo, preview, filler, interaction, music_offtopic, hook, poi_highlight, chapter — each with off/mark/remove buttons showing the current per-category policy, plus a chapter-title template field and a --sponsorblock-api endpoint field.](site/screenshots/11-sponsorblock.png)
SponsorBlock: per-category mark-or-remove policy, the chapter title template, and which API serves the timings.

![The Presets and aliases tab: rows for the built-in -t presets — mp3, aac, mp4, mkv, sleep, archive — each showing the exact flags it expands to (for example -t sleep expands to --sleep-subtitles 5 --sleep-requests 0.75 --sleep-interval 10 --max-sleep-interval 20) with an Apply button.](site/screenshots/12-presets.png)
Presets and aliases: the built-in -t shortcuts from the README, each showing exactly what it expands to.

</details>

<details>
<summary><b>Getting around</b> — search, the command palette, history, notifications and tab menus</summary>

![The collapsible left rail filtered by typing "hist": only the History destination remains visible under a CLI groups heading, with the filter field showing a small clear-filter icon.](site/screenshots/13-rail-filter-history.png)
The navigation rail has its own filter — type a few letters and everything else drops out.

![The History tab: a header reading "1,247 records · 482 KiB on disk · since 3 May 2026", a Live toggle, a searchable field, a row of category chips (All, HISTORY, Every kind, Changes, Runs, Errors, Destructive, Pinned only), a day-grouped timeline bar, one record for the current day reading "Started download history", the on-disk history.jsonl path, and Keep/Compact controls.](site/screenshots/14-history.png)
Local history: every state-changing action the app took, append-only, searchable, and exportable.

![A Notifications dialog: a heading explaining that every notice — finished downloads, warnings, wizard results — is kept in a local file that can be searched, exported and cleared, with nothing ever sent to a server; a search field, and Clear history and Close buttons.](site/screenshots/22-notifications.png)
The notification centre: every toast the app ever raised, searchable and reviewable after it disappears.

![The global search box in the title bar containing the text "format", with a placeholder reading "Search flags, jobs, sites, config, history" and a small .* regex toggle beside it.](site/screenshots/23-global-search.png)
Global search reaches flags, jobs, sites, config and history from one box in the title bar.

![A Pattern builder popover anchored below the global search box: an explanatory line that a pattern describes the shape of text rather than exact text, a live pattern field showing "(?i)\b(4k|2160p)\b", a building-block search field, and button groups for "Match one thing" (., \d, \w, \s, [abc]…), "How many" (+, *, ?, {2,4}), "Where" (^, $, \b, \B) and "Grouping" ((_), (?:_), |, (?&lt;name&gt;_)).](site/screenshots/24-regex-builder.png)
The regex builder anchored to the search box: build a pattern from labelled blocks instead of memorising syntax.

![The command palette dialog, opened with Ctrl+Shift+F: a keyboard-route hint, an explanation that it covers every surface, flag, setting and action and that rows with a live control can be changed right there, a search field, and result rows for Easy mode, Download queue, Language mode, English funny level, Cantonese funny level and Theme — several carrying live dropdowns and sliders inline.](site/screenshots/25-command-palette.png)
The command palette (Ctrl+Shift+F): search every surface and setting at once, and change the ones with live controls right from the result row.

![The command palette filtered to "sponsor", showing a single result: "SponsorBlock options — 5 flags · Mark or remove sponsor, intro, outro and other segment".](site/screenshots/26-command-palette-search.png)
Palette results narrow instantly and name exactly what picking one will do.

![A right-click context menu on the Video Format tab: Pin tab, Duplicate tab, Search open tabs (Ctrl+Shift+A), Move to group, Close tab (Ctrl+W), Close other tabs, Close tabs to the right, Lock this element, Edit appearance, Export this element, and Find in the command palette.](site/screenshots/28-tab-context-menu.png)
Every tab's context menu: pin, duplicate, group, close, lock, re-skin or export it, or jump straight to it in the palette.

</details>

<details>
<summary><b>Settings and safety</b> — language, appearance, personal vocabulary, the app mark, and Support Tickets</summary>

![The Settings tab: rows for Language mode (English), Narrator language, Optional narrator, English funny level (a slider at 2) and Cantonese funny level (a slider at 3), Emoji in notices, School mode, ADHD mode, Theme (Dark) and Follow system settings — each with an info icon and a one-line explanation.](site/screenshots/15-settings.png)
Settings: language mode, both funny-level sliders, School and ADHD modes, and theme — all explained inline.

![Settings filtered to "vocabulary": a single Personal vocabulary row reading "No file loaded — original wording is shown everywhere. Upload a local JSON dictionary to replace it." with an Upload JSON button.](site/screenshots/16-settings-vocabulary.png)
Personal vocabulary: nothing is invented until you supply your own local JSON file — the app says so plainly when none is loaded.

![Settings filtered to "app mark": a single App mark row reading "Using the shipped app mark. Replace it with your own PNG — title bar and tray only." with a Choose image button.](site/screenshots/17-settings-app-mark.png)
The app mark can be swapped for your own image — scoped honestly to just the title bar and tray icon.

![A Support tickets dialog: a heading explaining plainly that this is a local joke and not a real help desk — nothing is ever sent anywhere, no ticket exists outside this computer, no network request is made, and nobody is reading it; a Category dropdown set to General, a "What went wrong" textarea, and Cancel, Open data folder and File ticket buttons.](site/screenshots/18-support-tickets.png)
Support Tickets: a recovery flow dressed as a help desk, that tells you outright it's a joke and just opens your data folder.

</details>

<details>
<summary><b>Documentation and supported sites</b> — the in-app docs browser and the extractor catalogue</summary>

![The in-app Docs tab on "Getting started": a contents list down the left (Getting started, The three modes, Choosing a version, File names, Private and paid videos, When something fails, Keeping your settings, Getting around, Old flags that still work, Per-site extractor arguments, What changed) and cards on the right walking through pasting a link, picking a quality, pressing Download, and the "every setting explains itself" info-icon convention, with a Save as PDF button.](site/screenshots/19-docs.png)
The in-app documentation browser: every feature explained offline, searchable, exportable as a PDF.

![The Docs tab on "What changed": a heading, and a "No releases yet" notice stating plainly that this build has not shipped a release, that nothing is invented to fill the gap, and that once a real GitHub Release is published its notes will appear on this page automatically.](site/screenshots/20-what-changed.png)
What changed: an honest empty state rather than an invented changelog — this is what "no release yet" actually looks like.

![The Supported sites tab: a searchable extractor list with a "Send to --use-extractors" button and cards for youtube, youtube:tab, youtube:search, twitch:vod, twitch:stream, vimeo, soundcloud, bandcamp, BiliBili, niconico, nebula, crunchyroll, generic, ARDBeta Mediathek, TVer, dailymotion, facebook, instagram, reddit, tiktok, twitter, archive.org, peertube and rumble, each with the kind of link it accepts.](site/screenshots/08-sites.png)
Supported sites: yt-dlp's real extractor list, searchable, with each extractor's accepted argument syntax alongside it.

</details>

<!-- /HUISHOT-GALLERY -->

## Quick start

```bat
:: builds a runnable app in the checkout
build.bat

:: builds the distributable Windows installer
build-installer.bat
```

Both scripts install every dependency they need themselves and support a silent `/s` mode for
unattended use. See [`docs/features/build-and-packaging/`](docs/features/build-and-packaging/README.md).

<details>
<summary><b>What it does</b></summary>

- **Easy mode** — paste a URL, pick quality and destination, download.
- **Expert mode** — every yt-dlp CLI option (~250 flags across 16 groups), searchable, with
  plain-language help for each one and a live command preview.
- **Plain mode** — a raw argument editor for people who already know the flags they want.
- **Queue** — batch downloads with per-item progress parsed from yt-dlp's
  `--progress-template` output, pause/resume, retry, and reordering.
- **Console** — live stdout/stderr with color-coded lines; errors surface a guided repair
  wizard matched against known yt-dlp failure patterns.
- **Companion extension** — a Chrome extension that hands the current page's video URL to the
  desktop app, with its own popup, injected page controls, and options page.

</details>

<details>
<summary><b>The bundled-binaries story</b></summary>

`vendor/yt-dlp` is the official yt-dlp source, pinned as a git submodule at a fixed commit and
version. The build compiles a Windows executable from that source with PyInstaller and bundles
it into the installer alongside pinned `ffmpeg.exe`/`ffprobe.exe` builds. Nothing is downloaded
at runtime and nothing needs to be pre-installed by the user. See
[`docs/features/build-and-packaging/bundled-binaries.md`](docs/features/build-and-packaging/bundled-binaries.md)
and
[`docs/features/build-and-packaging/building-yt-dlp-from-source.md`](docs/features/build-and-packaging/building-yt-dlp-from-source.md).

</details>

<details>
<summary><b>Architecture</b></summary>

- **App shell:** Electron + Vite + React 19 + TypeScript.
- **Process layer:** the Electron main process spawns the bundled `yt-dlp.exe` with an argv
  array built from the selected flags, and parses its `--progress-template` output into
  structured job state rather than scraping the human-readable progress bar.
- **Packaging:** Squirrel.Windows (`Setup.exe`, `RELEASES`, full `.nupkg`, delta packages).
  Code signing is permanently out of scope for this project; installers are unsigned and will
  trigger the Windows unknown-publisher warning. See
  [`docs/features/build-and-packaging/squirrel-packaging.md`](docs/features/build-and-packaging/squirrel-packaging.md).
- **Design reference:** the `design/` folder holds the checked-in Claude Design export that the
  interface is being wired against — see
  [`docs/features/design-reference/design-reference-parity.md`](docs/features/design-reference/design-reference-parity.md).

</details>

<details>
<summary><b>Project status (read this before assuming anything is finished)</b></summary>

This repository is under active development. The design reference, the yt-dlp submodule pin,
and the Electron/Vite/React scaffold are in place. The build scripts, the main-process
integration with yt-dlp, and the renderer wiring for the flag catalog, queue, and console are
in progress. A large list of features described in the design reference — language modes,
narrator, School mode, the command palette, browser-style tabs, the appearance editor, the
local-AI suite manager, and more — are **not yet implemented**. See
[`ROADMAP.md`](ROADMAP.md) for the authoritative checklist and
[`docs/completeness-inventory.md`](docs/completeness-inventory.md) for the per-feature status
table.

**This pass shipped without an automated test suite and without screenshot/capture evidence,**
on the maintainer's explicit instruction, in order to ship quickly. See
[`HANDOFF.md`](HANDOFF.md) for the exact, honest verification status of everything in this
repository. Nothing in this README, in `docs/`, or in release notes should be read as claiming
a test passed or a screenshot was taken unless it says so explicitly.

</details>

<details>
<summary><b>Screenshots</b></summary>

Screenshots of the built application are pending. Real captures from the running application
will be added here once a build exists to capture. Until then, see the design reference files
in [`design/`](design/) for the intended interface — those are design exports, not captures of
the running app, and are labeled as such.

</details>

<details>
<summary><b>Size of the project, and how long a person would have taken</b></summary>

Counted by the committed counter, `node scripts/count-lines.mjs`, which is the same script the
release workflow runs. Vendored code, dependencies, build output and lockfiles are excluded, so
these are lines belonging to this project.

| Area | Total lines |
| --- | ---: |
| Design references (the transcribed option catalog and design components) | 7,720 |
| Site, build scripts and root files | 2,950 |
| Application main process | 978 |
| Application renderer | 443 |
| Scripts | 418 |
| Documentation | 347 |
| Application (other) | 310 |
| Workflows | 185 |
| Application preload | 138 |
| **Total** | **13,489** |

### How long would a human have taken?

**Roughly three to six months of full-time work for one experienced developer.**

That is an **estimate**, not a measurement. Nobody built this by hand, so there is no real figure to
report — what follows is the arithmetic it came from, so you can disagree with the assumptions
rather than with the conclusion:

- **Implementation code — about 5,769 lines** (the total above, less the design references). At a
  sustained **50 to 100 lines per day** for production code including design, debugging,
  documentation and rework — not the burst rate anyone hits on a good afternoon — that is
  **58 to 115 working days**.
- **Design reference catalog — 7,720 lines.** This is largely transcription: roughly 250 yt-dlp
  options with their help text, read out of upstream documentation. Transcription runs far faster
  than authored logic, so at **400 to 800 lines per day** it is **10 to 19 working days**.
- **Together: 68 to 134 working days**, which at five days a week is about **14 to 27 weeks**.

The range is wide on purpose. A single figure would imply a precision this kind of estimate does not
have, and the honest answer to "how long is this" is a range with its workings shown.

</details>

<details>
<summary><b>Contributing, security, license</b></summary>

See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md),
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and [`AGENTS.md`](AGENTS.md) (engineering rules for
contributors and agents working in this repository). Licensed under
[The Unlicense](LICENSE), matching yt-dlp's own license choice.

</details>
