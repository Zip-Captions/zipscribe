// Windowed-sinc polyphase resampler with an anti-alias low-pass (FR-04.2)
// and Web Audio `speakers` channel downmix (FR-04.3). Pure deterministic
// TypeScript: no DOM globals, no SDK imports, no randomness. The exported
// surface is the frozen unit-04 contract
// (`tests/unit/media/unit04-api-contract.d.ts`).
//
// Design (AUDIO-DEMUXER § "Resampler design", as carried by the contract
// docstring): the low-pass sits at `min(fromRate, toRate × speed) / 2 ×
// CUTOFF_RATIO`; output `n` is the input at time `n / (toRate / speed)`, so
// the kernel is centred on the fractional position (zero group delay) and
// `speed === 1` yields exactly `ceil(frames × toRate / (fromRate × speed))`
// samples. The kernel is a Kaiser-windowed sinc sized from the stopband
// spec; taps are evaluated per phase on the rational grid `n × fromRate ×
// speed / toRate`, which makes the one-shot and the streaming variant
// compute bit-identical outputs for the same input.

export const TARGET_SAMPLE_RATE = 16000

/** Web Audio `ChannelInterpretation` mixing rules (speakers = the spec's default table). */
export type ChannelInterpretation = 'speakers' | 'discrete'

export interface ResampleOptions {
  /** Input sample rate in Hz (44100, 48000, 22050, 8000…). */
  fromRate: number
  /** Target rate; default and the decode path pin `TARGET_SAMPLE_RATE` (16000). */
  toRate?: number
  /** Input channels; default `1`. Planar layout: channel `c` is `in[n × channels + c]`. */
  channels?: number
  /** Web Audio mixing rule used for ANY channel-count change; default `'speakers'`. */
  channelInterpretation?: ChannelInterpretation
  /** Web Audio `playbackRate`-style speed factor; default `1`. */
  speed?: number
}

/** Streaming variant: resamples finite chunks with filter state, concatenation-equivalent to one `resample()` call on the concatenated input. */
export interface StreamingResampler {
  push(input: Float32Array): Float32Array
  flush(): Float32Array
}

const CUTOFF_RATIO = 0.95
const STOPBAND_DB = 90
const MAX_EAGER_PHASES = 2048

function besselI0(x: number): number {
  let sum = 1
  let term = 1
  for (let k = 1; k <= 60; k++) {
    term = (term * x * x) / (4 * k * k)
    sum += term
    if (term < sum * 1e-18) break
  }
  return sum
}

interface Kernel {
  /** Kernel support radius in input samples (taps span `[-R, R]` around the position). */
  readonly radius: number
  /** Low-pass cutoff in cycles/input-sample. */
  readonly normalizedCutoff: number
  readonly beta: number
  readonly besselDenominator: number
}

function designKernel(fromRate: number, toRate: number, speed: number): Kernel {
  const edge = Math.min(fromRate, toRate * speed) / 2
  const cutoff = edge * CUTOFF_RATIO
  const transition = edge - cutoff
  // Kaiser order estimate for the target stopband over `transition` Hz.
  const taps = (STOPBAND_DB - 7.95) / (14.36 * (transition / fromRate)) + 1
  const beta = 0.1102 * (STOPBAND_DB - 8.7)
  return {
    radius: Math.max(3, Math.ceil(taps / 2)),
    normalizedCutoff: cutoff / fromRate,
    beta,
    besselDenominator: besselI0(beta),
  }
}

function tapValue(kernel: Kernel, t: number): number {
  const r = kernel.radius
  if (t <= -r || t >= r) return 0
  const u = 2 * kernel.normalizedCutoff * t
  const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)
  const v = t / r
  return 2 * kernel.normalizedCutoff * sinc * (besselI0(kernel.beta * Math.sqrt(1 - v * v)) / kernel.besselDenominator)
}

/**
 * Interleaved → mono per the Web Audio "speakers" downmix table
 * (https://webaudio.spec.whatwg.org/#channel-up-mixing-and-down-mixing-matrix
 * § 4.5 — the rules mediabunny's `AudioResampler` implements verbatim).
 * `discrete` sums every channel at unity gain (frozen contract semantics).
 * Channel counts with no spec table fall back to the discrete sum.
 */
