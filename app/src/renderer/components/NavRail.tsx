import { colors } from '../theme'

export type ModeId = 'easy' | 'expert' | 'plain' | 'queue' | 'console'

interface Destination {
  id: ModeId
  label: string
  glyph: string
}

const DESTINATIONS: Destination[] = [
  { id: 'easy', label: 'Easy', glyph: 'bolt' },
  { id: 'expert', label: 'Expert', glyph: 'tune' },
  { id: 'plain', label: 'Plain', glyph: 'terminal' },
  { id: 'queue', label: 'Queue', glyph: 'list_alt' },
  { id: 'console', label: 'Console', glyph: 'subject' },
]

export function NavRail({ active, onSelect }: { active: ModeId; onSelect: (id: ModeId) => void }) {
  return (
    <nav
      style={{
        width: 76,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.line}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        paddingTop: 8,
      }}
      aria-label="Main navigation"
    >
      {DESTINATIONS.map((d) => {
        const isActive = d.id === active
        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            aria-current={isActive ? 'page' : undefined}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '10px 4px',
              margin: '2px 8px',
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              background: isActive ? 'rgba(130,213,204,0.16)' : 'transparent',
              color: isActive ? colors.primary : colors.muted,
            }}
          >
            <i className="msym" style={{ fontSize: 20 }}>
              {d.glyph}
            </i>
            <span style={{ fontSize: 11 }}>{d.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
