# Progress parsing

## Behavior

yt-dlp Studio spawns the bundled `yt-dlp.exe` with an explicit argv array (never a shell string,
to avoid quoting and injection issues) and asks it to report progress in a structured,
machine-parseable form via yt-dlp's `--progress-template` option, rather than scraping the
human-readable progress bar it prints by default. The main process reads yt-dlp's stdout line
by line, matches the structured progress lines, and updates each queue job's percentage, rate,
size, ETA, and fragment count. Non-progress stdout/stderr lines are appended to the console log.

## Configuration

The exact `--progress-template` string used, and the exact field mapping from its output to job
state, is defined in the main-process source under `app/`. This document will be updated with
the exact template and field names once that code is finalized and observed working end to end.

## Failure modes

- **yt-dlp exits non-zero**: the job is marked failed; the console shows the process's stderr
  output; a line matching a known error pattern surfaces a repair wizard (see
  `design/HANDOFF.md`'s "Console" and "wizardDefs()" sections for the pattern catalog this is
  modeled on).
- **Progress template output is malformed or missing** (an upstream yt-dlp change, an
  unexpected extractor code path): the job should fall back to an indeterminate progress state
  rather than showing a stale or wrong percentage. The exact fallback behavior is not yet
  implemented.
- **Process hangs** (network stall, an extractor waiting indefinitely): no timeout/cancel
  behavior has been implemented or verified yet.

## Security considerations

- Arguments are passed as an argv array, not concatenated into a shell command string, so a
  malicious URL or filename cannot inject additional shell commands.
- User-supplied output paths and filename templates are passed through to yt-dlp as-is; yt-dlp
  itself is responsible for path handling. This project does not currently perform additional
  path sandboxing beyond what yt-dlp provides.

## Verification status

**Not yet verified.** No automated test exercises progress parsing against a real or mocked
yt-dlp process as of this writing, and no capture of the queue UI updating from real progress
output exists. This is a known gap — see [`HANDOFF.md`](../../../HANDOFF.md).
