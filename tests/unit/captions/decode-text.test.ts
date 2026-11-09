// CC-07.1 / FR-07.1 (L1): caption byte decoding — BOM sniff (UTF-8, UTF-16LE/
// BE) → strict UTF-8 → windows-1252 fallback, encoding reported, user override
// re-decodes. Undecodable bytes are a typed ENCODING failure (SECURITY-03:
// code + numbers only). Pure function over injected bytes — nothing mocked.
import { expect, test } from 'vitest'
import { decodeCaptionBytes } from '@engine/captions/decode-text'
import { captionBytes } from './project-support'

const utf8 = new TextEncoder()

test('CC-07.1 / FR-07.1: plain UTF-8 bytes decode with encoding reported as utf-8', () => {
  const decoded = decodeCaptionBytes(utf8.encode('0\n00:00:00,000 --> 00:00:01,000\nHello wörld\n'))
  expect(decoded.encoding).toBe('utf-8')
  expect(decoded.text).toContain('Hello wörld')
})

test('CC-07.1 / FR-07.1: UTF-8 BOM is sniffed and stripped from the text', () => {
  const decoded = decodeCaptionBytes(captionBytes('captions/bom-utf8.srt'))
  expect(decoded.encoding, 'BOM sniff (not just the fallback)').toBe('utf-8')
  expect(decoded.text.startsWith('\uFEFF'), 'BOM must not leak into the decoded text').toBe(false)
  expect(decoded.text).toContain('Bom utf eight')
})

test('CC-07.1 / FR-07.1: UTF-16LE BOM decodes and reports utf-16le', () => {
  const decoded = decodeCaptionBytes(captionBytes('captions/bom-utf16le.srt'))
  expect(decoded.encoding).toBe('utf-16le')
  expect(decoded.text).toContain('Utf sixteen le')
  expect(decoded.text.includes('\u0000'), 'no NUL bytes from byte-order mistakes').toBe(false)
})

test('CC-07.1 / FR-07.1: UTF-16BE BOM decodes and reports utf-16be', () => {
  const decoded = decodeCaptionBytes(captionBytes('captions/bom-utf16be.srt'))
  expect(decoded.encoding).toBe('utf-16be')
  expect(decoded.text).toContain('Utf sixteen be')
  expect(decoded.text.includes('\u0000'), 'no NUL bytes from byte-order mistakes').toBe(false)
})

test('CC-07.1 / FR-07.1: invalid-UTF-8 bytes fall back to windows-1252 and report it', () => {
  // The fixture stores é as a single 0xE9 byte — invalid UTF-8, valid cp1252.
  const decoded = decodeCaptionBytes(captionBytes('captions/accents-cp1252.srt'))
  expect(decoded.encoding, 'fallback applied and REPORTED (FR-07.1)').toBe('windows-1252')
  expect(decoded.text).toContain('Café')
  expect(decoded.text).toContain('naïve')
  expect(decoded.text).toContain('résumé')
  expect(decoded.text).toContain('—')
})

test('CC-07.1 / FR-07.1: encoding override re-decodes valid UTF-8 as windows-1252 (confirm-dialog override)', () => {
  const eAcuteUtf8 = utf8.encode('é') // C3 A9
  const sniffed = decodeCaptionBytes(eAcuteUtf8)
  expect(sniffed.encoding).toBe('utf-8')
  expect(sniffed.text).toBe('é')
  const overridden = decodeCaptionBytes(eAcuteUtf8, { encoding: 'windows-1252' })
  expect(overridden.encoding, 'the user override is honored verbatim').toBe('windows-1252')
  expect(overridden.text, 'cp1252 maps C3 A9 to Ã©').toBe('Ã©')
})

test('CC-07.1 / FR-07.1: bytes neither UTF-8 nor windows-1252 can decode → typed ENCODING failure', async () => {
  // 0xC3 0x28 breaks strict UTF-8; 0x81/0x8D/0x8F/0x90/0x9D are the five
  // windows-1252 positions with no character (undefined) → ENCODING.
  await expect(Promise.resolve().then(() => decodeCaptionBytes(captionBytes('captions/undecodable.bin')))).rejects.toMatchObject({ code: 'ENCODING' })
})

test('CC-07.1 / FR-07.1: the ENCODING failure carries no text (SECURITY-03)', async () => {
  try {
    decodeCaptionBytes(captionBytes('captions/undecodable.bin'))
    expect.unreachable('expected ENCODING failure')
  } catch (error) {
    expect(JSON.stringify(error), 'error surface is codes/numbers only').not.toContain('ABC')
  }
})

test('CC-07.1 / FR-07.1: empty bytes decode to empty text as utf-8', () => {
  const decoded = decodeCaptionBytes(new Uint8Array(0))
  expect(decoded.text).toBe('')
  expect(decoded.encoding).toBe('utf-8')
})
