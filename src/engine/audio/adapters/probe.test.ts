// Unit-04 adversary F-3 (A-07): `adapters/probe.ts` is the PRODUCTION decision
// table — capability evidence (mediabunny canDecode) never decides, the
// ffmpeg-only container/codec table does (harness: "mediabunny is CAPABILITY
// EVIDENCE, never the decision"). No shipped unit test executed it: the
// support-matrix e2e verified the built harness bundle, so `if (false &&
// ffmpegOnly)` at probe.ts:136 (ffmpeg-only formats reported `webcodecs`)
// stayed green. This suite imports the REAL module and asserts the committed
// support table — the same expectations `e2e/media/support-matrix.spec.ts`
// asserts, read through the frozen helper's own `nativeSet()`/`fallbackSet()`
// selection over the committed `fixtures/harness/manifest.json`.

import { describe, expect, test } from 'vitest'
import { ALL_FORMAT_HINTS, createSupportMatrix, formatSignature, sniffContainer } from './probe'
import { fallbackSet, loadManifest, nativeSet } from '../../../../e2e/media/helpers/media'

/**
 * Realistic probe inputs per matrix key, mirroring the harness `supportMatrix`
 * flow: parsed files contribute mediabunny's container/codec (whatever
 * `canDecode` said — the decision must not depend on it); fallback-set
 * containers aiff/amr/caf/wma "do not parse through mediabunny at all"
 * (harness comment), so the matrix gets `unknown`/`none` and the fileKey
 * extension hint decides.
 */
const PARSED_INPUTS: Record<string, readonly [container: string, codec: string] | null> = {
  'fmt-30s.aac': ['audio/aac', 'mp4a.40.2'],
  'fmt-30s.flac': ['audio/flac', 'flac'],
  'fmt-30s.m4a': ['audio/mp4', 'mp4a.40.2'],
  'fmt-30s.m4b': ['audio/mp4', 'mp4a.40.2'],
  'fmt-30s.mka': ['audio/x-matroska', 'opus'],
  'fmt-30s.mp3': ['audio/mpeg', 'mp3'],
  'fmt-30s.vbr.mp3': ['audio/mpeg', 'mp3'],
  'fmt-30s.oga': ['audio/ogg', 'vorbis'],
  'fmt-30s.ogg': ['audio/ogg', 'vorbis'],
  'fmt-30s.opus': ['audio/ogg', 'opus'],
  'fmt-30s.wav': ['audio/wav', 'pcm_f32le'],
  'fmt-30s.weba': ['video/webm', 'opus'],
  // 3gp parses through mediabunny (ISO-BMFF) with a WebCodecs-decodable AAC
  // track — the strongest form of the A-07 case: production must still say
  // 'ffmpeg' while the capability bit says 'webcodecs'.
  'fmt-30s.3gp': ['video/3gpp', 'mp4a.40.2'],
  // alac.m4a parses; canDecode is false (alac has no WebCodecs decoder).
  'fmt-30s.alac.m4a': ['audio/mp4', 'alac'],
  'fmt-30s.aiff': null,
  'fmt-30s.amr': null,
  'fmt-30s.caf': null,
  'fmt-30s.wma': null,
}

function probeKey(key: string): string {
  return `http://127.0.0.1:4310/fixtures/audio/${key}`
}

