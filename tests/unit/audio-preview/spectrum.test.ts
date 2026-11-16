// CC-107.5 (L1): `toSpectrumLine`/`toWaveformLine` pure visual math
// (FR-107.3) — tone bins → peaks at the right log-frequency x (± 2 px at a
// 1280 px stage); silence → baseline; NaN/−Infinity handled; property test:
// output length and bounds for arbitrary inputs (fast-check).
//
// RED mechanism: dynamic import of the unbuilt `@engine/audio/spectrum`
// (intended missing-module seam). Engine purity holds (this engine module
// takes typed arrays only — no DOM globals in or out).
import { describe, expect, test } from 'vitest'
import { assert as fcAssert, integer as fcInteger, property as fcProperty } from 'fast-check'

const SPECTRUM_MODULE = '@engine/audio/spectrum'
type SpectrumModule = typeof import('@engine/audio/spectrum')

const load = async (): Promise<SpectrumModule> => (await import(/* @vite-ignore */ SPECTRUM_MODULE)) as unknown as SpectrumModule

const SAMPLE_RATE = 44_100
const FFT_SIZE = 4096
const BIN_HZ = SAMPLE_RATE / FFT_SIZE
const STAGE_W = 1280
const STAGE_H = 720
const BASE_OPTS = { sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, width: STAGE_W, height: STAGE_H }
const POINTS = Math.floor(STAGE_W * 0.5) + 1 // pointsPerPx default 0.5

/** Bins for steady tones: −10 dBFS in the covering bin, −90 elsewhere. */
function toneBins(hzs: number[]): Float32Array {
  const bins = new Float32Array(FFT_SIZE / 2).fill(-90)
  for (const hz of hzs) bins[Math.round(hz / BIN_HZ)] = -10
  return bins
}

/** y of the output point whose x is nearest `targetX` (baseline = 0.8·h). */
function yNear(line: Float32Array, targetX: number): number {
  let best = Infinity
  let bestDx = Infinity
  for (let i = 0; i < line.length; i += 2) {
    const dx = Math.abs(line[i]! - targetX)
    if (dx < bestDx) {
      bestDx = dx
      best = line[i + 1]!
    }
  }
  expect(bestDx, 'output spans the full width').toBeLessThanOrEqual(1.1)
  return best
}

function expectPeakAt(mod: SpectrumModule, line: Float32Array, hz: number, label: string): void {
  const x = mod.spectrumX(hz, { width: STAGE_W })
  const yTop = yNear(line, x)
  expect(yTop, `${label}: peak at ${String(hz)} Hz (x=${String(Math.round(x))})`).toBeLessThan(STAGE_H * 0.35)
  // A local maximum: both ±40 px neighbours sit on the baseline band.
  const left = yNear(line, x - 40)
  const right = yNear(line, x + 40)
  expect(left, `${label}: left of ${String(hz)} Hz sits low`).toBeGreaterThan(STAGE_H * 0.65)
  expect(right, `${label}: right of ${String(hz)} Hz sits low`).toBeGreaterThan(STAGE_H * 0.65)
}

