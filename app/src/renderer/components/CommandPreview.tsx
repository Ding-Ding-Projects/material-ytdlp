import { colors } from '../theme'

/** Quote an argv element for DISPLAY only. The real spawn always uses argv, never this string. */
function shellQuote(arg: string): string {
  if (arg === '') return '""'
  if (/^[A-Za-z0-9._\-/:=@%]+$/.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

export function CommandPreview({ argv }: { argv: string[] }) {
  const text = ['yt-dlp', ...argv].map(shellQuote).join(' ')
  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.line}`,
        borderRadius: 8,
        padding: '10px 12px',
        fontFamily: 'Consolas, "Cascadia Mono", monospace',
        fontSize: 12.5,
        color: colors.text,
        overflowX: 'auto',
        whiteSpace: 'pre',
      }}
      aria-label="Command preview"
    >
      {text || 'yt-dlp'}
    </div>
  )
}
