// Coverage provider (CC-04.14 nested run, unit-03 internals-suite pattern):
// the bare-Blob leg of `fingerprintFile` (a unit-test injected `Blob` carries
// no `name`) and the degenerate all-empty-slices case — branches the frozen
// `fingerprint.test.ts` (File-only) does not exercise. No CC-tracing; the
// frozen suite owns the criterion evidence.
import { describe, expect, test } from 'vitest'
import { FINGERPRINT_SLICE_BYTES, fingerprintFile } from '@engine/audio/fingerprint'

function bytes(size: number, seed = 0): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size)
  for (let index = 0; index < size; index++) out[index] = (index * 31 + seed) & 0xff
  return out
}

describe('fingerprint: injected-Blob legs (FR-04.8)', () => {
  test('a nameless Blob fingerprints identically to the same bytes as a File', async () => {
    const payload = bytes(FINGERPRINT_SLICE_BYTES * 2 + 17)
    const asFile = new File([payload], 'speech.wav', { type: 'audio/wav' })
    const asBlob = new Blob([payload], { type: 'audio/wav' })
    const filePrint = await fingerprintFile(asFile, 12.3456)
    const blobPrint = await fingerprintFile(asBlob, 12.3456)
    expect(blobPrint.name).toBe('')
    expect(filePrint.name).toBe('speech.wav')
    expect(blobPrint.sampleHashes).toEqual(filePrint.sampleHashes)
    expect(blobPrint.durationMs).toBe(12346)
  })

  test('an empty Blob hashes three empty regions deterministically', async () => {
    const empty = new Blob([])
    const print = await fingerprintFile(empty, 0)
    expect(print.size).toBe(0)
    expect(print.sampleHashes).toHaveLength(3)
    expect(new Set(print.sampleHashes).size).toBe(1)
    expect(print.sampleHashes[0]).toMatch(/^[0-9a-f]{64}$/)
  })
})
