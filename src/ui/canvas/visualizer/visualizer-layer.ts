// unit-107 (FR-107.4 / CC-107.6): the audio visualizer layer — the spectrum
// line / waveform oscilloscope drawn on the audio stage (design.md § Audio
// projects — preview stage). PURE DRAWER: no rAF of its own (the transport
// bar owns the app's single rAF loop; the composition root pumps draw() from
// it), no DOM ownership beyond the canvas it is handed. Geometry comes
// exclusively from engine/audio/spectrum (CC-107.5 math) — the L4 pixel scan
// pins the same mapping through spectrumX.
//
// Frozen styling (design.md): 2 px line in --waveform-active, "Tint by
// speaker" overrides with the active block's colour (default on), 10% fill
// beneath, paused → last frame frozen at 40% opacity with ZERO draws,
// prefers-reduced-motion → ≤ 4 Hz. The canvas is decorative: aria-hidden,
// pointer-events none (CC-107.9 — the transcript/live region carry the
// information). NaN/−Infinity bins degrade (engine-safe), never throw.

import { toSpectrumLine, toWaveformLine } from '../../../engine/audio/spectrum'

export interface VisualizerPrefs {
  mode: 'spectrum' | 'waveform'
  tintBySpeaker: boolean
}

export interface VisualizerAnalyser {
  readonly fftSize: number
  readonly frequencyBinCount: number
  getFloatFrequencyData(bins: Float32Array): void
  getFloatTimeDomainData(samples: Float32Array): void
}

export interface VisualizerLayerDeps {
  canvas: HTMLCanvasElement
  analyser: VisualizerAnalyser
  sampleRate(): number
  getPrefs(): VisualizerPrefs
  getSize(): { width: number; height: number }
  activeSpeakerColor(): string | null
  devicePixelRatio(): number
  prefersReducedMotion(): boolean
  now(): number
}

export interface VisualizerLayerState {
  framesDrawn: number
  opacity: number
  dpr: number
}

export interface VisualizerLayer {
  setPlaying(playing: boolean): void
  /** Pump one frame (composition-root rAF only). */
  draw(playheadSec: number): void
  state(): VisualizerLayerState
  dispose(): void
}

const LINE_WIDTH = 2
const FILL_ALPHA = 0.1
const PAUSED_OPACITY = 0.4
const REDUCED_MOTION_MIN_INTERVAL_MS = 250
const FALLBACK_STROKE = '#4c8dff'

function resolveStrokeColor(): string {
  if (typeof window === 'undefined') return FALLBACK_STROKE
  const value = getComputedStyle(document.documentElement).getPropertyValue('--waveform-active').trim()
  return value === '' ? FALLBACK_STROKE : value
}

export function createVisualizerLayer(deps: VisualizerLayerDeps): VisualizerLayer {
  const { canvas } = deps
  canvas.setAttribute('aria-hidden', 'true')
  canvas.removeAttribute('tabindex')
  canvas.style.pointerEvents = 'none'
  const dpr = Math.max(1, deps.devicePixelRatio())
  const size = deps.getSize()
  canvas.width = Math.round(size.width * dpr)
  canvas.height = Math.round(size.height * dpr)
  const ctx = canvas.getContext('2d')

  let playing = false
  let opacity = 1
  let framesDrawn = 0
  let lastDrawAt: number | null = null
  let disposed = false

  const strokePolyline = (points: Float32Array, color: string): void => {
    if (ctx === null || points.length < 4) return
    ctx.beginPath()
    ctx.moveTo(points[0] ?? 0, points[1] ?? 0)
    for (let i = 2; i + 1 < points.length; i += 2) ctx.lineTo(points[i] ?? 0, points[i + 1] ?? 0)
    // Line stroked first (clean path), then the same path extended to the
    // floor for the 10% fill beneath (design.md styling).
    ctx.lineWidth = LINE_WIDTH
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.save()
    ctx.globalAlpha = opacity * FILL_ALPHA
    ctx.fillStyle = color
    ctx.lineTo(points[points.length - 2] ?? 0, size.height)
    ctx.lineTo(points[0] ?? 0, size.height)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  return {
    setPlaying(next: boolean): void {
      const wasPlaying = playing
      playing = next
      opacity = next ? 1 : PAUSED_OPACITY
      canvas.style.opacity = String(opacity)
      // Fresh-frame allowance only on the paused→playing EDGE — the pump
      // calls setPlaying(true) every frame (throttle clock must survive).
      if (next && !wasPlaying) lastDrawAt = null
    },
    draw(_playheadSec: number): void {
      if (disposed || !playing || ctx === null) return
      if (deps.prefersReducedMotion()) {
        const t = deps.now()
        if (lastDrawAt !== null && t - lastDrawAt < REDUCED_MOTION_MIN_INTERVAL_MS) return
        lastDrawAt = t
      }
      const prefs = deps.getPrefs()
      const { width, height } = deps.getSize()
      const color = prefs.tintBySpeaker ? (deps.activeSpeakerColor() ?? resolveStrokeColor()) : resolveStrokeColor()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.globalAlpha = opacity
      if (prefs.mode === 'spectrum') {
        const bins = new Float32Array(deps.analyser.frequencyBinCount)
        deps.analyser.getFloatFrequencyData(bins)
        strokePolyline(toSpectrumLine(bins, { sampleRate: deps.sampleRate(), fftSize: deps.analyser.fftSize, width, height }), color)
      } else {
        const samples = new Float32Array(deps.analyser.fftSize)
        deps.analyser.getFloatTimeDomainData(samples)
        strokePolyline(toWaveformLine(samples, { width, height }), color)
      }
      ctx.globalAlpha = 1
      framesDrawn += 1
    },
    state(): VisualizerLayerState {
      return { framesDrawn, opacity, dpr }
    },
    dispose(): void {
      disposed = true
    },
  }
}
