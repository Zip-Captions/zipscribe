// Adversarial round (EMPTY/ABSENT/DEGENERATE category): near-empty and
// header-only files per format. Contract:
// `.ai-dlc/local-transcribe-engine/unit-07-caption-import.md` US-07.1 lines
// 22–23 (invariant-11 fixes counted; "a file in an unrecognized format or
// undecodable bytes … typed error — no partial project change"), FR-07.2
// (line 44, one parser per format, language metadata), FR-07.3 (line 45,
// CUE_UNMATCHED / space-join semantics), domain.md invariants 11/12
// (lines 66–67). Frozen contract: tests/unit/captions/unit07-api-contract.d.ts
// lines 239–277 (parsers) and 288–296 (import guards/atomicity).
// Nothing here duplicates the boundary round (guards/timestamps/QC/retime).
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { CaptionFailure } from '@engine/captions/contract@07'
import { canonical } from '../canonical'
import { makeProject } from '../project-support'

const enc = new TextEncoder()
const NO_YIELD = async (): Promise<void> => undefined

async function captureFailure(run: () => Promise<unknown>): Promise<CaptionFailure> {
  try {
    await run()
  } catch (error) {
    return error as CaptionFailure
  }
  throw new Error('expected a CaptionFailure, but the call resolved')
}

test('ADVERSARIAL (degenerate): a 0-byte .srt is recognized-but-empty — imports 0 blocks, no typed error required (US-07.1 line 23 reserves typed errors for unrecognized/undecodable input)', async () => {
  const project = makeProject()
  const before = canonical(project)
  const { project: result, report } = await importCaptions(project, { name: 'empty.srt', bytes: new Uint8Array(0) }, { as: 'source', scheduleYield: NO_YIELD })
  expect(report.cues).toBe(0)
  expect(report.blocks).toBe(0)
  expect(report.adjustments).toEqual([])
  expect(result.blocks).toEqual([])
  expect(result.captionOrigin, 'source import still marks the origin (FR-07.3)').toBe('imported')
  expect(canonical(project), 'input project untouched').toBe(before)
})

