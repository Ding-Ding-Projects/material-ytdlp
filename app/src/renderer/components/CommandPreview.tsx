import { palette } from '../theme'
import { argvToDisplayString } from '../commandBuilder'
import { Icon } from './Icon'

export function CommandPreview({ argv, onRun, running }: { argv: string[]; onRun: () => void; running: boolean }) {
  const display = argvToDisplayString(argv)
  const hasUrl = argv.length > 0

  return (
    <div
      style={{
        borderTop: `1px solid ${palette.border}`,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: palette.bg,
        flex: '0 0 auto',
      }}
    >
      <code
        className="mono"
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
          color: palette.textDim,
        }}
        title={display}
      >
        {display}
      </code>
      <button
        onClick={onRun}
        disabled={!hasUrl || running}
        style={{
          height: 36,
          padding: '0 18px',
          borderRadius: 18,
          background: palette.primary,
          color: palette.onPrimary,
          fontSize: 13,
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          opacity: !hasUrl || running ? 0.5 : 1,
          flex: '0 0 auto',
        }}
      >
        <Icon name="download" size={16} color={palette.onPrimary} />
        {running ? 'Starting…' : 'Download'}
      </button>
    </div>
  )
}