describe('CC-107.5: toSpectrumLine', () => {
  test('CC-107.5: tones-220-1k-5k bins → peaks at the three expected x positions (± 2 px)', async () => {
    const mod = await load()
    const line = mod.toSpectrumLine(toneBins([220, 1000, 5000]), BASE_OPTS)
    expect(line.length).toBe(POINTS * 2)
    // x-positions recomputed independently of the library's own helper via the
    // documented log mapping (30 Hz → 0, 16 kHz → width): x = W·ln(f/30)/ln(16000/30).
    const xOf = (hz: number): number => (STAGE_W * Math.log(hz / 30)) / Math.log(16000 / 30)
    for (const hz of [220, 1000, 5000]) {
      const x = mod.spectrumX(hz, { width: STAGE_W })
      expect(Math.abs(x - xOf(hz)), `spectrumX(${String(hz)}) matches the documented mapping`).toBeLessThanOrEqual(2)
      expectPeakAt(mod, line, hz, 'tones')
    }
  })

  test('CC-107.5: silence → the line sits on the baseline, finite everywhere', async () => {
    const mod = await load()
    const line = mod.toSpectrumLine(new Float32Array(FFT_SIZE / 2).fill(-100), BASE_OPTS)
    for (let i = 0; i < line.length; i += 2) {
      expect(Number.isFinite(line[i]), `x[${String(i / 2)}] finite`).toBe(true)
      expect(Number.isFinite(line[i + 1]), `y[${String(i / 2)}] finite`).toBe(true)
      expect(line[i + 1], `baseline y at x=${String(line[i])}`).toBeCloseTo(STAGE_H * 0.8, 6)
    }
  })

  test('CC-107.5: NaN and −Infinity bins degrade to the minDb baseline', async () => {
    const mod = await load()
    const bins = toneBins([1000])
    bins[3] = Number.NaN
    bins[300] = Number.NEGATIVE_INFINITY
    bins[800] = Number.NaN
    const line = mod.toSpectrumLine(bins, BASE_OPTS)
    for (let i = 0; i < line.length; i += 2) {
      expect(Number.isFinite(line[i + 1]), `y[${String(i / 2)}] finite despite NaN/-Inf bins`).toBe(true)
    }
    expectPeakAt(mod, line, 1000, 'mixed')
    // The NaN-bin region (≈65–73 Hz region) sits on the baseline, not below.
    expect(yNear(line, mod.spectrumX(66, { width: STAGE_W }))).toBeCloseTo(STAGE_H * 0.8, 6)
  })

  test('CC-107.5: property — length and bounds hold for arbitrary inputs', async () => {
    const mod = await load()
    fcAssert(
      fcProperty(
        fcInteger({ min: -100_000, max: 100_000 }),
        fcInteger({ min: 0, max: 300 }),
        fcInteger({ min: 8_000, max: 192_000 }),
        fcInteger({ min: 40, max: 1600 }),
        fcInteger({ min: 20, max: 900 }),
        (seedNoise: number, binCount: number, sampleRate: number, width: number, height: number) => {
          const fftSize = 4096
          const bins = new Float32Array(fftSize / 2)
          // Deterministic adversarial fill seeded by the shrunk inputs.
          for (let i = 0; i < bins.length; i++) {
            const n = Math.sin(seedNoise * 7.13 + i * 0.91) * 60
            bins[i] = i < binCount ? Number.NaN : Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY
          }
          const line = mod.toSpectrumLine(bins, { sampleRate, fftSize, width, height })
          const points = Math.floor(width * 0.5) + 1
          if (line.length !== points * 2) return false
          for (let i = 0; i < line.length; i += 2) {
            const x = line[i]!
            const y = line[i + 1]!
            if (!Number.isFinite(x) || !Number.isFinite(y)) return false
            if (x < 0 || x > width || y < 0 || y > height) return false
            if (i >= 2 && line[i]! < line[i - 2]!) return false // x non-decreasing
          }
          return true
        },
      ),
      { numRuns: 200 },
    )
  })

  test('CC-107.5: dB clamp — bins above maxDb and below minDb map to the band edges', async () => {
    const mod = await load()
    const bins = new Float32Array(FFT_SIZE / 2).fill(-200)
    bins[Math.round(220 / BIN_HZ)] = 0 // above maxDb (-10) → clamps to the top edge
    bins[Math.round(4000 / BIN_HZ)] = -140 // below minDb (-90) → baseline
    const line = mod.toSpectrumLine(bins, BASE_OPTS)
    expect(yNear(line, mod.spectrumX(220, { width: STAGE_W }))).toBeCloseTo(STAGE_H * 0.2, 6)
    expect(yNear(line, mod.spectrumX(4000, { width: STAGE_W }))).toBeCloseTo(STAGE_H * 0.8, 6)
  })
})

describe('CC-107.5: toWaveformLine', () => {
  test('CC-107.5: sine maps symmetric amplitude and finite output', async () => {
    const mod = await load()
    const samples = new Float32Array(FFT_SIZE)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE)
    const line = mod.toWaveformLine(samples, { width: STAGE_W, height: STAGE_H, durationSec: samples.length / SAMPLE_RATE })
    const points = Math.floor(STAGE_W * 0.5) + 1
    expect(line.length).toBe(points * 2)
    let min = Infinity
    let max = -Infinity
    for (let i = 1; i < line.length; i += 2) {
      expect(Number.isFinite(line[i])).toBe(true)
      min = Math.min(min, line[i]!)
      max = Math.max(max, line[i]!)
    }
    expect(min).toBeLessThan(STAGE_H * 0.45)
    expect(max).toBeGreaterThan(STAGE_H * 0.55)
    expect(min + max, 'symmetric about the center').toBeCloseTo(STAGE_H, 0)
  })

  test('CC-107.5: NaN samples fall back to the center line', async () => {
    const mod = await load()
    const samples = new Float32Array(FFT_SIZE).fill(Number.NaN)
    const line = mod.toWaveformLine(samples, { width: STAGE_W, height: STAGE_H, durationSec: 0.1 })
    for (let i = 1; i < line.length; i += 2) expect(line[i]).toBeCloseTo(STAGE_H / 2, 6)
  })
})
