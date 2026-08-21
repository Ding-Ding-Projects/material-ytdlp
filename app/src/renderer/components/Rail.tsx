import { Icon } from './Icon'
import { palette } from '../theme'

export type RailDestination =
  | 'download'
  | 'queue'
  | 'history'
  | 'appearance'
  | 'command-palette'
  | 'locks'
  | 'authenticator'
  | 'languages'

export interface RailItem {
  id: RailDestination
  label: string
  glyph: string
  /** false = this destination is a marked-unimplemented stub, not a live surface. */
  implemented: boolean
}

export const RAIL_ITEMS: RailItem[] = [
  { id: 'download', label: 'Download', glyph: 'download', implemented: true },
  { id: 'queue', label: 'Queue & Console', glyph: 'list_alt', implemented: true },
  { id: 'history', label: 'History', glyph: 'history', implemented: false },
  { id: 'appearance', label: 'Appearance', glyph: 'palette', implemented: false },
  { id: 'command-palette', label: 'Command Palette', glyph: 'keyboard_command_key', implemented: false },
  { id: 'locks', label: 'Locks', glyph: 'lock', implemented: false },
  { id: 'authenticator', label: 'Authenticator', glyph: 'key', implemented: false },
  { id: 'languages', label: 'Languages', glyph: 'translate', implemented: false },
]

export function Rail({
  active,
  onSelect,
}: {
  active: RailDestination
  onSelect: (id: RailDestination) => void
}) {
  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        height: '100%',
        background: palette.bg,
        borderRight: `1px solid ${palette.border}`,
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        overflow: 'auto',
        flex: '0 0 auto',
      }}
    >
      {RAIL_ITEMS.map((item) => {
        const isActive = item.id === active
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            title={item.implemented ? item.label : `${item.label} (not yet implemented)`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 40,
              padding: '0 12px',
              borderRadius: 20,
              background: isActive ? '#1c2926' : 'transparent',
              color: isActive ? palette.primary : palette.textDim,
              fontSize: 13,
              textAlign: 'left',
            }}
          >
            <Icon name={item.glyph} size={18} />
            <span style={{ flex: 1 }}>{item.label}</span>
            {!item.implemented && (
              <span
                style={{
                  fontSize: 9,
                  color: palette.muted,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 8,
                  padding: '1px 6px',
                }}
              >
                soon
              </span>
            )}
          </button>
        )
      })}
    </aside>
  )
}
