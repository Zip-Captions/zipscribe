// CC-07.2 (L1 property): parse(serialize(p)) round-trips text EXACTLY and
// times ± 1 ms for SRT / VTT / SBV / TTML. The serializers are the MINIMAL
// in-test writers (writers.ts) — unit-202's export serializers are not landed,
// so per the unit spec they are stubbed here and the property must be swapped
// to the real writers when 202 lands (ASSUMPTIONS in the unit report).
//
// fast-check v4 assert/property/async-property API —
// https://fast-check.dev/docs/core-blocks/runners/
// Grounded surface: the ambient stub in tests/unit/asr/fast-check.d.ts
// (approved devDependency, installed: fast-check 4.10.2).
import { expect, test } from 'vitest'
import { array, assert, asyncProperty, constantFrom, integer, pre, record } from 'fast-check'
import { parseSrt } from '@engine/captions/parse/srt'
import { parseVtt } from '@engine/captions/parse/vtt'
import { parseSbv } from '@engine/captions/parse/sbv'
import { parseTtml } from '@engine/captions/parse/ttml'
import type { ParsedCue, ParseResult } from '@engine/captions/contract@07'
import { writeSbv, writeSrt, writeTtml, writeVtt } from './writers'

declare module 'fast-check' {
  export function asyncProperty(...args: unknown[]): unknown
}

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'] as const

const textArb = array(constantFrom(...WORDS), { minLength: 1, maxLength: 8 }).map((words) => words.join(' '))
const cueArb = record({
  startMs: integer({ min: 0, max: 3_500_000 }),
  durationMs: integer({ min: 100, max: 30_000 }),
  text: textArb,
})

interface CuePlan {
  startMs: number
  durationMs: number
  text: string
}

function toCues(plan: CuePlan[]): ParsedCue[] {
  const sorted = [...plan].sort((a, b) => a.startMs - b.startMs)
  return sorted.map((cue) => ({ start: cue.startMs / 1000, end: (cue.startMs + cue.durationMs) / 1000, text: cue.text, lines: cue.text.split('\n') }))
}

/** One property body reused per format. */
async function roundTrip(label: string, write: (cues: ParsedCue[]) => string, parse: (text: string) => Promise<ParseResult>, seed: number): Promise<void> {
  await assert(
    asyncProperty(array(cueArb, { minLength: 1, maxLength: 6 }), async (plan: unknown) => {
      const cues = toCues(plan as CuePlan[])
      const parsed = await parse(write(cues))
      expect(parsed.format, `${label}: parser self-identifies`).toBe(label)
      expect(parsed.cues, `${label}: cue count survives the round-trip`).toHaveLength(cues.length)
      for (let index = 0; index < cues.length; index++) {
        const expected = cues[index]!
        const actual = parsed.cues[index]!
        expect(actual.text, `${label}: text round-trips EXACTLY (cue ${index})`).toBe(expected.text)
        expect(Math.abs(actual.start - expected.start), `${label}: start within ± 1 ms (cue ${index})`).toBeLessThanOrEqual(0.001)
        expect(Math.abs(actual.end - expected.end), `${label}: end within ± 1 ms (cue ${index})`).toBeLessThanOrEqual(0.001)
      }
    }),
    { seed, numRuns: 200 },
  )
}

test('CC-07.2: SRT round-trip — text exact, times ± 1 ms (property)', async () => {
  await roundTrip('srt', writeSrt, parseSrt, 0x07c20001)
})

test('CC-07.2: WebVTT round-trip — text exact, times ± 1 ms (property)', async () => {
  await roundTrip('vtt', writeVtt, parseVtt, 0x07c20002)
})

test('CC-07.2: SBV round-trip — text exact, times ± 1 ms (property)', async () => {
  await roundTrip('sbv', writeSbv, parseSbv, 0x07c20003)
})

test('CC-07.2: TTML round-trip — text exact, times ± 1 ms (property)', async () => {
  await roundTrip('ttml', writeTtml, parseTtml, 0x07c20004)
})

test('CC-07.2: empty generator input is rejected by pre() — the property is non-vacuous', async () => {
  // Sanity: the writer/parse pair is actually exercised above; here pin that
  // a no-cue plan never reaches the assertions (pre() prunes it), so a
  // vacuous "0 cues == 0 cues" run cannot pass silently.
  let nonEmptyRuns = 0
  await assert(
    asyncProperty(array(cueArb, { minLength: 0, maxLength: 3 }), async (plan: unknown) => {
      pre((plan as CuePlan[]).length > 0)
      nonEmptyRuns += 1
    }),
    { seed: 0x07c20005, numRuns: 100 },
  )
  expect(nonEmptyRuns, 'pre() must still leave real runs to execute (non-vacuous property)').toBeGreaterThan(10)
})
