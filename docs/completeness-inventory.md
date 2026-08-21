# Completeness inventory

A hand-written table, one row per canonical feature named in the project's feature contract
(`AGENTS.md` and `design/HANDOFF.md`'s "Contract feature inventory"). This is hand-written
deliberately: an auto-generated list can only report on features it already knows to look for,
and cannot detect a feature that is missing entirely. Every row below was re-derived on
2026-08-21 by measuring the real built renderer and main-process source — see
[`contract-audit.md`](contract-audit.md) for the row-by-row evidence (surface location, backing
file, verification source) behind every status here.

**Status vocabulary** (exact definitions in `contract-audit.md`): **SHIPPED** (surface + real
backing + verified in the built app) · **WIRED-UNVERIFIED** (surface + real backing, unexercised)
· **SURFACE-ONLY** (looks live, nothing real behind it — the actionable defect) ·
**HONEST-STUB** (says plainly it's not implemented) · **ABSENT** (no surface at all).

## Totals

| Status | Count |
|---|---|
| SHIPPED | 2 |
| WIRED-UNVERIFIED | 7 |
| SURFACE-ONLY | 17 |
| HONEST-STUB | 1 |
| ABSENT | 10 |
| **Total features audited** | **37** |

**2 of 37 (5%) are genuinely done. 17 of 37 (46%) are the defect this audit exists to name: a
control that renders, opens, and looks finished, backed by nothing.** Most of the rest (10, 27%)
are simply not built yet, which is a normal and honest state — the 17 SURFACE-ONLY rows are the
ones that need fixing first, because they are indistinguishable from working features until
someone checks.

## Summary table

| Feature | Status | Evidence |
|---|---|---|
| Cantonese / bilingual language mode | SURFACE-ONLY | [contract-audit.md § Language and voice](contract-audit.md#language-and-voice) |
| Two funny-level sliders | SURFACE-ONLY | [contract-audit.md § Language and voice](contract-audit.md#language-and-voice) |
| Emoji-in-dialogs toggle | ABSENT | [contract-audit.md § Language and voice](contract-audit.md#language-and-voice) |
| Spoken narrator (TTS) | SURFACE-ONLY | [contract-audit.md § Language and voice](contract-audit.md#language-and-voice) |
| ADHD modes | SURFACE-ONLY | [contract-audit.md § Accessibility and modes](contract-audit.md#accessibility-and-modes) |
| School mode | SURFACE-ONLY | [contract-audit.md § Accessibility and modes](contract-audit.md#accessibility-and-modes) |
| Unlock ladder | ABSENT | [contract-audit.md § Accessibility and modes](contract-audit.md#accessibility-and-modes) |
| Per-element "Edit appearance…" | SURFACE-ONLY | [contract-audit.md § Customisation](contract-audit.md#customisation) |
| Infinite colour picker + translator + rainbow | ABSENT | [contract-audit.md § Customisation](contract-audit.md#customisation) |
| App rename (display name) | SURFACE-ONLY | [contract-audit.md § Customisation](contract-audit.md#customisation) |
| App-mark / logo customisation | WIRED-UNVERIFIED | [contract-audit.md § Customisation](contract-audit.md#customisation) |
| Theme / density / scale / weight / radius | SURFACE-ONLY | [contract-audit.md § Customisation](contract-audit.md#customisation) |
| Reduced motion | ABSENT | [contract-audit.md § Customisation](contract-audit.md#customisation) |
| Scheduled settings (incl. external source) | ABSENT | [contract-audit.md § Customisation](contract-audit.md#customisation) |
| Command palette (Ctrl+Shift+F) | SURFACE-ONLY | [contract-audit.md § Getting around](contract-audit.md#getting-around) |
| Browser-style tabs (full contract) | SURFACE-ONLY | [contract-audit.md § Getting around](contract-audit.md#getting-around) |
| Regex builder (Pattern builder) | SURFACE-ONLY (strongest candidate for upgrade) | [contract-audit.md § Getting around](contract-audit.md#getting-around) |
| Guided forms with real pickers | WIRED-UNVERIFIED (partial) | [contract-audit.md § Getting around](contract-audit.md#getting-around) |
| Local Git-backed version history | WIRED-UNVERIFIED (download history only; broader scope missing) | [contract-audit.md § Data](contract-audit.md#data) |
| Export in every format + ZIP/7z | SURFACE-ONLY / partial WIRED (single-format export only) | [contract-audit.md § Data](contract-audit.md#data) |
| Bulk actions on every list | ABSENT | [contract-audit.md § Data](contract-audit.md#data) |
| Built-in TOTP authenticator | SURFACE-ONLY | [contract-audit.md § Data](contract-audit.md#data) |
| Per-element toy locks | SURFACE-ONLY | [contract-audit.md § Data](contract-audit.md#data) |
| Local personal-vocabulary JSON upload | **SHIPPED** | [contract-audit.md § Data](contract-audit.md#data) |
| File converter | ABSENT | [contract-audit.md § Data](contract-audit.md#data) |
| Local Ollama suite manager | SURFACE-ONLY | [contract-audit.md § Data](contract-audit.md#data) |
| Non-blocking notifications + reviewable centre | WIRED-UNVERIFIED (partial) | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| Two-key + slider destructive gate | SURFACE-ONLY | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| Changelog viewer | SURFACE-ONLY | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| Automatic updates | HONEST-STUB | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| Support Tickets (local) | **SHIPPED** | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| Dim-sum surprise | ABSENT | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| External-editor handoff | WIRED-UNVERIFIED | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| Companion browser extension | WIRED-UNVERIFIED (partial) | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |
| Documentation site | ABSENT | [contract-audit.md § Everywhere else](contract-audit.md#everywhere-else) |

## The actionable defect list — SURFACE-ONLY (looks live, nothing real behind it)

These are the controls this audit exists to find: they render, they visibly open or respond, and
they call nothing and persist nothing. Full evidence for each is in `contract-audit.md`.

1. Cantonese / bilingual language mode
2. Two funny-level sliders
3. Spoken narrator (TTS)
4. ADHD modes
5. School mode
6. Per-element "Edit appearance…"
7. App rename (display name)
8. Theme / density / scale / weight / radius
9. Command palette (Ctrl+Shift+F)
10. Browser-style tabs (full docking/overflow/pin/group/search contract)
11. Regex builder (Pattern builder popover) — *best-evidenced of this whole group; see the note
    in `contract-audit.md` about what one more interaction-audit run could upgrade this to*
12. Export in every format + ZIP/7z (beyond the one real export path that does exist)
13. Built-in TOTP authenticator
14. Per-element toy locks
15. Local Ollama suite manager
16. Two-key + slider destructive gate
17. Changelog viewer

## Downstream build/design/vendoring rows carried forward from the prior pass

These rows are outside this pig's audit method (they concern build tooling and vendored source,
not renderer/main wiring) and are carried forward unchanged from the previous inventory, which
already recorded them accurately:

| Feature | Impl. | Notes |
|---|---|---|
| Design reference (Studio + Companion) | `design/` | reference only, not the running app |
| yt-dlp submodule pin | `vendor/yt-dlp` | see `docs/features/build-and-packaging/building-yt-dlp-from-source.md` |
| ffmpeg built from pinned source | `build-ffmpeg.bat`, `vendor/ffmpeg` | verified by `objdump` + a real merged download |
| Bundled yt-dlp/ffmpeg/ffprobe binaries | `app/src/main/resolve-binaries.ts` | resolver exists; packaging-time bundling not audited here (build scripts are out of this pig's lane) |
| Squirrel.Windows packaging | not implemented | see `docs/features/build-and-packaging/squirrel-packaging.md` |
| Automated test coverage | none | project-wide; unchanged from prior pass |

## What could not be determined, and why

See the "What this pig could not determine, and why" section at the end of
[`contract-audit.md`](contract-audit.md#what-this-pig-could-not-determine-and-why) for the full
list — in short: whether the regex builder actually filters results (most likely upgrade
candidate), whether the Git-backed history store has any UI entry point beyond download history,
the exact count of independently-working destructive gates versus repeated contract-explainer
copy, and whether a Companion browser extension exists in a sibling repository this pass did not
have access to.

**Every "SURFACE-ONLY" and "ABSENT" above is an honest current-state report, not a placeholder to
be filled in mechanically.** Update this table in the same commit that changes any of these facts.
