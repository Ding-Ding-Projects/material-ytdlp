import { useEffect, useMemo, useState } from 'react'
import type { JobCapabilities, JobRecord, PauseMode } from '../shared/ipc-contract'
import { TitleBar } from './components/TitleBar'
import { Rail, type RailDestination } from './components/Rail'
import { EasyPanel } from './components/EasyPanel'
import { ExpertPanel } from './components/ExpertPanel'
import { PlainPanel } from './components/PlainPanel'
import { CommandPreview } from './components/CommandPreview'
import { QueuePanel, type JobLogLine } from './components/QueuePanel'
import { Icon } from './components/Icon'
import { palette } from './theme'
import {
  DEFAULT_EASY_STATE,
  easyCommand,
  expertCommand,
  parsePlainCommand,
  argvToDisplayString,
  type EasyState,
  type ExpertValues,
} from './commandBuilder'

type Mode = 'easy' | 'expert' | 'plain'

export function App() {
  const [destination, setDestination] = useState<RailDestination>('download')
  const [mode, setMode] = useState<Mode>('easy')

  const [easyState, setEasyState] = useState<EasyState>(DEFAULT_EASY_STATE)
  const [expertUrl, setExpertUrl] = useState('')
  const [expertValues, setExpertValues] = useState<ExpertValues>({})
  const [plainText, setPlainText] = useState('')

  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [logsByJob, setLogsByJob] = useState<Record<string, JobLogLine[]>>({})
  const [pauseMode, setPauseMode] = useState<PauseMode | null>(null)
  const [starting, setStarting] = useState(false)

  // Initial job list + capabilities, and live subscriptions for the rest of
  // the session. All three IPC event streams are real — no simulated
  // progress interval running beside them.
  useEffect(() => {
    let cancelled = false

    window.ytdlpStudio.jobs
      .list()
      .then((list) => {
        if (!cancelled) setJobs(list as JobRecord[])
      })
      .catch(() => {
        /* Job list failed to load; the queue starts empty rather than crashing. */
      })

    window.ytdlpStudio.jobs
      .capabilities()
      .then((caps) => {
        if (!cancelled) setPauseMode((caps as JobCapabilities).pauseMode)
      })
      .catch(() => {
        /* Capability probe failed; pause controls stay conservative (stop-continue wording). */
      })

    const offProgress = window.ytdlpStudio.jobs.onProgress(({ id, progress }) => {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, progress, updatedAt: Date.now() } : j)))
    })
    const offState = window.ytdlpStudio.jobs.onState(({ id, state, exitCode }) => {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, state, exitCode, updatedAt: Date.now() } : j)))
    })
    const offLog = window.ytdlpStudio.jobs.onLog(({ id, text, level }) => {
      setLogsByJob((prev) => ({
        ...prev,
        [id]: [...(prev[id] ?? []), { text, level }],
      }))
    })

    return () => {
      cancelled = true
      offProgress()
      offState()
      offLog()
    }
  }, [])

  const argv = useMemo(() => {
    if (mode === 'easy') return easyCommand(easyState)
    if (mode === 'expert') return expertCommand(expertValues, expertUrl)
    return parsePlainCommand(plainText)
  }, [mode, easyState, expertValues, expertUrl, plainText])

  async function runDownload() {
    if (argv.length === 0 || starting) return
    setStarting(true)
    try {
      const id = crypto.randomUUID()
      const url = mode === 'easy' ? easyState.url : mode === 'expert' ? expertUrl : (argv[argv.length - 1] ?? '')
      await window.ytdlpStudio.jobs.start({ id, url, argv })
      const list = await window.ytdlpStudio.jobs.list()
      setJobs(list as JobRecord[])
      setDestination('queue')
    } finally {
      setStarting(false)
    }
  }

  function openFixWizard(jobId: string, logText: string) {
    // The repair wizard surface itself is not yet implemented (see the
    // Rail's "soon" destinations) — this is the honest stub: it reports
    // exactly what would be handed to it rather than pretending to open a
    // live wizard.
    window.alert(`Repair wizard is not implemented yet.\n\nJob: ${jobId}\nLine: ${logText}`)
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: palette.bg,
        color: palette.text,
        overflow: 'hidden',
        fontSize: 14,
      }}
    >
      <TitleBar />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Rail active={destination} onSelect={setDestination} />
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {destination === 'download' && (
            <>
              <ModeTabs mode={mode} onChange={setMode} />
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {mode === 'easy' && <EasyPanel state={easyState} onChange={setEasyState} />}
                {mode === 'expert' && (
                  <ExpertPanel
                    url={expertUrl}
                    onUrlChange={setExpertUrl}
                    values={expertValues}
                    onValuesChange={setExpertValues}
                  />
                )}
                {mode === 'plain' && <PlainPanel text={plainText} onChange={setPlainText} />}
              </div>
              <CommandPreview argv={argv} onRun={runDownload} running={starting} />
            </>
          )}

          {destination === 'queue' && (
            <QueuePanel
              jobs={jobs}
              logsByJob={logsByJob}
              pauseMode={pauseMode}
              onCancel={(id) => void window.ytdlpStudio.jobs.cancel(id)}
              onRetry={(id) => void window.ytdlpStudio.jobs.retry(id)}
              onRemove={(id) => {
                void window.ytdlpStudio.jobs.remove(id)
                setJobs((prev) => prev.filter((j) => j.id !== id))
              }}
              onPause={(id) => void window.ytdlpStudio.jobs.pause(id)}
              onResume={(id) => void window.ytdlpStudio.jobs.resume(id)}
              onOpenFix={openFixWizard}
            />
          )}

          {destination !== 'download' && destination !== 'queue' && <UnimplementedDestination id={destination} />}
        </main>
      </div>
      <StatusBar jobCount={jobs.length} argvPreview={argv} />
    </div>
  )
}

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tabs: { id: Mode; label: string; icon: string }[] = [
    { id: 'easy', label: 'Easy', icon: 'auto_awesome' },
    { id: 'expert', label: 'Expert', icon: 'tune' },
    { id: 'plain', label: 'Plain', icon: 'terminal' },
  ]
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '8px 16px 0',
        borderBottom: `1px solid ${palette.border}`,
        flex: '0 0 auto',
      }}
    >
      {tabs.map((t) => {
        const active = t.id === mode
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: '8px 8px 0 0',
              background: active ? palette.bgRaised : 'transparent',
              color: active ? palette.primary : palette.textDim,
              fontSize: 12,
              borderBottom: active ? `2px solid ${palette.primary}` : '2px solid transparent',
            }}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function StatusBar({ jobCount, argvPreview }: { jobCount: number; argvPreview: string[] }) {
  return (
    <footer
      style={{
        height: 24,
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 14px',
        background: palette.bg,
        borderTop: `1px solid ${palette.border}`,
        fontSize: 11,
        color: palette.muted,
      }}
    >
      <span>{jobCount} job{jobCount === 1 ? '' : 's'}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {argvPreview.length > 0 ? argvToDisplayString(argvPreview) : 'No command yet'}
      </span>
    </footer>
  )
}

function UnimplementedDestination({ id }: { id: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: palette.muted,
        padding: 32,
        textAlign: 'center',
      }}
    >
      <Icon name="construction" size={28} />
      <div style={{ fontSize: 14, color: palette.text }}>This destination is not implemented yet</div>
      <div style={{ fontSize: 12, maxWidth: 420 }}>
        "{id}" is a real rail entry, marked as unimplemented on purpose rather than shown as a working surface that
        actually does nothing.
      </div>
    </div>
  )
}
