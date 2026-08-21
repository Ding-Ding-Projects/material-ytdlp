import { colors } from '../theme'
import type { ConsoleLine } from '../useJobs'

const LEVEL_COLOR: Record<ConsoleLine['level'], string> = {
  error: colors.danger,
  warn: colors.warn,
  info: colors.text,
}

export function ConsolePane({ logs }: { logs: ConsoleLine[] }) {
  if (logs.length === 0) {
    return (
      <div style={{ color: colors.muted, fontSize: 13, padding: 24, textAlign: 'center' }} role="status">
        No log output yet.
      </div>
    )
  }

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.line}`,
        borderRadius: 8,
        padding: '10px 12px',
        fontFamily: 'Consolas, "Cascadia Mono", monospace',
        fontSize: 12,
        height: '100%',
        overflowY: 'auto',
      }}
      role="log"
      aria-live="polite"
    >
      {logs.map((line, i) => (
        <div key={i} style={{ color: LEVEL_COLOR[line.level], whiteSpace: 'pre-wrap' }}>
          [{line.id.slice(0, 8)}] {line.text}
        </div>
      ))}
    </div>
  )
}
