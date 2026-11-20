// CC-201.1 (L1 legs) — engine/export/overlay.ts layout decision tests.
//
// Deterministic fake ctx (record + hand-rolled measureText metric model) —
// pixel-level goldens live in e2e/style/ (L5, SSIM ≥ 0.98 vs committed PNGs);
// these tests pin the DECISIONS the pixels come from: wrap order, shrink
// floor, line cap, never-clip, box/outline/bar draw order, highlight modes,
// safe margins, RTL direction, translation-track block-level render.
//
// Metric model: width(text, size) = Σ per-char (cap 0.72, space 0.28, other
// 0.56) × size — the same conservative estimate the unit-200 mockup fit model
// uses, so expectations here are stable under real-Inter variance in e2e.
import { describe, expect, test } from 'vitest'
import { drawCaptions, safeMargins, type OverlayFrame } from '@engine/export/overlay'
import type { CaptionBlock, CaptionStyle, Seconds, WordToken } from '@engine/model'

type Rec =
  | { kind: 'text'; text: string; x: number; y: number; mode: 'fill' | 'stroke'; font: string; fillStyle: string; direction: string }
  | { kind: 'rect'; mode: 'fill' | 'stroke'; style: string; x: number; y: number; w: number; h: number; alpha: number; lineWidth: number }
  | { kind: 'path-start' }

function charW(ch: string): number {
  if (ch >= 'A' && ch <= 'Z') return 0.72
  if (ch === ' ') return 0.28
  return 0.56
}
function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += charW(ch)
  return w * size
}

function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i]
  if (v === undefined) throw new Error(`missing element ${i}`)
  return v
}

function fakeCtx() {
  const rec: Rec[] = []
  let pts: { x: number; y: number }[] = []
  const ctx: Record<string, unknown> = {
    font: '400 24px Inter', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, direction: 'ltr',
    beginPath: () => { pts = [] },
    moveTo: (x: number, y: number) => { pts.push({ x, y }) },
    lineTo: (x: number, y: number) => { pts.push({ x, y }) },
    arcTo: (x1: number, y1: number, x2: number, y2: number) => { pts.push({ x: x1, y: y1 }, { x: x2, y: y2 }) },
    closePath: () => {},
    fill: () => {
      if (pts.length === 0) return
      const xs = pts.map(p => p.x)
      const ys = pts.map(p => p.y)
      rec.push({ kind: 'rect', mode: 'fill', style: String(ctx.fillStyle), x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), alpha: Number(ctx.globalAlpha), lineWidth: Number(ctx.lineWidth) })
    },
    stroke: () => {
      if (pts.length === 0) return
      const xs = pts.map(p => p.x)
      const ys = pts.map(p => p.y)
      rec.push({ kind: 'rect', mode: 'stroke', style: String(ctx.strokeStyle), x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), alpha: Number(ctx.globalAlpha), lineWidth: Number(ctx.lineWidth) })
    },
    fillRect: (x: number, y: number, w: number, h: number) => { rec.push({ kind: 'rect', mode: 'fill', style: String(ctx.fillStyle), x, y, w, h, alpha: Number(ctx.globalAlpha), lineWidth: Number(ctx.lineWidth) }) },
    fillText: (t: string, x: number, y: number) => { rec.push({ kind: 'text', text: t, x, y, mode: 'fill', font: String(ctx.font), fillStyle: String(ctx.fillStyle), direction: String(ctx.direction) }) },
    strokeText: (t: string, x: number, y: number) => { rec.push({ kind: 'text', text: t, x, y, mode: 'stroke', font: String(ctx.font), fillStyle: String(ctx.strokeStyle), direction: String(ctx.direction) }) },
    measureText: (t: string) => {
      const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(ctx.font))?.[1] ?? '16')
      return { width: textWidth(t, size) }
    },
    save: () => {}, restore: () => {}, setTransform: () => {}, clearRect: () => {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rec }
}

function words(text: string, start: Seconds, end: Seconds): WordToken[] {
  const parts = text.split(' ')
  const span = (end - start) / parts.length
  return parts.map((t, i) => ({ text: t, start: start + i * span, end: start + (i + 1) * span }))
}