test('ADVERSARIAL (degenerate): BOM-only file — the BOM is consumed (FR-07.1), leaving an empty document: .srt imports 0 cues, an unknown extension is a typed UNRECOGNIZED_FORMAT with a numeric detail (SECURITY-03), .vtt is a typed failure because the WebVTT signature is normative (W3C §4.1)', async () => {
  const bomOnly = new Uint8Array([0xef, 0xbb, 0xbf])

  const srt = await importCaptions(makeProject(), { name: 'bom.srt', bytes: bomOnly }, { as: 'source', scheduleYield: NO_YIELD })
  expect(srt.report.encoding).toBe('utf-8')
  expect(srt.report.cues).toBe(0)
  expect(srt.report.blocks).toBe(0)

  const projectExt = makeProject()
  const beforeExt = canonical(projectExt)
  const noExt = await captureFailure(() => importCaptions(projectExt, { name: 'bom.dat', bytes: bomOnly }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(noExt.code).toBe('UNRECOGNIZED_FORMAT')
  expect(noExt.detail, 'numeric detail only (FR-07.6)').toBe('byteLength 0')
  expect(canonical(projectExt), 'no partial project change').toBe(beforeExt)

  const projectVtt = makeProject()
  const beforeVtt = canonical(projectVtt)
  const noSig = await captureFailure(() => importCaptions(projectVtt, { name: 'bom.vtt', bytes: bomOnly }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(noSig.code).toBe('UNRECOGNIZED_FORMAT')
  expect(noSig.line, 'line-numbered parse failure (FR-07.6)').toBe(1)
  expect(canonical(projectVtt)).toBe(beforeVtt)
})

test('ADVERSARIAL (degenerate): headers-only files parse to zero cues and report declared language — WEBVTT signature + Language:, TTML <tt> with an empty <body> and xml:lang (FR-07.2 line 44)', async () => {
  const vtt = await importCaptions(makeProject(), { name: 'headers.vtt', bytes: enc.encode('WEBVTT\nLanguage: fr\nNOTE a comment block\n') }, { as: 'source', scheduleYield: NO_YIELD })
  expect(vtt.report.format).toBe('vtt')
  expect(vtt.report.cues).toBe(0)
  expect(vtt.report.blocks).toBe(0)
  expect(vtt.report.detectedLanguage, 'declared language is metadata, not a cue (FR-07.2)').toBe('fr')
  expect(vtt.report.adjustments).toEqual([])

  const ttml = await importCaptions(makeProject(), { name: 'empty.ttml', bytes: enc.encode('<tt xml:lang="de"><head></head><body></body></tt>') }, { as: 'source', scheduleYield: NO_YIELD })
  expect(ttml.report.format).toBe('ttml')
  expect(ttml.report.cues).toBe(0)
  expect(ttml.report.detectedLanguage).toBe('de')
})

test('ADVERSARIAL (degenerate): an SRT of numbering lines only (no timestamps) is a typed UNRECOGNIZED_FORMAT naming the line (FR-07.6) — never a zero-cue success that silently replaces the track', async () => {
  const project = makeProject()
  const before = canonical(project)
  const failure = await captureFailure(() => importCaptions(project, { name: 'numbers.srt', bytes: enc.encode('1\n\n2\n\n3\n') }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(failure.code).toBe('UNRECOGNIZED_FORMAT')
  expect(failure.line, 'the first non-index line lacks a timestamp').toBe(2)
  expect(failure.detail, 'a line-numbered parse failure carries no detail text beyond codes/numbers').toBeUndefined()
  expect(canonical(project), 'no partial project change (US-07.1 line 23)').toBe(before)
})

test('ADVERSARIAL (degenerate): ASS with an [Events] section but no Dialogue lines → typed UNRECOGNIZED_FORMAT (parser contract: no cues at all is a malformed file), project untouched', async () => {
  const project = makeProject()
  const before = canonical(project)
  const body = '[Script Info]\nTitle: degenerate\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nComment: 0,00:00:00.00,00:00:01.00,Default,,0,0,0,,not a cue\n'
  const failure = await captureFailure(() => importCaptions(project, { name: 'events.ass', bytes: enc.encode(body) }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(failure.code).toBe('UNRECOGNIZED_FORMAT')
  expect(failure.line).toBe(1)
  expect(canonical(project)).toBe(before)
})

test('ADVERSARIAL (degenerate): zipscribe JSON degenerate roots — {} lacks the pinned "blocks" array and [] is a non-object root: both typed UNRECOGNIZED_FORMAT with shape messages, no cue text (FR-07.2, json parser contract d.ts:272–276)', async () => {
  const emptyObject = await captureFailure(() => importCaptions(makeProject(), { name: 'a.zipscribe.json', bytes: enc.encode('{}') }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(emptyObject.code).toBe('UNRECOGNIZED_FORMAT')
  expect(emptyObject.message, 'names the missing member, not the content').toContain('blocks')

  const emptyArray = await captureFailure(() => importCaptions(makeProject(), { name: 'b.zipscribe.json', bytes: enc.encode('[]') }, { as: 'source', scheduleYield: NO_YIELD }))
  expect(emptyArray.code).toBe('UNRECOGNIZED_FORMAT')
  expect(emptyArray.message).toContain('root')
})

test('ADVERSARIAL (degenerate): every cue empty text → EMPTY_CUE_DROPPED counts all of them, 0 blocks survive, cue count is the file count (invariant 11 line 66 "empty cues are dropped — each counted, never silent")', async () => {
  const json = '{"language":"en","blocks":[{"start":1,"end":2,"text":""},{"start":3,"end":4,"text":""},{"start":5,"end":6,"text":""}]}'
  const { project, report } = await importCaptions(makeProject(), { name: 'all-empty.zipscribe.json', bytes: enc.encode(json) }, { as: 'source', scheduleYield: NO_YIELD })
  expect(report.cues, 'the report counts what the FILE said').toBe(3)
  expect(report.blocks, 'no block survives an all-empty file (invariant 3: no empty blocks persist)').toBe(0)
  expect(project.blocks).toEqual([])
  expect(report.adjustments).toEqual([{ code: 'EMPTY_CUE_DROPPED', count: 3 }])
})

test('ADVERSARIAL (degenerate): SRT cues whose text lines are entirely absent parse to empty cues and are dropped with an EMPTY_CUE_DROPPED count', async () => {
  const body = '1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\n\n'
  const { report } = await importCaptions(makeProject(), { name: 'no-text.srt', bytes: enc.encode(body) }, { as: 'source', scheduleYield: NO_YIELD })
  expect(report.cues).toBe(2)
  expect(report.blocks).toBe(0)
  expect(report.adjustments).toEqual([{ code: 'EMPTY_CUE_DROPPED', count: 2 }])
})

test('ADVERSARIAL (degenerate): caption text of only whitespace (spaces, tab, NBSP) is empty — dropped and counted exactly like an empty cue (invariant 11)', async () => {
  const json = '{"blocks":[{"start":1,"end":2,"text":"   \\t "},{"start":3,"end":4,"text":"\\u00a0"}]}'
  const { project, report } = await importCaptions(makeProject(), { name: 'ws.zipscribe.json', bytes: enc.encode(json) }, { as: 'source', scheduleYield: NO_YIELD })
  expect(report.cues).toBe(2)
  expect(report.blocks).toBe(0)
  expect(report.adjustments).toEqual([{ code: 'EMPTY_CUE_DROPPED', count: 2 }])
  expect(project.blocks).toEqual([])
})

test('ADVERSARIAL (degenerate): translation import into a ZERO-block project — every kept cue counts CUE_UNMATCHED (max-OVERLAP requires positive overlap, so even the contained zero-duration cue matches nothing), whitespace cues count EMPTY_CUE_DROPPED not CUE_UNMATCHED, blocks untouched, track has no entries (FR-07.3 line 45)', async () => {
  const project = makeProject()
  const before = canonical(project)
  const json = '{"blocks":[{"start":1,"end":2,"text":"one"},{"start":3,"end":4,"text":"two"},{"start":5,"end":6,"text":"   "},{"start":7,"end":7,"text":"zero"}]}'
  const { project: result, report } = await importCaptions(project, { name: 'orphans.zipscribe.json', bytes: enc.encode(json) }, { as: { translation: 'es' }, scheduleYield: NO_YIELD })
  expect(report.cues).toBe(4)
  expect(report.adjustments).toEqual([
    { code: 'EMPTY_CUE_DROPPED', count: 1 },
    { code: 'CUE_UNMATCHED', count: 3 },
  ])
  expect(report.blocks, 'translation mode never changes the block count').toBe(0)
  expect(canonical(project), 'the input project object is untouched').toBe(before)
  expect(result.blocks).toEqual([])
  expect(result.translations).toHaveLength(1)
  expect(result.translations[0]!.language).toBe('es')
  expect(result.translations[0]!.origin, 'imported track (FR-07.3)').toBe('imported')
  expect(result.translations[0]!.entries, 'no entries can key a non-existent block (invariant 10)').toEqual({})
})