describe('support matrix = committed support table (adversary F-3/A-07: the real probe.ts decides)', () => {
  const manifest = loadManifest()

  test('the mirror stays in lockstep with the committed matrix (no unmapped key drifts)', () => {
    const mapped = new Set(Object.keys(PARSED_INPUTS))
    const unmapedNative = nativeSet().filter((key) => !mapped.has(key))
    const unmapedFallback = fallbackSet().filter((key) => !mapped.has(key))
    expect(unmapedNative, 'nativeSet() keys must be mapped here (the e2e support-matrix row for a new fmt-30s.* fixture has no unit assertion yet)').toEqual([])
    expect(unmapedFallback, 'fallbackSet() keys must be mapped here').toEqual([])
    expect(nativeSet().length, 'native (webcodecs) matrix size — matches the unit report / discovery 12-row set').toBe(12)
    expect(fallbackSet(), 'fallback (ffmpeg) matrix — matches the unit report / discovery 6-row set').toEqual(['fmt-30s.3gp', 'fmt-30s.aiff', 'fmt-30s.alac.m4a', 'fmt-30s.amr', 'fmt-30s.caf', 'fmt-30s.wma'])
  })

  for (const key of nativeSet()) {
    test(`CC-04.7 support table: ${key} → webcodecs via the real probe`, () => {
      expect(Object.hasOwn(PARSED_INPUTS, key), `${key} must be mapped in PARSED_INPUTS`).toBe(true)
      const [container, codec] = PARSED_INPUTS[key] ?? (['unknown', 'none'] as const)
      expect(manifest.files[key]?.expectedPath, 'committed manifest expectation').toBe('webcodecs')
      const matrix = createSupportMatrix()
      const entry = matrix.probe(probeKey(key), container, codec, { webcodecs: true, ffmpeg: true })
      expect(entry.supported, `probe(${key}) on the REAL adapters/probe.ts`).toBe('webcodecs')
    })
  }

  for (const key of fallbackSet()) {
    test(`CC-04.7 support table: ${key} → ffmpeg via the real probe, independent of the capability bit (A-07 kill)`, () => {
      expect(Object.hasOwn(PARSED_INPUTS, key), `${key} must be mapped in PARSED_INPUTS`).toBe(true)
      // `null` = mediabunny does not parse the container at all (harness
      // comment) — the matrix then decides from the fileKey extension hint.
      const [container, codec] = PARSED_INPUTS[key] ?? ['unknown', 'none']
      expect(manifest.files[key]?.expectedPath, 'committed manifest expectation').toBe('ffmpeg')
      // The decision must hold with the capability bit BOTH ways: an
      // ffmpeg-only container/codec reported as `webcodecs` (the A-07
      // mutation) fails the true-capability leg here.
      for (const webcodecs of [false, true]) {
        const matrix = createSupportMatrix()
        const entry = matrix.probe(probeKey(key), container, codec, { webcodecs, ffmpeg: true })
        expect(entry.supported, `probe(${key}) with webcodecs=${String(webcodecs)} must stay on the ffmpeg path`).toBe('ffmpeg')
      }
      // With no ffmpeg available an ffmpeg-only file is 'none' — never
      // silently promoted to 'webcodecs'.
      const matrix = createSupportMatrix()
      expect(matrix.probe(probeKey(key), container, codec, { webcodecs: true, ffmpeg: false }).supported).toBe('none')
    })
  }

  test('ffmpeg-only membership is decided by container or codec', () => {
    const matrix = createSupportMatrix()
    // codec-driven fallback inside a normal mp4 container
    expect(matrix.probe('x:a.m4a', 'audio/mp4', 'alac', { webcodecs: true, ffmpeg: true }).supported).toBe('ffmpeg')
    expect(matrix.probe('x:wm', 'audio/x-ms-wma', 'wmav2', { webcodecs: true, ffmpeg: true }).supported, 'asf container normalises from the x-ms-wma mime').toBe('ffmpeg')
    expect(matrix.probe('x:amrnb', 'audio/mp4', 'amr-nb', { webcodecs: true, ffmpeg: true }).supported).toBe('ffmpeg')
    expect(matrix.probe('x:amrwb', 'unknown', 'amr-wb', { webcodecs: true, ffmpeg: true }).supported).toBe('ffmpeg')
    expect(
      matrix.entries().every((entry) => entry.supported === 'ffmpeg'),
      'every decision above is ffmpeg',
    ).toBe(true)
  })

  test('the per-fileKey decision is computed once and cached (FR-04.6 session matrix)', () => {
    const matrix = createSupportMatrix()
    const first = matrix.probe('cached.wav', 'audio/wav', 'pcm_f32le', { webcodecs: true, ffmpeg: true })
    expect(first.supported).toBe('webcodecs')
    const second = matrix.probe('cached.wav', 'audio/flac', 'flac', { webcodecs: false, ffmpeg: false })
    expect(second, 'the same fileKey never re-decides within a session').toEqual(first)
    matrix.probe('second.opus', 'audio/ogg', 'opus', { webcodecs: true, ffmpeg: true })
    expect(matrix.entries().map((entry) => entry.container)).toEqual(['wav', 'ogg'])
  })

  test('normalisation: mime forms, aliases, extension hints, codec aliases', () => {
    const matrix = createSupportMatrix()
    expect(matrix.probe('a', 'video/webm', 'opus', { webcodecs: true, ffmpeg: true }).container, 'webm → matroska').toBe('matroska')
    expect(matrix.probe('b', 'audio/x-matroska', 'vorbis', { webcodecs: true, ffmpeg: true }).container).toBe('matroska')
    expect(matrix.probe('c', 'audio/3gpp', 'aac', { webcodecs: true, ffmpeg: true }).container, '3gpp → 3gp').toBe('3gp')
    expect(matrix.probe('d', 'audio/wave', 'pcm_s16le', { webcodecs: true, ffmpeg: true }).container).toBe('wav')
    expect(matrix.probe('e', 'audio/aiff', 'pcm_s16be', { webcodecs: true, ffmpeg: true }).supported).toBe('ffmpeg')
    expect(matrix.probe('f', 'audio/aifc', 'lpcm', { webcodecs: true, ffmpeg: true }).container, 'aifc → aiff').toBe('aiff')
    expect(matrix.probe('g', 'none', 'none', { webcodecs: true, ffmpeg: true }).container, 'no hint without an extension').toBe('unknown')
    expect(matrix.probe('song.name.FLAC?token=1', 'none', 'none', { webcodecs: true, ffmpeg: true }), 'extension hint from the fileKey (case-insensitive, query stripped)').toMatchObject({
      container: 'flac',
      supported: 'webcodecs',
    })
    expect(matrix.probe('h', 'audio/mpeg', 'mp3-HF', { webcodecs: true, ffmpeg: true }).codec, 'mp3* codec alias → mp3').toBe('mp3')
    expect(matrix.probe('i', 'audio/mp4', 'AMRWB', { webcodecs: true, ffmpeg: true }).codec).toBe('amr-wb')
    expect(matrix.probe('j', 'audio/mp4', 'wma', { webcodecs: true, ffmpeg: true }).codec, 'bare wma alias → wmav2').toBe('wmav2')
  })
})

