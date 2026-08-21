#!/usr/bin/env node
/**
 * Guards against the typed renderer catalog (app/src/renderer/catalog/ytdlp-flags.ts)
 * drifting away from the design reference catalog (design/ytdlp-flags.js).
 *
 * Parses both files by extracting every `f: '...'` (long flag) occurrence
 * inside each `id: '...'` group block, and fails (exit 1) with an explicit
 * diff when the group ids or their flag sets differ.
 *
 * This does not evaluate either file as code (the design file must never be
 * imported/executed by the product), it only reads the source text.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

const DESIGN_PATH = join(repoRoot, 'design', 'ytdlp-flags.js')
const TYPED_PATH = join(repoRoot, 'app', 'src', 'renderer', 'catalog', 'ytdlp-flags.ts')

/**
 * Extract an ordered list of { id, flags: Set<string> } group records from
 * a source string shaped like the GROUPS array in both files: a sequence of
 * `{ id: 'xxx', ... flags: [ ... { f: '--foo', ... }, ... ] }` objects.
 *
 * We do this with a small brace-depth walk over the GROUPS array text
 * rather than a single greedy/lazy regex, so nested objects and the
 * PRESETS/TEMPLATE_FIELDS arrays that follow GROUPS never leak in.
 */
function parseGroups(source, label) {
  const startMarker = 'export const GROUPS'
  const start = source.indexOf(startMarker)
  if (start === -1) {
    throw new Error(`${label}: could not find "export const GROUPS"`)
  }
  // Find the '=' that assigns the array (skipping any TypeScript type
  // annotation such as `: FlagGroup[]`, whose own '[]' would otherwise be
  // mistaken for the array we are looking for), then walk bracket depth
  // from the first '[' after it to find the matching ']'.
  const eq = source.indexOf('=', start)
  if (eq === -1) {
    throw new Error(`${label}: could not find "=" after GROUPS declaration`)
  }
  const arrayStart = source.indexOf('[', eq)
  if (arrayStart === -1) {
    throw new Error(`${label}: could not find the GROUPS array start`)
  }
  let depth = 0
  let arrayEnd = -1
  for (let i = arrayStart; i < source.length; i++) {
    const ch = source[i]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        arrayEnd = i
        break
      }
    }
  }
  if (arrayEnd === -1) {
    throw new Error(`${label}: could not find the GROUPS array end`)
  }
  const groupsText = source.slice(arrayStart + 1, arrayEnd)

  // Split into top-level group objects by walking brace depth at depth 0
  // relative to this slice (each group is `{ ... }` at the top level).
  const groupObjs = []
  let braceDepth = 0
  let objStart = -1
  for (let i = 0; i < groupsText.length; i++) {
    const ch = groupsText[i]
    if (ch === '{') {
      if (braceDepth === 0) objStart = i
      braceDepth++
    } else if (ch === '}') {
      braceDepth--
      if (braceDepth === 0 && objStart !== -1) {
        groupObjs.push(groupsText.slice(objStart, i + 1))
        objStart = -1
      }
    }
  }

  const idRe = /id:\s*'([^']*)'/
  // Match `f: '...'` — the long flag on each flag record. This intentionally
  // does not match `s:` (short flag) or `a:` (arg placeholder).
  const flagRe = /\bf:\s*'((?:[^'\\]|\\.)*)'/g

  return groupObjs.map((obj) => {
    const idMatch = obj.match(idRe)
    if (!idMatch) {
      throw new Error(`${label}: found a group with no id: ${obj.slice(0, 80)}...`)
    }
    const flags = new Set()
    let m
    flagRe.lastIndex = 0
    while ((m = flagRe.exec(obj)) !== null) {
      flags.add(m[1])
    }
    return { id: idMatch[1], flags }
  })
}

function main() {
  const designSource = readFileSync(DESIGN_PATH, 'utf8')
  const typedSource = readFileSync(TYPED_PATH, 'utf8')

  const designGroups = parseGroups(designSource, 'design/ytdlp-flags.js')
  const typedGroups = parseGroups(typedSource, 'app/src/renderer/catalog/ytdlp-flags.ts')

  const problems = []

  const designIds = designGroups.map((g) => g.id)
  const typedIds = typedGroups.map((g) => g.id)
  if (designIds.join(',') !== typedIds.join(',')) {
    problems.push(
      `Group id list differs.\n  design:  [${designIds.join(', ')}]\n  typed:   [${typedIds.join(', ')}]`
    )
  }

  const designById = new Map(designGroups.map((g) => [g.id, g]))
  const typedById = new Map(typedGroups.map((g) => [g.id, g]))

  const allIds = new Set([...designById.keys(), ...typedById.keys()])
  for (const id of allIds) {
    const d = designById.get(id)
    const t = typedById.get(id)
    if (!d) {
      problems.push(`Group '${id}' exists in the typed copy but not in the design reference.`)
      continue
    }
    if (!t) {
      problems.push(`Group '${id}' exists in the design reference but not in the typed copy.`)
      continue
    }
    const onlyInDesign = [...d.flags].filter((f) => !t.flags.has(f))
    const onlyInTyped = [...t.flags].filter((f) => !d.flags.has(f))
    if (onlyInDesign.length > 0 || onlyInTyped.length > 0) {
      const lines = [`Group '${id}' flag set differs:`]
      if (onlyInDesign.length > 0) {
        lines.push(`  present in design/ytdlp-flags.js but missing from the typed copy: ${onlyInDesign.join(', ')}`)
      }
      if (onlyInTyped.length > 0) {
        lines.push(`  present in the typed copy but missing from design/ytdlp-flags.js: ${onlyInTyped.join(', ')}`)
      }
      problems.push(lines.join('\n'))
    }
  }

  if (problems.length > 0) {
    console.error('Catalog drift detected between design/ytdlp-flags.js and app/src/renderer/catalog/ytdlp-flags.ts:\n')
    for (const p of problems) {
      console.error(`- ${p}\n`)
    }
    console.error(`(${designGroups.length} design groups, ${typedGroups.length} typed groups)`)
    process.exit(1)
  }

  const totalFlags = designGroups.reduce((n, g) => n + g.flags.size, 0)
  console.log(
    `Catalog OK: ${designGroups.length} groups, ${totalFlags} flags match between design/ytdlp-flags.js and the typed copy.`
  )
}

main()
