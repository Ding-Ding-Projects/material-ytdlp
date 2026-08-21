import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './Icon'
import { palette } from '../theme'

/**
 * Frameless custom Material title bar. Calls the preload's window-control
 * bridge for real minimize/maximize/close, rather than a decorative shell
 * that draws window-control-shaped buttons and does nothing.
 */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.ytdlpStudio.window
      .isMaximized()
      .then((v) => {
        if (!cancelled) setMaximized(v)
      })
      .catch(() => {
        /* Window-state probe failed; leave the default (not maximized). */
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function minimize() {
    await window.ytdlpStudio.window.minimize()
  }

  async function toggleMaximize() {
    if (maximized) {
      await window.ytdlpStudio.window.unmaximize()
      setMaximized(false)
    } else {
      await window.ytdlpStudio.window.maximize()
      setMaximized(true)
    }
  }

  async function close() {
    await window.ytdlpStudio.window.close()
  }

  return (
    <header
      style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 8px 0 16px',
        background: palette.bg,
        flex: '0 0 auto',
        borderBottom: `1px solid ${palette.border}`,
        // Lets the OS drag the window from this bar; buttons opt back out below.
        WebkitAppRegion: 'drag',
      } as CSSProperties}
    >
      <div
        style={{
          width: 28,
          height: 28,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 10,
          background: palette.primary,
          color: palette.onPrimary,
          fontWeight: 500,
          fontSize: 14,
          flex: '0 0 auto',
        }}
      >
        Y
      </div>
      <div style={{ fontWeight: 500, fontSize: 13 }}>yt-dlp Studio</div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <TitleBarButton title="Minimize" onClick={minimize}>
          <Icon name="remove" size={16} color={palette.textDim} />
        </TitleBarButton>
        <TitleBarButton title={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximize}>
          <Icon name={maximized ? 'filter_none' : 'crop_square'} size={14} color={palette.textDim} />
        </TitleBarButton>
        <TitleBarButton title="Close" onClick={close} danger>
          <Icon name="close" size={16} color={palette.textDim} />
        </TitleBarButton>
      </div>
    </header>
  )
}

function TitleBarButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 40,
        height: 40,
        borderRadius: 0,
        background: hover ? (danger ? '#8c2f2c' : '#1c2322') : 'transparent',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {children}
    </button>
  )
}
