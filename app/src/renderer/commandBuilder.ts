import type { FlagDef } from './catalog/ytdlp-flags'
import { findFlag } from './catalog/ytdlp-flags'

// ---------------------------------------------------------------------------
// Easy mode
// ---------------------------------------------------------------------------

export type EasyQuality = 'best' | '1080p' | '720p' | '480p' | 'audio-only'

export interface EasyState {
  url: string
  quality: EasyQuality
  folder: string | null
  subtitles: boolean
  thumbnail: boolean
  sponsorblock: boolean
}

export const DEFAULT_EASY_STATE: EasyState = {
  url: '',
  quality: 'best',
  folder: null,
  subtitles: false,
  thumbnail: false,
  sponsorblock: false,
}

const QUALITY_FORMAT: Record<EasyQuality, string> = {
  best: 'bv*+ba/b',
  '1080p': 'bv*[height<=1080]+ba/b[height<=1080]',
  '720p': 'bv*[height<=720]+ba/b[height<=720]',
  '480p': 'bv*[height<=480]+ba/b[height<=480]',
  'audio-only': 'ba/b',
}

/**
 * Builds the real argv (a string[] — never a shell string, since the main
 * process spawns yt-dlp directly with an argument array) for easy mode.
 */
export function easyCommand(state: EasyState): string[] {
  const argv: string[] = []
  if (state.quality === 'audio-only') {
    argv.push('-f', QUALITY_FORMAT[state.quality], '-x', '--audio-format', 'mp3')
  } else {
    argv.push('-f', QUALITY_FORMAT[state.quality])
  }
  if (state.folder) {
    argv.push('-P', state.folder)
  }
  if (state.subtitles) {
    argv.push('--write-subs', '--write-auto-subs', '--embed-subs')
  }
  if (state.thumbnail) {
    argv.push('--write-thumbnail', '--embed-thumbnail')
  }
  if (state.sponsorblock) {
    argv.push('--sponsorblock-mark', 'all')
  }
  if (state.url.trim()) {
    argv.push(state.url.trim())
  }
  return argv
}

// ---------------------------------------------------------------------------
// Expert mode
// ---------------------------------------------------------------------------

/**
 * Value stored per flag in expert mode. A bool flag stores true/false; every
 * other control type stores its string form (or null/empty for "unset").
 */
export type ExpertValues = Record<string, string | boolean | undefined>

export const DEFAULT_EXPERT_URL = ''

/**
 * Serialises expert-mode flag values plus the target URL into the real
 * argv yt-dlp will be spawned with.
 */
export function expertCommand(values: ExpertValues, url: string): string[] {
  const argv: string[] = []
  for (const [flagName, value] of Object.entries(values)) {
    const def = findFlag(flagName)
    if (!def) continue
    if (def.t === 'bool') {
      if (value === true) argv.push(def.f)
      continue
    }
    if (typeof value === 'string' && value.trim() !== '') {
      argv.push(def.f, value)
    }
  }
  if (url.trim()) {
    argv.push(url.trim())
  }
  return argv
}

/** Human-readable command-line preview (for display only — the argv above is what actually runs). */
export function argvToDisplayString(argv: string[]): string {
  return ['yt-dlp', ...argv.map(quoteForDisplay)].join(' ')
}

function quoteForDisplay(arg: string): string {
  if (arg === '') return "''"
  if (/^[A-Za-z0-9._\-/:@%+=]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

// ---------------------------------------------------------------------------
// Plain mode: a raw command-line textarea, parsed into a real argv.
// ---------------------------------------------------------------------------

/**
 * Splits a shell-like command line into argv, honoring single and double
 * quotes and backslash escapes. This is intentionally a small subset of
 * real shell parsing (no globbing, no variable expansion, no subshells) —
 * it is a text field for typing yt-dlp flags, not a shell.
 */
export function parsePlainCommand(line: string): string[] {
  const argv: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let hasCurrent = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inSingle) {
      if (ch === "'") {
        inSingle = false
      } else {
        current += ch
      }
      continue
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false
      } else if (ch === '\\' && i + 1 < line.length && (line[i + 1] === '"' || line[i + 1] === '\\')) {
        current += line[++i]
      } else {
        current += ch
      }
      continue
    }
    if (ch === "'") {
      inSingle = true
      hasCurrent = true
      continue
    }
    if (ch === '"') {
      inDouble = true
      hasCurrent = true
      continue
    }
    if (ch === '\\' && i + 1 < line.length) {
      current += line[++i]
      hasCurrent = true
      continue
    }
    if (/\s/.test(ch)) {
      if (hasCurrent) {
        argv.push(current)
        current = ''
        hasCurrent = false
      }
      continue
    }
    current += ch
    hasCurrent = true
  }
  if (hasCurrent) argv.push(current)

  // Drop a leading literal "yt-dlp" token, if the user typed the full
  // command rather than just its arguments.
  if (argv[0] === 'yt-dlp') argv.shift()
  return argv
}

export function findFlagOrNull(f: string): FlagDef | null {
  return findFlag(f) ?? null
}
