import { useState } from 'react'
import { GROUPS } from '../catalog/ytdlp-flags'
import { colors } from '../theme'
import { buildArgvFromExpertState, useExpertState } from '../useArgv'
import { CommandPreview } from './CommandPreview'
import { Button, TextInput } from './fields'
import { FlagRow } from './FlagRow'
import type { StartJobRequest } from '../../shared/ipc-contract'

export function ExpertMode({ onStart }: { onStart: (req: StartJobRequest) => void }) {
  const [groupId, setGroupId] = useState(GROUPS[0].id)
  const [url, setUrl] = useState('')
  const { state, setFlag } = useExpertState()

  const activeGroup = GROUPS.find((g) => g.id === groupId) ?? GROUPS[0]
  const allFlags = GROUPS.flatMap((g) => g.flags)
  const argv = [...buildArgvFromExpertState(state, allFlags), ...(url.trim() ? [url.trim()] : [])]

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0 }}>
      <div
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: `1px solid ${colors.line}`,
          overflowY: 'auto',
        }}
      >
        {GROUPS.map((g) => {
          const active = g.id === groupId
          return (
            <button
              key={g.id}
              onClick={() => setGroupId(g.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                border: 'none',
                background: active ? 'rgba(130,213,204,0.12)' : 'transparent',
                color: active ? colors.primary : colors.text,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              <i className="msym" style={{ fontSize: 16 }}>
                {g.glyph}
              </i>
              {g.label}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: '0 16px' }}>
        <div style={{ padding: '12px 4px' }}>
          <TextInput
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Video URL"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ padding: '0 4px 8px', fontSize: 12, color: colors.muted }}>{activeGroup.blurb}</div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {activeGroup.flags.map((flag) => (
            <FlagRow key={flag.f} flag={flag} state={state} onChange={setFlag} />
          ))}
        </div>

        <div style={{ padding: '12px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CommandPreview argv={argv} />
          <div>
            <Button
              variant="filled"
              disabled={!url.trim()}
              onClick={() =>
                onStart({
                  id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  url: url.trim(),
                  argv,
                  cwd: null,
                })
              }
            >
              <i className="msym">download</i>
              Download
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
