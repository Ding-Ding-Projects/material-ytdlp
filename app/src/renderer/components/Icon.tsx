import type { CSSProperties } from 'react'

/**
 * Material Symbols ligature icon. The NAME is the element's text content —
 * that is how ligature icon fonts work — never a literal glyph character.
 * With no ligature font vendored yet (see index.html), this honestly
 * displays the icon's own English name as small text rather than a blank
 * box or a crash. Only use names confirmed to exist in Material Symbols
 * Outlined.
 */
export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: string
  size?: number
  color?: string
  style?: CSSProperties
}) {
  return (
    <i
      className="msym"
      aria-hidden="true"
      style={{ fontSize: size, color, ...style }}
    >
      {name}
    </i>
  )
}
