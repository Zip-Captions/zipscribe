// Adversarial round (EMPTY/ABSENT/DEGENERATE category): degenerate byte
// streams through `importCaptions` with and without the FR-07.1 encoding
// override. Contract: unit-07 line 43 (FR-07.1: BOM sniff → strict UTF-8 →
// windows-1252 fallback; user override re-decodes) and line 48 (FR-07.6:
// failures carry codes/numbers only, never cue text); frozen contract
// tests/unit/captions/unit07-api-contract.d.ts lines 220–237 (ENCODING for
// undefined cp1252 positions and wrong-codec reads).
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { CaptionFailure } from '@engine/captions/contract@07'
import { canonical } from '../canonical'
import { makeProject } from '../project-support'

const enc = new TextEncoder()
const NO_YIELD = async (): Promise<void> => undefined
const SRT_BODY = '1\n00:00:01,000 --> 00:00:02,000\nhi there\n'

async function captureFailure(run: () => Promise<unknown>): Promise<CaptionFailure> {
  try {
    await run()
  } catch (error) {
    return error as CaptionFailure
  }
  throw new Error('expected a CaptionFailure, but the call resolved')
}

function toUtf16LeBytes(text: string): Uint8Array {
  const utf8 = enc.encode(text)
  const bytes = new Uint8Array(utf8.length * 2)
  for (let index = 0; index < utf8.length; index++) bytes[index * 2] = utf8[index]!
  return bytes
}

test('ADVERSARIAL (degenerate): UTF-16 bytes under an encoding:"utf-8" override → typed ENCODING (the NUL-code-point guard), input project untouched — a wrong-codec read must be an honest failure, not mojibake blocks (FR-07.1)', async () => {
  const project = makeProject()
  const before = canonical(project)
  const failure = await captureFailure(() => importCaptions(project, { name: 'forced.srt', bytes: toUtf16LeBytes(SRT_BODY) }, { as: 'source', encoding: 'utf-8', scheduleYield: NO_YIELD }))
  expect(failure.name).toBe('CaptionFailure')
  expect(failure.code).toBe('ENCODING')
  expect(failure.detail, 'numeric detail only (SECURITY-03)').toMatch(/^byteLength \d+$/)
  expect(canonical(project), 'no partial project change').toBe(before)
})

test('ADVERSARIAL (degenerate): windows-1252 undefined byte 0x81 — the sniff path (invalid UTF-8 → strict cp1252 fallback) fails typed ENCODING naming the byte and offset, never silently decoding to a C1 control character (FR-07.1; WHATWG windows-1252 leniency is why decode-text uses a strict table)', async () => {
  const project = makeProject()
  const before = canonical(project)
  const bytes = new Uint8Array([...enc.encode(SRT_BODY), 0x81, 0x0a])
  const failure = await captureFailure(() => importCaptions(project, { name: 'cp1252-undefined.srt', bytes }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(failure.code).toBe('ENCODING')
  expect(failure.message).toBe('caption bytes are not valid UTF-8 and hit an undefined windows-1252 position')
  expect(failure.detail, 'codes and numbers only (FR-07.6)').toBe(`byte 0x81 at offset ${SRT_BODY.length}`)
  expect(canonical(project)).toBe(before)
})

test('ADVERSARIAL (degenerate): the same 0x81 byte under an explicit encoding:"windows-1252" override is still a typed ENCODING — the five undefined cp1252 positions have no character and must never import as U+0081 garbage (FR-07.1 override re-decodes the SAME bytes, it does not relax strictness)', async () => {
  const project = makeProject()
  const bytes = new Uint8Array([...enc.encode(SRT_BODY), 0x81, 0x0a])
  const failure = await captureFailure(() => importCaptions(project, { name: 'forced-cp1252.srt', bytes }, { as: 'source', encoding: 'windows-1252', scheduleYield: NO_YIELD }))
  expect(failure.code).toBe('ENCODING')
  expect(failure.detail).toBe(`byte 0x81 at offset ${SRT_BODY.length}`)
  expect(JSON.stringify([failure.message, failure.detail]), 'SECURITY-03: the offending byte never leaks as text').not.toContain('\u0081')
})
