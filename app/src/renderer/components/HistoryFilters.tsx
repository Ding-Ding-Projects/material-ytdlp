import { useEffect, useMemo, useRef, useState } from 'react'
import { palette } from '../theme'
import { Icon } from './Icon'
import type {
  HistoryActionType,
  HistoryDownloadRecord,
  HistoryDownloadState,
  HistoryFilterState,
} from '../../shared/history-contract'

// ---------------------------------------------------------------------------
// Facet counting helpers
// ---------------------------------------------------------------------------

function countBy<T extends string>(records: HistoryDownloadRecord[], get: (r: HistoryDownloadRecord) => T | null): Map<T, number> {
  const map = new Map<T, number>()
  for (const r of records) {
    const v = get(r)
    if (v === null) continue
    map.set(v, (map.get(v) ?? 0) + 1)
  }
  return map
}

const ACTION_LABELS: Record<HistoryActionType, string> = {
  added: 'Added',
  started: 'Started',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  retried: 'Retried',
  removed: 'Removed',
  'bulk-removed': 'Bulk removed',
  'restored-entry': 'Restored (one)',
  'restored-list': 'Restored (whole list)',
  'app-closed': 'App closed',
}

const STATE_LABELS: Record<HistoryDownloadState, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  done: 'Done',
  error: 'Failed',
  cancelled: 'Cancelled',
  removed: 'Removed',
}

// ---------------------------------------------------------------------------
// Anchored regex builder popover
// ---------------------------------------------------------------------------

