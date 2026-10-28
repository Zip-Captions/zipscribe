// CC-01.8: the audio format matrix is present and manifest-verified.
//
// Contract source: `.ai-dlc/local-transcribe-engine/unit-01-scaffold-quality-gates.md`
// US-1.0.2 ("Given `pnpm fixtures` … `fixtures/audio/` contains the audio format
// matrix …") + the manifest schema in § Technical Specification. Binary fixtures
// are produced by `pnpm fixtures` (setup step), never downloaded at test time.
import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exists, readJson, REPO_ROOT } from '../../helpers/repo'

interface ManifestEntry {
  sha256: string
  duration: number
  kind: 'tone' | 'speech' | 'speech-2spk' | 'perf'
  language: string | null
  category: 'en-clean' | 'en-accented' | 'en-technical' | 'en-noisy' | 'fr-clean' | null
  groundTruth: string | null
  generated: boolean
  license: string
  codec?: string
  sampleRate?: number
  channels?: number
  expectedPath?: 'webcodecs' | 'ffmpeg'
  derivedFrom?: string
}

interface Manifest {
  files: Record<string, ManifestEntry>
}

// Native set = mediabunny + WebCodecs (architecture.md § Supported media);
// fallback set = ffmpeg.wasm. `fmt-30s.ref.wav` is the 16 kHz reference.
const NATIVE_MATRIX = [
  'fmt-30s.mp3',
  'fmt-30s.vbr.mp3',
  'fmt-30s.m4a',
  'fmt-30s.m4b',
  'fmt-30s.aac',
  'fmt-30s.wav',
  'fmt-30s.flac',
  'fmt-30s.ogg',
  'fmt-30s.oga',
  'fmt-30s.opus',
  'fmt-30s.weba',
  'fmt-30s.mka',
]

const FALLBACK_MATRIX = ['fmt-30s.aiff', 'fmt-30s.alac.m4a', 'fmt-30s.wma', 'fmt-30s.amr', 'fmt-30s.3gp', 'fmt-30s.caf']

const AUDIO_EXTRAS = ['fmt-30s.ref.wav', 'speech-2min.m4a', 'speech-2spk-2min.m4a', 'tones-220-1k-5k-10s.wav', 'sweep-20-20k-10s.flac', 'silence-10s.wav', 'not-audio.mp3']

function audioPath(name: string): string {
  return `fixtures/audio/${name}`
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(join(REPO_ROOT, file))).digest('hex')
}

function loadManifest(): Manifest {
  const candidates = ['fixtures/harness/manifest.json', 'fixtures/manifest.json', 'harness/manifest.json']
  const path = candidates.find((candidate) => exists(candidate))
  expect(path, `manifest at one of ${candidates.join(', ')}`).toBeDefined()
  return readJson<Manifest>(path!)
}

describe('CC-01.8: audio format matrix', () => {
  test('CC-01.8: every native-codec file from the US-1.0.2 audio list exists under fixtures/audio/', () => {
    const missing = NATIVE_MATRIX.filter((name) => !exists(audioPath(name)))
    expect(missing, 'run `pnpm fixtures` (setup step) to regenerate fixtures/audio/').toEqual([])
  })

  test('CC-01.8: every ffmpeg-fallback file from the audio list exists under fixtures/audio/', () => {
    const missing = FALLBACK_MATRIX.filter((name) => !exists(audioPath(name)))
    expect(missing, 'run `pnpm fixtures`').toEqual([])
  })

  test('CC-01.8: reference WAV, audio twins, tones, sweep, silence and the corrupt file exist', () => {
    const missing = AUDIO_EXTRAS.filter((name) => !exists(audioPath(name)))
    expect(missing, 'run `pnpm fixtures`').toEqual([])
  })

  test('CC-01.8: `not-audio.mp3` is not decodable audio (random bytes with an .mp3 name)', () => {
    expect(exists(audioPath('not-audio.mp3'))).toBe(true)
    const bytes = readFileSync(join(REPO_ROOT, audioPath('not-audio.mp3')))
    const hasMp3FrameSync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
    const hasId3 = bytes.subarray(0, 3).toString('latin1') === 'ID3'
    const hasRiff = bytes.subarray(0, 4).toString('latin1') === 'RIFF'
    expect(hasMp3FrameSync || hasId3 || hasRiff, 'not-audio.mp3 must not be a valid MP3/RIFF container').toBe(false)
  })

  test('CC-01.8: the manifest lists every matrix entry with codec, sampleRate, channels and expectedPath', () => {
    const manifest = loadManifest()
    for (const name of [...NATIVE_MATRIX, ...FALLBACK_MATRIX]) {
      const entry = manifest.files[name]
      expect(entry, `manifest entry for ${name}`).toBeDefined()
      expect(typeof entry!.codec, `${name}.codec`).toBe('string')
      expect(typeof entry!.sampleRate, `${name}.sampleRate`).toBe('number')
      expect(entry!.sampleRate, `${name}.sampleRate`).toBeGreaterThan(0)
      expect(entry!.channels, `${name}.channels`).toBeGreaterThan(0)
      expect(['webcodecs', 'ffmpeg'], `${name}.expectedPath`).toContain(entry!.expectedPath)
      expect(entry!.derivedFrom, `${name}.derivedFrom`).toBe('fmt-30s.ref.wav')
    }
  })

  test('CC-01.8: native codecs are expected on webcodecs and fallback codecs on ffmpeg', () => {
    const manifest = loadManifest()
    for (const name of NATIVE_MATRIX) expect(manifest.files[name]!.expectedPath, name).toBe('webcodecs')
    for (const name of FALLBACK_MATRIX) expect(manifest.files[name]!.expectedPath, name).toBe('ffmpeg')
  })

  test('CC-01.8: the 16 kHz reference WAV and the audio twins carry ground truth derived from it', () => {
    const manifest = loadManifest()
    expect(manifest.files['fmt-30s.ref.wav']!.sampleRate, 'fmt-30s.ref.wav is the 16 kHz PCM reference').toBe(16000)
    expect(manifest.files['speech-2min.m4a']!.groundTruth, 'speech-2min.m4a').toBeTruthy()
    expect(manifest.files['speech-2spk-2min.m4a']!.groundTruth, 'speech-2spk-2min.m4a').toBeTruthy()
    expect(manifest.files['speech-2min.m4a']!.groundTruth, 'audio twins share the video fixtures ground truth').toBe(
      manifest.files['speech-2min.mp4']!.groundTruth,
    )
  })

  test('CC-01.8: every committed fixture in the manifest matches its recorded SHA-256', () => {
    const manifest = loadManifest()
    const mismatches: string[] = []
    for (const [name, entry] of Object.entries(manifest.files)) {
      const file = audioPath(name)
      if (entry.generated || !exists(file)) continue
      if (sha256(file) !== entry.sha256) mismatches.push(name)
    }
    expect(mismatches, 'checksum drift (regenerate with `pnpm fixtures`)').toEqual([])
  })
})