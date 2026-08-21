import type { FlagDef } from '../catalog/ytdlp-flags'
import { colors } from '../theme'
import { Select, Switch, TextInput } from './fields'
import type { ExpertState } from '../useArgv'

export function FlagRow({
  flag,
  state,
  onChange,
}: {
  flag: FlagDef
  state: ExpertState
  onChange: (f: string, v: string | boolean) => void
}) {
  const raw = state[flag.f]

  // Exactly one control per flag row, gated by control type. A flag must
  // never receive two branches at once (e.g. a switch AND a text box).
  let control: React.ReactNode
  if (flag.t === 'bool') {
    control = (
      <Switch
        checked={raw === true}
        onChange={(v) => onChange(flag.f, v)}
        label={flag.f}
      />
    )
  } else if (flag.t === 'select' && flag.o) {
    control = (
      <Select
        value={typeof raw === 'string' ? raw : ''}
        onChange={(v) => onChange(flag.f, v)}
        options={['', ...flag.o]}
        style={{ minWidth: 180 }}
      />
    )
  } else if (flag.t === 'password') {
    control = (
      <TextInput
        type="password"
        value={typeof raw === 'string' ? raw : ''}
        onChange={(e) => onChange(flag.f, e.target.value)}
        placeholder={flag.a ?? ''}
        style={{ minWidth: 220 }}
      />
    )
  } else if (flag.t === 'int') {
    control = (
      <TextInput
        type="number"
        value={typeof raw === 'string' ? raw : ''}
        onChange={(e) => onChange(flag.f, e.target.value)}
        placeholder={flag.a ?? ''}
        style={{ minWidth: 120 }}
      />
    )
  } else {
    // 'text' and 'path' both render as a plain text box; a browse button
    // for 'path' is a follow-up, not attempted here to avoid a half-wired
    // dialog contract mismatch under time pressure.
    control = (
      <TextInput
        value={typeof raw === 'string' ? raw : ''}
        onChange={(e) => onChange(flag.f, e.target.value)}
        placeholder={flag.a ?? ''}
        style={{ minWidth: 220 }}
      />
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 4px',
        borderBottom: `1px solid ${colors.line}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: colors.text, fontFamily: 'Consolas, monospace' }}>
          {flag.f}
          {flag.s ? <span style={{ color: colors.muted }}> ({flag.s})</span> : null}
        </div>
        <div style={{ fontSize: 11, color: colors.muted }}>{flag.h}</div>
      </div>
      {control}
    </div>
  )
}
