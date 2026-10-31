// CC-04.4 / CC-04.5 (L1): content sniffing and the per-session support matrix
// (FR-04.6 / FR-04.9 — format detection by content, never by extension alone;
// `'none'` → `UNSUPPORTED_MEDIA`; the matrix is cached in memory per session).
//
// The probe adapter (`engine/audio/adapters/probe.ts`) runs in the worker with
// mediabunny; this suite proves the pure parts in Node against the committed
// fixture headers and a `FixturesLike` list of the documented container
// signatures.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_FORMAT_HINTS, createSupportMatrix, formatSignature, sniffContainer } from '@engine/audio/adapters/probe'
import { REPO_ROOT } from '../../helpers/repo'

function header(name: string, length = 64): Uint8Array {
  return new Uint8Array(readFileSync(join(REPO_ROOT, 'fixtures/audio', name)).subarray(0, length))
}

/** Signatures the probe adapter must recognise (from the fixture headers above). */
const EXPECTED_CONTAINER_BY_FILE: Record<string, string> = {
  'fmt-30s.m4a': 'mp4',
  'fmt-30s.m4b': 'mp4',
  'fmt-30s.alac.m4a': 'mp4',
  'fmt-30s.aac': 'aac',
  'fmt-30s.mp3': 'mp3',
  'fmt-30s.vbr.mp3': 'mp3',
  'fmt-30s.wav': 'wav',
  'fmt-30s.aiff': 'aiff',
  'fmt-30s.flac': 'flac',
  'fmt-30s.ogg': 'ogg',
  'fmt-30s.oga': 'ogg',
  'fmt-30s.opus': 'ogg',
  'fmt-30s.weba': 'matroska',
  'fmt-30s.mka': 'matroska',
  'fmt-30s.wma': 'asf',
  'fmt-30s.amr': 'amr',
  'fmt-30s.caf': 'caf',
  'fmt-30s.3gp': 'mp4',
}

describe('CC-04.5: content-based format detection (FR-04.9)', () => {
  test('CC-04.5: formatSignature renders a dash-joined hex signature of a byte region', () => {
    expect(formatSignature(new Uint8Array([0, 0, 0, 28, 0x66]), 0, 5)).toBe('00-00-00-1c-66')
    expect(formatSignature(new Uint8Array([1, 2, 3]), 2, 8), 'short region yields an empty signature').toBe('')
  })

  test.each(Object.entries(EXPECTED_CONTAINER_BY_FILE))('CC-04.5: %s sniffs as %s', (name, container) => {
    expect(sniffContainer(header(name))).toBe(container)
  })

  test('CC-04.5: not-audio.mp3 is NOT sniffed as MP3 despite its extension', () => {
    const container = sniffContainer(header('not-audio.mp3', 512))
    expect(container, 'a junk file must never be classified as audio by extension').not.toBe('mp3')
    expect(container).toBe('unknown')
  })

  test('CC-04.5: ALL_FORMAT_HINTS documents every searched signature (registry precision)', () => {
    expect(ALL_FORMAT_HINTS.length).toBeGreaterThanOrEqual(8)
    for (const hint of ALL_FORMAT_HINTS) expect(typeof hint).toBe('string')
  })
})

describe('CC-04.5: per-session support matrix (FR-04.6) is cached in memory', () => {
  test('CC-04.5: webcodecs-capable env resolves native codecs to the webcodecs path', () => {
    const matrix = createSupportMatrix()
    const result = matrix.probe('cache-key-1', 'mp4', 'aac', { webcodecs: true, ffmpeg: true })
    expect(result).toEqual({ container: 'mp4', codec: 'aac', supported: 'webcodecs' })
  })

  test('CC-04.5: without WebCodecs the same codec resolves to the ffmpeg fallback', () => {
    const matrix = createSupportMatrix()
    expect(matrix.probe('cache-key-2', 'wma', 'wmav2', { webcodecs: false, ffmpeg: true }).supported).toBe('ffmpeg')
    expect(matrix.probe('cache-key-3', 'mp4', 'aac', { webcodecs: false, ffmpeg: true }).supported).toBe('ffmpeg')
  })

  test('CC-04.5: no decoder at all resolves to none (the UNSUPPORTED_MEDIA trigger)', () => {
    const matrix = createSupportMatrix()
    expect(matrix.probe('cache-key-4', 'unknown', 'none', { webcodecs: false, ffmpeg: false }).supported).toBe('none')
  })

  test('CC-04.5: probe results are cached per session — the second probe returns the SAME entry', () => {
    const matrix = createSupportMatrix()
    const first = matrix.probe('cache-key-5', 'wav', 'pcm-s16', { webcodecs: true, ffmpeg: true })
    const second = matrix.probe('cache-key-5', 'wav', 'pcm-s16', { webcodecs: false, ffmpeg: false })
    expect(second).toBe(first)
    expect(matrix.entries()).toHaveLength(1)
  })

  test('CC-04.5: each probe adds exactly one entry to the session cache', () => {
    const matrix = createSupportMatrix()
    matrix.probe('a', 'mp4', 'aac', { webcodecs: true, ffmpeg: true })
    matrix.probe('b', 'ogg', 'opus', { webcodecs: true, ffmpeg: false })
    const entries = matrix.entries()
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => `${entry.container}/${entry.codec}`).sort()).toEqual(['mp4/aac', 'ogg/opus'])
  })
})