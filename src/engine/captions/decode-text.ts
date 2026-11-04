// FR-07.1 — caption byte decoding. Pure over injected bytes: BOM sniff
// (UTF-8, UTF-16LE/BE; BOM stripped) → strict UTF-8 → windows-1252 fallback,
// encoding reported; `opts.encoding` re-decodes the SAME bytes with the
// user's confirm-dialog choice. Undecodable bytes are the typed 'ENCODING'
// failure (SECURITY-03: codes and numbers only, never bytes-as-text).

import type { CaptionEncoding } from './types'
import { CaptionFailureError } from './failure'

export interface DecodedText {
  text: string
  /** BOM sniffed or fallback applied — reported for the ImportReport/confirm dialog (FR-07.1). */
  encoding: CaptionEncoding
}

export interface DecodeOptions {
  /** Re-decode override (FR-07.1); omit for the BOM → strict UTF-8 → windows-1252 sniff. */
  encoding?: CaptionEncoding
}

/**
 * windows-1252 rows 0x80–0x9F. The five undefined cp1252 positions
 * (0x81, 0x8D, 0x8F, 0x90, 0x9D) are the '\uFFFE' sentinels → ENCODING.
 * This is why we do not use `TextDecoder('windows-1252')`: the WHATWG
 * decoder maps those five bytes to the matching C1 control characters
 * instead of failing (https://encoding.spec.whatwg.org/#windows-1252-decoder),
 * which would silently "decode" garbage instead of reporting ENCODING.
 * Rows 0x00–0x7F and 0xA0–0xFF are identity (code point === byte).
 */
const CP1252_HIGH = '\u20ac\ufffe\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffe\u017d\ufffe\ufffe\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffe\u017e\u0178'

function isPrefixOf(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false
  for (let index = 0; index < prefix.length; index++) {
    if (bytes[index] !== prefix[index]) return false
  }
  return true
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new CaptionFailureError('ENCODING', 'caption bytes are not valid UTF-8', { detail: `byteLength ${bytes.byteLength}` })
  }
}

/** Strict windows-1252: the five undefined byte positions are an ENCODING failure (FR-07.1). */
function decodeWindows1252Strict(bytes: Uint8Array): string {
  const chars: string[] = []
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!
    if (byte < 0x80 || byte >= 0xa0) {
      chars.push(String.fromCharCode(byte))
      continue
    }
    const high = CP1252_HIGH[byte - 0x80]!
    if (high === '\ufffe') {
      throw new CaptionFailureError('ENCODING', 'caption bytes are not valid UTF-8 and hit an undefined windows-1252 position', { detail: `byte 0x${byte.toString(16).padStart(2, '0')} at offset ${index}` })
    }
    chars.push(high)
  }
  return chars.join('')
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  // Non-fatal: a trailing odd byte decodes to U+FFFD (the strictness that
  // matters for ENCODING is UTF-8 validity and the cp1252 undefined rows).
  const text = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Strip a decoded UTF-8 BOM (user override re-decodes bytes a BOM sniff would have consumed). */
function stripBomChar(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function decodeCaptionBytes(bytes: Uint8Array, opts: DecodeOptions = {}): DecodedText {
  if (opts.encoding) {
    switch (opts.encoding) {
      case 'utf-8': {
        const text = stripBomChar(decodeUtf8Strict(bytes))
        if (text.includes('\u0000')) {
          // A user-forced UTF-8 read that produced NULs is UTF-16 data read
          // with the wrong codec (errors.test 'forced.srt' pins this).
          throw new CaptionFailureError('ENCODING', 'bytes do not decode as the chosen UTF-8 (NUL code points)', { detail: `byteLength ${bytes.byteLength}` })
        }
        return { text, encoding: 'utf-8' }
      }
      case 'utf-16le':
        return { text: decodeUtf16(bytes, true), encoding: 'utf-16le' }
      case 'utf-16be':
        return { text: decodeUtf16(bytes, false), encoding: 'utf-16be' }
      case 'windows-1252':
        return { text: decodeWindows1252Strict(bytes), encoding: 'windows-1252' }
    }
  }

  if (isPrefixOf(bytes, [0xef, 0xbb, 0xbf])) return { text: decodeUtf8Strict(bytes.subarray(3)), encoding: 'utf-8' }
  if (isPrefixOf(bytes, [0xff, 0xfe])) return { text: decodeUtf16(bytes.subarray(2), true), encoding: 'utf-16le' }
  if (isPrefixOf(bytes, [0xfe, 0xff])) return { text: decodeUtf16(bytes.subarray(2), false), encoding: 'utf-16be' }

  try {
    return { text: decodeUtf8Strict(bytes), encoding: 'utf-8' }
  } catch {
    return { text: decodeWindows1252Strict(bytes), encoding: 'windows-1252' }
  }
}
