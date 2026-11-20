// Shared caption overlay renderer (FR-201.1) — THE one caption painter for
// preview (unit-102 canvas layer) and burn-in (unit-202 export worker). The
// import-graph test (CC-201.5) forbids any second caption renderer.
//
// Pure on (ctx, frame): no DOM globals, no fonts API, no React — the caller
// (ui/canvas adapter / export worker) owns font registration and supplies
// palette colors as data. Layout contract: mockups README §1 "Layout / fit
// rules" (binding) + design.md § Intent 3 surfaces:
//   wrap \n-first → fit to maxLinesPerBlock at 90 % safe width →
//   shrink-to-fit to 40 % of fontSizePct → grow to hard cap 5 → never clip.
// outlineWidth is px at 1080p canvas height; bold-active is weight-only
// (700→900); karaoke is a solid highlightColor swap (no motion).

import type { CaptionBlock, CaptionStyle, OutputAspect, Seconds } from '../model'

export interface SafeMargins {
  /** usable caption width as a fraction of canvas width (rest split L/R) */
  widthFraction: number
  /** reserved strip at the top, fraction of canvas height */
  topFraction: number
  /** reserved strip at the bottom, fraction of canvas height */
  bottomFraction: number
}

// The 90 % safe width is the binding rule (README §1.2). Top/bottom strips
// are per-aspect platform-overlay allowances — the spec names no table for
// 1:1/4:5 (recorded as a deviation in the unit report): portrait reserves
// more bottom (player chrome), square splits the difference.
const SAFE_MARGINS: Record<OutputAspect, SafeMargins> = {
  source: { widthFraction: 0.9, topFraction: 0.04, bottomFraction: 0.06 },
  '16:9': { widthFraction: 0.9, topFraction: 0.04, bottomFraction: 0.06 },
  '9:16': { widthFraction: 0.9, topFraction: 0.1, bottomFraction: 0.14 },
  '1:1': { widthFraction: 0.9, topFraction: 0.07, bottomFraction: 0.1 },
  '4:5': { widthFraction: 0.9, topFraction: 0.07, bottomFraction: 0.1 },
}

export function safeMargins(aspect: OutputAspect): SafeMargins {
  return SAFE_MARGINS[aspect]
}

export interface OverlayFrame {
  /** blocks visible at `time` (caller-filtered; may temporally overlap) */
  blocks: CaptionBlock[]
  time: Seconds
  style: CaptionStyle
  /** 'source', or a translation track's BCP-47 language (block-level render).
   *  Typed as plain string; 'source' is the reserved sentinel. */
  track: string
  width: number
  height: number
  /** --speaker-palette, supplied by the caller (engine cannot read CSS) */
  speakerPalette?: readonly string[]
  /** box edge color for caption boxes (--border-subtle); caller-supplied */
  boxEdgeColor?: string
  safe?: SafeMargins
}

type PaintCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const RTL_BASES = new Set(['ar', 'he', 'fa', 'ur', 'yi', 'ps', 'sd', 'ku'])
const SHRINK_GUARD = 64
const MAX_LINES_CAP = 5
const FIT_FLOOR = 0.4 // of fontSizePct (design.md binding)

interface Line {
  text: string
  wordFrom: number // inclusive index into the block's visible word list
  wordTo: number // exclusive
}

function applyTransform(text: string, style: CaptionStyle): string {
  if (style.textTransform === 'uppercase') return text.toUpperCase()
  if (style.textTransform === 'lowercase') return text.toLowerCase()
  return text
}

function measure(ctx: PaintCtx, text: string): number {
  return ctx.measureText(text).width
}

