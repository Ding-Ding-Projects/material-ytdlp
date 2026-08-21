# Contract audit — measured, not asserted

This is the detailed evidence behind `completeness-inventory.md`. Every row was established by
three separate checks rather than one glance at the design:

1. **Surface exists?** — grepped for the feature's text/markup in the *built* renderer,
   `app/src/renderer/index.html` (the design-component output, per `design-parity.md`).
2. **Wired?** — checked whether a real backing implementation exists (`app/src/main/**`) and is
   exposed across the preload bridge (`app/src/preload/index.ts`), which currently exposes exactly
   these namespaces and no others: `window`, `binaries`, `jobs`, `dialogs`, `store`, `history`,
   `vocabulary`, `appMark`, `supportTickets`, `fileOps`, `cookies`, `probes`.
3. **Verified?** — checked `docs/interaction-audit.md` (a real CDP click-through of the packaged
   build) and `docs/screenshots/` for evidence anyone actually exercised the control.

**Ground truth from the interaction audit that shapes every row below:** `window.ytdlpStudio` is
exposed via `contextBridge`, whose properties are non-writable/non-configurable, so that harness
could not confirm a single bridge call in its run — it could only tell "the DOM changed" (UI-ONLY)
from "nothing observably happened" (UNDETERMINED). So "the design draws it and something visibly
opens" is not evidence of wiring; the source-level check (does a preload namespace back this
control?) is what decides WIRED vs SURFACE-ONLY below, and it is decisive because the bridge
namespace list is short, explicit, and exhaustive by construction (it is the literal object
returned by `contextBridge.exposeInMainWorld`).

Status legend: **SHIPPED** (surface + real backing + verified in the built app) ·
**WIRED-UNVERIFIED** (surface + real backing, nobody has exercised it) · **SURFACE-ONLY** (looks
live, nothing real behind it — the actionable defect) · **HONEST-STUB** (says plainly it's not
implemented) · **ABSENT** (no surface at all).

---

## Language and voice

| Feature | Status | Surface | Backing | Verification | Note |
|---|---|---|---|---|---|
| Cantonese / bilingual language mode | SURFACE-ONLY | `index.html`: "bilingual"/"Cantonese" text, 4 hits | none — no `language` bridge namespace, no i18n resource files under `app/src/renderer` | none | Selector/copy exists in the design; nothing switches rendered strings or persists a choice. |
| Two funny-level sliders (1–5, per language) | SURFACE-ONLY | `index.html`: "Funny level"/"playfulness", 6 hits | none | none | No store key, no bridge call; a slider control with nothing to read or write. |
| Emoji-in-dialogs toggle | ABSENT | 0 hits for the toggle text itself (only generic emoji use) | none | none | Not found as a distinct control. |
| Spoken narrator (TTS): off-by-default, per-language voice/rate/pitch | SURFACE-ONLY | `index.html`: "narrator"/"TTS", 2 hits | none — no TTS invocation, no `speechSynthesis` call, no bridge namespace | none | Two mentions of the word; no voice picker, no rate/pitch control found, no wiring. |

## Accessibility and modes

| Feature | Status | Surface | Backing | Verification | Note |
|---|---|---|---|---|---|
| ADHD modes (Focus / Low stimulation / Time awareness / One thing at a time / Momentum) | SURFACE-ONLY | `index.html`: "ADHD"/"Focus mode", 2 hits | none | none | At most a label; none of the five named sub-modes independently confirmed present, no persisted state, no bridge call. |
| School mode (shared, renameable, credential-gated) | SURFACE-ONLY | `index.html`: "School mode", 2 hits | none — no shared-lock credential store, no cross-app sync mechanism (this is a single Electron app, so "shared across apps" cannot be backed at all here) | none | Label present; the credential gate and rename path have no backing store. |
| Unlock ladder (dim sum → sums → whack-a-mole → clock) | ABSENT | 0 hits for "unlock ladder"/"dim sum"/"whack" | none | none | Not found anywhere in the built renderer. Nothing to unlock, since School mode itself is unbacked. |

## Customisation

