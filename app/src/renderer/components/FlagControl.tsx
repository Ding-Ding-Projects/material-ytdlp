import { useState, type ReactNode } from 'react'
import type { FlagDef } from '../catalog/ytdlp-flags'
import { palette } from '../theme'
import { Icon } from './Icon'

/**
 * Renders exactly ONE control for a flag, chosen by its declared control
 * type (`t`). This is a strict switch, not a chain of independent `is*`
 * checks — the design's own handoff calls out that overlapping checks can
 * render a slider AND a text guide for the same row. A `switch` on `def.t`
 * cannot do that: exactly one case runs.
 */
export function FlagControl({
  def,
  value,
  onChange,
}: {
  def: FlagDef
  value: string | boolean | undefined
  onChange: (next: string | boolean | undefined) => void
}) {
  switch (def.t) {
    case 'bool':
      return <BoolControl def={def} value={value === true} onChange={onChange} />
    case 'select':
      return <SelectControl def={def} value={typeof value === 'string' ? value : ''} onChange={onChange} />
    case 'int':
      return <TextControl def={def} value={typeof value === 'string' ? value : ''} onChange={onChange} inputMode="numeric" />
    case 'path':
      return <PathControl def={def} value={typeof value === 'string' ? value : ''} onChange={onChange} />
    case 'password':
      return <TextControl def={def} value={typeof value === 'string' ? value : ''} onChange={onChange} type="password" />
    case 'text':
    default:
      return <TextControl def={def} value={typeof value === 'string' ? value : ''} onChange={onChange} />
  }
}

function Row({ def, children }: { def: FlagDef; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 4px',
        borderBottom: `1px solid ${palette.border}`,
      }}
    >
      <div style={{ flex: '0 0 260px', minWidth: 0 }}>
        <div style={{ fontSize: 12, fontFamily: 'Roboto Mono, Consolas, monospace', color: palette.text }}>
          {def.f}
          {def.s ? <span style={{ color: palette.muted }}> ({def.s})</span> : null}
        </div>
        <div style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>{def.h}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function BoolControl({
  def,
  value,
  onChange,
}: {
  def: FlagDef
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <Row def={def}>
      <button
        role="switch"
        aria-checked={value}
        aria-label={def.f}
        onClick={() => onChange(!value)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          background: value ? palette.primary : '#3a4241',
          position: 'relative',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: value ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: 9,
            background: value ? palette.onPrimary : palette.textDim,
            transition: 'left 120ms ease',
          }}
        />
      </button>
    </Row>
  )
}

function TextControl({
  def,
  value,
  onChange,
  inputMode,
  type,
}: {
  def: FlagDef
  value: string
  onChange: (next: string) => void
  inputMode?: 'numeric'
  type?: 'password'
}) {
  return (
    <Row def={def}>
      <input
        type={type ?? 'text'}
        inputMode={inputMode}
        value={value}
        placeholder={def.a}
        onChange={(e) => onChange(e.target.value)}
        aria-label={def.f}
        style={{
          width: '100%',
          background: palette.bgRaised,
          border: `1px solid ${palette.border}`,
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          color: palette.text,
        }}
      />
    </Row>
  )
}

function SelectControl({
  def,
  value,
  onChange,
}: {
  def: FlagDef
  value: string
  onChange: (next: string) => void
}) {
  const options = def.o ?? []
  // The current value must be listed FIRST, otherwise React silently falls
  // back to rendering the first <option> in source order before the
  // controlled value has mounted (a documented trap from the design
  // handoff). An empty/unset value gets its own leading placeholder option.
  const ordered = value && options.includes(value) ? [value, ...options.filter((o) => o !== value)] : options

  return (
    <Row def={def}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={def.f}
        style={{
          width: '100%',
          background: palette.bgRaised,
          border: `1px solid ${palette.border}`,
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          color: palette.text,
        }}
      >
        <option value="">(unset)</option>
        {ordered.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </Row>
  )
}

function PathControl({
  def,
  value,
  onChange,
}: {
  def: FlagDef
  value: string
  onChange: (next: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function browse() {
    setBusy(true)
    try {
      // A generic "path" flag may want a file or a folder depending on the
      // flag; without a per-flag file/folder distinction in the catalog,
      // the file picker (which also accepts navigating into and selecting
      // within folders on most platforms) is the more generally useful
      // default for the CLI arguments in this group. --paths / --config-
      // locations style DIR flags are the exception; those use the folder
      // picker instead.
      const wantsFolder = def.a?.toUpperCase().includes('DIR') || def.f === '--paths'
      const picked = wantsFolder
        ? await window.ytdlpStudio.dialogs.pickFolder()
        : await window.ytdlpStudio.dialogs.pickFile()
      if (picked) onChange(picked)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Row def={def}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={value}
          placeholder={def.a}
          onChange={(e) => onChange(e.target.value)}
          aria-label={def.f}
          style={{
            flex: 1,
            minWidth: 0,
            background: palette.bgRaised,
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 12,
            color: palette.text,
          }}
        />
        <button
          onClick={browse}
          disabled={busy}
          title="Browse"
          aria-label={`Browse for ${def.f}`}
          style={{
            width: 34,
            height: 30,
            borderRadius: 8,
            background: palette.bgRaised,
            border: `1px solid ${palette.border}`,
            display: 'grid',
            placeItems: 'center',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Icon name="folder_open" size={16} color={palette.textDim} />
        </button>
      </div>
    </Row>
  )
}