function block(partial: Partial<CaptionBlock> & { text: string }): CaptionBlock {
  const start = partial.start ?? 0
  const end = partial.end ?? 5
  return {
    id: partial.id ?? 'b1', start, end, text: partial.text,
    words: partial.words ?? words(partial.text.replace(/\n/g, ' '), start, end),
    speakerId: partial.speakerId ?? 'SPK_1',
  }
}

export const BASE_STYLE: CaptionStyle = {
  fontFamily: 'Inter', fontWeight: 400, fontSizePct: 4.0, textTransform: 'none',
  color: '#ffffff', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 0,
  backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center',
  maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false,
}

function frame(over: Partial<OverlayFrame> = {}): OverlayFrame {
  return {
    blocks: [], time: 2, style: BASE_STYLE, track: 'source', width: 1920, height: 1080,
    speakerPalette: ['#f00', '#0f0', '#00f'],
    ...over,
  }
}

const texts = (rec: Rec[]) => rec.filter((r): r is Extract<Rec, { kind: 'text' }> => r.kind === 'text')
const rects = (rec: Rec[]) => rec.filter((r): r is Extract<Rec, { kind: 'rect' }> => r.kind === 'rect')

describe('CC-201.1: wrap + fit decisions', () => {
  test('CC-201.1: short caption renders as one centered line within 90% safe width', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Hello there' })] }))
    const t = texts(rec)
    expect(t).toHaveLength(1)
    expect(at(t, 0).text).toBe('Hello there')
    expect(at(t, 0).x).toBeCloseTo(1920 / 2, 0)
    expect(textWidth('Hello there', parseFloat(/(\d+(\.\d+)?)px/.exec(at(t, 0).font)?.[1] ?? '16'))).toBeLessThanOrEqual(1920 * 0.9)
  })

  test('CC-201.1: explicit \\n breaks win over re-flowing (maxLines 3)', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'alpha beta\ngamma delta' })], style: { ...BASE_STYLE, maxLinesPerBlock: 3 } }))
    expect(texts(rec).map(t => t.text)).toEqual(['alpha beta', 'gamma delta'])
  })

  test('CC-201.1: wrapping fills maxLinesPerBlock with ≤ 90% width each line', () => {
    const long = 'the quick brown fox jumps over the lazy dog while the editor watches the render pass'
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: long })], style: { ...BASE_STYLE, maxLinesPerBlock: 2 } }))
    const t = texts(rec)
    expect(t.length).toBe(2)
    const size = parseFloat(/(\d+(\.\d+)?)px/.exec(at(t, 0).font)?.[1] ?? '16')
    for (const line of t) expect(textWidth(line.text, size)).toBeLessThanOrEqual(1920 * 0.9 + 1)
    expect(t.map(l => l.text).join(' ')).toBe(long)
  })

  test('CC-201.1: over-long block shrinks font, never below the 40% floor', () => {
    const huge = Array(40).fill('supercalifragilistic').join(' ')
    const { ctx, rec } = fakeCtx()
    const base = BASE_STYLE.fontSizePct / 100 * 1080
    drawCaptions(ctx, frame({ blocks: [block({ text: huge })], style: { ...BASE_STYLE, maxLinesPerBlock: 2 } }))
    const t = texts(rec)
    const size = parseFloat(/(\d+(\.\d+)?)px/.exec(at(t, 0).font)?.[1] ?? '16')
    expect(size).toBeLessThan(base)
    expect(size).toBeGreaterThanOrEqual(0.4 * base - 0.01)
    expect(t.length).toBeLessThanOrEqual(5)
  })

  test('CC-201.1: pathological single word renders at floor, ≤ 5 lines, no clip, no ellipsis', () => {
    const monster = 'x'.repeat(4000)
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: monster })], style: { ...BASE_STYLE, maxLinesPerBlock: 1 } }))
    const t = texts(rec)
    expect(t.length).toBeLessThanOrEqual(5)
    const size = parseFloat(/(\d+(\.\d+)?)px/.exec(at(t, 0).font)?.[1] ?? '16')
    expect(size).toBeCloseTo(0.4 * (BASE_STYLE.fontSizePct / 100 * 1080), 1)
    expect(t.some(l => l.text.includes('…') || l.text.includes('...'))).toBe(false)
  })
})