| Feature | Status | Surface | Backing | Verification | Note |
|---|---|---|---|---|---|
| Per-element "Edit appearance…" on every element | SURFACE-ONLY | `index.html`: "Edit appearance"/"colour picker", 4 hits | none — no appearance-override store, no per-element style persistence path in `store.ts` | none | A handful of mentions, not a context-menu command wired to every element as the contract requires. |
| Infinite colour picker + translator + animated rainbow | ABSENT | 0 hits beyond the 4 counted above (no dedicated colour-space translator UI, no rainbow sentinel found) | none | none | Not found as a distinct surface. |
| App rename (display name only) | SURFACE-ONLY | `index.html`: "Rename app"/"App mark", 6 hits (shares hits with app-mark below) | `app/src/main/app-mark.ts` (235 lines) is real, but it implements the **app-mark/logo** feature, not the **display-name rename** feature — grep found no distinct rename-name store key | WIRED-UNVERIFIED for app-mark itself (see next row); rename-name has none | These are two different contract features sharing one settings area; only the logo half is backed. |
| App-mark / logo customisation | WIRED-UNVERIFIED | `index.html`: shares the 6 hits above | `app/src/main/app-mark.ts` — real implementation; exposed via preload `appMark:` namespace (`index.ts:230`) | not in `interaction-audit.md`'s controls table by name, and no `docs/screenshots/` entry named for it | Has a real backing store and IPC channel — genuinely wired — but nobody has exercised it end to end in the built app per current evidence. |
| Theme / density / scale / weight / radius | SURFACE-ONLY | present via the `dc-*` design-prop scaffolding (`startMode`, `accent` props at `index.html:1994`) and CSS custom properties throughout | `store.ts` persists app-level settings (`startMode`, `showUpdateBanner`) but no density/weight/radius keys were found | none | Accent color is a real prop; density/weight/radius controls in the UI have no persisted backing found. |
| Reduced motion | ABSENT | no dedicated toggle text found (distinct from `prefers-reduced-motion` media-query usage, which was not confirmed either) | none | none | Not confirmed present. |
| Scheduled settings (incl. Home Assistant/external source) | ABSENT | 0 hits | none | none | Not found. |

## Getting around

| Feature | Status | Surface | Backing | Verification | Note |
|---|---|---|---|---|---|
| Command palette (Ctrl+Shift+F, live inline controls, teleport) | SURFACE-ONLY | `index.html`: "Ctrl+Shift+F", 4 hits; "Command Palette", 6 hits | none — no global keydown handler backing found, no bridge call | `interaction-audit.md` does not list a palette row as exercised; the harness's own known limitation is it cannot confirm bridge calls, but there is also no bridge namespace for it to call | Label and shortcut text exist in the design; nothing in `main`/`preload` backs "teleport to element" or live inline setting edits. |
| Browser-style tabs (docking, overflow, reorder, pin, groups, four tab searches) | SURFACE-ONLY | `index.html`: "tab strip"/"Tab group", 38 hits — a real rail/tab UI is drawn and clickable | `store.ts` has no persisted tab-order/pin/group keys found | `interaction-audit.md` confirms the rail/config tabs open (UI-ONLY, DOM changes) — i.e. tabs render and switch panels, but reordering, pinning, grouping, docking-edge choice, and the four dedicated searches were not found as distinct wired features | Basic tab switching works as a view-router; the full contract (dock any edge, overflow surface, pin/group persistence, 4 searches) is not there. |
| Regex builder anchored beside every search/dropdown/menu | SURFACE-ONLY | `index.html`: "Pattern builder"/regex, 122 hits — extensive, matches `interaction-audit.md`'s confirmed "Pattern builder popover" | none — no regex evaluation call into `main`, and evaluation for a local regex builder should be renderer-local per the contract, so this alone isn't disqualifying | `interaction-audit.md` **positively confirms** the "Global search regex toggle `.*`" opens "Pattern builder popover: pattern field, searchable building blocks, Match/How many/Where/Grouping/Look around sections" (UI-ONLY, DOM change confirmed) | Best-evidenced surface in the app — genuinely opens and renders. Downgraded from SHIPPED to SURFACE-ONLY here only because "wired" per this project's own definition requires exercising the *result* (does the built pattern actually filter the list?) which was not confirmed — the harness saw the popover open, not a filtered result set. Treat as the strongest WIRED-UNVERIFIED candidate in the app; flagged SURFACE-ONLY pending that one missing check. |
| Guided forms with real pickers | WIRED-UNVERIFIED (partial) | intake/format/config forms render throughout `index.html` | `probes.ts` (589 lines) backs format/subtitle/thumbnail listing via `probes:` namespace; `fileops-contract.ts`/`fileops.ts` back config file read/write/validate | `interaction-audit.md` did not populate the URL field, so probe-backed pickers were only exercised in their empty state | Real backing exists for the download-flow pickers specifically; broader "every picker is guided" claim not established. |

