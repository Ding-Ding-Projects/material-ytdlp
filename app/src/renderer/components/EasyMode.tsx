import { getBridge } from '../bridge'
import { colors } from '../theme'
import { useEasyState } from '../useArgv'
import { CommandPreview } from './CommandPreview'
import { Button, Field, Select, Switch, TextInput } from './fields'
import type { StartJobRequest } from '../../shared/ipc-contract'

const QUALITIES = ['best', '1080p', '720p', 'audio-only']

export function EasyMode({ onStart }: { onStart: (req: StartJobRequest) => void }) {
  const easy = useEasyState()

  const browseFolder = async () => {
    const bridge = getBridge()
    if (!bridge) return
    const dir = await bridge.dialogs.pickFolder().catch(() => null)
    if (dir) easy.setOutputFolder(dir)
  }

  const canStart = easy.url.trim().length > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
      <Field label="Video URL">
        <TextInput
          value={easy.url}
          onChange={(e) => easy.setUrl(e.target.value)}
          placeholder="https://example.com/watch?v=..."
        />
      </Field>

      <Field label="Quality">
        <Select value={easy.quality} onChange={easy.setQuality} options={QUALITIES} />
      </Field>

      <Field label="Output folder" help={easy.outputFolder ?? 'yt-dlp default (current working directory)'}>
        <div style={{ display: 'flex', gap: 8 }}>
          <TextInput
            value={easy.outputFolder ?? ''}
            readOnly
            placeholder="(default)"
            style={{ flex: 1 }}
          />
          <Button onClick={browseFolder}>
            <i className="msym">folder_open</i>
            Browse
          </Button>
        </div>
      </Field>

      <div style={{ display: 'flex', gap: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text }}>
          <Switch checked={easy.subtitles} onChange={easy.setSubtitles} label="Download subtitles" />
          Subtitles
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: colors.text }}>
          <Switch checked={easy.thumbnail} onChange={easy.setThumbnail} label="Download thumbnail" />
          Thumbnail
        </label>
      </div>

      <div>
        <div style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>Command preview</div>
        <CommandPreview argv={easy.argv} />
      </div>

      <div>
        <Button
          variant="filled"
          disabled={!canStart}
          onClick={() => {
            if (!canStart) return
            onStart({
              id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              url: easy.url.trim(),
              argv: easy.argv,
              cwd: easy.outputFolder,
            })
          }}
        >
          <i className="msym">download</i>
          Download
        </Button>
      </div>
    </div>
  )
}