describe('CC-201.1: position, margins, safe areas', () => {
  test('CC-201.1: position bottom + marginVPct places block bottom inset from frame', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Bottom line' })], style: { ...BASE_STYLE, position: 'bottom', marginVPct: 6 } }))
    const t = texts(rec)
    const size = parseFloat(/(\d+(\.\d+)?)px/.exec(at(t, 0).font)?.[1] ?? '16')
    // baseline must sit above the bottom safe inset and below its middle
    const bottomLimit = 1080 * (1 - 6 / 100)
    expect(at(t, 0).y).toBeLessThanOrEqual(bottomLimit + 1)
    expect(at(t, 0).y).toBeGreaterThan(1080 * 0.7)
    expect(size).toBeGreaterThan(0)
  })

  test('CC-201.1: position center anchors block CENTER at marginVPct of height (karaoke hero @45)', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Karaoke hero line' })], style: { ...BASE_STYLE, position: 'center', marginVPct: 45, fontSizePct: 7, maxLinesPerBlock: 1 as const } }))
    const t = texts(rec)
    const size = parseFloat(/(\d+(\.\d+)?)px/.exec(at(t, 0).font)?.[1] ?? '16')
    // vertical center of the single line ≈ ascent/2 below baseline; center ≈ 0.45·1080
    const center = at(t, 0).y - size * 0.35
    expect(Math.abs(center - 1080 * 0.45)).toBeLessThan(size * 0.6)
  })

  test('CC-201.1: position top insets from the top', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Top line' })], style: { ...BASE_STYLE, position: 'top', marginVPct: 8 } }))
    expect(at(texts(rec), 0).y).toBeLessThan(1080 * 0.3)
  })

  test('CC-201.1: safeMargins per aspect (single source for letterbox + export)', () => {
    const s169 = safeMargins('16:9')
    expect(s169.widthFraction).toBe(0.9)
    for (const a of ['source', '16:9', '9:16', '1:1', '4:5'] as const) {
      const m = safeMargins(a)
      expect(m.widthFraction).toBeGreaterThan(0.6)
      expect(m.topFraction).toBeGreaterThanOrEqual(0)
      expect(m.bottomFraction).toBeGreaterThanOrEqual(0)
    }
    // portrait keeps MORE bottom safe area than landscape (platform overlay zones)
    expect(safeMargins('9:16').bottomFraction).toBeGreaterThan(s169.bottomFraction)
  })
})

describe('CC-201.1: box, outline, speaker bar draw decisions', () => {
  test('CC-201.1: background box fills backgroundColor at backgroundOpacity then edge stroke (broadcast-box)', () => {
    const { ctx, rec } = fakeCtx()
    const style = { ...BASE_STYLE, backgroundColor: '#15181d', backgroundOpacity: 0.82 }
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Boxed caption' })], style }))
    const r = rects(rec)
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(at(r, 0)).toMatchObject({ mode: 'fill', style: '#15181d', alpha: 0.82 })
    expect(at(r, 1).mode).toBe('stroke') // 1px box edge
    // text drawn after the box
    expect(rec.findIndex(x => x.kind === 'text')).toBeGreaterThan(rec.findIndex(x => x.kind === 'rect'))
  })

  test('CC-201.1: no background drawn when backgroundColor absent or opacity 0', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Plain caption' })] }))
    expect(rects(rec)).toHaveLength(0)
  })

  test('CC-201.1: outline strokes before fill, width scales with canvas height (px@1080p)', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Outlined' })], style: { ...BASE_STYLE, outlineWidth: 3 }, width: 960, height: 540 }))
    const t = texts(rec)
    expect(at(t, 0).mode).toBe('stroke')
    expect(at(t, 0).fillStyle).toBe(BASE_STYLE.outlineColor)
    expect(at(t, 1).mode).toBe('fill')
    expect(at(t, 1).fillStyle).toBe(BASE_STYLE.color)
  })

  test('CC-201.1: speaker bar drawn at box left edge in palette color when showSpeakerBar', () => {
    const { ctx, rec } = fakeCtx()
    const style = { ...BASE_STYLE, showSpeakerBar: true, backgroundColor: '#15181d', backgroundOpacity: 0.82 }
    drawCaptions(ctx, frame({ blocks: [block({ text: 'Spoken line', speakerId: 'SPK_1' })], style }))
    const bars = rects(rec).filter(r => r.w < 20 && r.h > 20)
    expect(bars).toHaveLength(1)
    expect(['#f00', '#0f0', '#00f']).toContain(at(bars, 0).style)
  })

  test('CC-201.1: no speaker bar when showSpeakerBar false', () => {
    const { ctx, rec } = fakeCtx()
    drawCaptions(ctx, frame({ blocks: [block({ text: 'No bar here' })], style: { ...BASE_STYLE, showSpeakerBar: false } }))
    expect(rects(rec).filter(r => r.w < 20)).toHaveLength(0)
  })
})

