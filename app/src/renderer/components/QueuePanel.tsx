import { useMemo, useState } from 'react'
import type { JobLogEvent, JobRecord, PauseMode } from '../../shared/ipc-contract'
import { palette } from '../theme'
import { Icon } from './Icon'

export interface JobLogLine {
  text: string
  level: JobLogEvent['level']
}

const STATE_COLOR: Record<JobRecord['state'], string> = {
  queued: palette.muted,
  running: palette.primary,
  paused: palette.warn,
  done: palette.primary,
  error: palette.error,
  cancelled: palette.muted,
}

export function QueuePanel({
  jobs,
  logsByJob,
  pauseMode,
  onCancel,
  onRetry,
  onRemove,
  onPause,
  onResume,
  onOpenFix,
}: {
  jobs: JobRecord[]
  logsByJob: Record<string, JobLogLine[]>
  pauseMode: PauseMode | null
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onOpenFix: (jobId: string, logText: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const activeId = selected && jobs.some((j) => j.id === selected) ? selected : (jobs[0]?.id ?? null)
  const activeLogs = activeId ? (logsByJob[activeId] ?? []) : []

  const pauseLabel = useMemo(() => {
    if (pauseMode === 'suspend') return 'Pause'
    // Windows has no real process suspend. Being honest about this rather
    // than claiming a "pause" that does not really pause: it stops the
    // process, and resume respawns yt-dlp with --continue.
    return 'Stop (resume continues the file)'
  }, [pauseMode])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: '0 0 40%', minHeight: 120, overflow: 'auto', borderBottom: `1px solid ${palette.border}` }}>
        {jobs.length === 0 ? (
          <div style={{ padding: 24, color: palette.muted, fontSize: 13 }}>
            No jobs yet. Start a download from the Download destination and it will show up here.
          </div>
        ) : (
          jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              selected={job.id === activeId}
              pauseLabel={pauseLabel}
              onSelect={() => setSelected(job.id)}
              onCancel={() => onCancel(job.id)}
              onRetry={() => onRetry(job.id)}
              onRemove={() => onRemove(job.id)}
              onPause={() => onPause(job.id)}
              onResume={() => onResume(job.id)}
            />
          ))
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 14px', fontSize: 11, color: palette.muted, flex: '0 0 auto' }}>
          Console {activeId ? `— job ${activeId.slice(0, 8)}` : ''}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 14px 14px', fontFamily: 'Roboto Mono, Consolas, monospace', fontSize: 12 }}>
          {activeLogs.length === 0 ? (
            <div style={{ color: palette.muted }}>No output yet.</div>
          ) : (
            activeLogs.map((line, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  color: line.level === 'error' ? palette.error : line.level === 'warn' ? palette.warn : palette.textDim,
                  padding: '2px 0',
                }}
              >
                <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line.text}</span>
                {(line.level === 'error' || line.level === 'warn') && activeId && (
                  <button
                    onClick={() => onOpenFix(activeId, line.text)}
                    title="Open the repair wizard for this line"
                    style={{
                      flex: '0 0 auto',
                      fontSize: 11,
                      padding: '1px 8px',
                      borderRadius: 10,
                      background: 'transparent',
                      border: `1px solid ${palette.border}`,
                      color: palette.primary,
                    }}
                  >
                    ⚑ Fix
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function JobRow({
  job,
  selected,
  pauseLabel,
  onSelect,
  onCancel,
  onRetry,
  onRemove,
  onPause,
  onResume,
}: {
  job: JobRecord
  selected: boolean
  pauseLabel: string
  onSelect: () => void
  onCancel: () => void
  onRetry: () => void
  onRemove: () => void
  onPause: () => void
  onResume: () => void
}) {
  const p = job.progress
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 14px',
        borderBottom: `1px solid ${palette.border}`,
        background: selected ? '#151b1a' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: STATE_COLOR[job.state],
            flex: '0 0 auto',
          }}
        />
        <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.url}
        </span>
        <span style={{ fontSize: 11, color: palette.muted, textTransform: 'capitalize' }}>{job.state}</span>
      </div>

      {/* Bound to the aggregated, monotonic `pct` field — never the raw
          per-fragment percentage, which resets near 0% at the start of
          every fragment and would make this bar jitter and repeatedly
          claim completion. */}
      <div style={{ height: 4, borderRadius: 2, background: '#242b2a', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${clampPct(p.pct)}%`,
            background: job.state === 'error' ? palette.error : palette.primary,
            transition: 'width 200ms ease',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: palette.muted, flexWrap: 'wrap' }}>
        {p.pct && <span>{p.pct}</span>}
        {p.rate && <span>{p.rate}</span>}
        {/* size and eta can legitimately be null (yt-dlp reports N/A on
            fragmented downloads) — render nothing rather than "NaN" or
            "0" for a value that was never known. */}
        {p.size && <span>{p.size}</span>}
        {p.eta && <span>ETA {p.eta}</span>}
        {p.frags && <span>{p.frags} frags</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
        {job.state === 'running' && (
          <RowButton icon="pause" label={pauseLabel} onClick={onPause} />
        )}
        {job.state === 'paused' && <RowButton icon="play_arrow" label="Resume" onClick={onResume} />}
        {(job.state === 'running' || job.state === 'paused' || job.state === 'queued') && (
          <RowButton icon="close" label="Cancel" onClick={onCancel} />
        )}
        {(job.state === 'error' || job.state === 'cancelled') && (
          <RowButton icon="refresh" label="Retry" onClick={onRetry} />
        )}
        {(job.state === 'done' || job.state === 'error' || job.state === 'cancelled') && (
          <RowButton icon="delete" label="Remove" onClick={onRemove} />
        )}
      </div>
    </div>
  )
}

function RowButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 10,
        background: 'transparent',
        border: `1px solid ${palette.border}`,
        color: palette.textDim,
      }}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  )
}

function clampPct(pct: string | null): number {
  if (!pct) return 0
  const n = parseFloat(pct)
  if (Number.isNaN(n)) return 0
  return Math.min(100, Math.max(0, n))
}
