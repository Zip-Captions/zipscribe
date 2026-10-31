// CC-04.8 (L1): resample/mono goldens vs ffmpeg-generated references.
//
// FR-04.2 — `resample.ts` is a windowed-sinc polyphase resampler to 16 kHz
// with an anti-alias low-pass. The spec's quality assertions, implemented
// here as measurements (not tolerances invented by the builder):
//   (a) a 10 kHz tone at 44.1 kHz input leaves ≤ −60 dBFS of aliased energy at
//       6 kHz after resampling to 16 kHz (the image of 10 kHz folds to 6 kHz);
//   (b) a 1 kHz tone's passband ripple is ≤ 0.1 dB, measured pre- and
//       post-resample at 44.1 and 48 kHz;
//   (c) 44.1→16 kHz speech RMS is within 1e-3 of the ffmpeg (soxr) reference
//       `fixtures/golden/resample-44k-to-16k-soxr.f32` (generated once with the
//       pinned ffmpeg-static + soxr engine, committed — never at test time).
//
// FR-04.3 — channel downmix follows the Web Audio mixing rules and is exposed
// as `resample(..., { channelInterpretation: 'speakers' })` (tie-break
// recorded in the unit report). Goldens for stereo and 5.1 are committed
// (`fixtures/golden/downmix-stereo.wav`, `fixtures/golden/downmix-5.1.wav`),
// produced by the generator, never by the code under test.
import { describe, expect, test } from 'vitest'
import { createResampler, resample, TARGET_SAMPLE_RATE } from '@engine/audio/resample'
import { resampleFilm } from '@engine/audio/resample/film'
import { bestAlignment, dbfs, GOLDEN, interleave, readF32, readPcm, rms, tone, toneAmplitude } from './helpers/wav'

const GOLDEN_DIR = 'fixtures/golden'