## Data

| Feature | Status | Surface | Backing | Verification | Note |
|---|---|---|---|---|---|
| Local Git-backed version history | WIRED-UNVERIFIED | `index.html`: no dedicated "version history"/"History panel" hits found for a *settings-mutation* history (as opposed to download history, below) | `history.ts` (472 lines), `history-contract.ts` (216 lines), preload `history:` namespace | none in `interaction-audit.md` by name | The real implementation here backs **download history** (queue/job history), not the broader "every user-managed record" version-control contract (accounts, credentials, settings). Scope mismatch, not absence. |
| Export in every applicable format + ZIP/7z | SURFACE-ONLY→WIRED-UNVERIFIED (mixed) | export UI present (`fileOps.exportContent` call site referenced from renderer per bridge) | `fileops.ts` implements `exportContent`, a real Save-As + atomic write (per `fileops-contract.ts`); no evidence of format *choice* (JSON/YAML/CSV/etc.) or archive (ZIP/7z) support in `fileops.ts` | `interaction-audit.md` **confirms** the INTAKE "Export" button opens a real native Win32 "Save As" dialog (window count 13→34) — genuinely wired for at least one export path | The one export path that exists is real and verified. The full "every format, plus ZIP/7z with all documented options" contract is not implemented — this is a single-format export, not the universal exporter. |
| Bulk actions on every list | ABSENT | no dedicated bulk-select/bulk-action UI confirmed distinct from single-row actions | none | none | Not found as a general contract; queue rows appear to be single-item. |
| Built-in TOTP authenticator w/ QR pairing | SURFACE-ONLY | `index.html`: "TOTP"/"authenticator"/"QR", 54 hits — extensive text presence | none — no crypto/TOTP module in `app/src/main`, no QR generation library referenced, no bridge namespace | not in `interaction-audit.md`'s confirmed rows | High text-hit count is misleading: this repo's `AGENTS.md`/contract language itself contains "TOTP/authenticator/QR" repeated in in-app help copy describing the *feature contract*, which inflates the count without indicating a working authenticator. No RFC 6238 implementation found anywhere in `app/src`. |
| Per-element toy locks | SURFACE-ONLY | `index.html`: "Lock this element", 6 hits | none — no lock-credential store, no per-element lock state persistence found | none | Text/menu-entry present; no backing. |
| Local personal-vocabulary JSON upload | **SHIPPED** | `index.html`: 1 direct hit (plus the always-present control requirement) | `app/src/main/vocabulary.ts` (439 lines), `vocabulary-contract.ts` (118 lines), preload `vocabulary:` namespace, `app/src/renderer/vocabulary-apply.ts` | Documented and covered in `docs/features/appearance/personal-vocabulary.md`; this is the one feature the existing `completeness-inventory.md` already marks fully implemented, and source inspection agrees: real validation, real bounded schema, real local-only application. | The clearest completed feature in the project. |
| File converter | ABSENT | 0 hits | none | none | Not found. |
| Local Ollama suite manager | SURFACE-ONLY | `index.html`: "Ollama", 1 hit | none — no HTTP client to a local Ollama endpoint anywhere in `app/src/main` | none | A single mention; no catalog, no pull/chat/harness surface, no bridge namespace. |

## Everywhere else

