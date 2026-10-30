// Unit-04 slice 4D — L1 coverage for the ffmpeg.wasm fallback adapter
// (src/engine/audio/adapters/ffmpeg.ts). The `@ffmpeg/ffmpeg` runtime is
// injected through the adapter's declared test seam (`createFfmpeg` /
// `fetchCore`) — the transcode INPUTS, the WAV parser, the sample-window
// contract, the probe shape and the SECURITY-03 error hygiene are the real
// production code (nothing here mocks the thing under test; the WebAssembly
// core itself is exercised by the Chromium e2e fallback rows).

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AudioSampleLike } from '../decode'
import type { FfmpegLike, OpenFfmpegOptions } from './ffmpeg'

function wavBytes(channels: number, sampleRate: number, frames: number): Uint8Array {
  const bytes = new Uint8Array(44 + frames * channels * 4)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++) bytes[at + index] = text.charCodeAt(index)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + frames * channels * 4, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true) // IEEE float
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, (sampleRate * channels * 32) / 8, true)
  view.setUint16(32, (channels * 32) / 8, true)
  view.setUint16(34, 32, true)
  ascii(36, 'data')
  view.setUint32(40, frames * channels * 4, true)
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      view.setFloat32(44 + (frame * channels + channel) * 4, (frame + channel) / frames, true)
    }
  }
  return bytes
}

interface FakeFfmpeg extends FfmpegLike {
  writes: Array<{ path: string; data: Uint8Array }>
  execArgs: string[][]
  deletes: string[]
}

function fakeFfmpeg(wav: Uint8Array | (() => Uint8Array), execReturn = 0): FakeFfmpeg {
  const fake: FakeFfmpeg = {
    writes: [],
    execArgs: [],
    deletes: [],
    load: () => Promise.resolve(true),
    writeFile: (path, data) => {
      fake.writes.push({ path, data })
      return Promise.resolve(true)
    },
    exec: (args) => {
      fake.execArgs.push(args)
      return Promise.resolve(execReturn)
    },
    readFile: () => Promise.resolve(typeof wav === 'function' ? wav() : wav),
    deleteFile: (path) => {
      fake.deletes.push(path)
      return Promise.resolve(true)
    },
    terminate() {},
  }
  return fake
}

function stubbedOptions(fake: FakeFfmpeg, overrides: Partial<OpenFfmpegOptions> = {}): OpenFfmpegOptions {
  return {
    createFfmpeg: () => Promise.resolve(fake),
    fetchCore: () => Promise.resolve({ ok: true, status: 200 }),
    ...overrides,
  }
}

const file = (bytes: Uint8Array): File => new File([new Uint8Array(bytes)], 'fixture', { type: 'application/octet-stream' })

async function freshAdapter() {
  vi.resetModules()
  return import('./ffmpeg')
}

