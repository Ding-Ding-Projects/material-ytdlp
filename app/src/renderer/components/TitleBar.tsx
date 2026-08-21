import { useEffect, useState } from 'react'
import { getBridge } from '../bridge'
import { colors } from '../theme'

type DragCSS = React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const btnStyle: DragCSS = {
  WebkitAppRegion: 'no-drag',
  width: 46,
  height: 32,
  border: 'none',
  background: 'transparent',
  color: colors.muted,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const bridge = getBridge()

  useEffect(() => {
    if (!bridge) return
    bridge.window.isMaximized().then(setMaximized).catch(() => {})
  }, [bridge])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        background: colors.surface,
        borderBottom: `1px solid ${colors.line}`,
        WebkitAppRegion: 'drag',
        flexShrink: 0,
      } as DragCSS}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, fontSize: 13, color: colors.text }}>
        <i className="msym" style={{ color: colors.primary, fontSize: 16 }}>
          movie
        </i>
        <span>yt-dlp Studio</span>
      </div>
      <div style={{ flex: 1 }} />
      <button
        aria-label="Minimize"
        style={btnStyle}
        onClick={() => bridge?.window.minimize().catch(() => {})}
      >
        <i className="msym">remove</i>
      </button>
      <button
        aria-label={maximized ? 'Restore' : 'Maximize'}
        style={btnStyle}
        onClick={async () => {
          if (!bridge) return
          if (maximized) {
            await bridge.window.unmaximize().catch(() => {})
          } else {
            await bridge.window.maximize().catch(() => {})
          }
          bridge.window.isMaximized().then(setMaximized).catch(() => {})
        }}
      >
        <i className="msym">{maximized ? 'fullscreen_exit' : 'crop_square'}</i>
      </button>
      <button
        aria-label="Close"
        style={{ ...btnStyle, color: colors.danger }}
        onClick={() => bridge?.window.close().catch(() => {})}
      >
        <i className="msym">close</i>
      </button>
    </div>
  )
}
