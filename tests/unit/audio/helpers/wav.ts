// Deterministic WAV/PCM helpers for the unit-04 audio suite (Node side).
//
// No network, no ffmpeg at test time: references are committed under
// `fixtures/golden/` (see that directory's README) and produced ONCE with the
// pinned ffmpeg-static build. Everything here is pure math so the tests are
// hermetic and reproducible on any machine.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../../helpers/repo'

export interface PcmWav {
  sampleRate: number
  channels: number
  /** Planar channels (de-interleaved f32, −1..1). */
  data: Float32Array[]
}

/** Parse a canonical RIFF/WAVE PCM file (16-bit or f32 little-endian). */
export function readWav(repoRelativePath: string): PcmWav {
  const bytes = readFileSync(join(REPO_ROOT, repoRelativePath))
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error(`${repoRelativePath}: not a RIFF/WAVE file`)
  }
  let offset = 12
  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let data: Buffer | undefined
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const body = bytes.subarray(offset + 8, offset + 8 + size)
    if (id === 'fmt ') {
      format = body.readUInt16LE(0)
      channels = body.readUInt16LE(2)
      sampleRate = body.readUInt32LE(4)
      bits = body.readUInt16LE(14)
    } else if (id === 'data') {
      data = body
    }
    offset += 8 + size + (size % 2)
  }
  if (!data || channels === 0) throw new Error(`${repoRelativePath}: no data chunk`)
  const bytesPerSample = bits / 8
  const frames = data.length / (bytesPerSample * channels)
  const planar: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const at = (frame * channels + channel) * bytesPerSample
      let value: number
      if (format === 3 && bits === 32) value = data.readFloatLE(at)
      else if (bits === 16) value = data.readInt16LE(at) / 32768
      else if (bits === 24) value = data.readIntLE(at, 3) / 8388608
      else if (bits === 32) value = data.readInt32LE(at) / 2147483648
      else throw new Error(`${repoRelativePath}: unsupported PCM bit depth ${bits}`)
      planar[channel]![frame] = value
    }
  }
  return { sampleRate, channels, data: planar }
}

/** Read a PCM WAV fixture as planar channels regardless of container depth (s16 → /32768). */
export function readPcm(path: string): PcmWav {
  return readWav(path)
}

/** Read a headerless little-endian f32 `.f32` reference file (mono unless `channels` given). */
export function readF32(repoRelativePath: string, channels = 1): Float32Array[] {
  const bytes = readFileSync(join(REPO_ROOT, repoRelativePath))
  const copy = new Float32Array(bytes.length / 4)
  for (let index = 0; index < copy.length; index++) copy[index] = bytes.readFloatLE(index * 4)
  if (channels === 1) return [copy]
  const frames = copy.length / channels
  return Array.from({ length: channels }, (_, channel) => {
    const out = new Float32Array(frames)
    for (let frame = 0; frame < frames; frame++) out[frame] = copy[frame * channels + channel]!
    return out
  })
}

/** Interleave planar channels into the mediabunny/WebCodecs-style single f32 buffer. */
export function interleave(planar: readonly Float32Array[]): Float32Array {
  const channels = planar.length
  const frames = planar[0]?.length ?? 0
  const out = new Float32Array(frames * channels)
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) out[frame * channels + channel] = planar[channel]![frame]!
  }
  return out
}

/** Deterministic pseudo-random generator (LCG, same constants as scripts/make-fixtures.ts). */
export function lcg(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

export function tone(seconds: number, frequency: number, sampleRate = 44100, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate))
  for (let index = 0; index < out.length; index++) out[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate)
  return out
}

/** One-sided amplitude of the `frequency` bin via a Goertzel-style projection (DFT over the whole span). */
export function toneAmplitude(samples: Float32Array, sampleRate: number, frequency: number): number {
  let real = 0
  let imaginary = 0
  for (let index = 0; index < samples.length; index++) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate
    real += samples[index]! * Math.cos(phase)
    imaginary += samples[index]! * Math.sin(phase)
  }
  return (2 * Math.sqrt(real * real + imaginary * imaginary)) / samples.length
}

export function rms(samples: Float32Array): number {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

export function dbfs(linear: number): number {
  return 20 * Math.log10(linear + 1e-30)
}

/** Normalized cross-correlation of two equal-length spans (1 = identical shape). */
export function ncc(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let energyA = 0
  let energyB = 0
  for (let index = 0; index < length; index++) {
    dot += a[index]! * b[index]!
    energyA += a[index]! * a[index]!
    energyB += b[index]! * b[index]!
  }
  return dot / (Math.sqrt(energyA * energyB) + 1e-30)
}

/**
 * Search the alignment offset of `actual` against `reference` over ±`maxOffset`
 * samples; returns the best normalized correlation and its offset (positive =
 * `actual` starts that many samples LATE relative to the reference). Only the
 * overlapping region is compared, so priming/padding shows up as an offset
 * instead of dragging the score down.
 */
export function bestAlignment(reference: Float32Array, actual: Float32Array, maxOffset: number): { corr: number; offset: number } {
  let best = { corr: -Infinity, offset: 0 }
  for (let offset = -maxOffset; offset <= maxOffset; offset++) {
    const startRef = Math.max(0, -offset)
    const startActual = Math.max(0, offset)
    const length = Math.min(reference.length - startRef, actual.length - startActual)
    if (length < 256) continue
    let dot = 0
    let energyRef = 0
    let energyActual = 0
    for (let index = 0; index < length; index++) {
      const ref = reference[startRef + index]!
      const act = actual[startActual + index]!
      dot += ref * act
      energyRef += ref * ref
      energyActual += act * act
    }
    const corr = dot / (Math.sqrt(energyRef * energyActual) + 1e-30)
    if (corr > best.corr) best = { corr, offset }
  }
  return best
}

/** Slice `[startSec, startSec + seconds)` from a planar buffer into an interleaved f32 buffer. */
export function planarSliceInterleaved(planar: readonly Float32Array[], sampleRate: number, startSec: number, seconds: number): Float32Array {
  const start = Math.round(startSec * sampleRate)
  const count = Math.round(seconds * sampleRate)
  return interleave(planar.map((channel) => channel.subarray(start, start + count)))
}

/** Committed golden references (created once via the pinned ffmpeg-static build — see fixtures/golden/README.md). */
export const GOLDEN = {
  /** 0.5·sin(440 Hz) left / 0.5·sin(660 Hz) right, 44.1 kHz stereo PCM (never mixed). */
  downmixStereo: 'fixtures/golden/downmix-stereo.wav',
  /** fmt-30s.ref.wav resampled to 44.1 kHz stereo (16→44.1 upsample reference). */
  playback44100Stereo: 'fixtures/golden/playback-44100stereo-ref.f32',
  /** fmt-30s.ref.wav (30 s, 16 kHz mono) as raw f32. */
  fmt30sRef: 'fixtures/audio/fmt-30s.ref.wav',
} as const