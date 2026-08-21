import type { ReactNode } from 'react'
import { colors } from '../theme'

export function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: colors.muted }}>
      <span>{label}</span>
      {children}
      {help ? <span style={{ fontSize: 11, color: colors.muted, opacity: 0.8 }}>{help}</span> : null}
    </label>
  )
}

const inputBase: React.CSSProperties = {
  background: colors.bg,
  border: `1px solid ${colors.line}`,
  borderRadius: 8,
  color: colors.text,
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputBase, ...props.style }} />
}

export function Select({
  value,
  onChange,
  options,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  // The current value must be listed first, or React can render the wrong
  // option before children finish mounting.
  const ordered = [value, ...options.filter((o) => o !== value)]
  return (
    <select
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputBase, ...rest.style }}
    >
      {ordered.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 40,
        height: 22,
        borderRadius: 11,
        border: `1px solid ${checked ? colors.primary : colors.line}`,
        background: checked ? colors.primary : 'transparent',
        position: 'relative',
        cursor: 'pointer',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: checked ? colors.onPrimary : colors.muted,
          transition: 'left 120ms ease',
        }}
      />
    </button>
  )
}

export function Button({
  children,
  variant = 'outline',
  ...rest
}: { children: ReactNode; variant?: 'filled' | 'outline' | 'text' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    borderRadius: 20,
    fontSize: 13,
    cursor: rest.disabled ? 'default' : 'pointer',
    opacity: rest.disabled ? 0.5 : 1,
    border: `1px solid ${colors.line}`,
    background: 'transparent',
    color: colors.text,
  }
  if (variant === 'filled') {
    base.background = colors.primary
    base.color = colors.onPrimary
    base.border = `1px solid ${colors.primary}`
  } else if (variant === 'text') {
    base.border = '1px solid transparent'
  }
  return (
    <button {...rest} style={{ ...base, ...rest.style }}>
      {children}
    </button>
  )
}

export function NotImplemented({ what }: { what: string }) {
  return (
    <div
      style={{
        padding: 24,
        color: colors.muted,
        fontSize: 13,
        border: `1px dashed ${colors.line}`,
        borderRadius: 12,
        textAlign: 'center',
      }}
      role="status"
    >
      {what} is not implemented yet.
    </div>
  )
}