describe('sniffContainer (CC-04.4/CC-04.5 magic-byte registry — real probe.ts)', () => {
  const head = (...bytes: number[]) => new Uint8Array([...bytes, ...new Array<number>(24).fill(0)])
  const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0))
  const ftyp = (brand: string) => {
    const b = new Uint8Array(24)
    b.set([0x00, 0x00, 0x02, 0x00], 0)
    b.set(new TextEncoder().encode(`ftyp${brand}`), 4)
    return b
  }

  test('detects every registered family by content, never by extension', () => {
    expect(sniffContainer(ftyp('isom'))).toBe('mp4')
    expect(sniffContainer(ftyp('M4A '))).toBe('mp4')
    const ftypAtZero = new Uint8Array([...ascii('ftypisom'), ...new Array<number>(16).fill(0)])
    expect(sniffContainer(ftypAtZero), 'ftyp must sit at byte 4 — the signature position is contract').toBe('unknown')
    expect(sniffContainer(new Uint8Array([...ascii('OggS'), ...new Array<number>(20).fill(0)]))).toBe('ogg')
    const wav = new Uint8Array(24)
    wav.set(ascii('RIFF'), 0)
    wav.set(ascii('WAVE'), 8)
    expect(sniffContainer(wav)).toBe('wav')
    const aiff = new Uint8Array(24)
    aiff.set(ascii('FORM'), 0)
    aiff.set(ascii('AIFC'), 8)
    expect(sniffContainer(aiff)).toBe('aiff')
    expect(sniffContainer(new Uint8Array([...ascii('fLaC'), ...new Array<number>(20).fill(0)]))).toBe('flac')
    expect(sniffContainer(head(0x1a, 0x45, 0xdf, 0xa3))).toBe('matroska')
    expect(sniffContainer(head(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11))).toBe('asf')
    expect(sniffContainer(new Uint8Array([...ascii('caff'), ...new Array<number>(20).fill(0)]))).toBe('caf')
    expect(sniffContainer(new Uint8Array([...ascii('#!AMR\n'), ...new Array<number>(18).fill(0)]))).toBe('amr')
    expect(sniffContainer(head(0xff, 0xf1, 0x00))).toBe('aac')
    expect(sniffContainer(new Uint8Array([...ascii('ID3'), ...new Array<number>(21).fill(0)]))).toBe('mp3')
    expect(sniffContainer(head(0xff, 0xfb, 0x00))).toBe('mp3')
  })

  test('garbage sniffs unknown (not-audio.mp3 never claims to be audio)', () => {
    expect(sniffContainer(new Uint8Array([...ascii('PK\x03\x04 not an audio file at all')]))).toBe('unknown')
    expect(sniffContainer(new Uint8Array(0))).toBe('unknown')
    expect(sniffContainer(head(0xff, 0x01))).toBe('unknown')
  })

  test('ALL_FORMAT_HINTS documents every sniffed family (registry-precision pin)', () => {
    expect(ALL_FORMAT_HINTS, 'eleven documented magic families — a new sniff rule must land here too').toHaveLength(11)
    expect(ALL_FORMAT_HINTS.some((hint) => /ftyp@4/.test(hint))).toBe(true)
    expect(ALL_FORMAT_HINTS.some((hint) => /#!AMR@0/.test(hint))).toBe(true)
    expect(ALL_FORMAT_HINTS.some((hint) => /caff@0/.test(hint))).toBe(true)
  })

  test('formatSignature: dashed hex, empty on out-of-range', () => {
    const bytes = new Uint8Array([0x00, 0x1a, 0x45, 0xdf, 0xa3])
    expect(formatSignature(bytes, 1, 4)).toBe('1a-45-df-a3')
    expect(formatSignature(bytes, 3, 4), 'region past the end').toBe('')
    expect(formatSignature(bytes, -1, 2)).toBe('')
    expect(formatSignature(bytes, 0, 0)).toBe('')
  })
})