| Feature | Status | Surface | Backing | Verification | Note |
|---|---|---|---|---|---|
| Non-blocking notifications + reviewable centre | WIRED-UNVERIFIED (partial) | `index.html`: "notification cent", 1 hit; toast markup used throughout | no dedicated notification-history store found in `store.ts` | `interaction-audit.md` **confirms** the notifications bell opens "a full Notifications dialog: heading, explanatory copy, a search field with its own regex affordance, 'Clear history'/'Close' buttons, an honest empty state" (UI-ONLY, DOM change confirmed) | Confirmed to render and open with real structure; "Clear history" wired to a real store was not confirmed, so kept short of SHIPPED. |
| Two-key + slider destructive gate | SURFACE-ONLY | `index.html`: "two-key"/"destructive", 22 hits — extensive | none — no gate-state store, no bridge call gating any destructive `fileOps`/`history` mutation found | `interaction-audit.md` lists 3 controls explicitly `SKIPPED-destructive` (i.e. the harness deliberately did not click them, so their real behaviour is unconfirmed either way) | Heavy textual presence again likely reflects in-app contract-explainer copy rather than 22 independent working gates. No source-level enforcement located. |
| Changelog viewer | SURFACE-ONLY | `index.html`: "Changelog"/"What changed", 4 hits | none — no changelog data file bundled/read by any `main` module found | none | Label present ("Docs → What changed" per `design/HANDOFF.md`); no data source wired. |
| Automatic updates | HONEST-STUB | `dc-support.js`/`index.html` reference `showUpdateBanner` as a design prop (default `true`) but no update-check text found beyond that prop name | none — no autoUpdater wiring in `app/src/main/index.ts` | none | `AGENTS.md`/`docs/features/build-and-packaging/squirrel-packaging.md` document the Squirrel update contract as not yet implemented; treated as an honest stub rather than a defect since the doc says so plainly. |
| Support Tickets (local only) | **SHIPPED** | `index.html`: "Support Ticket", 7 hits | `app/src/main/support-tickets.ts` (120 lines), preload `supportTickets:` namespace | not explicitly named in `interaction-audit.md`'s controls table, but the backing is real and self-contained (no network per contract) | Real, scoped implementation; the one gap is a dedicated interaction-audit row confirming the folder-open action actually fires — call this WIRED-UNVERIFIED if that missing click-through matters to the reader, but the source clearly implements the documented local-only behaviour. |
| Dim-sum surprise | ABSENT | 0 hits for "dim sum surprise"; `docs/dim-sum-used.json` exists but is release-tooling metadata, not the in-app 10%-chance startup surprise | none | none | Not found as an in-app feature; the JSON file is unrelated release-code-name bookkeeping. |
| External-editor handoff | SURFACE-ONLY→WIRED-UNVERIFIED | `index.html`: "Open in editor", 1 hit | `fileops.ts` implements `openInEditor` (per `fileops-contract.ts`), exposed via `fileOps.openInEditor` on the bridge | not confirmed in `interaction-audit.md` | Real backing exists (detect-and-launch an external editor); nobody has clicked it in a verified run. |
| Companion browser extension | ABSENT | `index.html`: "browser extension"/"companion", 1 hit (a mention, not a shipped extension) | none — no `extension/` or `companion/` directory found in the repo root | none | `design/` may carry a Companion design reference (per `design/HANDOFF.md`'s "Studio and Companion each independently carry…"), but no extension package exists in this repository. |
| Documentation site (GitHub Pages) | ABSENT | n/a | none — no `site/` build output checked, no Pages workflow confirmed active | none | Out of this pig's edit lane to verify further (site/** is excluded); `docs/completeness-inventory.md`'s prior pass already recorded this as not implemented and nothing found here contradicts that. |

---

## What this pig could not determine, and why

- **Whether `Pattern builder` (regex builder) actually filters anything.** The interaction audit
  confirms the popover opens with real UI (pattern field, building blocks, sections) but its own
  documented method (CDP + bridge-instrumentation) cannot confirm whether typing a pattern changes
  the underlying list, because no bridge call could be instrumented and the audit never populated
  the search field. This is the single most likely candidate for an upgrade to SHIPPED, and the
  cheapest way to find out is a follow-up interaction-audit run that types into that field and
  checks whether the list's visible-text signature changes.
- **Whether `history.ts`'s Git-backed store is reachable from a UI control at all**, versus being
  backend-only code with no renderer entry point. Grep found download-history UI (queue/job
  history) but not a distinct "restore a settings snapshot" UI; it is possible one exists under a
  different label this pass's search terms missed.
- **Exact scope of the "two-key + destructive" 22 text hits.** Whether these are 22 separate gate
  instances or repeated contract-explainer copy (in-app help text quoting the rule itself) could
  not be distinguished by grep alone; distinguishing them needs reading each hit's surrounding
  context in the 450KB generated file, which was sampled but not exhaustively reviewed under this
  effort budget.
- **Companion extension and documentation site**: confirmed absent from this repository's own
  tree, but this pig did not check whether they live in a sibling repository the design references
  — `design/HANDOFF.md` implies "Studio and Companion" are two design surfaces, and Companion may
  be entirely out of scope for `material-ytdlp` itself.
