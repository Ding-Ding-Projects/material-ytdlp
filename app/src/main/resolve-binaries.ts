import { app } from 'electron'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { delimiter, join, resolve as resolvePath } from 'node:path'
import type { BinaryName, BinaryOrigin, ResolveAllBinariesResult, ResolvedBinary } from '../shared/ipc-contract'

const BINARY_NAMES: BinaryName[] = ['yt-dlp', 'ffmpeg', 'ffprobe']

const versionCache = new Map<string, string | null>()

function exeName(name: BinaryName): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

/** The repository root when running un-packaged (`app/` is one level down). */
function devRepoRoot(): string {
  // app/src/main -> app -> repo root
  return resolvePath(__dirname, '..', '..', '..')
}

function bundledDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin')
  }
  return join(devRepoRoot(), 'vendor', 'bin')
}

function pathCandidates(name: BinaryName): string[] {
  const raw = process.env.PATH ?? process.env.Path ?? ''
  const dirs = raw.split(delimiter).filter(Boolean)
  return dirs.map((dir) => join(dir, exeName(name)))
}

export interface ResolveOptions {
  /** User-configured override path, if any, keyed by binary name. */
  overrides?: Partial<Record<BinaryName, string | null>>
}

/**
 * Resolve a single binary. Resolution order:
 *   1. explicit user override path from settings
 *   2. bundled with the app (resources/bin in a packaged build, vendor/bin in dev)
 *   3. PATH, as a last-resort fallback
 *
 * When nothing is found, `searched` enumerates EVERY location that was
 * checked so the UI (and this function's own errors) never reduce a missing
 * bundled dependency to a bare "not found".
 */
export function resolveBinary(name: BinaryName, options: ResolveOptions = {}): ResolvedBinary {
  const searched: string[] = []
  const override = options.overrides?.[name]

  if (override) {
    searched.push(override)
    if (existsSync(override)) {
      return { name, path: override, origin: 'override', searched, version: versionCache.get(override) ?? null }
    }
  }

  const bundled = join(bundledDir(), exeName(name))
  searched.push(bundled)
  if (existsSync(bundled)) {
    return { name, path: bundled, origin: 'bundled', searched, version: versionCache.get(bundled) ?? null }
  }

  const onPath = pathCandidates(name)
  searched.push(...onPath)
  const found = onPath.find((candidate) => existsSync(candidate))
  if (found) {
    return { name, path: found, origin: 'path', searched, version: versionCache.get(found) ?? null }
  }

  return { name, path: null, origin: null, searched, version: null }
}

export function resolveAllBinaries(options: ResolveOptions = {}): ResolveAllBinariesResult {
  const result = {} as ResolveAllBinariesResult
  for (const name of BINARY_NAMES) {
    result[name] = resolveBinary(name, options)
  }
  return result
}

/**
 * Actually run `<binary> --version` and cache the result against the exact
 * resolved path (never against the logical name — an override or a bundled
 * copy at a different path is a different binary as far as caching goes).
 */
export function probeVersion(binaryPath: string): Promise<string | null> {
  if (versionCache.has(binaryPath)) {
    return Promise.resolve(versionCache.get(binaryPath) ?? null)
  }
  if (!existsSync(binaryPath)) {
    versionCache.set(binaryPath, null)
    return Promise.resolve(null)
  }
  return new Promise((resolvePromise) => {
    let out = ''
    let settled = false
    const finish = (version: string | null) => {
      if (settled) return
      settled = true
      versionCache.set(binaryPath, version)
      resolvePromise(version)
    }
    try {
      const child = spawn(binaryPath, ['--version'], { windowsHide: true })
      const timer = setTimeout(() => {
        child.kill()
        finish(null)
      }, 10_000)
      child.stdout?.on('data', (chunk) => {
        out += chunk.toString('utf8')
      })
      child.on('error', () => {
        clearTimeout(timer)
        finish(null)
      })
      child.on('close', () => {
        clearTimeout(timer)
        const trimmed = out.trim().split(/\r?\n/)[0]?.trim() ?? ''
        finish(trimmed.length > 0 ? trimmed : null)
      })
    } catch {
      finish(null)
    }
  })
}

/**
 * A binary is "missing" in a way the UI must be able to explain fully: this
 * throws an Error whose message enumerates every path that was searched,
 * rather than a bare "yt-dlp not found".
 */
export function describeMissingBinary(binary: ResolvedBinary): string {
  const lines = [
    `${binary.name} could not be found. Searched, in order:`,
    ...binary.searched.map((p) => `  - ${p}`),
  ]
  return lines.join('\n')
}

export type { BinaryName, BinaryOrigin }
