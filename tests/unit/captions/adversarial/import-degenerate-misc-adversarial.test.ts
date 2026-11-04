// Adversarial round (EMPTY/ABSENT/DEGENERATE category): malformed zipscribe
// JSON wire variants, negative times, double-import idempotence and the
// async-seam atomicity of `importCaptions`. Contract: unit-07 US-07.1 line 23
// (typed error, no partial project change), FR-07.2 (line 44), FR-07.7
// (line 49, yield seam every 2 000 cues), json parser contract d.ts:272–276
// (shape violations are UNRECOGNIZED_FORMAT, never a raw SyntaxError),
// domain.md line 56 (invariant 1 `0 ≤ word[i].start …`) and line 66
// (invariant 11 "Import never violates invariants 1–4").
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { CaptionFailure } from '@engine/captions/contract@07'
import { canonical, canonicalGolden } from '../canonical'
import { makeProject } from '../project-support'

const enc = new TextEncoder()
const NO_YIELD = async (): Promise<void> => undefined
const p = (value: number, width: number): string => String(value).padStart(width, '0')
const srtTime = (totalMs: number): string => `${p(Math.floor(totalMs / 3_600_000), 2)}:${p(Math.floor(totalMs / 60_000) % 60, 2)}:${p(Math.floor(totalMs / 1_000) % 60, 2)},${p(totalMs % 1_000, 3)}`

async function captureFailure(run: () => Promise<unknown>): Promise<CaptionFailure> {
  try {
    await run()
  } catch (error) {
    return error as CaptionFailure
  }
  throw new Error('expected a CaptionFailure, but the call resolved')
}

