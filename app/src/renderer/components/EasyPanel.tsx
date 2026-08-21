import { useState } from 'react'
import type { EasyState, EasyQuality } from '../commandBuilder'
import { palette } from '../theme'
import { Icon } from './Icon'

const QUALITIES: { value: EasyQuality; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '1080p', label: '1080p or lower' },
  { value: '720p', label: '720p or lower' },
  { value: '480p', label: '480p or lower' },
  { value: 'audio-only', label: 'Audio only (MP3)' },
]

export function EasyPanel({
  state,
  onChange,
}: {
  state: EasyState
  onChange: (next: EasyState) => void
}) {
  const [busy, setBusy] = useState(false)

  async function browseFolder() {
    setBusy(true)
    try {
      const picked = await window.ytdlpStudio.dialogs.pickFolder()
      if (picked) onChange({ ...state, folder: picked })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
      <div>
        <label style={{ fontSize: 12, color: palette.muted, display: 'block', marginBottom: 6 }} htmlFor="easy-url">
          URL
        </label>
        <input
          id="easy-url"
          value={state.url}
          onChange={(e) => onChange({ ...state, url: e.target.value })}
          placeholder="https://example.com/watch?v=..."
          style={{
            width: '100%',
            background: palette.bgRaised,
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            color: palette.text,
          }}
        />
      </div>

      <div>
        <label style={{ fontSize: 12, color: palette.muted, display: 'block', marginBottom: 6 }} htmlFor="easy-quality">
          Quality
        </label>
        <select
          id="easy-quality"
          value={state.quality}
          onChange={(e) => onChange({ ...state, quality: e.target.value as EasyQuality })}
          style={{
            width: '100%',
            background: palette.bgRaised,
            border: `1px solid ${palette.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            color: palette.text,
          }}
        >
          {/* The currently selected value is listed first so a controlled
              <select> never falls back to the first option in source order
              before the value has mounted. */}
          {[state.quality, ...QUALITIES.map((q) => q.value).filter((v) => v !== state.quality)].map((v) => {
            const q = QUALITIES.find((x) => x.value === v)!
            return (
              <option key={v} value={v}>
                {q.label}
              </option>
            )
          })}
        </select>
      </div>

      <div>
        <label style={{ fontSize: 12, color: palette.muted, display: 'block', marginBottom: 6 }}>Download folder</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            readOnly
            value={state.folder ?? '(default download folder)'}
            style={{
              flex: 1,
              background: palette.bgRaised,
              border: `1px solid ${palette.border}`,
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 13,
              color: state.folder ? palette.text : palette.muted,
            }}
          />
          <button
            onClick={browseFolder}
            disabled={busy}
            style={{
              padding: '0 16px',
              borderRadius: 8,
              background: palette.bgRaised,
              border: `1px solid ${palette.border}`,
              color: palette.textDim,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Icon name="folder_open" size={16} />
            Browse
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ToggleRow
          label="Download subtitles"
          checked={state.subtitles}
          onChange={(v) => onChange({ ...state, subtitles: v })}
        />
        <ToggleRow
          label="Embed thumbnail as cover art"
          checked={state.thumbnail}
          onChange={(v) => onChange({ ...state, thumbnail: v })}
        />
        <ToggleRow
          label="Mark SponsorBlock segments"
          checked={state.sponsorblock}
          onChange={(v) => onChange({ ...state, sponsorblock: v })}
        />
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: palette.text }}>{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          background: checked ? palette.primary : '#3a4241',
          position: 'relative',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: 9,
            background: checked ? palette.onPrimary : palette.textDim,
          }}
        />
      </button>
    </div>
  )
}
