// Pinned test vectors for the hand-written SHA-256 the audio adapters use.
//
// `crypto.subtle.digest('SHA-256', …)` is the production API (available in
// workers and page contexts). The fingerprint unit tests run under Node and
// need a SHA-256 that is byte-identical to it — FIPS 180-4 vectors below make
// a wrong implementation impossible to hide (the Node tests recompute every
// expected digest at runtime with `node:crypto` and cross-check this table).
export const SHA256_VECTORS: readonly { input: Uint8Array; hex: string; label: string }[] = [
  { label: 'empty', input: new Uint8Array(0), hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { label: 'abc', input: new TextEncoder().encode('abc'), hex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' },
  {
    label: '448-bit (one padding block boundary)',
    input: new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    hex: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  {
    label: '896-bit',
    input: new TextEncoder().encode('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
    hex: 'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  },
] as const

/** Byte-for-byte sequential filler used by the fingerprint tests (never random). */
export function sequentialBytes(length: number, start = 0): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length))
  for (let index = 0; index < length; index++) out[index] = (start + index) & 0xff
  return out
}