function RegexBuilderPopover({
  pattern,
  flags,
  onApply,
  onClose,
  anchorRef,
}: {
  pattern: string
  flags: string
  onApply: (pattern: string, flags: string) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement>
}) {
  const [draft, setDraft] = useState(pattern)
  const [draftFlags, setDraftFlags] = useState(flags)
  const [sample, setSample] = useState('My Video Title [720p].mp4')
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (popRef.current?.contains(e.target as Node)) return
      if (anchorRef.current?.contains(e.target as Node)) return
      onClose()
      anchorRef.current?.focus()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  const { matches, error } = useMemo(() => {
    if (draft.length > 500) return { matches: false, error: 'Pattern too long (500 character limit).' }
    try {
      const re = new RegExp(draft, draftFlags.replace(/[^gimsuy]/g, ''))
      // Bound the evaluation against catastrophic backtracking with a cheap
      // guard: cap the sample length, since we only ever test one short
      // local string here, never user file content at scale.
      return { matches: re.test(sample.slice(0, 2000)), error: null }
    } catch (err) {
      return { matches: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, [draft, draftFlags, sample])

  function insert(token: string) {
    setDraft((d) => d + token)
  }

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Regex builder"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 6,
        zIndex: 50,
        width: 360,
        maxHeight: 420,
        overflowY: 'auto',
        background: palette.bgRaised,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        color: palette.text,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 12 }}>Regex builder</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Pattern
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Regex pattern"
          style={inputStyle}
          placeholder="e.g. \\.mp4$"
        />
      </label>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          ['.', 'any char'],
          ['\\d', 'digit'],
          ['\\w', 'word char'],
          ['\\s', 'whitespace'],
          ['^', 'start'],
          ['$', 'end'],
          ['*', '0+'],
          ['+', '1+'],
          ['?', '0/1'],
          ['[]', 'class'],
          ['()', 'group'],
          ['|', 'or'],
        ].map(([tok, label]) => (
          <button
            key={tok}
            type="button"
            onClick={() => insert(tok)}
            title={label}
            style={{ ...chipButtonStyle, padding: '3px 8px' }}
          >
            {tok}
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Flags
        <input
          value={draftFlags}
          onChange={(e) => setDraftFlags(e.target.value)}
          aria-label="Regex flags"
          style={inputStyle}
          placeholder="gi"
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Sample text
        <input
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          aria-label="Sample text to test the pattern against"
          style={inputStyle}
        />
      </label>

      <div
        role="status"
        style={{
          fontSize: 11,
          padding: '4px 8px',
          borderRadius: 6,
          background: error ? 'rgba(242,184,181,0.12)' : matches ? 'rgba(130,213,204,0.12)' : 'transparent',
          color: error ? palette.error : matches ? palette.primary : palette.muted,
        }}
      >
        {error ? `Invalid pattern: ${error}` : matches ? 'Matches the sample text' : 'No match on the sample text'}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose} style={chipButtonStyle}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!!error}
          onClick={() => {
            onApply(draft, draftFlags)
            onClose()
          }}
          style={{ ...chipButtonStyle, background: palette.primary, color: palette.onPrimary, borderColor: palette.primary }}
        >
          Apply
        </button>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: palette.bg,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  color: palette.text,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
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

// ---------------------------------------------------------------------------
// Multi-value facet chip group
// ---------------------------------------------------------------------------

function FacetGroup<T extends string>({
  title,
  counts,
  labels,
  selected,
  onToggle,
}: {
  title: string
  counts: Map<T, number>
  labels?: Record<string, string>
  selected: T[]
  onToggle: (v: T) => void
}) {
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    return (
      <div style={{ fontSize: 11 }}>
        <div style={{ color: palette.muted, marginBottom: 4 }}>{title}</div>
        <div style={{ color: palette.muted, fontStyle: 'italic' }}>No values yet</div>
      </div>
    )
  }
  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ color: palette.muted, marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {entries.map(([value, count]) => {
          const active = selected.includes(value)
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(value)}
              style={{
                ...chipButtonStyle,
                background: active ? palette.primary : 'transparent',
                color: active ? palette.onPrimary : palette.text,
                borderColor: active ? palette.primary : palette.border,
              }}
            >
              {(labels?.[value] ?? value)} <span style={{ opacity: 0.7 }}>({count})</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Date range with typed-date fallback
// ---------------------------------------------------------------------------

function toDateInputValue(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function parseDateInput(value: string): number | null {
  if (!value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.getTime()
}

function DateRangeField({
  from,
  to,
  onChange,
}: {
  from: number | null
  to: number | null
  onChange: (from: number | null, to: number | null) => void
}) {
  const [fromText, setFromText] = useState(toDateInputValue(from))
  const [toText, setToText] = useState(toDateInputValue(to))
  const [fromInvalid, setFromInvalid] = useState(false)
  const [toInvalid, setToInvalid] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
      <div style={{ color: palette.muted }}>Date range</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="date"
          aria-label="From date"
          value={fromText}
          onChange={(e) => {
            const text = e.target.value
            setFromText(text)
            const parsed = parseDateInput(text)
            setFromInvalid(text.trim().length > 0 && parsed === null)
            if (parsed !== null || !text.trim()) onChange(parsed, to)
          }}
          style={{ ...inputStyle, borderColor: fromInvalid ? palette.error : palette.border }}
        />
        <span style={{ color: palette.muted }}>to</span>
        <input
          type="date"
          aria-label="To date"
          value={toText}
          onChange={(e) => {
            const text = e.target.value
            setToText(text)
            const parsed = parseDateInput(text)
            setToInvalid(text.trim().length > 0 && parsed === null)
            if (parsed !== null || !text.trim()) onChange(from, parsed)
          }}
          style={{ ...inputStyle, borderColor: toInvalid ? palette.error : palette.border }}
        />
        {(from !== null || to !== null) && (
          <button
            type="button"
            onClick={() => {
              setFromText('')
              setToText('')
              setFromInvalid(false)
              setToInvalid(false)
              onChange(null, null)
            }}
            style={chipButtonStyle}
          >
            Clear
          </button>
        )}
      </div>
      {(fromInvalid || toInvalid) && (
        <div role="alert" style={{ color: palette.error }}>
          That date could not be understood. Try YYYY-MM-DD.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The full filter bar
// ---------------------------------------------------------------------------

export function HistoryFilters({
  records,
  filters,
  onChange,
  onClearAll,
}: {
  records: HistoryDownloadRecord[]
  filters: HistoryFilterState
  onChange: (next: HistoryFilterState) => void
  onClearAll: () => void
}) {
  const [regexOpen, setRegexOpen] = useState(false)
  const searchWrapRef = useRef<HTMLDivElement>(null)
  const regexButtonRef = useRef<HTMLButtonElement>(null)

  const stateCounts = useMemo(() => countBy<HistoryDownloadState>(records, (r) => r.state), [records])
  const extCounts = useMemo(() => countBy<string>(records, (r) => r.ext), [records])
  const extractorCounts = useMemo(() => countBy<string>(records, (r) => r.extractor), [records])

  function toggleFacet<K extends 'states' | 'extensions' | 'extractors'>(key: K, value: string) {
    const current = filters[key] as string[]
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    onChange({ ...filters, [key]: next })
  }

  const hasActiveFilters =
    filters.query.trim().length > 0 ||
    filters.states.length > 0 ||
    filters.extensions.length > 0 ||
    filters.extractors.length > 0 ||
    filters.dateRange.from !== null ||
    filters.dateRange.to !== null ||
    filters.sizeMinBytes !== null ||
    filters.sizeMaxBytes !== null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        borderBottom: `1px solid ${palette.border}`,
        background: palette.bgRaised,
        flex: '0 0 auto',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div ref={searchWrapRef} style={{ position: 'relative', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Icon
                name="search"
                size={16}
                color={palette.muted}
                style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
              />
              <input
                value={filters.query}
                onChange={(e) => onChange({ ...filters, query: e.target.value })}
                aria-label="Search history by title, URL, filename or error text"
                placeholder={filters.useRegex ? 'Search (regex)…' : 'Search title, URL, filename, error…'}
                style={{ ...inputStyle, width: '100%', paddingLeft: 30 }}
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: palette.muted, whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={filters.useRegex}
                onChange={(e) => onChange({ ...filters, useRegex: e.target.checked })}
              />
              Regex
            </label>
            <button
              ref={regexButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={regexOpen}
              onClick={() => setRegexOpen((v) => !v)}
              title="Open the regex builder"
              style={chipButtonStyle}
            >
              <Icon name="regular_expression" size={14} />
            </button>
          </div>
          {regexOpen && (
            <RegexBuilderPopover
              pattern={filters.query}
              flags={filters.regexFlags}
              anchorRef={regexButtonRef as unknown as React.RefObject<HTMLElement>}
              onApply={(pattern, regexFlags) => onChange({ ...filters, query: pattern, regexFlags, useRegex: true })}
              onClose={() => setRegexOpen(false)}
            />
          )}
        </div>

        <select
          aria-label="Sort by"
          value={filters.sortBy}
          onChange={(e) => onChange({ ...filters, sortBy: e.target.value as HistoryFilterState['sortBy'] })}
          style={inputStyle}
        >
          <option value="date">Date</option>
          <option value="title">Title</option>
          <option value="size">Size</option>
          <option value="duration">Duration</option>
          <option value="status">Status</option>
        </select>
        <button
          type="button"
          aria-label={filters.sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          onClick={() => onChange({ ...filters, sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
          style={chipButtonStyle}
        >
          <Icon name={filters.sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'} size={14} />
        </button>

        {hasActiveFilters && (
          <button type="button" onClick={onClearAll} style={chipButtonStyle}>
            Clear all filters
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
        <FacetGroup title="Status" counts={stateCounts} labels={STATE_LABELS} selected={filters.states} onToggle={(v) => toggleFacet('states', v)} />
        <FacetGroup title="Format" counts={extCounts} selected={filters.extensions} onToggle={(v) => toggleFacet('extensions', v)} />
        <FacetGroup title="Source" counts={extractorCounts} selected={filters.extractors} onToggle={(v) => toggleFacet('extractors', v)} />
        <DateRangeField
          from={filters.dateRange.from}
          to={filters.dateRange.to}
          onChange={(from, to) => onChange({ ...filters, dateRange: { from, to } })}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filtering / sorting engine used by both the panel and the export scope text
// ---------------------------------------------------------------------------

export function applyHistoryFilters(records: HistoryDownloadRecord[], filters: HistoryFilterState): HistoryDownloadRecord[] {
  let matcher: ((haystack: string) => boolean) | null = null
  const query = filters.query.trim()
  if (query) {
    if (filters.useRegex) {
      try {
        const re = new RegExp(query, filters.regexFlags.replace(/[^gimsuy]/g, ''))
        matcher = (h) => re.test(h)
      } catch {
        matcher = () => false
      }
    } else {
      const needle = query.toLowerCase()
      matcher = (h) => h.toLowerCase().includes(needle)
    }
  }

  let out = records.filter((r) => {
    if (matcher) {
      const haystack = [r.title ?? '', r.url, r.filename ?? '', r.error ?? ''].join('\n')
      if (!matcher(haystack)) return false
    }
    if (filters.states.length > 0 && !filters.states.includes(r.state)) return false
    if (filters.extensions.length > 0 && (!r.ext || !filters.extensions.includes(r.ext))) return false
    if (filters.extractors.length > 0 && (!r.extractor || !filters.extractors.includes(r.extractor))) return false
    if (filters.dateRange.from !== null && r.addedAt < filters.dateRange.from) return false
    if (filters.dateRange.to !== null && r.addedAt > filters.dateRange.to + 24 * 60 * 60 * 1000) return false
    if (filters.sizeMinBytes !== null && (r.sizeBytes ?? -1) < filters.sizeMinBytes) return false
    if (filters.sizeMaxBytes !== null && (r.sizeBytes ?? Infinity) > filters.sizeMaxBytes) return false
    if (filters.durationMinSec !== null && (r.durationSec ?? -1) < filters.durationMinSec) return false
    if (filters.durationMaxSec !== null && (r.durationSec ?? Infinity) > filters.durationMaxSec) return false
    return true
  })

  const dir = filters.sortDir === 'asc' ? 1 : -1
  out = [...out].sort((a, b) => {
    switch (filters.sortBy) {
      case 'title':
        return dir * (a.title ?? a.url).localeCompare(b.title ?? b.url)
      case 'size':
        return dir * ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))
      case 'duration':
        return dir * ((a.durationSec ?? 0) - (b.durationSec ?? 0))
      case 'status':
        return dir * a.state.localeCompare(b.state)
      case 'date':
      default:
        return dir * (a.addedAt - b.addedAt)
    }
  })

  return out
}

export function describeHistoryFilterScope(filters: HistoryFilterState, matchedCount: number, totalCount: number): string {
  if (matchedCount === totalCount) return `All ${totalCount} entries (no filter active)`
  const parts: string[] = []
  if (filters.query.trim()) parts.push(`search "${filters.query}"${filters.useRegex ? ' (regex)' : ''}`)
  if (filters.states.length) parts.push(`status in [${filters.states.map((s) => STATE_LABELS[s]).join(', ')}]`)
  if (filters.extensions.length) parts.push(`format in [${filters.extensions.join(', ')}]`)
  if (filters.extractors.length) parts.push(`source in [${filters.extractors.join(', ')}]`)
  if (filters.dateRange.from || filters.dateRange.to) parts.push('date range applied')
  return `${matchedCount} of ${totalCount} entries filtered by: ${parts.join('; ') || 'active filters'}`
}
