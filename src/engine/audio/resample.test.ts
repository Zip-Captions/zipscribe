// L1 coverage for the resampler surface the frozen CC-04.8 suite does not
// exercise: option defaults, `speed`, the remaining `speakers` tables
// (quad, 5.1 LFE-mute), discrete summation, streaming edge cases (sub-frame
// carry, empty input, identity), validation, and the film resampler.
// (unit-03 precedent for source-adjacent branch tests; supports CC-04.14.)
import { describe, expect, test } from 'vitest'
import { TARGET_SAMPLE_RATE, createResampler, resample } from './resample'
import { resampleFilm } from './resample/film'

function tone(seconds: number, frequency: number, sampleRate: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate))
  for (let index = 0; index < out.length; index++) out[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate)
  return out
}

function toneAmplitude(samples: Float32Array, sampleRate: number, frequency: number): number {
  let real = 0
  let imaginary = 0
  for (let index = 0; index < samples.length; index++) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate
    real += samples[index]! * Math.cos(phase)
    imaginary += samples[index]! * Math.sin(phase)
  }
  return (2 * Math.sqrt(real * real + imaginary * imaginary)) / samples.length
}

function constantFrames(frames: number, values: readonly number[]): Float32Array {
  const channels = values.length
  const out = new Float32Array(frames * channels)
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) out[frame * channels + channel] = values[channel]!
  return out
}

function interiorMiddle(out: Float32Array): number {
  return out[Math.floor(out.length / 2)]!
}

describe('resample: option defaults (unit-04 4A coverage)', () => {
  test('toRate defaults to TARGET_SAMPLE_RATE', () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000)
    const input = tone(1, 1000, 44100)
    const output = resample(input, { fromRate: 44100 })
    expect(output.length).toBe(Math.ceil((input.length * TARGET_SAMPLE_RATE) / 44100))
    expect(toneAmplitude(output.subarray(2000, output.length - 2000), 16000, 1000)).toBeGreaterThan(0.4)
  })

  test('channels defaults to 1 (interleaved input is taken as-is)', () => {
    const input = tone(0.5, 440, 16000)
    const output = resample(input, { fromRate: 16000, toRate: 8000 })
    expect(output.length).toBe(4000)
  })
})

describe('resample: speakers tables beyond stereo (unit-04 4A coverage)', () => {
  test('quad → mono is 0.25·(L+R+SL+SR)', () => {
    const out = resample(constantFrames(8000, [0.1, 0.2, 0.3, 0.4]), { fromRate: 48000, toRate: 16000, channels: 4 })
    expect(interiorMiddle(out)).toBeCloseTo(0.25 * 1.0, 5)
  })

  test('5.1 → mono mutes LFE (Web Audio § 4.5 / mediabunny rule)', () => {
    const out = resample(constantFrames(8000, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), { fromRate: 48000, toRate: 16000, channels: 6 })
    const expected = Math.SQRT1_2 * 0.3 + 0.3 + 0.5 * 1.1
    expect(interiorMiddle(out)).toBeCloseTo(expected, 5)
    // The LFE-inclusive variant (0.5·LFE added) would sit 0.2 higher.
    expect(Math.abs(interiorMiddle(out) - (expected + 0.2))).toBeGreaterThan(0.1)
  })

  test('speakers for channel counts with no spec table falls back to the discrete sum', () => {
    const out = resample(constantFrames(8000, [0.1, 0.1, 0.1]), { fromRate: 48000, toRate: 16000, channels: 3 })
    expect(interiorMiddle(out)).toBeCloseTo(0.3, 5)
  })
})

describe('resample: discrete and speed semantics (unit-04 4A coverage)', () => {
  test('discrete sums every channel at unity gain, including LFE', () => {
    const out = resample(constantFrames(8000, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), { fromRate: 48000, toRate: 16000, channels: 6, channelInterpretation: 'discrete' })
    expect(interiorMiddle(out)).toBeCloseTo(2.1, 5)
  })

  test('speed=2 halves the output and doubles the pitch (playbackRate semantics)', () => {
    const input = tone(1.5, 1000, 48000)
    const output = resample(input, { fromRate: 48000, toRate: 16000, speed: 2 })
    expect(output.length).toBe(Math.ceil((input.length * 16000) / (48000 * 2)))
    const core = output.subarray(1000, output.length - 1000)
    expect(toneAmplitude(core, 16000, 2000)).toBeGreaterThan(0.4)
    expect(toneAmplitude(core, 16000, 1000)).toBeLessThan(0.02)
  })

  test('a non-rational speed falls back to per-output tap evaluation, deterministically', () => {
    const input = tone(1, 1000, 44100)
    const first = resample(input, { fromRate: 44100, toRate: 16000, speed: 1.0001 })
    const second = resample(input, { fromRate: 44100, toRate: 16000, speed: 1.0001 })
    expect(first.length).toBe(Math.ceil((input.length * 16000) / (44100 * 1.0001)))
    let maxDelta = 0
    for (let index = 0; index < first.length; index++) maxDelta = Math.max(maxDelta, Math.abs(first[index]! - second[index]!))
    expect(maxDelta).toBe(0)
    expect(toneAmplitude(first.subarray(2000, first.length - 2000), 16000, 1000.1)).toBeGreaterThan(0.4)
  })

  test('a coprime rate pair (huge phase count) uses the on-the-fly path and matches the length formula', () => {
    const input = tone(1, 1000, 22051)
    const output = resample(input, { fromRate: 22051, toRate: 16000 })
    expect(output.length).toBe(Math.ceil((input.length * 16000) / 22051))
    expect(toneAmplitude(output.subarray(2000, output.length - 2000), 16000, 1000)).toBeGreaterThan(0.4)
  })
})

