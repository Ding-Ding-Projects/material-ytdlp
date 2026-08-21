import { palette } from '../theme'

export function PlainPanel({ text, onChange }: { text: string; onChange: (next: string) => void }) {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ fontSize: 12, color: palette.muted }}>
        No wizards, no pickers — type the command and its flags exactly as you would in a terminal. The URL goes at
        the end, like a real yt-dlp invocation.
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label="Raw yt-dlp command line"
        placeholder="yt-dlp -f bv*+ba/b --write-subs https://example.com/watch?v=..."
        style={{
          flex: 1,
          minHeight: 200,
          resize: 'vertical',
          background: palette.bgRaised,
          border: `1px solid ${palette.border}`,
          borderRadius: 8,
          padding: 12,
          fontSize: 13,
          color: palette.text,
          fontFamily: 'Roboto Mono, Consolas, monospace',
        }}
      />
    </div>
  )
}