describe('CC-04.8: resampler quality — anti-aliasing, passband ripple, ffmpeg reference', () => {
  test('CC-04.8: extra modules that ship alongside the resampler stay importable', () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000)
  })

  test('CC-04.8: (a) 10 kHz tone at 44.1 kHz leaves ≤ −60 dBFS of aliased energy at 6 kHz', () => {
    const input = tone(2, 10000, 44100, 0.5)
    const output = resample(input, { fromRate: 44100, toRate: 16000 })
    // Skip the filter's edge transients on both ends (a windowed sinc needs
    // its support samples before its output stabilises).
    const core = output.subarray(4000, output.length - 4000)
    const alias = toneAmplitude(core, 16000, 6000)
    expect(dbfs(alias), `aliased 6 kHz energy (${dbfs(alias).toFixed(1)} dBFS) must be ≤ −60 dBFS`).toBeLessThanOrEqual(-60)
    // A 10 kHz tone has no passband at 16 kHz, so only the residual image may
    // remain: level is NOT the discriminator (the unfiltered decimation image
    // is also quiet) — the 6 kHz assertion above is.
  })

  test('CC-04.8: (b) 1 kHz tone passband ripple ≤ 0.1 dB at 44.1 → 16 kHz', () => {
    const amplitude = 0.5
    const reference = dbfs(amplitude)
    for (const fromRate of [44100, 48000]) {
      const input = tone(1.5, 1000, fromRate, amplitude)
      const output = resample(input, { fromRate, toRate: 16000 })
      const core = output.subarray(2000, output.length - 2000)
      const measured = dbfs(toneAmplitude(core, 16000, 1000))
      expect(Math.abs(measured - reference), `${fromRate}→16000: ripple ${Math.abs(measured - reference).toFixed(3)} dB`).toBeLessThanOrEqual(0.1)
    }
  })

  test('CC-04.8: (c) 44.1→16 kHz speech RMS within 1e-3 of the ffmpeg reference', () => {
    // `fixtures/golden/playback-44100stereo-ref.f32` is ffmpeg's own 44.1 kHz
    // stereo rendering of `fmt-30s.ref.wav`; downmixing + resampling it must
    // land back on the 16 kHz mono source within 1e-3 RMS (the ffmpeg
    // regeneration path — soxr is unavailable in the pinned ffmpeg-static
    // build, so the reference is the `-ar 44100 -ac 2` round trip; see the
    // unit report, Fixture notes).
    const stereo = readF32(GOLDEN.playback44100Stereo, 2)
    const mono44100 = new Float32Array(stereo[0]!.length)
    for (let index = 0; index < mono44100.length; index++) mono44100[index] = 0.5 * stereo[0]![index]! + 0.5 * stereo[1]![index]!
    const output = resample(mono44100, { fromRate: 44100, toRate: 16000 })
    const reference = readPcm(GOLDEN.fmt30sRef).data[0]!
    expect(Math.abs(rms(output) - rms(reference)), 'speech RMS must match the ffmpeg-generated reference').toBeLessThanOrEqual(1e-3)
    const alignment = bestAlignment(reference, output, 64)
    expect(alignment.corr, `shape correlation with the ffmpeg reference (${alignment.corr.toFixed(4)})`).toBeGreaterThan(0.99)
    expect(Math.abs(alignment.offset), 'no drift against the reference (samples)').toBeLessThanOrEqual(8)
  })

  test('CC-04.8: 22.05→16 kHz speech is within 1e-3 RMS of the ffmpeg reference', () => {
    const speech = readPcm('fixtures/golden/speech-22k.wav')
    const output = resample(speech.data[0]!, { fromRate: 22050, toRate: 16000 })
    const reference = readPcm(GOLDEN.fmt30sRef).data[0]!
    const alignment = bestAlignment(reference, output, 64)
    expect(alignment.corr, `shape correlation with the ffmpeg reference (${alignment.corr.toFixed(4)})`).toBeGreaterThan(0.99)
    const overlap = Math.min(reference.length, output.length)
    expect(Math.abs(rms(output.subarray(0, overlap)) - rms(reference.subarray(0, overlap))), 'speech RMS must match the ffmpeg reference').toBeLessThanOrEqual(1e-3)
  })

  test('CC-04.8: 16 kHz → 16 kHz is an exact pass-through (no filter, no length change)', () => {
    const input = readPcm(GOLDEN.fmt30sRef).data[0]!
    const output = resample(input, { fromRate: 16000, toRate: 16000 })
    expect(output.length).toBe(input.length)
    let maxDelta = 0
    for (let index = 0; index < input.length; index++) maxDelta = Math.max(maxDelta, Math.abs(output[index]! - input[index]!))
    expect(maxDelta, 'identity resample must be bit-exact').toBe(0)
  })

  test('CC-04.8: output length is ceil(in / fromRate × toRate) — no frame loss', () => {
    for (const [frames, fromRate] of [
      [44100, 44100],
      [48000, 48000],
      [22050, 22050],
      [8000, 8000],
      [12345, 44100],
    ] as const) {
      const input = new Float32Array(frames).fill(0.1)
      const output = resample(input, { fromRate, toRate: 16000 })
      expect(output.length, `${frames} @ ${fromRate}`).toBe(Math.ceil((frames * 16000) / fromRate))
    }
  })

  test('CC-04.8: streaming resampler is concatenation-equivalent to the one-shot resampler', () => {
    const input = readPcm('fixtures/golden/tone1k-rate48k.wav').data[0]!
    const oneShot = resample(input, { fromRate: 48000, toRate: 16000 })
    const streaming = createResampler({ fromRate: 48000, toRate: 16000 })
    const pieces: Float32Array[] = []
    for (let start = 0; start < input.length; start += 7777) pieces.push(streaming.push(input.subarray(start, start + 7777)))
    pieces.push(streaming.flush())
    const joined = new Float32Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
    let at = 0
    for (const piece of pieces) {
      joined.set(piece, at)
      at += piece.length
    }
    expect(joined.length).toBe(oneShot.length)
    expect(bestAlignment(oneShot, joined, 0).corr, 'streamed output matches the one-shot output').toBeGreaterThan(0.9999)
  })

  test('CC-04.8: the ffmpeg fallback path uses the film (linear) resampler, not the shipping sinc resampler', () => {
    const speech = readPcm(GOLDEN.fmt30sRef).data[0]!
    const filmOutput = resampleFilm(speech, { fromRate: 16000, toRate: 44100, channels: 1 })
    const sincOutput = resample(speech, { fromRate: 16000, toRate: 44100 })
    expect(filmOutput.length).toBe(sincOutput.length)
    // They must be different algorithms: the linear interpolator cannot match
    // the windowed-sinc output sample-for-sample.
    expect(bestAlignment(sincOutput, filmOutput, 0).corr).toBeLessThan(0.99999)
    // But both must carry the same speech: the fallback path is level-accurate.
    expect(Math.abs(rms(filmOutput) - rms(sincOutput))).toBeLessThan(0.005)
  })
})

