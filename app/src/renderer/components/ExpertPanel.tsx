import { useState } from 'react'
import { GROUPS } from '../catalog/ytdlp-flags'
import type { ExpertValues } from '../commandBuilder'
import { palette } from '../theme'
import { Icon } from './Icon'
import { FlagControl } from './FlagControl'

export function ExpertPanel({
  url,
  onUrlChange,
  values,
  onValuesChange,
}: {
  url: string
  onUrlChange: (next: string) => void
  values: ExpertValues
  onValuesChange: (next: ExpertValues) => void
}) {
  const [activeGroup, setActiveGroup] = useState(GROUPS[0].id)
  const group = GROUPS.find((g) => g.id === activeGroup) ?? GROUPS[0]

  function setFlagValue(flagName: string, next: string | boolean | undefined) {
    onValuesChange({ ...values, [flagName]: next })
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <nav
        style={{
          width: 200,
          minWidth: 200,
          borderRight: `1px solid ${palette.border}`,
          overflow: 'auto',
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {GROUPS.map((g) => {
          const active = g.id === activeGroup
          return (
            <button
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              title={g.blurb}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 34,
                padding: '0 10px',
                borderRadius: 17,
                background: active ? '#1c2926' : 'transparent',
                color: active ? palette.primary : palette.textDim,
                fontSize: 12,
                textAlign: 'left',
              }}
            >
              <Icon name={g.glyph} size={16} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.label}
              </span>
              <em style={{ fontStyle: 'normal', fontSize: 10, color: palette.muted }}>{g.flags.length}</em>
            </button>
          )
        })}
      </nav>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${palette.border}` }}>
          <label style={{ fontSize: 11, color: palette.muted, display: 'block', marginBottom: 4 }} htmlFor="expert-url">
            Target URL
          </label>
          <input
            id="expert-url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://example.com/watch?v=..."
            style={{
              width: '100%',
              background: palette.bgRaised,
              border: `1px solid ${palette.border}`,
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: 12,
              color: palette.text,
            }}
          />
        </div>
        <div style={{ padding: '4px 16px 12px', borderBottom: `1px solid ${palette.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{group.label}</div>
          <div style={{ fontSize: 11, color: palette.muted, marginTop: 2 }}>{group.blurb}</div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
          {group.flags.map((flag) => (
            <FlagControl key={flag.f} def={flag} value={values[flag.f]} onChange={(next) => setFlagValue(flag.f, next)} />
          ))}
        </div>
      </div>
    </div>
  )
}