describe('parseF32Wav', () => {
  test('parses a well-formed pcm_f32le mono WAV', async () => {
    const { parseF32Wav } = await freshAdapter()
    const parsed = parseF32Wav(wavBytes(1, 16000, 100))
    expect(parsed).not.toBeNull()
    expect(parsed!.sampleRate).toBe(16000)
    expect(parsed!.channels).toBe(1)
    expect(parsed!.frames).toBe(100)
    expect(parsed!.data.length).toBe(100)
    expect(parsed!.data[10]!).toBeCloseTo(0.1, 5)
  })

  test('rejects non-RIFF, integer PCM (format 1), missing data and short buffers', async () => {
    const { parseF32Wav } = await freshAdapter()
    expect(parseF32Wav(new Uint8Array(20))).toBeNull()
    const wav = wavBytes(1, 16000, 8)
    const view = new DataView(wav.buffer)
    view.setUint16(20, 1, true) // format 1 = integer PCM, not f32
    expect(parseF32Wav(wav)).toBeNull()
    view.setUint16(20, 3, true)
    expect(parseF32Wav(wav.subarray(0, 44 + 16))).not.toBeNull()
    expect(parseF32Wav(wav.subarray(0, 36))).toBeNull() // no data chunk
  })

  test('skips odd-sized side chunks (LIST/fact) and copies the payload', async () => {
    const { parseF32Wav } = await freshAdapter()
    const wav = wavBytes(1, 16000, 10)
    const list = new Uint8Array(8 + 5) // odd size ⇒ 1 pad byte
    const view = new DataView(list.buffer)
    for (let index = 0; index < 4; index++) list[index] = 'LIST'.charCodeAt(index)
    view.setUint32(4, 5, true)
    const spliced = new Uint8Array(wav.length + list.length + 1)
    spliced.set(wav.subarray(0, 36), 0)
    spliced.set(list, 36)
    spliced[36 + list.length] = 0 // odd pad byte
    spliced.set(wav.subarray(36), 36 + list.length + 1)
    const parsed = parseF32Wav(spliced)
    expect(parsed!.frames).toBe(10)
    expect(parsed!.data[5]!).toBeCloseTo(0.5, 5)
  })

  test('handles a non-4-byte-aligned input view (readFile sub-array shapes)', async () => {
    const { parseF32Wav } = await freshAdapter()
    const wav = wavBytes(1, 16000, 16)
    const packed = new Uint8Array(wav.length + 1)
    packed.set(wav, 1)
    const parsed = parseF32Wav(packed.subarray(1))
    expect(parsed!.frames).toBe(16)
  })

  test('accepts the WAVE_FORMAT_EXTENSIBLE shape the ffmpeg muxer actually writes for pcm_f32le', async () => {
    const { parseF32Wav } = await freshAdapter()
    const frames = 12
    const fmtSize = 40
    const bytes = new Uint8Array(12 + 8 + fmtSize + 8 + 4 + 8 + 26 + 8 + frames * 4)
    const view = new DataView(bytes.buffer)
    const ascii = (at: number, text: string) => {
      for (let index = 0; index < text.length; index++) bytes[at + index] = text.charCodeAt(index)
    }
    ascii(0, 'RIFF')
    view.setUint32(4, bytes.length - 8, true)
    ascii(8, 'WAVE')
    ascii(12, 'fmt ')
    view.setUint32(16, fmtSize, true)
    view.setUint16(20, 0xfffe, true) // WAVE_FORMAT_EXTENSIBLE
    view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true)
    view.setUint32(28, 64000, true)
    view.setUint16(32, 4, true)
    view.setUint16(34, 32, true)
    view.setUint16(36, 22, true) // cbSize
    view.setUint16(44, 3, true) // subformat wFormatTag = IEEE float
    const factAt = 12 + 8 + fmtSize
    ascii(factAt, 'fact')
    view.setUint32(factAt + 4, 4, true)
    const listAt = factAt + 12
    ascii(listAt, 'LIST')
    view.setUint32(listAt + 4, 26, true)
    const dataAt = listAt + 8 + 26
    ascii(dataAt, 'data')
    view.setUint32(dataAt + 4, frames * 4, true)
    for (let frame = 0; frame < frames; frame++) view.setFloat32(dataAt + 8 + frame * 4, frame / frames, true)
    const parsed = parseF32Wav(bytes)
    expect(parsed).not.toBeNull()
    expect(parsed!.frames).toBe(frames)
    expect(parsed!.data[6]!).toBeCloseTo(0.5, 5)
  })

  test('rejects an extensible header whose subformat is not float', async () => {
    const { parseF32Wav } = await freshAdapter()
    const bytes = new Uint8Array(102)
    const view = new DataView(bytes.buffer)
    const ascii = (at: number, text: string) => {
      for (let index = 0; index < text.length; index++) bytes[at + index] = text.charCodeAt(index)
    }
    ascii(0, 'RIFF')
    view.setUint32(4, 94, true)
    ascii(8, 'WAVE')
    ascii(12, 'fmt ')
    view.setUint32(16, 40, true)
    view.setUint16(20, 0xfffe, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true)
    view.setUint16(34, 32, true)
    view.setUint16(44, 1, true) // subformat = integer PCM ⇒ not our contract
    ascii(60, 'data')
    view.setUint32(64, 32, true)
    expect(parseF32Wav(bytes)).toBeNull()
  })
})

