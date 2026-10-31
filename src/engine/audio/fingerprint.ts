// Media fingerprint (FR-04.8 / CC-04.13): SHA-256 of three 64 KB regions —
// first, middle, last — sliced from the file with `File.slice` and hashed via
// WebCrypto (`globalThis.crypto.subtle`, the unit-03 `model/cache.ts`
// pattern). Deterministic across imports of the same bytes and different
// under a 1-byte change in any sampled region. The probe supplies
// `durationSec`; nothing here touches the DOM beyond injected DOM *types*.
// The exported surface is the frozen unit-04 contract
// (`tests/unit/media/unit04-api-contract.d.ts`).

import type { MediaFingerprint } from '../model'

/** Bytes hashed per sampled region (first / middle / last). */
export const FINGERPRINT_SLICE_BYTES = 65536

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

async function hashRegion(file: Blob, at: number): Promise<string> {
  const region = await file.slice(at, at + FINGERPRINT_SLICE_BYTES).arrayBuffer()
  const digest = await globalThis.crypto.subtle.digest('SHA-256', region)
  return toHex(digest)
}

/** SHA-256 of three 64 KB `File.slice` regions — first, middle, last (FR-04.8); `durationMs` is supplied by the probe. */
export async function fingerprintFile(file: Blob, durationSec: number): Promise<MediaFingerprint> {
  const size = file.size
  const middle = Math.max(0, Math.floor(size / 2 - FINGERPRINT_SLICE_BYTES / 2))
  const last = Math.max(0, size - FINGERPRINT_SLICE_BYTES)
  const sampleHashes = await Promise.all([hashRegion(file, 0), hashRegion(file, middle), hashRegion(file, last)])
  // `File` carries a name; a bare `Blob` (unit-test injection) yields ''.
  const name = typeof (file as File).name === 'string' ? (file as File).name : ''
  return { name, size, durationMs: Math.round(durationSec * 1000), sampleHashes }
}