test('ADVERSARIAL (degenerate): malformed zipscribe wire text — a NaN literal is not JSON (typed "not valid JSON", never a raw SyntaxError leak) and 1e999 (Infinity) is rejected as non-finite; both carry codes/numbers only (d.ts:272–276, FR-07.6)', async () => {
  const nanLiteral = await captureFailure(() => importCaptions(makeProject(), { name: 'nan.zipscribe.json', bytes: enc.encode('{"blocks":[{"start":NaN,"end":2,"text":"x"}]}') }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(nanLiteral.name, 'the structured CaptionFailure, not SyntaxError').toBe('CaptionFailure')
  expect(nanLiteral.code).toBe('UNRECOGNIZED_FORMAT')
  expect(nanLiteral.message).toBe('zipscribe-json is not valid JSON')

  const infinity = await captureFailure(() => importCaptions(makeProject(), { name: 'inf.zipscribe.json', bytes: enc.encode('{"blocks":[{"start":0,"end":1e999,"text":"x"}]}') }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(infinity.code).toBe('UNRECOGNIZED_FORMAT')
  expect(infinity.message).toContain('blocks[0]')
})

test('ADVERSARIAL (degenerate): zipscribe words:[ ] variants — a block carrying ONLY words (no start/end/text) violates the pinned cue shape → typed UNRECOGNIZED_FORMAT; an extra words member beside valid times is ignored and the words stay cue-derived-estimated (ParsedCue carries no word times, d.ts:273)', async () => {
  const wordsOnly = await captureFailure(() => importCaptions(makeProject(), { name: 'wo.zipscribe.json', bytes: enc.encode('{"blocks":[{"words":[]}]}') }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(wordsOnly.code).toBe('UNRECOGNIZED_FORMAT')
  expect(wordsOnly.message).toContain('blocks[0]')

  const { project, report } = await importCaptions(makeProject(), { name: 'we.zipscribe.json', bytes: enc.encode('{"blocks":[{"start":0,"end":1,"text":"hi there","words":[]}]}') }, { as: 'source', scheduleYield: NO_YIELD })
  expect(report.cues).toBe(1)
  expect(report.blocks).toBe(1)
  const words = project.blocks[0]!.words
  expect(words.map((word) => word.text)).toEqual(['hi', 'there'])
  expect(words.every((word) => word.timing === 'estimated'), 'estimated from the cue, not the empty words array').toBe(true)
})

test('degenerate VIOLATION: zipscribe JSON negative times import unguarded — blocks and words carry negative starts (domain.md:56 invariant 1 "0 ≤ word[i].start"; domain.md:66 invariant 11 "Import never violates invariants 1–4"; parse/json.ts:24 checks only Number.isFinite, so −5 sails through while the SRT/VTT/ASS/SBV grammars cannot even express a minus sign — the sidecar is the only format that admits negative times)', async () => {
  const project = makeProject()
  const { project: result, report } = await importCaptions(project, { name: 'neg.zipscribe.json', bytes: enc.encode('{"blocks":[{"start":-5,"end":-4,"text":"neg one"},{"start":-2,"end":-1,"text":"neg two"}]}') }, { as: 'source', scheduleYield: NO_YIELD })
  expect(report.blocks, 'the import itself is silent about it').toBe(2)
  for (const block of result.blocks) {
    expect(block.start, `block at ${block.start} violates 0 ≤ times`).toBeGreaterThanOrEqual(0)
    for (const word of block.words) {
      expect(word.start, `word "${word.text}" at ${word.start} violates invariant 1 (0 ≤ word[i].start)`).toBeGreaterThanOrEqual(0)
    }
  }
})

test('ADVERSARIAL (degenerate): importing the same file twice from the same project is idempotent — identical reports, canonical-identical projects (ids normalized positionally), and a chained re-import over the first result is stable (invariant 12 keeps segmentation deterministic)', async () => {
  const body = [
    { start: 0, end: 1, text: 'alpha one' },
    { start: 1, end: 2, text: 'beta two' },
    { start: 4, end: 5, text: 'gamma three' },
  ]
  const bytes = enc.encode(body.map((cue, index) => `${index + 1}\n${srtTime(cue.start * 1000)} --> ${srtTime(cue.end * 1000)}\n${cue.text}`).join('\n\n'))
  const base = makeProject()
  const first = await importCaptions(base, { name: 'twice.srt', bytes }, { as: 'source', scheduleYield: NO_YIELD })
  const second = await importCaptions(base, { name: 'twice.srt', bytes }, { as: 'source', scheduleYield: NO_YIELD })
  // Random crypto.randomUUID() ids are normalized positionally by the golden
  // canonicalizer over blocks/speakerId references (d.ts:38–40); the speaker
  // list is compared structurally (labels/colors/count), not by raw id.
  const comparable = (outcome: { project: { blocks: unknown[]; speakers: { label: string; color: string }[] }; report: unknown }): string => canonicalGolden({ blocks: outcome.project.blocks, speakers: outcome.project.speakers.map((speaker) => ({ label: speaker.label, color: speaker.color })), report: outcome.report })
  expect(second.report, 'report idempotent').toEqual(first.report)
  expect(comparable(second), 'project idempotent (ids normalized)').toBe(comparable(first))
  const chained = await importCaptions(first.project, { name: 'twice.srt', bytes }, { as: 'source', scheduleYield: NO_YIELD })
  expect(chained.report, 're-importing over the first result changes nothing').toEqual(first.report)
  expect(comparable(chained)).toBe(comparable(first))
})

test('ADVERSARIAL (degenerate): scheduleYield throwing mid-parse (2 001 cues — the seam fires at the 2 000-cue boundary) rejects the import and leaves the input project byte-identical — no partial blocks, no half-applied mapping (US-07.1 line 23 atomicity; FR-07.7 seam). The caller seam is an injected effect, so its own error propagates untyped by design — the contract only pins the shape of CAPTION failures (d.ts:116–129)', async () => {
  const cues = Array.from({ length: 2_001 }, (_, index) => `${index + 1}\n${srtTime(index * 1000)} --> ${srtTime(index * 1000 + 500)}\nword${index}`).join('\n\n')
  const project = makeProject({ duration: 100_000 })
  const before = canonical(project)
  let yields = 0
  const error = await captureFailure(() => importCaptions(project, { name: 'boom.srt', bytes: enc.encode(cues) }, { as: 'source', scheduleYield: () => { yields += 1; return Promise.reject(new Error('yield-boom')) } }))
  expect((error as unknown as Error).message, 'the seam error surfaces').toBe('yield-boom')
  expect(yields, 'the failure happened AFTER at least one yield — mid-parse, not pre-flight').toBeGreaterThanOrEqual(1)
  expect(canonical(project), 'project unchanged — import is atomic (US-07.1)').toBe(before)
})

test('ADVERSARIAL (degenerate): the injected LanguageDetector seam rejecting mid-import rejects the whole import and leaves the project byte-identical — detection happens before any block is handed back (US-07.2 seam; US-07.1 no-partial-change)', async () => {
  const project = makeProject()
  const before = canonical(project)
  const body = '1\n00:00:01,000 --> 00:00:02,000\nhello there friend\n'
  const error = await captureFailure(() => importCaptions(project, { name: 'det.srt', bytes: enc.encode(body) }, { as: 'source', scheduleYield: NO_YIELD, detectLanguage: () => Promise.reject(new Error('detector-boom')) }))
  expect((error as unknown as Error).message).toBe('detector-boom')
  expect(canonical(project), 'project unchanged').toBe(before)
})
