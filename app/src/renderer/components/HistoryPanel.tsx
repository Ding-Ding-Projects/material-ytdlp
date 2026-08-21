import { useEffect, useMemo, useState } from 'react'
import { palette } from '../theme'
import { Icon } from './Icon'
import { HistoryFilters, applyHistoryFilters, describeHistoryFilterScope } from './HistoryFilters'
import type {
  HistoryCommit,
  HistoryDiffResult,
  HistoryDownloadRecord,
  HistoryExportFormat,
  HistoryFilterState,
  HistoryRetentionSetting,
  HistorySnapshot,
  HistoryStatus,
} from '../../shared/history-contract'
import { DEFAULT_HISTORY_FILTERS, DEFAULT_HISTORY_RETENTION } from '../../shared/history-contract'

function formatBytes(n: number | null): string {
  if (n === null) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function dayKey(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function ACTION_ICON(action: HistoryCommit['action']): string {
  switch (action) {
    case 'added':
      return 'add_circle'
    case 'started':
      return 'play_circle'
    case 'completed':
      return 'check_circle'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'cancel'
    case 'retried':
      return 'replay'
    case 'removed':
      return 'delete'
    case 'bulk-removed':
      return 'delete_sweep'
    case 'restored-entry':
    case 'restored-list':
      return 'restore'
    case 'app-closed':
      return 'power_settings_new'
    default:
      return 'history'
  }
}

const chipButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  color: palette.text,
  padding: '4px 10px',
  fontSize: 11,
  cursor: 'pointer',
}

export function HistoryPanel() {
  const api = window.ytdlpStudio.history

  const [status, setStatus] = useState<HistoryStatus | null>(null)
  const [snapshot, setSnapshot] = useState<HistorySnapshot>({})
  const [commits, setCommits] = useState<HistoryCommit[]>([])
  const [filters, setFilters] = useState<HistoryFilterState>(DEFAULT_HISTORY_FILTERS)
  const [retention, setRetention] = useState<HistoryRetentionSetting>(DEFAULT_HISTORY_RETENTION)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [diff, setDiff] = useState<HistoryDiffResult | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectAllMode, setSelectAllMode] = useState<'page' | 'all' | null>(null)
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    const [st, commitList, filterState, retentionState] = await Promise.all([
      api.status(),
      api.listCommits(),
      api.getFilters().catch(() => DEFAULT_HISTORY_FILTERS),
      api.getRetention().catch(() => DEFAULT_HISTORY_RETENTION),
    ])
    setStatus(st)
    setCommits(commitList)
    setFilters(filterState)
    setRetention(retentionState)
    const full = await api.getFullSnapshot().catch(() => ({}) as HistorySnapshot)
    setSnapshot(full)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void api.setFilters(filters).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const records = useMemo(() => Object.values(snapshot), [snapshot])
  const filtered = useMemo(() => applyHistoryFilters(records, filters), [records, filters])
  const scopeDescription = describeHistoryFilterScope(filters, filtered.length, records.length)

  const grouped = useMemo(() => {
    const map = new Map<string, HistoryDownloadRecord[]>()
    for (const r of filtered) {
      const key = dayKey(r.addedAt)
      const arr = map.get(key) ?? []
      arr.push(r)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [filtered])

  const visibleCommits = useMemo(() => api.applyRetentionView(commits, retention), [commits, retention, api])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllOnPage() {
    setSelectedIds(new Set(filtered.map((r) => r.id)))
    setSelectAllMode('page')
  }

  function selectEveryMatch() {
    setSelectedIds(new Set(filtered.map((r) => r.id)))
    setSelectAllMode('all')
  }

  function invertSelection() {
    setSelectedIds((prev) => {
      const next = new Set<string>()
      for (const r of filtered) if (!prev.has(r.id)) next.add(r.id)
      return next
    })
    setSelectAllMode(null)
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setSelectAllMode(null)
  }

  async function performBulkDelete() {
    const ids = [...selectedIds]
    await api.bulkRemove(ids)
    setConfirmingBulkDelete(false)
    clearSelection()
    await refresh()
  }

  async function doExport(format: HistoryExportFormat, scope: 'selected' | 'filtered') {
    const ids = scope === 'selected' ? [...selectedIds] : filtered.map((r) => r.id)
    const result = await api.exportEntries({
      format,
      ids,
      scopeDescription: scope === 'selected' ? `${ids.length} selected entries` : scopeDescription,
    })
    const blob = new Blob([result.content], { type: result.mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.suggestedFilename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function viewDiff(sha: string) {
    setSelectedCommit(sha)
    const d = await api.getDiff(sha).catch(() => null)
    setDiff(d)
  }

  async function restoreEntry(id: string, fromSha: string) {
    await api.restoreEntry(id, fromSha)
    await refresh()
  }

  async function restoreWholeList(sha: string) {
    await api.restoreList(sha)
    await refresh()
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: palette.muted }}>
        Loading history…
      </div>
    )
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {status && !status.gitAvailable && (
        <div
          role="status"
          style={{
            padding: '8px 16px',
            background: 'rgba(232,192,125,0.12)',
            borderBottom: `1px solid ${palette.border}`,
            color: palette.warn,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="warning" size={16} />
          Version history is unavailable{status.reason ? `: ${status.reason}` : '.'} The download list still works
          normally — restore and diff just aren't available until git is on PATH.
        </div>
      )}

      <HistoryFilters records={records} filters={filters} onChange={setFilters} onClearAll={() => setFilters(DEFAULT_HISTORY_FILTERS)} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', borderBottom: `1px solid ${palette.border}`, fontSize: 11, color: palette.muted, flexWrap: 'wrap' }}>
        <span>{scopeDescription}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={chipButtonStyle} onClick={selectAllOnPage}>
          Select all (this view)
        </button>
        <button type="button" style={chipButtonStyle} onClick={selectEveryMatch}>
          Select every match
        </button>
        <button type="button" style={chipButtonStyle} onClick={invertSelection}>
          Invert selection
        </button>
        {selectedIds.size > 0 && (
          <button type="button" style={chipButtonStyle} onClick={clearSelection}>
            Clear ({selectedIds.size})
          </button>
        )}
        <button type="button" style={chipButtonStyle} disabled={selectedIds.size === 0} onClick={() => void doExport('json', 'selected')}>
          Export selected JSON
        </button>
        <button type="button" style={chipButtonStyle} disabled={selectedIds.size === 0} onClick={() => void doExport('csv', 'selected')}>
          CSV
        </button>
        <button type="button" style={chipButtonStyle} disabled={selectedIds.size === 0} onClick={() => void doExport('markdown', 'selected')}>
          Markdown
        </button>
        <button type="button" style={chipButtonStyle} onClick={() => void doExport('json', 'filtered')}>
          Export filtered view
        </button>
        <button
          type="button"
          disabled={selectedIds.size === 0}
          onClick={() => setConfirmingBulkDelete(true)}
          style={{ ...chipButtonStyle, borderColor: palette.error, color: palette.error }}
        >
          <Icon name="delete_sweep" size={13} /> Delete selected
        </button>
      </div>

      {confirmingBulkDelete && (
        <div
          role="alertdialog"
          aria-label="Confirm bulk delete"
          style={{
            padding: 12,
            background: 'rgba(242,184,181,0.1)',
            borderBottom: `1px solid ${palette.error}`,
            fontSize: 12,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <Icon name="warning" size={16} color={palette.error} />
          <span>
            Remove {selectedIds.size} download{selectedIds.size === 1 ? '' : 's'} from history
            {selectAllMode === 'all' ? ' (every match, not just this page)' : ''}? This is recorded as its own history
            commit and can be undone from the commit log below.
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" style={chipButtonStyle} onClick={() => setConfirmingBulkDelete(false)}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...chipButtonStyle, background: palette.error, color: palette.onPrimary, borderColor: palette.error }}
            onClick={() => void performBulkDelete()}
          >
            Delete {selectedIds.size}
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 2, minWidth: 0, overflowY: 'auto', padding: 12 }}>
          {filtered.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 48, color: palette.muted, textAlign: 'center' }}>
              <Icon name="filter_alt_off" size={26} />
              <div style={{ color: palette.text }}>
                {records.length === 0 ? 'No downloads recorded yet' : 'No entries match the active filters'}
              </div>
              {records.length > 0 && <div style={{ fontSize: 12 }}>{scopeDescription}</div>}
            </div>
          ) : (
            grouped.map(([day, entries]) => (
              <div key={day} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: palette.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{day}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {entries
                    .sort((a, b) => b.addedAt - a.addedAt)
                    .map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: selectedIds.has(r.id) ? 'rgba(130,213,204,0.08)' : palette.bgRaised,
                          border: `1px solid ${palette.border}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.title ?? r.url}`}
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                        />
                        <Icon name={r.state === 'error' ? 'error' : r.state === 'done' ? 'check_circle' : 'download'} size={16} color={r.state === 'error' ? palette.error : palette.muted} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title ?? r.url}</div>
                          <div style={{ fontSize: 11, color: palette.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {new Date(r.updatedAt).toLocaleTimeString()} · {r.state} · {formatBytes(r.sizeBytes)} · {formatDuration(r.durationSec)}
                            {r.extractor ? ` · ${r.extractor}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ flex: 1, minWidth: 280, maxWidth: 420, borderLeft: `1px solid ${palette.border}`, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <RetentionControl retention={retention} onChange={async (r) => { setRetention(r); await api.setRetention(r) }} />

          <div>
            <div style={{ fontSize: 11, color: palette.muted, marginBottom: 6, textTransform: 'uppercase' }}>
              Commit log{retention.mode !== 'keep-everything' ? ' (view limited by retention — nothing is deleted from the repository)' : ''}
            </div>
            {visibleCommits.length === 0 ? (
              <div style={{ fontSize: 12, color: palette.muted }}>No history commits yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {visibleCommits.map((c) => (
                  <button
                    key={c.sha}
                    type="button"
                    onClick={() => void viewDiff(c.sha)}
                    aria-pressed={selectedCommit === c.sha}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      textAlign: 'left',
                      padding: 8,
                      borderRadius: 8,
                      border: `1px solid ${selectedCommit === c.sha ? palette.primary : palette.border}`,
                      background: selectedCommit === c.sha ? 'rgba(130,213,204,0.08)' : 'transparent',
                      color: palette.text,
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name={ACTION_ICON(c.action)} size={15} color={palette.muted} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>{c.message}</div>
                      <div style={{ fontSize: 10, color: palette.muted }}>{new Date(c.timestamp).toLocaleString()}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {diff && (
            <div style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 10 }}>
              <div style={{ fontSize: 11, color: palette.muted, marginBottom: 6, textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>Diff inspector</span>
                <button type="button" style={chipButtonStyle} onClick={() => void restoreWholeList(diff.commit.sha)}>
                  Restore whole list to here
                </button>
              </div>
              {diff.items.length === 0 ? (
                <div style={{ fontSize: 12, color: palette.muted }}>No changes recorded in this commit.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {diff.items.map((item) => (
                    <div key={item.id} style={{ padding: 8, borderRadius: 8, border: `1px solid ${palette.border}`, fontSize: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: item.kind === 'added' ? palette.primary : item.kind === 'removed' ? palette.error : palette.warn }}>
                          {item.kind === 'added' ? '+ added' : item.kind === 'removed' ? '− removed' : '~ changed'}
                        </span>
                        {item.kind === 'removed' && (
                          <button type="button" style={chipButtonStyle} onClick={() => void restoreEntry(item.id, diff.commit.sha)}>
                            Restore
                          </button>
                        )}
                      </div>
                      <div style={{ marginTop: 4 }}>{(item.after ?? item.before)?.title ?? (item.after ?? item.before)?.url}</div>
                      {item.changedFields.length > 0 && (
                        <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: palette.muted }}>
                          {item.changedFields.map((f) => (
                            <li key={String(f.field)}>
                              {String(f.field)}: {JSON.stringify(f.before)} → {JSON.stringify(f.after)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RetentionControl({
  retention,
  onChange,
}: {
  retention: HistoryRetentionSetting
  onChange: (r: HistoryRetentionSetting) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: palette.muted, marginBottom: 6, textTransform: 'uppercase' }}>Retention</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name="retention-mode"
            checked={retention.mode === 'keep-everything'}
            onChange={() => onChange({ ...retention, mode: 'keep-everything' })}
          />
          Keep everything
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name="retention-mode"
            checked={retention.mode === 'prune-by-count'}
            onChange={() => onChange({ ...retention, mode: 'prune-by-count' })}
          />
          Show only the newest
          <input
            type="number"
            min={1}
            value={retention.maxEntries}
            onChange={(e) => onChange({ ...retention, mode: 'prune-by-count', maxEntries: Number(e.target.value) || 1 })}
            style={{ width: 60, ...chipButtonStyle }}
          />
          entries
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name="retention-mode"
            checked={retention.mode === 'prune-by-age'}
            onChange={() => onChange({ ...retention, mode: 'prune-by-age' })}
          />
          Show only the last
          <input
            type="number"
            min={1}
            value={retention.maxAgeDays}
            onChange={(e) => onChange({ ...retention, mode: 'prune-by-age', maxAgeDays: Number(e.target.value) || 1 })}
            style={{ width: 60, ...chipButtonStyle }}
          />
          days
        </label>
        <div style={{ fontSize: 10, color: palette.muted }}>
          Retention only limits what's shown here. Nothing is ever deleted from the underlying history repository —
          restores always stay possible.
        </div>
      </div>
    </div>
  )
}