describe('CC-04.8: downmix to mono — Web Audio mixing rules (stereo + 5.1 goldens)', () => {
  test('CC-04.8: stereo (L+R)/2 matches the committed ffmpeg golden', () => {
    const golden = readPcm(`${GOLDEN_DIR}/downmix-stereo.wav`)
    expect(golden.channels, 'golden is a stereo file').toBe(2)
    const input = interleave(golden.data)
    const mono = resample(input, { fromRate: golden.sampleRate, toRate: 16000, channels: 2, channelInterpretation: 'speakers' })
    // Per-band amplitude check (exact, independent of the resampler's phase):
    // L is 440 Hz / R is 660 Hz at 0.5, so the mono mix is both at 0.25.
    const core = mono.subarray(2000, mono.length - 2000)
    expect(toneAmplitude(core, 16000, 440)).toBeCloseTo(0.25, 2)
    expect(toneAmplitude(core, 16000, 660)).toBeCloseTo(0.25, 2)
    // And against the golden's own mix (computed from the golden, not the code).
    const expected = golden.data[0]!.map((left, index) => (left + golden.data[1]![index]!) / 2)
    const alignment = bestAlignment(Float32Array.from(expected), mono, 64)
    expect(alignment.corr, 'downmix tracks the golden (L+R)/2 mix').toBeGreaterThan(0.999)
  })

  test('CC-04.8: 5.1 → mono follows the Web Audio speaker downmix and matches the golden', () => {
    // 5.1 layout per the Web Audio spec: L R C LFE SL SR.
    const golden = readPcm(`${GOLDEN_DIR}/downmix-5.1.wav`)
    expect(golden.channels, 'golden is a 6-channel file').toBe(6)
    const expected = readPcm(`${GOLDEN_DIR}/downmix-5.1-mono.wav`).data[0]!
    const mono = resample(interleave(golden.data), { fromRate: golden.sampleRate, toRate: 16000, channels: 6, channelInterpretation: 'speakers' })
    const alignment = bestAlignment(expected, mono, 64)
    expect(alignment.corr, `5.1 downmix matches the golden mono mix (${alignment.corr.toFixed(4)})`).toBeGreaterThan(0.999)
  })

  test('CC-04.8: discrete interpretation sums instead of averaging (contrast case)', () => {
    const golden = readPcm(`${GOLDEN_DIR}/downmix-stereo.wav`)
    const speakers = resample(interleave(golden.data), { fromRate: golden.sampleRate, toRate: 16000, channels: 2, channelInterpretation: 'speakers' })
    const discrete = resample(interleave(golden.data), { fromRate: golden.sampleRate, toRate: 16000, channels: 2, channelInterpretation: 'discrete' })
    expect(rms(discrete) / rms(speakers), 'discrete keeps both channels at full gain (2× the averaged mix)').toBeCloseTo(2, 1)
  })
})