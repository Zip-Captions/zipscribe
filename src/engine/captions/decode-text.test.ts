// FR-07.1 (L1, co-located coverage suite): decodeCaptionBytes — BOM sniff,
// strict UTF-8, strict windows-1252 fallback with the five undefined
// positions as ENCODING, user override re-decode. The frozen acceptance
// suite is tests/unit/captions/decode-text.test.ts; this file additionally
// covers the override branches and the error class (src/** unit-test
// convention, knowledge/conventions.md § Testing strategy). SECURITY-03:
// failures asserted for codes/numbers only.
import { describe, expect, test } from 'vitest'
import { decodeCaptionBytes } from './decode-text'
import { CaptionFailureError } from './failure'

const utf8 = new TextEncoder()
const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)

describe('CC-07.1 / FR-07.1: decodeCaptionBytes', () => {
  test('plain UTF-8, empty bytes and the UTF-8 BOM (stripped)', () => {
    expect(decodeCaptionBytes(utf8.encode('hello'))).toEqual({ text: 'hello', encoding: 'utf-8' })
    expect(decodeCaptionBytes(bytes())).toEqual({ text: '', encoding: 'utf-8' })
    const bom = decodeCaptionBytes(bytes(0xef, 0xbb, 0xbf, 0x41, 0x20, 0xc3, 0xa9)) // 'A é' with BOM
    expect(bom.encoding).toBe('utf-8')
    expect(bom.text).toBe('A é')
  })

  test('UTF-16LE/BE BOMs decode and the decoded BOM char never leaks', () => {
    const le = decodeCaptionBytes(bytes(0xff, 0xfe, 0x41, 0x00, 0xff, 0xfe)) // 'A' + a second BOM mid-stream (only the leading one is stripped)
    expect(le).toEqual({ text: 'A\uFEFF', encoding: 'utf-16le' })
    const be = decodeCaptionBytes(bytes(0xfe, 0xff, 0x00, 0x41))
    expect(be).toEqual({ text: 'A', encoding: 'utf-16be' })
  })

  test('invalid UTF-8 falls back to windows-1252 (0xE9 é, 0x97 em dash)', () => {
    const decoded = decodeCaptionBytes(bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0x97))
    expect(decoded).toEqual({ text: 'Café \u2014', encoding: 'windows-1252' })
  })

  test('the five undefined cp1252 positions are a typed ENCODING failure', () => {
    for (const byte of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) {
      try {
        decodeCaptionBytes(bytes(0x41, byte))
        expect.unreachable('expected ENCODING')
      } catch (error) {
        const failure = error as { code: string; detail?: string }
        expect(failure.code).toBe('ENCODING')
        expect(failure.detail).toContain(`0x${byte.toString(16)}`)
      }
    }
  })

  test('a BOM-sniffed UTF-8 file with invalid bytes is ENCODING (no silent cp1252 after a UTF-8 BOM)', () => {
    expect(() => decodeCaptionBytes(bytes(0xef, 0xbb, 0xbf, 0xc3, 0x28))).toThrowError(/ENCODING|UTF-8/u)
    try {
      decodeCaptionBytes(bytes(0xef, 0xbb, 0xbf, 0xc3, 0x28))
      expect.unreachable()
    } catch (error) {
      expect((error as { code: string }).code).toBe('ENCODING')
    }
  })

  test('encoding override re-decodes the same bytes with the user choice', () => {
    const eAcute = bytes(0xc3, 0xa9)
    expect(decodeCaptionBytes(eAcute, { encoding: 'windows-1252' })).toEqual({ text: '\u00c3\u00a9', encoding: 'windows-1252' })
    expect(decodeCaptionBytes(eAcute, { encoding: 'utf-8' })).toEqual({ text: 'é', encoding: 'utf-8' })
    const le = bytes(0xff, 0xfe, 0x41, 0x00)
    expect(decodeCaptionBytes(le, { encoding: 'utf-16le' })).toEqual({ text: 'A', encoding: 'utf-16le' }) // forced decode strips the decoded BOM char
    expect(decodeCaptionBytes(bytes(0x00, 0x41), { encoding: 'utf-16be' })).toEqual({ text: 'A', encoding: 'utf-16be' })
  })

  test('a forced UTF-8 read that produces NUL code points is ENCODING (UTF-16 data, wrong codec)', () => {
    try {
      decodeCaptionBytes(bytes(0x61, 0x00, 0x00, 0x00), { encoding: 'utf-8' })
      expect.unreachable('expected ENCODING')
    } catch (error) {
      expect((error as { code: string }).code).toBe('ENCODING')
    }
  })

  test('a forced UTF-8 read of invalid bytes is ENCODING', () => {
    expect(() => decodeCaptionBytes(bytes(0xc3, 0x28), { encoding: 'utf-8' })).toThrowError()
  })

  test('a forced windows-1252 read hits undefined positions as ENCODING', () => {
    expect(() => decodeCaptionBytes(bytes(0x81), { encoding: 'windows-1252' })).toThrowError()
  })
})

describe('unit-07 contract shape: CaptionFailureError', () => {
  test('carries name/code and optional line/detail only', () => {
    const withLine = new CaptionFailureError('UNRECOGNIZED_FORMAT', 'SRT timestamp line malformed (line 6)', { line: 6 })
    expect(withLine).toBeInstanceOf(Error)
    expect({ name: withLine.name, message: withLine.message, code: withLine.code, line: withLine.line, detail: withLine.detail }).toEqual({
      name: 'CaptionFailure',
      message: 'SRT timestamp line malformed (line 6)',
      code: 'UNRECOGNIZED_FORMAT',
      line: 6,
      detail: undefined,
    })
    const bare = new CaptionFailureError('ENCODING', 'bytes are not valid UTF-8')
    expect(bare.line).toBeUndefined()
    expect(bare.detail).toBeUndefined()
  })
})