describe('resample: streaming edges and validation (unit-04 4A coverage)', () => {
  test('empty input produces empty output from both forms', () => {
    expect(resample(new Float32Array(0), { fromRate: 44100, toRate: 16000 })).toHaveLength(0)
    const engine = createResampler({ fromRate: 44100, toRate: 16000 })
    expect(engine.push(new Float32Array(0))).toHaveLength(0)
    expect(engine.flush()).toHaveLength(0)
  })

  test('chunked stereo pushes with a sub-frame carry match the one-shot output', () => {
    const frames = 4000
    const interleaved = new Float32Array(frames * 2)
    for (let frame = 0; frame < frames; frame++) {
      interleaved[frame * 2] = 0.5 * Math.sin((2 * Math.PI * 440 * frame) / 48000)
      interleaved[frame * 2 + 1] = 0.5 * Math.sin((2 * Math.PI * 660 * frame) / 48000)
    }
    const oneShot = resample(interleaved, { fromRate: 48000, toRate: 16000, channels: 2 })
    const engine = createResampler({ fromRate: 48000, toRate: 16000, channels: 2 })
    const pieces: Float32Array[] = []
    for (let start = 0; start < interleaved.length; start += 1001) pieces.push(engine.push(interleaved.subarray(start, start + 1001)))
    pieces.push(engine.flush())
    const joined = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
    let at = 0
    for (const piece of pieces) {
      joined.set(piece, at)
      at += piece.length
    }
    expect(joined.length).toBe(oneShot.length)
    let maxDelta = 0
    for (let index = 0; index < joined.length; index++) maxDelta = Math.max(maxDelta, Math.abs(joined[index]! - oneShot[index]!))
    expect(maxDelta, 'streamed stereo matches the one-shot bit-for-bit').toBe(0)
  })

  test('identity streaming (equal rates) is a pass-through with no flush tail', () => {
    const input = tone(0.5, 1000, 16000)
    const engine = createResampler({ fromRate: 16000, toRate: 16000 })
    let total = 0
    for (let start = 0; start < input.length; start += 1234) total += engine.push(input.subarray(start, start + 1234)).length
    expect(engine.flush()).toHaveLength(0)
    expect(total).toBe(input.length)
  })

  test('invalid options throw RangeError with parameter names only', () => {
    expect(() => resample(new Float32Array(1), { fromRate: 0 })).toThrow(RangeError)
    expect(() => resample(new Float32Array(1), { fromRate: Number.NaN })).toThrow(RangeError)
    expect(() => resample(new Float32Array(1), { fromRate: 44100, toRate: -1 })).toThrow(RangeError)
    expect(() => resample(new Float32Array(1), { fromRate: 44100, channels: 0 })).toThrow(RangeError)
    expect(() => resample(new Float32Array(1), { fromRate: 44100, channels: 1.5 })).toThrow(RangeError)
    expect(() => resample(new Float32Array(1), { fromRate: 44100, speed: 0 })).toThrow(RangeError)
  })
})

describe('resampleFilm (unit-04 4A coverage)', () => {
  test('equal rates are an exact copy at speed 1', () => {
    const input = tone(0.25, 300, 16000)
    const output = resampleFilm(input, { fromRate: 16000, toRate: 16000, channels: 1 })
    expect(output.length).toBe(input.length)
    let maxDelta = 0
    for (let index = 0; index < input.length; index++) maxDelta = Math.max(maxDelta, Math.abs(output[index]! - input[index]!))
    expect(maxDelta).toBe(0)
  })

  test('interpolates linearly between neighbours and zero-pads past the end', () => {
    const input = new Float32Array([0, 1, 2, 3])
    const output = resampleFilm(input, { fromRate: 1, toRate: 3, channels: 1 })
    // positions 0, 1/3, 2/3, 1, 4/3, 2, 7/3 (length ceil(4×3/1)=12? no — ceil(4·3/1)=12… check formula)
    expect(output.length).toBe(Math.ceil((4 * 3) / 1))
    expect(output[0]).toBeCloseTo(0, 6)
    expect(output[3]).toBeCloseTo(1, 6)
    expect(output[2]).toBeCloseTo(2 / 3, 6)
    expect(output[6]).toBeCloseTo(2, 6)
    expect(output[output.length - 1]).toBeCloseTo(1, 6)
  })

  test('stereo film resampling keeps channels interleaved and follows the length formula', () => {
    const frames = 1000
    const interleaved = new Float32Array(frames * 2)
    for (let frame = 0; frame < frames; frame++) {
      interleaved[frame * 2] = frame / frames
      interleaved[frame * 2 + 1] = -frame / frames
    }
    const output = resampleFilm(interleaved, { fromRate: 48000, toRate: 16000, channels: 2 })
    expect(output.length).toBe(2 * Math.ceil((frames * 16000) / 48000))
    for (let n = 10; n < 20; n++) expect(output[n * 2]!).toBeGreaterThan(output[(n - 1) * 2]!)
  })

  test('speed shortens the output; invalid options throw', () => {
    const input = tone(1, 440, 48000)
    expect(resampleFilm(input, { fromRate: 48000, toRate: 16000, channels: 1, speed: 2 }).length).toBe(Math.ceil((input.length * 16000) / 96000))
    expect(() => resampleFilm(input, { fromRate: 48000, toRate: 0, channels: 1 })).toThrow(RangeError)
    expect(() => resampleFilm(input, { fromRate: 48000, toRate: 16000, channels: -2 })).toThrow(RangeError)
    expect(() => resampleFilm(input, { fromRate: 48000, toRate: 16000, channels: 1, speed: Number.NaN })).toThrow(RangeError)
  })
})
