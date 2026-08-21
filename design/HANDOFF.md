# Handoff — wiring yt-dlp Studio

Two design files, both self-contained Design Components. Nothing here talks to a real
process yet: every action calls a local handler that raises a toast. Wiring means replacing
those handlers with IPC calls.

| File | What it is |
| --- | --- |
| `yt-dlp Studio.dc.html` | The desktop application: three modes, 20 rail destinations, every CLI option |
| `yt-dlp Companion (Chrome).dc.html` | The browser extension: popup, injected page controls, options page |
| `ytdlp-flags.js` | The option catalog — 16 groups, ~250 flags, help text transcribed from `README.md` lines 306–1184 |

## Shape of the design

`ytdlp-flags.js` exports `GROUPS` (each `{id, label, glyph, blurb, flags[]}`) plus `PRESETS`,
`TEMPLATE_FIELDS`, `OUTPUT_TYPES`, `SORT_FIELDS`, `FILTER_OPS`. A flag entry is
`{f, s?, a?, t, h, d?, o?, rx?}` — long flag, short flag, argument placeholder, control type,
one-line help, default marker, enum options, and whether it takes a regular expression.
`glyph` values are Material Symbols ligature names, not characters.

The logic class holds all state; there is no store and no router. The pieces worth knowing:

- `state.values` — the flag map that produces the command line. `expertCommand()` serialises it.
- `state.confLines` — the structured config editor rows. `configBody` serialises them back to text.
- `state.mode` — `easy` | `expert` | `plain`. `state.view` selects the expert surface.
- `controlFor(flag, def)` — decides which control a flag gets (switch, slider, select, date, path, chips).
- `optionCatalog(flag)` — searchable dropdown options with plain-language descriptions.
- `repeatable(flag)` — flags that open the list editor, with their WHEN/TYPE prefixes.
- `guideFor(flag)` — the hand-written plain-language wizard for a flag.
- `helpGuide(flag, def)` — `guideFor` or a generated fallback; this is what the ⓘ icon opens.
- `surfaceFor(flag)` — which full surface a value can also be built on.
- `wizardDefs()` — error-pattern → stepped repair, matched against extractor output.

## What the host has to provide

Replace each handler below with a call across the IPC boundary. Names are the current
`renderVals` keys, so they are greppable.

**Process control** — `runCommand`, `plainRun`, `easyDownload`, `enqueue`, `simulateRun`,
`togglePause`, and each job's `retry` / `remove`. The host spawns yt-dlp with the argv that
`expertCommand()` (or `easyCommand()`) already produces, and streams progress back.

**Progress** — the fake interval in `componentDidMount` bumps `jobs[].pct`. Delete it and feed
real values into `state.jobs`; rows read `pct`, `rate`, `size`, `eta`, `frags`, `state`.
Parse them from `--progress-template` rather than scraping the human-readable bar.

**Console** — `state.log` is an array of `[text, color]`. Append parsed stdout/stderr lines.
Any line matching `/ERROR|WARNING/` grows a ⚑ Fix button that runs `openWizard(text)`, so the
wizard system needs nothing beyond real log text.

**File and folder pickers** — every `browse` handler and `pickBatch` / `pickInfoJson` /
`browseFolder`. Return a path string; the caller writes it straight into the flag value.

**Cookies and sign-in** — `openLogin` opens the embedded browser mock; `finishLogin` is where a
real implementation writes a Netscape cookie jar and sets `--cookies`. The status bar reads
`state.loginCookieCount`.

**Config files** — `configFiles` lists the five standard locations; `saveConf` and `exportConf`
must write to the selected one. `validateConfig` currently checks only for missing values;
back it with a real parse.

**Authenticator** — already real. `totpCode()` derives codes with WebCrypto from a base32
secret, refreshed every second by `refreshTotp()`. Only the credential storage is missing:
put the secret in the OS credential vault, not in renderer state.

**Toy locks** — `state.locks` accumulates `{target, method, duration}`. Persist each credential
separately in the OS vault, never shared between elements. The recovery path shown in the
wizard names `%APPDATA%\yt-dlp-studio`; make that the real application-data folder.

**Preferences** — `state.prefs` (language mode, funny levels, theme, density, font, scale,
weight, radius, reduced motion) currently drives only the shell. Persist it locally and
version it. `state.dock`, `railW`, `railH`, `railX`, `railY` hold the navigation rail position.

**Updates** — the banner is static. Wire it to the Squirrel.Windows feed; keep the
unsigned-artifact wording, since the build is deliberately unsigned.

## House rules this design already follows

Search field with a `.*` regex builder on every list, dropdown and context menu. `Ctrl+Shift+F`
command palette with live controls in the results and teleport-with-glow to the exact element.
Browser-style tabs with groups and preview-then-authorize closing. Per-element **Edit
appearance** and **Lock this element…** on every context menu. Two-key plus slider gate before
anything destructive. Notification centre. Export in every listed format. Local history of
state changes.

Product copy uses ordinary words. Keep the private vocabulary out of anything a user can see.

## Contract feature inventory (both surfaces)

Studio and Companion each independently carry: language mode + narrator (language, toggle), both
funny levels, emoji switch, School mode, ADHD mode, quiet-hours schedule, follow-OS settings,
theme/density/scale/weight/radius, reduced motion, regex builder on every search, notifications,
per-element Edit appearance and toy locks (enforced: a locked element's context menu offers only
unlock + recovery; unlock reuses the lock popover in unlock mode), two-key + slider destructive
gate, local history (Studio: full manager — day grouping, diff inspector, restore points, bulk
select/export/delete, retention; Companion: keep/export/clear rows), changelog ("What changed"
docs page / options action), export format + Export all, external-editor handoff, personal-
vocabulary JSON upload, app-mark customization, support tickets (local), dim-sum surprise, local
AI (Ollama suite select), and the Companion's download start/progress/completion surface in the
popup. Legacy yt-dlp aliases are documented in Docs → "Old flags that still work".

## Traps

- Icons are ligatures. `<i class="msym">settings</i>` — a literal glyph character breaks the set.
- Controls are mutually exclusive per row. A flag with a guide must not also render a slider;
  gate every `is*` branch on `!guide` the way `configLines` and `groupFlags` do.
- Anchored popovers must clamp their top against their own height (`studioTop()`), or the
  footer lands below the fold on short windows.
- `<select>` needs the current value first in its option list (`optionList()`), otherwise React
  falls back to the first option before the children mount.
- Inline styles only. No stylesheet, no classes beyond `.msym`.
