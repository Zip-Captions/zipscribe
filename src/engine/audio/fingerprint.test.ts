// L1 coverage for the fingerprint surface the frozen CC-04.13 suite pins at
// the contract level: the first/middle/last 64 KB `File.slice` offsets and
// the real SHA-256 over each region, determinism, per-region tamper
// isolation, small-file clamping, duration rounding and the nameless-Blob
// fallback. Expected digests are `node:crypto` SHA-256 of the pinned
// sequential bytes (the frozen suite cross-checks node:crypto against the
// committed FIPS 180-4 vectors). (unit-03 precedent for source-adjacent
// tests; supports the per-file coverage gate on `src/engine/**`.)
import { describe, expect, test } from 'vitest'
import { FINGERPRINT_SLICE_BYTES, fingerprintFile } from './fingerprint'

const SIZE = FINGERPRINT_SLICE_BYTES * 2 + 12_345 // 143 417 — larger than three slices
const MIDDLE_AT = Math.floor(SIZE / 2 - FINGERPRINT_SLICE_BYTES / 2) // 38 940
const LAST_AT = SIZE - FINGERPRINT_SLICE_BYTES // 77 881

/** node:crypto digests of `sequentialBytes(SIZE, 5)` at [0, MIDDLE_AT, LAST_AT] + the 3000-byte tiny file. */
const PINNED = [
  '4cdf72271fcefc2f6466e00c33629289ef02d0e8ab700fdbaba0d84fc37ac882',
  'a6d6413f749688523e51a419e91b217a1895fe4f76a4b2e6be57c237c80510d2',
  '3b963d865e6674235922ec6e0cdd1c281b800d3a4b83e3d2112fa0b089776d38',
] as const
const PINNED_TINY = 'e9e8e1e965f17acefde0a0640bca0c130c8ed24cde4e859098d9ebb3f7ea6f59'

function sequentialBytes(length: number, start = 0): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length))
  for (let index = 0; index < length; index++) out[index] = (start + index) & 0xff
  return out
}

function file(bytes: Uint8Array<ArrayBuffer>, name = 'clip.wav'): Blob {
  return new File([bytes], name, { type: 'application/octet-stream' })
}

describe('fingerprint: sampled regions and hashing (FR-04.8)', () => {
  test('sampleHashes are SHA-256 of the first/middle/last 64 KB slices', async () => {
    const fingerprint = await fingerprintFile(file(sequentialBytes(SIZE, 5)), 30)
    expect(fingerprint.sampleHashes).toEqual([...PINNED])
    expect(fingerprint.name).toBe('clip.wav')
    expect(fingerprint.size).toBe(SIZE)
  })

  test('identical bytes give byte-identical fingerprints across calls', async () => {
    const a = await fingerprintFile(file(sequentialBytes(SIZE, 5)), 30)
    const b = await fingerprintFile(file(sequentialBytes(SIZE, 5)), 30)
    expect(b).toEqual(a)
  })

  test('a 1-byte change perturbs exactly the region containing it', async () => {
    const base = sequentialBytes(SIZE, 5)
    const tamper = async (at: number): Promise<Awaited<ReturnType<typeof fingerprintFile>>> => {
      const changed = base.slice()
      changed[at] = (changed[at]! + 1) & 0xff
      return fingerprintFile(file(changed), 30)
    }
    // The three 64 KB regions overlap at this size; tamper in each region's
    // exclusive zone so exactly one digest must move.
    const clean = await fingerprintFile(file(base), 30)
    const first = await tamper(Math.floor(MIDDLE_AT / 2)) // < MIDDLE_AT — only the first region
    expect(first.sampleHashes[0]).not.toBe(clean.sampleHashes[0])
    expect([first.sampleHashes[1], first.sampleHashes[2]]).toEqual([clean.sampleHashes[1], clean.sampleHashes[2]])
    const middle = await tamper(FINGERPRINT_SLICE_BYTES + 100) // ≥ first end, < last start — only the middle
    expect(middle.sampleHashes[1]).not.toBe(clean.sampleHashes[1])
    expect([middle.sampleHashes[0], middle.sampleHashes[2]]).toEqual([clean.sampleHashes[0], clean.sampleHashes[2]])
    const last = await tamper(LAST_AT + FINGERPRINT_SLICE_BYTES - 3) // > middle end — only the last
    expect(last.sampleHashes[2]).not.toBe(clean.sampleHashes[2])
    expect([last.sampleHashes[0], last.sampleHashes[1]]).toEqual([clean.sampleHashes[0], clean.sampleHashes[1]])
  })

  test('a file smaller than three slices clamps the offsets to zero', async () => {
    const tiny = sequentialBytes(3000, 1)
    const fingerprint = await fingerprintFile(file(tiny, 'tiny.wav'), 0.2)
    expect(fingerprint.sampleHashes).toEqual([PINNED_TINY, PINNED_TINY, PINNED_TINY])
    expect(fingerprint.size).toBe(3000)
    expect(fingerprint.durationMs).toBe(200)
  })

  test('durationMs rounds half-up to integer milliseconds', async () => {
    const fingerprint = await fingerprintFile(file(sequentialBytes(1000)), 2.9996)
    expect(fingerprint.durationMs).toBe(3000)
    const trunc = await fingerprintFile(file(sequentialBytes(1000)), 1.2344)
    expect(trunc.durationMs).toBe(1234)
  })
})

describe('fingerprint: nameless Blob input', () => {
  test('a plain Blob (no File name) fingerprints with name ""', async () => {
    const blob = new Blob([sequentialBytes(FINGERPRINT_SLICE_BYTES * 2 + 10)])
    const fingerprint = await fingerprintFile(blob, 5)
    expect(fingerprint.name).toBe('')
    expect(fingerprint.sampleHashes).toHaveLength(3)
    expect(fingerprint.durationMs).toBe(5000)
  })
})
