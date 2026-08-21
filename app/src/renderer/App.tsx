import { useState } from 'react'
import { ConsolePane } from './components/ConsolePane'
import { EasyMode } from './components/EasyMode'
import { ExpertMode } from './components/ExpertMode'
import { NavRail, type ModeId } from './components/NavRail'
import { PlainMode } from './components/PlainMode'
import { QueuePane } from './components/QueuePane'
import { TitleBar } from './components/TitleBar'
import { colors } from './theme'
import { useJobs } from './useJobs'

const TITLES: Record<ModeId, string> = {
  easy: 'Easy',
  expert: 'Expert',
  plain: 'Plain',
  queue: 'Queue',
  console: 'Console',
}

export function App() {
  const [mode, setMode] = useState<ModeId>('easy')
  const { jobs, logs, start, cancel, retry, remove, bridgeAvailable } = useJobs()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: colors.bg,
        color: colors.text,
      }}
    >
      <TitleBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <NavRail active={mode} onSelect={setMode} />
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            style={{
              padding: '14px 20px',
              borderBottom: `1px solid ${colors.line}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <h1 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{TITLES[mode]}</h1>
            {!bridgeAvailable && (
              <span style={{ fontSize: 11, color: colors.danger }}>
                Preload bridge unavailable — running outside Electron; downloads cannot start.
              </span>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: mode === 'expert' ? 'hidden' : 'auto', padding: mode === 'expert' ? 0 : '20px' }}>
            {mode === 'easy' && <EasyMode onStart={start} />}
            {mode === 'expert' && <ExpertMode onStart={start} />}
            {mode === 'plain' && <PlainMode onStart={start} />}
            {mode === 'queue' && <QueuePane jobs={jobs} onCancel={cancel} onRetry={retry} onRemove={remove} />}
            {mode === 'console' && (
              <div style={{ height: '100%' }}>
                <ConsolePane logs={logs} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
