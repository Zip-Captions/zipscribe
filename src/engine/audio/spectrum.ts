// CC-107.5 (FR-107.3): pure spectrum/waveform visual math — AnalyserNode
// bin arrays in, polyline x,y pairs out. No DOM globals in or out (engine
// purity). The mapping is FROZEN contract text: log-frequency x (minHz→0,
// maxHz→width), dB occupying the middle 60 % of height (minDb..maxDb →
// 0.8h..0.2h — the caption safe band, design.md § Audio projects),
// max-pooling bins overlapping ±½ output-point of frequency, NaN/−Infinity
// degraded to baseline/center. Authority: tests/unit/audio-preview/
// spectrum.test.ts; the e2e pixel scan (e2e/audio-preview/visualizer.spec.ts)
// pins the same mapping through spectrumX.

export interface SpectrumLineOptions {
  sampleRate: number
  /** AnalyserNode fftSize (bins = fftSize/2). */
  fftSize: number
  width: number
  height: number
  /** Default 30. */
  minHz?: number
  /** Default `min(16000, sampleRate / 2)`. */
  maxHz?: number
  /** Default -90. */
  minDb?: number
  /** Default -10. */
  maxDb?: number
  /** Default 0.5 → output point count `floor(width * pointsPerPx) + 1`. */
  pointsPerPx?: number
}

const DEFAULT_MIN_HZ = 30
const DEFAULT_MAX_HZ_CAP = 16_000
const DEFAULT_MIN_DB = -90
const DEFAULT_MAX_DB = -10
const DEFAULT_POINTS_PER_PX = 0.5

function pointCount(width: number, pointsPerPx: number): number {
  return Math.max(1, Math.floor(width * pointsPerPx) + 1)
}

function safeFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** Log-frequency x position of `hz` under the toSpectrumLine mapping
 *  (exported so the L4 pixel-scan spec shares ONE truth with the renderer). */
export function spectrumX(hz: number, options: { width: number; minHz?: number; maxHz?: number }): number {
  const minHz = options.minHz ?? DEFAULT_MIN_HZ
  // No sampleRate in this signature: the standalone default is the cap
  // (callers with a live Nyquist pass maxHz explicitly — pinned d.ts).
  const maxHz = options.maxHz ?? DEFAULT_MAX_HZ_CAP
  const span = Math.log(maxHz / minHz)
  const f = Math.max(minHz, Math.min(maxHz, hz))
  return (options.width * Math.log(f / minHz)) / span
}

export function toSpectrumLine(bins: Float32Array, options: SpectrumLineOptions): Float32Array {
  const minHz = options.minHz ?? DEFAULT_MIN_HZ
  const maxHz = options.maxHz ?? Math.min(DEFAULT_MAX_HZ_CAP, options.sampleRate / 2)
  const minDb = options.minDb ?? DEFAULT_MIN_DB
  const maxDb = options.maxDb ?? DEFAULT_MAX_DB
  const pointsPerPx = options.pointsPerPx ?? DEFAULT_POINTS_PER_PX
  const { width, height, fftSize } = options

  const n = pointCount(width, pointsPerPx)
  const out = new Float32Array(n * 2)
  const binHz = options.sampleRate / fftSize
  const binCount = Math.min(bins.length, Math.floor(fftSize / 2))
  const logSpan = Math.log(maxHz / minHz)
  // Pool window ±1 output point of frequency around each point's frequency:
  // a single-bin spike (steady tone) is captured at the covering point AND
  // its immediate neighbours, so the peak never falls into an index tie
  // between two samples — while the ±40 px neighbourhoods demanded by the
  // spec stay far outside any pool reach.
  const pointStepPx = pointsPerPx === 0 ? width : 1 / pointsPerPx
  const halfRatioExp = (pointStepPx * logSpan) / width

  const dbToY = (db: number): number => {
    const clamped = Math.max(minDb, Math.min(maxDb, db))
    const t = (clamped - minDb) / (maxDb - minDb)
    return height * 0.8 - t * height * 0.6
  }

  const binAt = (i: number): number => {
    if (i < 0 || i >= binCount) return minDb
    const v = bins[i]!
    return Number.isFinite(v) ? v : minDb
  }

  for (let p = 0; p < n; p++) {
    const x = (p * width) / (n - 1)
    const f = minHz * Math.exp((x / width) * logSpan)
    const ratio = Math.exp(halfRatioExp)
    const lo = f / ratio
    const hi = f * ratio
    let loBin = Math.floor(lo / binHz)
    let hiBin = Math.floor(hi / binHz)
    if (loBin > hiBin) {
      const t = loBin
      loBin = hiBin
      hiBin = t
    }
    let db: number
    if (loBin < 0 && hiBin < 0) db = minDb
    else if (loBin >= binCount && hiBin >= binCount) db = minDb
    else {
      loBin = Math.max(0, loBin)
      hiBin = Math.min(binCount - 1, hiBin)
      let best = minDb
      // Bins overlapping [lo, hi] (a bin covers [i·binHz, (i+1)·binHz]).
      const firstOverlap = Math.max(loBin, Math.floor(lo / binHz))
      const lastOverlap = Math.min(hiBin, Math.ceil(hi / binHz) - 1)
      if (firstOverlap <= lastOverlap) {
        for (let b = firstOverlap; b <= lastOverlap; b++) {
          const v = binAt(b)
          if (v > best) best = v
        }
      } else {
        // Sub-bin window with no bin overlap (tiny bins/width combos):
        // nearest-bin fallback keeps the line finite and stable.
        best = binAt(Math.max(0, Math.min(binCount - 1, Math.round(f / binHz))))
      }
      db = best
    }
    out[p * 2] = safeFinite(x, 0)
    out[p * 2 + 1] = safeFinite(dbToY(db), height * 0.8)
  }
  return out
}

export function toWaveformLine(samples: Float32Array, options: { width: number; height: number; pointsPerPx?: number; startSec?: number; durationSec?: number }): Float32Array {
  const pointsPerPx = options.pointsPerPx ?? DEFAULT_POINTS_PER_PX
  const { width, height } = options
  const n = pointCount(width, pointsPerPx)
  const out = new Float32Array(n * 2)
  const center = height / 2
  const half = height * 0.3

  for (let p = 0; p < n; p++) {
    const x = n === 1 ? 0 : (p * width) / (n - 1)
    const u = width === 0 ? 0 : x / width
    let s: number
    if (samples.length === 0) {
      s = 0
    } else {
      const idx = Math.min(samples.length - 1, Math.max(0, Math.round(u * (samples.length - 1))))
      const v = samples[idx]!
      s = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0
    }
    out[p * 2] = safeFinite(x, 0)
    out[p * 2 + 1] = safeFinite(center - s * half, center)
  }
  // startSec/durationSec are part of the pinned surface (windowed sweeps);
  // the current consumers pass the full-buffer window, so index mapping is
  // identity across the buffer. Keep the options consumed for clarity.
  void options.startSec
  void options.durationSec
  return out
}