function mixToMono(input: Float32Array, offset: number, frames: number, channels: number, interpretation: ChannelInterpretation, into: Float32Array, intoOffset: number): void {
  if (channels === 1) {
    for (let i = 0; i < frames; i++) into[intoOffset + i] = input[offset + i]!
    return
  }
  if (interpretation === 'speakers') {
    if (channels === 2) {
      for (let i = 0; i < frames; i++) into[intoOffset + i] = 0.5 * (input[offset + i * 2]! + input[offset + i * 2 + 1]!)
      return
    }
    if (channels === 4) {
      for (let i = 0; i < frames; i++) {
        const b = offset + i * 4
        into[intoOffset + i] = 0.25 * (input[b]! + input[b + 1]! + input[b + 2]! + input[b + 3]!)
      }
      return
    }
    if (channels === 6) {
      // 5.1 → mono: sqrt(0.5)·(L+R) + C + 0.5·(SL+SR); the LFE channel is
      // muted by the spec (surprising but normative, and what mediabunny does).
      for (let i = 0; i < frames; i++) {
        const b = offset + i * 6
        into[intoOffset + i] = Math.SQRT1_2 * (input[b]! + input[b + 1]!) + input[b + 2]! + 0.5 * (input[b + 4]! + input[b + 5]!)
      }
      return
    }
  }
  for (let i = 0; i < frames; i++) {
    let sum = 0
    const b = offset + i * channels
    for (let c = 0; c < channels; c++) sum += input[b + c]!
    into[intoOffset + i] = sum
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x
}

function outputCount(frames: number, fromRate: number, toRate: number, speed: number): number {
  return Math.ceil((frames * toRate) / (fromRate * Math.max(speed, Number.EPSILON)))
}

/**
 * Shared polyphase engine behind both `resample` (one push + flush) and
 * `createResampler`. `P/Q` is the reduced `fromRate × speed / toRate` ratio
 * when that is rational: output `n` samples the mono history at input
 * position `n·P/Q` (zero-delay, kernel centred). The one-shot delegates here
 * so both forms compute identical outputs for identical inputs.
 */
function createEngine(fromRate: number, toRate: number, channels: number, interpretation: ChannelInterpretation, speed: number): StreamingResampler {
  const identity = fromRate === toRate && speed === 1
  const kernel = designKernel(fromRate, toRate, speed)
  const radius = kernel.radius
  const tapsPerOutput = 2 * radius + 1

  const rationalNumerator = fromRate * speed
  const rational = Number.isInteger(rationalNumerator) && Number.isInteger(toRate)
  const g = rational ? gcd(rationalNumerator, toRate) : 1
  const P = rational ? rationalNumerator / g : 0
  const Q = rational ? toRate / g : 0
  const posScale = (fromRate * speed) / toRate
  const table = rational && Q <= MAX_EAGER_PHASES ? new Float32Array(Q * tapsPerOutput) : null
  if (table) {
    for (let phase = 0; phase < Q; phase++) {
      const f = phase / Q
      for (let m = 0; m < tapsPerOutput; m++) table[phase * tapsPerOutput + m] = tapValue(kernel, m - radius + f)
    }
  }

  // `mono` is the mixed history covering exactly global frames
  // `[monoBase, seenFrames)`; only frames still inside a pending output's
  // kernel support are retained (compacted after every emit).
  let mono = new Float32Array(0)
  let monoBase = 0
  let seenFrames = 0
  let produced = 0
  let pending = new Float32Array(0)

  function appendMono(interleaved: Float32Array, frames: number): void {
    if (frames === 0) return
    const next = new Float32Array(mono.length + frames)
    next.set(mono)
    mixToMono(interleaved, 0, frames, channels, interpretation, next, mono.length)
    mono = next
    seenFrames += frames
  }

  function emit(count: number, knownFrames: number): Float32Array {
    const out = new Float32Array(count)
    for (let n = produced; n < produced + count; n++) {
      let q: number
      let fraction: number
      let row: Float32Array | null = null
      if (rational) {
        const np = n * P
        const j = np % Q
        q = (np - j) / Q
        if (table) row = table.subarray(j * tapsPerOutput, (j + 1) * tapsPerOutput)
        fraction = j / Q
      } else {
        const x = n * posScale
        q = Math.floor(x)
        fraction = x - q
      }
      let sum = 0
      const kLo = Math.max(q - radius, monoBase)
      const kHi = Math.min(q + radius, knownFrames - 1, monoBase + mono.length - 1)
      if (row) {
        for (let k = kLo; k <= kHi; k++) sum += row[k - (q - radius)]! * mono[k - monoBase]!
      } else {
        for (let k = kLo; k <= kHi; k++) sum += tapValue(kernel, fraction - (k - q)) * mono[k - monoBase]!
      }
      out[n - produced] = sum
    }
    produced += count
    return out
  }

  function availableCount(): number {
    if (identity) return seenFrames - produced
    let n = produced
    while (rational ? n * P < (seenFrames - radius) * Q : n * posScale < seenFrames - radius) n++
    return n - produced
  }

  return {
    push(input: Float32Array): Float32Array {
      if (identity && channels === 1) {
        const out = new Float32Array(input.length)
        out.set(input)
        produced += input.length
        return out
      }
      const merged = new Float32Array(pending.length + input.length)
      merged.set(pending)
      merged.set(input, pending.length)
      const frames = Math.floor(merged.length / channels)
      const block = merged.subarray(0, frames * channels)
      pending = merged.subarray(frames * channels)
      if (identity) {
        const out = new Float32Array(frames)
        mixToMono(block, 0, frames, channels, interpretation, out, 0)
        produced += frames
        return out
      }
      appendMono(block, frames)
      const count = availableCount()
      const piece = emit(count, seenFrames)
      const neededStart = Math.max(0, Math.floor(produced * posScale - radius - 1))
      if (neededStart > monoBase) {
        mono = mono.subarray(neededStart - monoBase)
        monoBase = neededStart
      }
      return piece
    },
    flush(): Float32Array {
      if (identity) return new Float32Array(0)
      const total = outputCount(seenFrames, fromRate, toRate, speed)
      return emit(Math.max(0, total - produced), seenFrames)
    },
  }
}

function validate(fromRate: number, toRate: number, channels: number, speed: number): void {
  if (!Number.isFinite(fromRate) || fromRate <= 0) throw new RangeError(`resample: fromRate must be a positive finite number (got ${fromRate})`)
  if (!Number.isFinite(toRate) || toRate <= 0) throw new RangeError(`resample: toRate must be a positive finite number (got ${toRate})`)
  if (!Number.isInteger(channels) || channels < 1) throw new RangeError(`resample: channels must be a positive integer (got ${channels})`)
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError(`resample: speed must be a positive finite number (got ${speed})`)
}

function resolve(options: ResampleOptions): { fromRate: number; toRate: number; channels: number; interpretation: ChannelInterpretation; speed: number } {
  const toRate = options.toRate ?? TARGET_SAMPLE_RATE
  const channels = options.channels ?? 1
  const speed = options.speed ?? 1
  validate(options.fromRate, toRate, channels, speed)
  return { fromRate: options.fromRate, toRate, channels, interpretation: options.channelInterpretation ?? 'speakers', speed }
}

/**
 * Windowed-sinc polyphase resampler with an anti-alias low-pass at
 * `min(fromRate, toRate × speed) / 2 × 0.95`. Output is mono; for
 * `speed === 1` the length is `ceil(in.length / channels × toRate / fromRate)`
 * and `out[n]` is the input at time `n / toRate`.
 */
export function resample(input: Float32Array, options: ResampleOptions): Float32Array {
  const resolved = resolve(options)
  const engine = createEngine(resolved.fromRate, resolved.toRate, resolved.channels, resolved.interpretation, resolved.speed)
  const first = engine.push(input)
  const tail = engine.flush()
  if (tail.length === 0) return first
  const out = new Float32Array(first.length + tail.length)
  out.set(first)
  out.set(tail, first.length)
  return out
}

export function createResampler(options: ResampleOptions): StreamingResampler {
  const resolved = resolve(options)
  return createEngine(resolved.fromRate, resolved.toRate, resolved.channels, resolved.interpretation, resolved.speed)
}