/** hard-break a single word wider than the budget (no ellipsis, ever) */
function breakWord(ctx: PaintCtx, word: string, maxW: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of word) {
    if (cur && measure(ctx, cur + ch) > maxW) {
      out.push(cur)
      cur = ch
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function wrap(ctx: PaintCtx, text: string, maxW: number): Line[] {
  const lines: Line[] = []
  let cur: string[] = []
  let curWordStart = 0
  const flush = (wordIdxEnd: number): void => {
    if (cur.length) {
      lines.push({ text: cur.join(' '), wordFrom: curWordStart, wordTo: wordIdxEnd })
      cur = []
    }
  }
  let wordIdx = 0
  for (const para of text.split('\n')) {
    flush(wordIdx)
    for (const raw of para.split(' ')) {
      if (raw === '') continue
      if (measure(ctx, raw) > maxW) {
        flush(wordIdx)
        // a hard-broken word shares ONE word range across its fragments —
        // the active word highlights on every fragment (no drift for the
        // lines after it)
        for (const piece of breakWord(ctx, raw, maxW)) lines.push({ text: piece, wordFrom: wordIdx, wordTo: wordIdx + 1 })
      } else if (cur.length && measure(ctx, `${cur.join(' ')} ${raw}`) > maxW) {
        flush(wordIdx)
        cur = [raw]
        curWordStart = wordIdx
      } else {
        if (cur.length === 0) curWordStart = wordIdx
        cur.push(raw)
      }
      wordIdx += 1
    }
    flush(wordIdx)
  }
  return lines
}

interface Fit {
  sizePx: number
  lines: Line[]
}

/** fit contract: maxLines → shrink to floor → grow to cap → hold (never clip) */
function fitBlock(ctx: PaintCtx, text: string, baseSize: number, maxLines: number, maxW: number): Fit {
  const floor = baseSize * FIT_FLOOR
  let size = baseSize
  ctx.font = fontString(size, 400, 'sans-serif') // measure at metric-neutral weight/face
  let lines = wrap(ctx, text, maxW)
  let guard = 0
  while (lines.length > maxLines && size > floor && guard++ < SHRINK_GUARD) {
    size = Math.max(floor, size * (maxLines / lines.length) * 0.98)
    ctx.font = fontString(size, 400, 'sans-serif')
    lines = wrap(ctx, text, maxW)
  }
  if (size <= floor && lines.length > MAX_LINES_CAP) {
    lines = lines.slice(0, MAX_LINES_CAP) // pathological: floor + cap (QC flags upstream)
  }
  return { sizePx: size, lines }
}

function fontString(px: number, weight: number, family: string): string {
  return `${weight} ${px.toFixed(2)}px ${family}`
}

function speakerColor(speakerId: string, palette: readonly string[]): string {
  if (palette.length === 0) return 'transparent'
  let h = 0
  for (const ch of speakerId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return palette[h % palette.length] ?? 'transparent'
}

function activeWordIndex(block: CaptionBlock, time: Seconds): number {
  // half-open [start, end); binary search; null-equivalent → -1
  let lo = 0
  let hi = block.words.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const w = block.words[mid]
    if (w === undefined) break
    if (w.start <= time) {
      if (time < w.end) found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

interface PlacedLine {
  line: Line
  y: number
  size: number
}

function blockTopBaseline(style: CaptionStyle, height: number, count: number, lineH: number, size: number, anchorOffset: number): number {
  const ascent = size * 0.8
  if (style.position === 'top') return height * (style.marginVPct / 100) + ascent + anchorOffset
  if (style.position === 'center') {
    const center = height * (style.marginVPct / 100)
    return center + (0 - (count - 1) / 2) * lineH + ascent - size * 0.45 + anchorOffset
  }
  return height * (1 - style.marginVPct / 100) - (count - 1) * lineH - size * 0.25 + anchorOffset
}

/** stack temporally-overlapping visible blocks away from the anchor edge */
function anchorOffsetsFor(blocks: CaptionBlock[], style: CaptionStyle, lineH: number): number[] {
  if (blocks.length <= 1) return blocks.map(() => 0)
  const gap = lineH * 0.4
  const unit = lineH + gap
  if (style.position === 'top') return blocks.map((_, i) => i * unit)
  if (style.position === 'center') return blocks.map((_, i) => (i - (blocks.length - 1) / 2) * unit)
  return blocks.map((_, i) => (blocks.length - 1 - i) * unit)
}

export function drawCaptions(ctx: PaintCtx, frame: OverlayFrame): void {
  const { style, width, height, time } = frame
  const safe = frame.safe ?? safeMargins('source')
  const maxW = width * safe.widthFraction
  const sideInset = (width - maxW) / 2
  const baseSize = (style.fontSizePct / 100) * height
  const px = (n: number): number => (n * height) / 1080 // px@1080p scale
  const rtl = frame.track !== 'source' && RTL_BASES.has(frame.track.toLowerCase().split(/[-_]/)[0] ?? '')
  const showWords = frame.track === 'source' && style.highlightMode !== 'none'

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.direction = rtl ? 'rtl' : 'ltr'

  const visible = [...frame.blocks].sort((a, b) => a.start - b.start)
  const fitted = visible.map((b) => ({
    block: b,
    fit: fitBlock(ctx, applyTransform(b.text, style), baseSize, style.maxLinesPerBlock, maxW),
  }))
  const lineH = Math.max(...fitted.map((f) => f.fit.sizePx), baseSize) * 1.25
  const anchors = anchorOffsetsFor(visible, style, lineH)

  for (let bi = 0; bi < fitted.length; bi++) {
    const entry = fitted[bi]
    if (entry === undefined) continue
    const { block, fit } = entry
    const { sizePx, lines } = fit
    if (lines.length === 0) continue
    const boxPadX = sizePx * 0.6
    const boxPadY = sizePx * 0.35
    ctx.font = fontString(sizePx, style.fontWeight, style.fontFamily)
    const firstBaseline = blockTopBaseline(style, height, lines.length, sizePx * 1.25, sizePx, anchors[bi] ?? 0)
    const lineYs: PlacedLine[] = lines.map((line, i) => ({ line, y: firstBaseline + i * sizePx * 1.25, size: sizePx }))

    // geometry for the box
    const textL = Math.min(...lineYs.map((p) => xLeft(ctx, style, p.line.text, width, sideInset)))
    const textR = Math.max(...lineYs.map((p) => xLeft(ctx, style, p.line.text, width, sideInset) + measure(ctx, p.line.text)))
    const top = Math.min(...lineYs.map((p) => p.y)) - sizePx * 0.85
    const bottom = Math.max(...lineYs.map((p) => p.y)) + sizePx * 0.25
    const bx = textL - boxPadX
    const bw = textR - textL + 2 * boxPadX
    const bh = bottom - top + 2 * boxPadY
    const by = top - boxPadY

    // 1. background box (+ 1px box edge when a background is set — boxEdge
    //    owner decision, derived without widening CaptionStyle)
    if (style.backgroundColor && style.backgroundOpacity > 0) {
      ctx.globalAlpha = style.backgroundOpacity
      ctx.fillStyle = style.backgroundColor
      roundRect(ctx, bx, by, bw, bh, Math.min(6, bh * 0.3))
      ctx.fill()
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = frame.boxEdgeColor ?? 'rgba(42,47,56,0.9)'
      ctx.lineWidth = 1
      roundRect(ctx, bx, by, bw, bh, Math.min(6, bh * 0.3))
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // 2. speaker bar: 8px @1080p rounded bar at the box left edge
    if (style.showSpeakerBar && frame.speakerPalette?.length) {
      ctx.fillStyle = speakerColor(block.speakerId, frame.speakerPalette)
      roundRect(ctx, bx, by, px(8), bh, px(4))
      ctx.fill()
    }

    // 3. outline pass then fill pass (stroke order), then active-word pass
    if (style.outlineWidth > 0) {
      ctx.lineWidth = px(style.outlineWidth)
      ctx.lineJoin = 'round'
      ctx.strokeStyle = style.outlineColor
      for (const p of lineYs) drawLineText(ctx, p, style, width, sideInset, 'stroke')
    }
    ctx.fillStyle = style.color
    for (const p of lineYs) drawLineText(ctx, p, style, width, sideInset, 'fill')

    if (showWords) {
      const wi = activeWordIndex(block, time)
      if (wi >= 0) {
        const hit = lineYs.find((p) => wi >= p.line.wordFrom && wi < p.line.wordTo)
        if (hit) {
          const wordsAll = block.text
            .split('\n')
            .join(' ')
            .split(' ')
            .filter((w) => w !== '')
          const rawWord = wordsAll[wi]
          if (rawWord !== undefined) {
            const word = applyTransform(rawWord, style)
            const prefix = wordsAll
              .slice(hit.line.wordFrom, wi)
              .map((w) => applyTransform(w, style))
              .join(' ')
            const lineLeft = xLeft(ctx, style, hit.line.text, width, sideInset)
            const wordX = prefix ? lineLeft + measure(ctx, `${prefix} `) : lineLeft
            ctx.save()
            ctx.textAlign = 'left'
            if (style.highlightMode === 'karaoke') {
              ctx.fillStyle = style.highlightColor
              ctx.font = fontString(hit.size, style.fontWeight, style.fontFamily)
              ctx.fillText(word, wordX, hit.y)
            } else {
              ctx.fillStyle = style.highlightColor
              ctx.font = fontString(hit.size, 900, style.fontFamily) // bold-active: weight only
              ctx.fillText(word, wordX, hit.y)
            }
            ctx.restore()
          }
        }
      }
    }
  }
  ctx.restore()
}

function xLeft(ctx: PaintCtx, style: CaptionStyle, text: string, width: number, sideInset: number): number {
  if (style.alignment === 'left') return sideInset
  if (style.alignment === 'right') return width - sideInset - measure(ctx, text)
  return (width - measure(ctx, text)) / 2
}

function drawLineText(ctx: PaintCtx, p: PlacedLine, style: CaptionStyle, width: number, sideInset: number, mode: 'fill' | 'stroke'): void {
  const x = style.alignment === 'left' ? sideInset : style.alignment === 'right' ? width - sideInset : width / 2
  ctx.textAlign = style.alignment
  if (mode === 'fill') ctx.fillText(p.line.text, x, p.y)
  else ctx.strokeText(p.line.text, x, p.y)
}

function roundRect(ctx: PaintCtx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}
