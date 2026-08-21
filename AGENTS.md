# AGENTS.md

> This file is a **sanitized mirror** of the shared engineering instructions this project's
> maintainer uses across their repositories. It is generalized for a public audience: no
> private paths, machine names, usernames, IP addresses, or tokens appear here. Instruction
> changes are made upstream in the maintainer's own instruction repository first and mirrored
> outward — please don't edit this file expecting a change here to propagate anywhere else, and
> please don't rely on it being perfectly current with the upstream source.

Rules for anyone — human or AI agent — contributing to yt-dlp Studio.

## Design conformance

- The application conforms to **Material Design 3**: tokens, typography, shape, elevation, and
  motion, with no legacy or ad-hoc UI elements. Functional data colors (progress states, log
  severity colors) are exempt as data encodings, not chrome.
- Every rendered control obeys the design system's density, spacing, and elevation rules
  consistently with its siblings.

## Language and tone

- The app supports three language modes: **English**, playful **Hong Kong-style Cantonese**,
  and a **bilingual** mode. Keep localization resources separate from logic and provide
  sensible fallback behavior.
- Two independent **funny-level sliders** (1–5, fully serious to maximum playfulness), one per
  language, style *every* category of user-facing message including errors and destructive
  warnings. The funny level changes voice, never facts: an error message must still say what
  happened and what to do about it, however playfully it is worded.

## Accessibility is a completion blocker, not polish

- Keyboard reachability, visible focus, correct roles/names/states, sufficient contrast,
  respect for reduced-motion preferences, and sensible screen-reader structure are required for
  every surface, not an afterthought.
- No clipped, truncated, overlapping, or off-screen text or controls at any supported window
  size, 100/125/150/200% display scale, or language mode (bilingual labels are the longest —
  test them).
- Any icon, preview, toolbar control, card, or affordance that looks interactive must actually
  work, expose an accessible equivalent, and be covered by an interaction test — or be labeled
  plainly as a static preview.

## Search and discovery

- Every search field, dropdown, and context menu carries its own **anchored regex builder**:
  plain-text search is the default, regex is an explicit opt-in, and query/pattern/flags stay
  in sync bidirectionally.

## Notifications and destructive actions

- Anything that only informs (progress, success, non-decision errors) is a **non-blocking**
  notification (toast/snackbar), never a modal dialog. Modal dialogs are reserved for genuine
  decisions: confirmations, unsaved-work prompts, destructive-action gates.
- Destructive actions (deleting a download, clearing history, wiping credentials) require the
  **two-key plus slider** confirmation gate: two independently operated controls before a
  full-range slider unlocks, plus an always-available cancel.

## Data ownership

- User-owned state (queue history, saved presets, credentials) is recoverable through a local,
  append-only version history. Restoring a prior state is itself a new recorded revision, never
  a silent rewrite.
- Every list, table, and record set supports **export** in every format that can faithfully
  represent the data, and supports **bulk actions** (not just single-item actions repeated).

## Dependencies and signing

- The app **bundles its own dependencies**. The end user installs nothing beyond the Windows
  installer: yt-dlp is built from the pinned submodule source and bundled, ffmpeg/ffprobe are
  pinned and bundled. No CDN scripts, fonts, or third-party assets are loaded at runtime.
- **Code signing is permanently out of scope for this project.** Never add a signing workflow,
  request or store a certificate, or claim signature verification. Installers are unsigned and
  will trigger the operating system's unknown-publisher warning; say so plainly in release
  notes and in-app copy.

## Commit messages

- Write commit messages **bilingually**: a concise English subject/body plus a playful
  Hong Kong-style Cantonese counterpart conveying the same information. Keep technical
  identifiers (file names, flag names, function names) exact in both languages.
- Every commit ends with:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## Continuous integration

- **CI builds and packages the release. It does not run tests or lint gates.** Nothing in the
  release workflow can withhold a release on a code-quality verdict — that supersedes any
  older convention of a gating test job. A run only fails when the build or packaging itself
  fails.
- This is a deliberate, explicit project decision, not an oversight: checking moves to the
  contributor's own machine, before pushing. The repository's own test scripts (where they
  exist) are still run locally and their results are still reported honestly in commit
  messages, PR descriptions, and `HANDOFF.md` — they simply never block a release.
- Because of this, release notes must state plainly which checks were actually run locally and
  what their real results were. Never imply CI verified something it did not run, and never
  describe a release as "passing" when nothing tested it.

## Honesty about verification

- Never claim something is tested, verified, or captured (screenshotted) when it has not
  actually happened. State the real verification status of every change plainly, including
  "not yet tested" and "no capture exists yet" where that is the truth.
