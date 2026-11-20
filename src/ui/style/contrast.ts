// WCAG contrast guard (FR-201.5). Method is the unit-200 contrast sheet
// method (mockups/README §2, owner-signed): outlined text (no box) is
// `text vs outlineColor` plus non-text `outlineColor vs frame ≥ 3:1`; boxed
// text is `text vs box composited over frame`. < 4.5:1 on the text pair →
// warning icon in the style panel (product rule, AA).

export function lum(hex: string): number {
  const { r, g, b } = parse(hex)
  const f = (v: number): number => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function ratio(a: string, b: string): number {
  const la = lum(a)
  const lb = lum(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** alpha-composite fg over bg (both #rrggbb) → #rrggbb */
export function over(fg: string, alpha: number, bg: string): string {
  const f = parse(fg)
  const b = parse(bg)
  const mix = (x: number, y: number): number => Math.round(alpha * x + (1 - alpha) * y)
  const h = (x: number): string => x.toString(16).padStart(2, '0')
  return `#${h(mix(f.r, b.r))}${h(mix(f.g, b.g))}${h(mix(f.b, b.b))}`
}

function parse(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex.trim())
  if (m === null) return { r: 0, g: 0, b: 0 }
  return { r: parseInt(m[1] ?? '0', 16), g: parseInt(m[2] ?? '0', 16), b: parseInt(m[3] ?? '0', 16) }
}

export interface ContrastReport {
  /** the pair that governs the warning */
  pair: 'text-vs-outline' | 'text-vs-box'
  ratio: number
  /** non-text separation (outline vs frame) — informational, AA non-text is 3:1 */
  nonText?: { ratio: number; pass: boolean }
  warn: boolean
}

export function captionContrast(
  style: {
    color: string
    outlineColor: string
    outlineWidth: number
    backgroundColor?: string
    backgroundOpacity: number
  },
  frameColor: string,
  aaRatio = 4.5,
): ContrastReport {
  if (style.backgroundColor && style.backgroundOpacity > 0) {
    const composited = over(style.backgroundColor, style.backgroundOpacity, frameColor)
    const r = ratio(style.color, composited)
    return { pair: 'text-vs-box', ratio: r, warn: r < aaRatio }
  }
  const r = ratio(style.color, style.outlineColor)
  const nonText = ratio(style.outlineColor, frameColor)
  return {
    pair: 'text-vs-outline',
    ratio: r,
    nonText: { ratio: nonText, pass: nonText >= 3 },
    warn: r < aaRatio || (style.outlineWidth > 0 && nonText < 3),
  }
}