describe('openFfmpeg (fallback open behind the mediabunny seam)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('happy path: transcodes to f32 WAV and exposes the frozen MediaSourceLike contract', async () => {
    const { openFfmpeg } = await freshAdapter()
    const wav = wavBytes(1, 16000, 8000)
    const fake = fakeFfmpeg(wav)
    const opened = await openFfmpeg(file(new Uint8Array([1, 2, 3])), { container: 'asf', codec: 'wmav2' }, stubbedOptions(fake))
    expect(opened.path).toBe('ffmpeg')
    expect(opened.probe.audioCodec).toBe('wmav2')
    expect(opened.probe.container).toBe('asf')
    expect(opened.probe.duration).toBeCloseTo(0.5, 6)
    expect(opened.probe.canDecodeAudio).toBe(false)
    expect(opened.probe.videoCodec).toBeNull()
    expect(fake.execArgs[0]).toEqual(['-i', expect.any(String), '-vn', '-map', '0:a:0', '-f', 'wav', '-c:a', 'pcm_f32le', expect.any(String)])
    expect(fake.writes[0]!.data).toEqual(new Uint8Array([1, 2, 3]))
    const track = opened.source.audioTracks()[0]!
    expect(track.sampleRate).toBe(16000)
    expect(track.numberOfChannels).toBe(1)
    expect(track.canDecode()).toBe(false)
    expect(opened.source.getDuration()).toBeCloseTo(0.5, 6)
    const seen: Array<{ timestamp: number; frames: number }> = []
    let total = 0
    for await (const sample of opened.source.samples(track)) {
      seen.push({ timestamp: sample.timestamp, frames: sample.numberOfFrames })
      total += sample.numberOfFrames
      expect(sample.numberOfChannels).toBe(1)
      expect(sample.samples().length).toBe(1)
    }
    expect(total).toBe(8000)
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[0]!.timestamp).toBe(0)
    expect(seen[1]!.timestamp).toBe(4096 / 16000)
  })

  test('stereo payload is delivered as ONE interleaved plane (decode.ts contract)', async () => {
    const { openFfmpeg } = await freshAdapter()
    const wav = wavBytes(2, 16000, 4096)
    const fake = fakeFfmpeg(wav)
    const opened = await openFfmpeg(file(new Uint8Array([0])), { container: 'mov', codec: 'alac' }, stubbedOptions(fake))
    const track = opened.source.audioTracks()[0]!
    expect(track.numberOfChannels).toBe(2)
    const iterator = opened.source.samples(track)[Symbol.asyncIterator]()
    const first = (await iterator.next()).value as AudioSampleLike
    expect(first.numberOfChannels).toBe(2)
    expect(first.samples().length).toBe(1) // interleaved, not two planar copies
    expect(first.samples()[0]!.length).toBe(first.numberOfFrames * 2)
  })

  test('exec failure surfaces UNSUPPORTED_MEDIA as a code-only error', async () => {
    const { openFfmpeg } = await freshAdapter()
    const fake = fakeFfmpeg(() => wavBytes(1, 16000, 1), 1)
    await expect(openFfmpeg(file(new Uint8Array([0])), { container: 'asf', codec: 'wmav2' }, stubbedOptions(fake))).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' })
  })

  test('a non-WAV transcode output is UNSUPPORTED_MEDIA, not an internal fault', async () => {
    const { openFfmpeg } = await freshAdapter()
    const fake = fakeFfmpeg(() => new Uint8Array(64))
    await expect(openFfmpeg(file(new Uint8Array([0])), { container: 'asf', codec: 'wmav2' }, stubbedOptions(fake))).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' })
  })

  test('SECURITY-03: ffmpeg-side failure text never escapes the error', async () => {
    const { openFfmpeg } = await freshAdapter()
    const fake: FakeFfmpeg = {
      ...fakeFfmpeg(new Uint8Array(0)),
      exec: () => Promise.reject(new Error('Invalid data found when processing input: /tmp/secret-user-file.wma')),
    }
    const error = await openFfmpeg(file(new Uint8Array([0])), { container: 'asf', codec: 'wmav2' }, stubbedOptions(fake)).catch((caught: unknown) => caught)
    expect((error as { code?: string }).code).toBe('UNSUPPORTED_MEDIA')
    expect((error as Error).message).not.toMatch('secret-user-file')
    expect((error as Error).message).not.toMatch('Invalid data')
  })

  test('a missing self-hosted core is FFMPEG_CORE_UNAVAILABLE (never a CDN fetch) and re-raisable', async () => {
    const { openFfmpeg } = await freshAdapter()
    const fake = fakeFfmpeg(() => wavBytes(1, 16000, 1))
    const fetchCore = vi.fn(() => Promise.resolve({ ok: false, status: 404 }))
    const options = stubbedOptions(fake, { fetchCore })
    await expect(openFfmpeg(file(new Uint8Array([0])), { container: 'asf', codec: 'wmav2' }, options)).rejects.toMatchObject({ code: 'FFMPEG_CORE_UNAVAILABLE' })
    // Retryable: the failed load must not be cached (the harness film handoff
    // depends on a fresh attempt).
    await expect(openFfmpeg(file(new Uint8Array([0])), { container: 'asf', codec: 'wmav2' }, options)).rejects.toMatchObject({ code: 'FFMPEG_CORE_UNAVAILABLE' })
    expect(fetchCore).toHaveBeenCalledTimes(2) // each attempt aborts at the first missing core file
  })

  test('core load failure maps to FFMPEG_CORE_UNAVAILABLE with a code-only message', async () => {
    const { openFfmpeg } = await freshAdapter()
    const options: OpenFfmpegOptions = {
      fetchCore: () => Promise.resolve({ ok: true, status: 200 }),
      createFfmpeg: () => Promise.reject(new Error('WebAssembly.instantiate(): Download failed https://unpkg.com/@ffmpeg/core/...')),
    }
    const error = await openFfmpeg(file(new Uint8Array([0])), { container: 'asf', codec: 'wmav2' }, options).catch((caught: unknown) => caught)
    expect((error as { code?: string }).code).toBe('FFMPEG_CORE_UNAVAILABLE')
    expect((error as Error).message).toBe('FFMPEG_CORE_UNAVAILABLE')
  })
})
