// CC-107.6 (L2, jsdom): the visualizer layer behavior over scripted
// analyser frames — draws ONLY while playing (paused → zero draws, last
// frame frozen at 40% opacity); spectrum mode reads frequency data and
// waveform mode reads time-domain data; "Tint by speaker" colors the line
// with the active block's speaker colour; prefers-reduced-motion caps the
// redraw at ≤ 4 Hz (≥ 250 ms between draws); DPR scales the backing store;
// the canvas is aria-hidden (CC-107.9 half). Driven by explicit draw()
// calls — the layer has NO rAF of its own (the composition root pumps it
// from arbitrator samples; the transport-bar frozen test pins one rAF loop
// app-wide).
// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeAnalyser } from '../../../src/test-support/fake-analyser'
import type { VisualizerLayer, VisualizerPrefs } from '@ui/canvas/visualizer/visualizer-layer'

const VISUALIZER_MODULE = '@ui/canvas/visualizer/visualizer-layer'
type VisualizerModule = typeof import('@ui/canvas/visualizer/visualizer-layer')

interface DrawCall {
  kind: 'stroke' | 'fill'
  style: string | null
}

function fakeCanvas2d(): { ctx: CanvasRenderingContext2D; calls: DrawCall[] } {
  const calls: DrawCall[] = []
  let pendingStroke: string | null = null
  let pendingFill: string | null = null
  const ctx = {
    canvas: null,
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '#000',
    fillStyle: '#000',
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke(): void {
      pendingStroke = String(ctx.strokeStyle)
      calls.push({ kind: 'stroke', style: pendingStroke })
    },
    fill(): void {
      pendingFill = String(ctx.fillStyle)
      calls.push({ kind: 'fill', style: pendingFill })
    },
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    closePath: vi.fn(),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

let drawTarget: { ctx: CanvasRenderingContext2D; calls: DrawCall[] }

beforeEach(() => {
  drawTarget = fakeCanvas2d()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => drawTarget.ctx)
})

const SIZE = { width: 1280, height: 720 }

async function makeLayer(opts: {
  prefs?: Partial<VisualizerPrefs>
  activeColor?: string | null
  dpr?: number
  reducedMotion?: boolean
  nowStart?: number
} = {}): Promise<{ layer: VisualizerLayer; canvas: HTMLCanvasElement; analyser: ReturnType<typeof createFakeAnalyser>; now: { t: number }; calls: () => DrawCall[] }> {
  const mod = (await import(/* @vite-ignore */ VISUALIZER_MODULE)) as unknown as VisualizerModule
  const analyser = createFakeAnalyser({ fftSize: 4096, sampleRate: 44_100 })
  const prefs: VisualizerPrefs = { mode: 'spectrum', tintBySpeaker: true, ...opts.prefs }
  const now = { t: opts.nowStart ?? 0 }
  const canvas = document.createElement('canvas')
  const layer = mod.createVisualizerLayer({
    canvas,
    analyser,
    sampleRate: () => 44_100,
    getPrefs: () => prefs,
    getSize: () => SIZE,
    activeSpeakerColor: () => opts.activeColor ?? null,
    devicePixelRatio: () => opts.dpr ?? 1,
    prefersReducedMotion: () => opts.reducedMotion ?? false,
    now: () => now.t,
  })
  return { layer, canvas, analyser, now, calls: () => drawTarget.calls }
}

describe('CC-107.6: visualizer layer', () => {
  test('CC-107.6: draws while playing; paused means ZERO draws and a 40% frozen frame', async () => {
    const { layer, now, calls } = await makeLayer()
    layer.setPlaying(true)
    for (let i = 0; i < 5; i++) {
      now.t += 16
      layer.draw(i * 0.016)
    }
    expect(layer.state().framesDrawn, 'five playing draws').toBe(5)
    expect(calls().some((c) => c.kind === 'stroke'), 'lines were stroked').toBe(true)
    layer.setPlaying(false)
    expect(layer.state().opacity, 'frozen frame at 40%').toBeCloseTo(0.4, 6)
    const before = layer.state().framesDrawn
    for (let i = 0; i < 20; i++) {
      now.t += 16
      layer.draw(1 + i * 0.016)
    }
    expect(layer.state().framesDrawn, 'paused → zero frames (CC-107.6)').toBe(before)
    layer.dispose()
  })

  test('CC-107.6: spectrum mode reads frequency data; waveform mode reads time-domain data', async () => {
    const spectrum = await makeLayer({ prefs: { mode: 'spectrum' } })
    spectrum.layer.setPlaying(true)
    spectrum.now.t = 16
    spectrum.layer.draw(0)
    expect(spectrum.analyser.frequencyCalls, 'spectrum reads getFloatFrequencyData').toBe(1)
    expect(spectrum.analyser.timeDomainCalls, 'never time domain in spectrum mode').toBe(0)
    spectrum.layer.dispose()

    const waveform = await makeLayer({ prefs: { mode: 'waveform' } })
    waveform.analyser.setTimeDomain(Array.from({ length: 4096 }, (_, i) => Math.sin(i / 32)))
    waveform.layer.setPlaying(true)
    waveform.now.t = 16
    waveform.layer.draw(0)
    expect(waveform.analyser.timeDomainCalls, 'waveform reads getFloatTimeDomainData').toBe(1)
    expect(waveform.analyser.frequencyCalls).toBe(0)
    waveform.layer.dispose()
  })

  test('CC-107.6: Tint by speaker uses the active block colour; off falls back', async () => {
    const tinted = await makeLayer({ activeColor: '#ff6b6b' })
    tinted.layer.setPlaying(true)
    tinted.now.t = 16
    tinted.layer.draw(0)
    const strokes = tinted.calls().filter((c) => c.kind === 'stroke')
    expect(strokes.length, 'a line was drawn').toBeGreaterThan(0)
    expect(strokes.at(-1)?.style, 'tinted with the active speaker colour').toBe('#ff6b6b')
    tinted.layer.dispose()

    drawTarget = fakeCanvas2d()
    const plain = await makeLayer({ activeColor: '#ff6b6b', prefs: { tintBySpeaker: false } })
    plain.layer.setPlaying(true)
    plain.now.t = 16
    plain.layer.draw(0)
    const plainStrokes = plain.calls().filter((c) => c.kind === 'stroke')
    expect(plainStrokes.length).toBeGreaterThan(0)
    expect(plainStrokes.at(-1)?.style, 'not the speaker colour when tint is off').not.toBe('#ff6b6b')
    plain.layer.dispose()
  })

  test('CC-107.6: prefers-reduced-motion caps redraws at ≤ 4 Hz (≥ 250 ms apart)', async () => {
    const { layer, now } = await makeLayer({ reducedMotion: true })
    layer.setPlaying(true)
    for (let t = 0; t <= 1000; t += 50) {
      now.t = t
      layer.draw(t / 1000)
    }
    // 0..1000 ms at 250 ms spacing: at most 0,250,500,750,1000 → 5 frames.
    expect(layer.state().framesDrawn, '≤ 4 Hz over 1 s').toBeLessThanOrEqual(5)
    layer.dispose()
  })

  test('CC-107.6: DPR scales the backing store (dpr 2 → 2× pixel dimensions)', async () => {
    const { layer, canvas } = await makeLayer({ dpr: 2 })
    expect(layer.state().dpr).toBe(2)
    expect(canvas.width, 'dpr-scaled width').toBe(SIZE.width * 2)
    expect(canvas.height, 'dpr-scaled height').toBe(SIZE.height * 2)
    expect(canvas.getAttribute('aria-hidden'), 'decorative canvas is aria-hidden (CC-107.9)').toBe('true')
    layer.dispose()
  })

  test('CC-107.6: NaN bins never throw and never stop the frame counter', async () => {
    const { layer, analyser } = await makeLayer()
    analyser.setFrequencyBins(Array.from({ length: 2048 }, (_, i) => (i % 7 === 0 ? Number.NaN : i % 3 === 0 ? Number.NEGATIVE_INFINITY : -80)))
    layer.setPlaying(true)
    for (let i = 0; i < 4; i++) layer.draw(i * 0.02)
    expect(layer.state().framesDrawn).toBe(4)
    layer.dispose()
  })
})
