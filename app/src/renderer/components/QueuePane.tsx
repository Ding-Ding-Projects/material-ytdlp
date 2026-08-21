import { colors } from '../theme'
import { Button } from './fields'
import type { JobRecord } from '../../shared/ipc-contract'

const STATE_COLOR: Record<JobRecord['state'], string> = {
  queued: colors.muted,
  running: colors.primary,
  paused: colors.warn,
  done: colors.primary,
  error: colors.danger,
  cancelled: colors.muted,
}

function pctNumber(pct: string | null): number | null {
  if (!pct) return null
  const n = parseFloat(pct)
  return Number.isFinite(n) ? n : null
}

export function QueuePane({
  jobs,
  onCancel,
  onRetry,
  onRemove,
}: {
  jobs: JobRecord[]
  onCancel: (id: string) => void
  onRetry: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (jobs.length === 0) {
    return (
      <div style={{ color: colors.muted, fontSize: 13, padding: 24, textAlign: 'center' }} role="status">
        No downloads yet. Start one from Easy, Expert, or Plain.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {jobs.map((job) => {
        // pct is the aggregated, monotonic progress field — never
        // fragmentPct, which resets per-fragment and would jitter a bar.
        const pct = pctNumber(job.progress.pct)
        return (
          <div
            key={job.id}
            style={{
              border: `1px solid ${colors.line}`,
              borderRadius: 10,
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: colors.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job.url}
              </span>
              <span style={{ fontSize: 11, color: STATE_COLOR[job.state], textTransform: 'uppercase' }}>{job.state}</span>
            </div>

            <div style={{ height: 6, borderRadius: 3, background: colors.line, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct ?? 0}%`,
                  background: colors.primary,
                  transition: 'width 200ms ease',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.muted }}>
              <span>{pct !== null ? `${pct.toFixed(1)}%` : '—'}</span>
              <span>{job.progress.rate ?? '—'}</span>
              {/* size and eta legitimately come back null on fragmented
                  downloads (yt-dlp reports N/A) — render a dash, never NaN/0. */}
              <span>{job.progress.size ?? '—'}</span>
              <span>ETA {job.progress.eta ?? '—'}</span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {(job.state === 'running' || job.state === 'queued' || job.state === 'paused') && (
                <Button onClick={() => onCancel(job.id)}>
                  <i className="msym">stop</i>
                  Cancel
                </Button>
              )}
              {(job.state === 'error' || job.state === 'cancelled') && (
                <Button onClick={() => onRetry(job.id)}>
                  <i className="msym">refresh</i>
                  Retry
                </Button>
              )}
              {(job.state === 'done' || job.state === 'error' || job.state === 'cancelled') && (
                <Button onClick={() => onRemove(job.id)}>
                  <i className="msym">delete</i>
                  Remove
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