describe('CC-201.1: highlight state machine', () => {
  test('CC-201.1: karaoke swaps active word to highlightColor fill, base words keep color', () => {
    const { ctx, rec } = fakeCtx()
    const style = { ...BASE_STYLE, highlightMode: 'karaoke' as const, fontSizePct: 4, maxLinesPerBlock: 1 as const }
    const b = block({ text: 'one two three four', start: 0, end: 4 }) // word 2 = 'three' [1,2)
    drawCaptions(ctx, frame({ blocks: [b], time: 2.5, style }))
    const t = texts(rec)
    const whole = t.find(x => x.text === 'one two three four')
    expect(whole).toBeDefined()
    const active = t.find(x => x.text === 'three' && x.fillStyle === BASE_STYLE.highlightColor)
    expect(active).toBeDefined()
    expect(active!.y).toBe(whole!.y)
  })

  test('CC-201.1: bold-active re-renders active word at weight 900, color unchanged', () => {
    const { ctx, rec } = fakeCtx()
    const style = { ...BASE_STYLE, highlightMode: 'bold-active' as const, fontWeight: 700 as const, highlightColor: '#ffffff', maxLinesPerBlock: 1 as const }
    const b = block({ text: 'one two three four', start: 0, end: 4 })
    drawCaptions(ctx, frame({ blocks: [b], time: 2.5, style }))
    const t = texts(rec)
    const active = t.find(x => x.text === 'three' && /^900/.test(x.font))
    expect(active).toBeDefined()
    expect(active!.fillStyle).toBe(BASE_STYLE.color)
    expect(t.some(x => x.fillStyle === BASE_STYLE.highlightColor && x.text === 'three' && /^400|^700/.test(x.font))).toBe(false)
  })

  test('CC-201.1: no active word in gaps — highlightMode karaoke with playhead between blocks draws base only', () => {
    const { ctx, rec } = fakeCtx()
    const b = block({ text: 'gap test', start: 0, end: 1 })
    drawCaptions(ctx, frame({ blocks: [b], time: 1.5, style: { ...BASE_STYLE, highlightMode: 'karaoke' as const } }))
    const t = texts(rec)
    expect(t.every(x => x.fillStyle === BASE_STYLE.color)).toBe(true)
  })

  test('CC-201.1: translation track renders block text without word highlight', () => {
    const { ctx, rec } = fakeCtx()
    const style = { ...BASE_STYLE, highlightMode: 'karaoke' as const }
    const b = block({ text: 'bonjour tout le monde', start: 0, end: 4 })
    drawCaptions(ctx, frame({ blocks: [b], time: 2.5, style, track: 'fr' }))
    expect(texts(rec).every(x => x.fillStyle === BASE_STYLE.color)).toBe(true)
  })

  test('CC-201.1: RTL track language sets ctx.direction = rtl', () => {
    const { ctx, rec } = fakeCtx()
    const b = block({ text: 'مرحبا بالعالم', start: 0, end: 2 })
    drawCaptions(ctx, frame({ blocks: [b], track: 'ar' }))
    expect(at(texts(rec), 0).direction).toBe('rtl')
  })

  test('CC-201.1: multiple visible blocks stack without overlap', () => {
    const { ctx, rec } = fakeCtx()
    const b1 = block({ id: 'a', text: 'first block line', start: 0, end: 4 })
    const b2 = block({ id: 'b', text: 'second block line', start: 1, end: 4 })
    drawCaptions(ctx, frame({ blocks: [b1, b2], time: 2 }))
    const ys = texts(rec).map(t => t.y)
    expect(new Set(ys.map(Math.round)).size).toBe(ys.length)
  })
})
