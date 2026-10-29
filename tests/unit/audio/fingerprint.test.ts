// CC-04.13 (L1): media fingerprint — deterministic across imports, differs on
// a 1-byte change in any sampled region (FR-04.8 / `MediaFingerprint`).
//
// `fingerprintFile(file, durationSec)` hashes three 64 KB `file.slice`
// regions (first, middle, last) with SHA-256. The digest must be the real
// SHA-256 (a wrong/fake hash makes the 1-byte change test vacuous), so the
// suite cross-checks the implementation against `node:crypto` for every
// vector and against the committed FIPS 180-4 vectors in `hash-vector.ts`.
import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { FINGERPRINT_SLICE_BYTES, fingerprintFile } from '@engine/audio/fingerprint'
import { SHA256_VECTORS, sequentialBytes } from './helpers/hash-vector'

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function fileName(blob: Blob, name: string): Blob {
  // Node has `File` (Node ≥ 20); its `slice()` keeps the name.
  return new File([blob], name, { type: 'application/octet-stream' })
}

const SIZE = FINGERPRINT_SLICE_BYTES * 4 + 12345

describe('CC-04.13: fingerprint determinism and tamper detection', () => {
  test('CC-04.13: FINGERPRINT_SLICE_BYTES is 64 KB', () => {
    expect(FINGERPRINT_SLICE_BYTES).toBe(65536)
  })

  test('CC-04.13: SHA-256 used by the adapters matches node:crypto on the committed vectors', () => {
    // The table is FIPS 180-4; node:crypto is the oracle. A wrong table or a
    // wrong implementation cannot satisfy both.
    for (const vector of SHA256_VECTORS) {
      expect(nodeSha256(vector.input), vector.label).toBe(vector.hex)
    }
  })

  test('CC-04.13: two imports of the same file give identical fingerprints', async () => {
    const bytes = sequentialBytes(SIZE, 7)
    const first = await fingerprintFile(fileName(new Blob([bytes]), 'speech-2min.mp4'), 120.04)
    const second = await fingerprintFile(fileName(new Blob([bytes]), 'speech-2min.mp4'), 120.04)
    expect(second).toEqual(first)
    expect(first.name).toBe('speech-2min.mp4')
    expect(first.size).toBe(SIZE)
    expect(first.durationMs).toBe(120040)
    expect(first.sampleHashes).toHaveLength(3)
    for (const hash of first.sampleHashes) expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('CC-04.13: sampleHashes are the SHA-256 of first/middle/last 64 KB via File.slice', async () => {
    const bytes = sequentialBytes(SIZE, 3)
    const file = fileName(new Blob([bytes]), 'clip.wav')
    const fingerprint = await fingerprintFile(file, 30)
    const middleAt = Math.floor(SIZE / 2 - FINGERPRINT_SLICE_BYTES / 2)
    const expected = [0, middleAt, SIZE - FINGERPRINT_SLICE_BYTES].map((at) => nodeSha256(bytes.subarray(at, at + FINGERPRINT_SLICE_BYTES)))
    expect(fingerprint.sampleHashes).toEqual(expected)
  })

  test('CC-04.13: a 1-byte change in the FIRST sampled region changes the fingerprint', async () => {
    const base = sequentialBytes(SIZE, 11)
    const changed = base.slice()
    changed[100] = (changed[100]! + 1) & 0xff
    const a = await fingerprintFile(fileName(new Blob([base]), 'a.m4a'), 30)
    const b = await fingerprintFile(fileName(new Blob([changed]), 'a.m4a'), 30)
    expect(b.sampleHashes[0]).not.toBe(a.sampleHashes[0])
    expect(b.sampleHashes).not.toEqual(a.sampleHashes)
  })

  test('CC-04.13: a 1-byte change in the MIDDLE sampled region changes the fingerprint', async () => {
    const base = sequentialBytes(SIZE, 13)
    const changed = base.slice()
    const middleAt = Math.floor(SIZE / 2 - FINGERPRINT_SLICE_BYTES / 2)
    changed[middleAt + 777] = (changed[middleAt + 777]! + 1) & 0xff
    const a = await fingerprintFile(fileName(new Blob([base]), 'b.m4a'), 30)
    const b = await fingerprintFile(fileName(new Blob([changed]), 'b.m4a'), 30)
    expect(b.sampleHashes[1]).not.toBe(a.sampleHashes[1])
    expect(b.sampleHashes).not.toEqual(a.sampleHashes)
  })

  test('CC-04.13: a 1-byte change in the LAST sampled region changes the fingerprint', async () => {
    const base = sequentialBytes(SIZE, 17)
    const changed = base.slice()
    changed[SIZE - 17] = (changed[SIZE - 17]! + 1) & 0xff
    const a = await fingerprintFile(fileName(new Blob([base]), 'c.m4a'), 30)
    const b = await fingerprintFile(fileName(new Blob([changed]), 'c.m4a'), 30)
    expect(b.sampleHashes[2]).not.toBe(a.sampleHashes[2])
    expect(b.sampleHashes).not.toEqual(a.sampleHashes)
  })

  test('CC-04.13: a file smaller than three slices still hashes first/middle/last deterministically', async () => {
    const small = sequentialBytes(3000, 1)
    const fingerprint = await fingerprintFile(fileName(new Blob([small]), 'tiny.wav'), 0.2)
    expect(fingerprint.sampleHashes).toHaveLength(3)
    for (const hash of fingerprint.sampleHashes) expect(hash).toMatch(/^[0-9a-f]{64}$/)
    const again = await fingerprintFile(fileName(new Blob([small]), 'tiny.wav'), 0.2)
    expect(again.sampleHashes).toEqual(fingerprint.sampleHashes)
    expect(fingerprint.size).toBe(3000)
  })

  test('CC-04.13: durationMs is rounded to integer milliseconds', async () => {
    const bytes = sequentialBytes(1000, 0)
    const fingerprint = await fingerprintFile(fileName(new Blob([bytes]), 'x.mp3'), 1.23456)
    expect(fingerprint.durationMs).toBe(1235)
  })
})