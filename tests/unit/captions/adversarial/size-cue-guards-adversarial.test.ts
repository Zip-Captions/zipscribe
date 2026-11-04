// Adversarial round (boundary-value category): the FR-07.7 guards at the exact
// edges — `.ai-dlc/local-transcribe-engine/unit-07-caption-import.md` line 49:
// "files > 20 MB or > 100 000 cues are rejected" (frozen contract
// tests/unit/captions/unit07-api-contract.d.ts line 294, import.ts line 19:
// 20 MiB / 100 000, checked > not >=). Exactly at the limit must pass, +1 must
// throw the typed code, and the input project object must be untouched
// (US-07.1 line 23: "no partial project change"). SECURITY-03 (FR-07.6 line
// 48): failure messages/details carry codes and numbers only.
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { CaptionFailure } from '@engine/captions/contract@07'
import { canonical } from '../canonical'
import { makeProject } from '../project-support'

const TWENTY_MIB = 20 * 1024 * 1024
const MAX_CUES = 100_000
const NO_YIELD = { scheduleYield: async () => {} }

function srtTime(totalMs: number): string {
  const h = Math.floor(totalMs / 3_600_000)
  const m = Math.floor(totalMs / 60_000) % 60
  const s = Math.floor(totalMs / 1_000) % 60
  const ms = totalMs % 1_000
  const p = (value: number, width: number): string => String(value).padStart(width, '0')
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(ms, 3)}`
}

/** `count` non-overlapping SRT cues, each occupying [i, i+0.5] seconds. */
function srtWithCues(count: number): string {
  const chunk: string[] = []
  for (let index = 0; index < count; index += 1) {
    const start = index * 1_000
    chunk.push(`${index + 1}\n${srtTime(start)} --> ${srtTime(start + 500)}\nword${index % 100}`)
  }
  return chunk.join('\n\n')
}

async function captureFailure(run: () => Promise<unknown>): Promise<CaptionFailure> {
  try {
    await run()
  } catch (error) {
    return error as CaptionFailure
  }
  throw new Error('expected a CaptionFailure, but the call resolved')
}

test('FR-07.7 boundary: exactly 100 000 cues imports (report.cues/blocks = 100 000), the +100 001st throws TOO_MANY_CUES with the input project untouched', async () => {
  const at = makeProject()
  const atSnapshot = canonical(at)
  const outcome = await importCaptions(at, { name: 'at-limit.srt', bytes: new TextEncoder().encode(srtWithCues(MAX_CUES)) }, { as: 'source', scheduleYield: NO_YIELD.scheduleYield })
  expect(outcome.report.cues, 'exactly 100 000 is not more than 100 000').toBe(MAX_CUES)
  expect(outcome.report.blocks).toBe(MAX_CUES)
  expect(canonical(at), 'input project object untouched on the accepted side too').toBe(atSnapshot)

  const over = makeProject()
  const overSnapshot = canonical(over)
  const failure = await captureFailure(() => importCaptions(over, { name: 'over.srt', bytes: new TextEncoder().encode(srtWithCues(MAX_CUES + 1)) }, { as: 'source', scheduleYield: NO_YIELD.scheduleYield }))
  expect(failure.code).toBe('TOO_MANY_CUES')
  expect(failure.detail, 'detail carries the count, never cue text').toBe(`cues ${MAX_CUES + 1}`)
  expect(`${failure.message}${failure.detail ?? ''}`, 'SECURITY-03: no cue text').not.toContain('word')
  expect(canonical(over), 'no partial project change (US-07.1)').toBe(overSnapshot)
}, 120_000)

test('FR-07.7 boundary: exactly 20 MiB (20 971 520 bytes) imports; 20 MiB + 1 byte throws FILE_TOO_LARGE before any cue processing', async () => {
  const header = '1\n00:00:00,000 --> 00:00:01,000\n'
  const tail = '\n'
  const buildFile = (padLength: number): Uint8Array => new TextEncoder().encode(`${header}${'Z'.repeat(padLength)}${tail}`)

  const at = makeProject()
  const atBytes = buildFile(TWENTY_MIB - header.length - tail.length)
  expect(atBytes.byteLength, 'fixture is exactly 20 MiB').toBe(TWENTY_MIB)
  const outcome = await importCaptions(at, { name: 'at-20mib.srt', bytes: atBytes }, { as: 'source', scheduleYield: NO_YIELD.scheduleYield })
  expect(outcome.report.cues, 'exactly 20 MiB is not more than 20 MiB').toBe(1)
  expect(outcome.project.blocks).toHaveLength(1)

  const over = makeProject()
  const overBytes = buildFile(TWENTY_MIB - header.length - tail.length + 1)
  expect(overBytes.byteLength).toBe(TWENTY_MIB + 1)
  const failure = await captureFailure(() => importCaptions(over, { name: 'over-20mib.srt', bytes: overBytes }, { as: 'source', scheduleYield: NO_YIELD.scheduleYield }))
  expect(failure.code).toBe('FILE_TOO_LARGE')
  expect(failure.detail, 'detail carries the byte count only').toBe(`byteLength ${TWENTY_MIB + 1}`)
  expect(`${failure.message}${failure.detail ?? ''}`, 'SECURITY-03: no cue text').not.toContain('ZZZZ')
}, 120_000)
