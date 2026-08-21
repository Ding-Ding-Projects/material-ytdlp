# Contributing

Thanks for your interest in yt-dlp Studio.

## Before you start

- Read [`AGENTS.md`](AGENTS.md) for the project's engineering rules (Material Design 3
  conformance, accessibility as a completion blocker, the CI-builds-but-doesn't-gate policy,
  the bilingual commit message convention, and more).
- Read [`ROADMAP.md`](ROADMAP.md) to see what's already done, in progress, and not started.
- Read [`HANDOFF.md`](HANDOFF.md) for the current, honest state of the project — this project
  is early and a lot of the design reference's intended feature set is not implemented yet.

## Making changes

1. Fork and branch from `main`.
2. Keep changes scoped and run whatever tests exist locally before pushing — CI does not gate
   on tests (see `AGENTS.md`), so local checking is the only checking that happens.
3. Write commit messages bilingually (English + playful Hong Kong-style Cantonese) per
   `AGENTS.md`.
4. Update the relevant documentation under `docs/`, the `ROADMAP.md` checklist, and
   `docs/completeness-inventory.md` in the same change that alters what they describe.
5. Open a pull request describing what changed and, honestly, what has and hasn't been
   verified.

## Reporting bugs

Open a GitHub issue with reproduction steps, the affected version/commit, and expected vs.
actual behavior.
