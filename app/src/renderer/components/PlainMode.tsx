import { useState } from 'react'
import { colors } from '../theme'
import { Button, Field } from './fields'
import type { StartJobRequest } from '../../shared/ipc-contract'

/** Splits a raw argv line on whitespace, honoring single/double quotes. */
function splitArgv(line: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

export function PlainMode({ onStart }: { onStart: (req: StartJobRequest) => void }) {
  const [raw, setRaw] = useState('')
  const argv = splitArgv(raw)
  const url = [...argv].reverse().find((a) => /^https?:\/\//.test(a)) ?? ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
      <Field label="Raw argv" help="One yt-dlp command line, exactly as you would type it after `yt-dlp`.">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          placeholder="-f bestvideo+bestaudio --write-subs https://example.com/watch?v=..."
          style={{
            background: colors.bg,
            border: `1px solid ${colors.line}`,
            borderRadius: 8,
            color: colors.text,
            padding: '10px 12px',
            fontFamily: 'Consolas, "Cascadia Mono", monospace',
            fontSize: 12.5,
            resize: 'vertical',
          }}
        />
      </Field>

      <div style={{ fontSize: 11, color: colors.muted }}>
        {argv.length > 0 ? `${argv.length} argument${argv.length === 1 ? '' : 's'} parsed` : 'No arguments yet'}
        {url ? ` — URL detected: ${url}` : ' — no http(s) URL detected in the line'}
      </div>

      <div>
        <Button
          variant="filled"
          disabled={argv.length === 0 || !url}
          onClick={() =>
            onStart({
              id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              url,
              argv,
              cwd: null,
            })
          }
        >
          <i className="msym">download</i>
          Run
        </Button>
      </div>
    </div>
  )
}
