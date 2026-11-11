// ERes2Net log-Mel/Kaldi fbank frontend (FR-06.1/FR-06.2, pure).
//
// 80-bin Kaldi-compatible fbank (25 ms frame / 10 ms shift @ 16 kHz) with the
// global-mean normalization the exported ONNX declares in its metadata
// (`feature_normalize_type: global-mean`, `sample_rate: 16000`,
// `output_dim: 512` — verified against the cached graph's metadata_props).
// The graph input is `x` float32 [N, T, 80]; output `embedding` [N, 512].
//
// kaldi recipe mirrored (dither 0): pre-emphasis 0.97, povey window, HTK-style
// mel triangle filterbank over a 512-pt rFFT power spectrum, log with 1e-10
// floor, then per-bin time-mean subtraction (global-mean normalisation).
// Deterministic pure function — no SDK, no DOM globals (engine-pure).

const FRAME_MS = 0.025
const SHIFT_MS = 0.01
const NFFT = 512
const NUM_BINS = 80
const PRE_EMPHASIS = 0.97
const FLOOR = 1e-10

export const FBANK_NUM_BINS = NUM_BINS

/** radix-2 in-place Cooley–Tukey; re/im overwritten with the DFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!
        const ui = im[i + k]!
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

// HTK mel: m = 1127 ln(1 + f/700); its inverse builds NUM_BINS+2 triangle
// centre frequencies between 20 Hz and Nyquist, exactly kaldi's default band.
function melCentres(sampleRate: number): number[] {
  const lo = 20
  const hi = sampleRate / 2
  const melLo = 1127 * Math.log(1 + lo / 700)
  const melHi = 1127 * Math.log(1 + hi / 700)
  const hz: number[] = []
  for (let m = 0; m <= NUM_BINS + 1; m++) {
    const mel = melLo + ((melHi - melLo) * m) / (NUM_BINS + 1)
    hz.push(700 * (Math.exp(mel / 1127) - 1))
  }
  return hz
}

/**
 * 80-dim log-Mel fbank for one utterance, Kaldi-style with dither 0.
 * @param samples mono 16 kHz Float32 in [-1, 1]
 * @param sampleRate the buffer's rate (16000 per the protocol PcmChunk contract)
 * @returns row-major [T, NUM_BINS] features with per-bin global-mean removed,
 *   plus the frame count `T`. Empty/short audio is zero-padded to one frame so
 *   the embedding session always receives a well-formed [1, ≥1, 80] tensor.
 */
export function computeFbank(samples: Float32Array, sampleRate = 16_000): { feats: Float32Array; frames: number } {
  const winLen = Math.round(FRAME_MS * sampleRate) // 400 @ 16k
  const winStep = Math.round(SHIFT_MS * sampleRate) // 160 @ 16k
  const frames = Math.max(1, Math.floor((samples.length - winLen) / winStep) + 1)

  const window = new Float32Array(winLen)
  for (let n = 0; n < winLen; n++) window[n] = Math.pow(0.5 - 0.46 * Math.cos((2 * Math.PI * n) / (winLen - 1)), 0.85)

  const centres = melCentres(sampleRate)
  const binHz = (k: number): number => (k * sampleRate) / NFFT
  const filters = new Array<Float32Array>(NUM_BINS)
  for (let m = 1; m <= NUM_BINS; m++) {
    const f0 = centres[m - 1]!
    const f1 = centres[m]!
    const f2 = centres[m + 1]!
    const row = new Float32Array(NFFT / 2 + 1)
    for (let k = 0; k <= NFFT / 2; k++) {
      const f = binHz(k)
      if (f >= f0 && f <= f1) row[k] = f1 === f0 ? 0 : (f - f0) / (f1 - f0)
      else if (f > f1 && f <= f2) row[k] = f2 === f1 ? 0 : (f2 - f) / (f2 - f1)
    }
    filters[m - 1] = row
  }

  const feats = new Float32Array(frames * NUM_BINS)
  const pre = new Float32Array(winLen)
  const re = new Float64Array(NFFT)
  const im = new Float64Array(NFFT)
  for (let t = 0; t < frames; t++) {
    const off = t * winStep
    for (let n = 0; n < winLen; n++) {
      const cur = samples[off + n] ?? 0
      const prev = n === 0 ? cur : (samples[off + n - 1] ?? 0)
      pre[n] = (cur - PRE_EMPHASIS * prev) * window[n]!
      re[n] = pre[n]!
      im[n] = 0
    }
    for (let n = winLen; n < NFFT; n++) {
      re[n] = 0
      im[n] = 0
    }
    fft(re, im)
    for (let m = 0; m < NUM_BINS; m++) {
      let energy = 0
      const row = filters[m]!
      for (let k = 0; k <= NFFT / 2; k++) {
        const mag = re[k]! * re[k]! + im[k]! * im[k]!
        energy += mag * row[k]!
      }
      feats[t * NUM_BINS + m] = Math.log(Math.max(energy, FLOOR))
    }
  }

  // global-mean normalisation (per bin, over time) — model metadata contract.
  for (let m = 0; m < NUM_BINS; m++) {
    let mean = 0
    for (let t = 0; t < frames; t++) mean += feats[t * NUM_BINS + m]!
    mean /= frames
    for (let t = 0; t < frames; t++) feats[t * NUM_BINS + m]! -= mean
  }
  return { feats, frames }
}
