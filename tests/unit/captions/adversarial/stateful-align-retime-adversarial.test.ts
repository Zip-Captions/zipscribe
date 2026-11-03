// Adversarial round (MALFORMED/STATEFUL-INTERLEAVING category): call sequences
// across modules — estimate→align→align composition, many-block alignment
// spanning blocks, retimeAll→QC recomputation, and the FR-07.7 yield seam
// throwing on its k-th call between concurrent imports. Contract: unit-07
// US-07.3 line 30 (matched words 'aligned', unmatched re-interpolated, "text
// and cue count never change"), FR-07.4 (line 46: align/retime/qc pure),
// US-07.4 line 34 (retime map), US-07.5 line 38 (QC rules) + d.ts:212-222
// (changedBlock = all().filter over changed + neighbours); domain.md:56
// invariant 1 (blocks ordered/non-overlapping, words sorted in-bounds),
// domain.md:65 invariant 10 ("Retiming a source block never marks
// translations stale"), FR-07.7 line 49 + types.ts:28-29 (yield seam "at
// least once per completed 2 000 cues"). Purity claims: import.ts:20-21,
// align.ts:112-114 ("the input project is never mutated"), retime.ts:3-6.
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import { alignCaptionsToWords } from '@engine/captions/align'
import type { AsrWordInput } from '@engine/captions/contract@07'
import { retimeAll } from '@engine/captions/retime'
import { checkCaptions, createQcChecker, sourceTextHash } from '@engine/captions/qc'
import type { Project, WordToken } from '@engine/model@07'
import { canonical, canonicalGolden } from '../canonical'
import { makeBlock, makeProject, spacedWords } from '../project-support'

const enc = new TextEncoder()
const NO_YIELD = async (): Promise<void> => undefined

const p4 = (value: number, width: number): string => String(value).padStart(width, '0')
const srtTime = (totalMs: number): string => `${p4(Math.floor(totalMs / 3_600_000), 2)}:${p4(Math.floor(totalMs / 60_000) % 60, 2)}:${p4(Math.floor(totalMs / 1_000) % 60, 2)},${p4(totalMs % 1_000, 3)}`

function srtFile(name: string, cues: { start: number; end: number; text: string }[]): { name: string; bytes: Uint8Array } {
  const body = cues.map((cue, index) => `${index + 1}\n${srtTime(Math.round(cue.start * 1000))} --> ${srtTime(Math.round(cue.end * 1000))}\n${cue.text}`).join('\n\n')
  return { name, bytes: enc.encode(body) }
}

async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run()
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the call to reject, it resolved')
}

const wordTexts = (project: Project): string[][] => project.blocks.map((block) => block.words.map((word) => word.text))

test('ADVERSARIAL (stateful): estimate+align composition is idempotent on the second pass — align(import(x)) then align again with the SAME ASR words: reports deep-equal, blocks canonically identical (exact ids and times), already-aligned words keep timing "aligned" with unchanged times, unmatched words stay "estimated", and word texts / block texts / cue count never change from import through both passes (US-07.3 line 30, d.ts:60-64)', async () => {
  const imported = await importCaptions(makeProject(), srtFile('idem.srt', [
    { start: 0, end: 1, text: 'alpha beta' },
    { start: 1, end: 2, text: 'gamma delta' },
    { start: 2, end: 3, text: 'epsilon zeta' },
  ]), { as: 'source', scheduleYield: NO_YIELD })
  const p1 = imported.project
  expect(p1.blocks.every((block) => block.words.every((word) => word.timing === 'estimated')), 'import words start estimated').toBe(true)

  const asr: AsrWordInput[] = [
    { text: 'alpha', start: 0, end: 0.4 },
    { text: 'beta', start: 0.5, end: 0.9 },
    { text: 'gamma', start: 1.05, end: 1.45 },
  ]
  const p1Snapshot = canonical(p1)
  const first = alignCaptionsToWords(p1, asr)
  const second = alignCaptionsToWords(first.project, asr)

  expect(second.report, 'second pass reports identically').toEqual(first.report)
  expect(first.report).toEqual({ wordsTotal: 6, wordsAligned: 3, alignedRatio: 0.5 })
  expect(canonical(second.project.blocks), 're-aligning an aligned project is a no-op (exact ids and times)').toBe(canonical(first.project.blocks))

  const textsBefore = wordTexts(p1)
  expect(wordTexts(first.project), 'text never changes under align').toEqual(textsBefore)
  expect(wordTexts(second.project), 'text never changes under re-align').toEqual(textsBefore)
  expect(second.project.blocks.map((block) => block.text)).toEqual(p1.blocks.map((block) => block.text))
  expect(second.project.blocks.length, 'cue count never changes').toBe(3)

  const timingsOf = (project: Project): (WordToken | undefined)[] => project.blocks.flatMap((block) => block.words)
  const t1 = timingsOf(first.project)
  const t2 = timingsOf(second.project)
  expect(t2.every((word, index) => word!.timing === t1[index]!.timing && word!.start === t1[index]!.start && word!.end === t1[index]!.end), 'aligned stay aligned with identical times; estimated stay estimated').toBe(true)
  expect(t2.filter((word) => word!.timing === 'aligned').map((word) => word!.text), 'the same three words carry the aligned flag').toEqual(['alpha', 'beta', 'gamma'])
  expect(canonical(p1), 'align never mutates its input, first or second pass').toBe(p1Snapshot)
})

test('ADVERSARIAL (stateful): align of MANY blocks with one ASR stream spanning them all — no cross-block leakage: matched words in block i take exactly their own ASR times (never a neighbour block\'s), the unmatched filler word in each block interpolates strictly inside its OWN block bounds between the in-block aligned neighbours (block-local arrays, align.ts:127-150), aligned times ascend across the whole track, and block bounds/text/ids survive (invariant 1, model.ts:30, US-07.3)', () => {
  const blocks = Array.from({ length: 8 }, (_unused, i) =>
    makeBlock(10 * i, 10 * i + 4, [
      { text: `m${i}a`, start: 10 * i + 0.2, end: 10 * i + 0.8, timing: 'estimated' as const },
      { text: `hmm${i}`, start: 10 * i + 1, end: 10 * i + 1.6, timing: 'estimated' as const },
      { text: `m${i}b`, start: 10 * i + 2, end: 10 * i + 2.8, timing: 'estimated' as const },
    ], 'SPK_MULTI', `blk-multi-${i}`),
  )
  const asr: AsrWordInput[] = Array.from({ length: 16 }, (_unused, k) => (k % 2 === 0 ? { text: `m${k / 2}a`, start: 10 * (k / 2) + 0.1, end: 10 * (k / 2) + 0.7 } : { text: `m${(k - 1) / 2}b`, start: 10 * ((k - 1) / 2) + 2.1, end: 10 * ((k - 1) / 2) + 2.9 }))
  const project = makeProject({ duration: 100, blocks, speakers: [{ id: 'SPK_MULTI', label: 'Multi', color: '#fff' }], speakerSource: 'manual' })
  const before = canonical(project)
  const skeletonsBefore = project.blocks.map((block) => [block.id, block.start, block.end, block.text])

  const { project: aligned, report } = alignCaptionsToWords(project, asr)
  expect(report).toEqual({ wordsTotal: 24, wordsAligned: 16, alignedRatio: 16 / 24 })
  expect(aligned.blocks.map((block) => [block.id, block.start, block.end, block.text]), 'bounds/text/ids untouched').toEqual(skeletonsBefore)

  const alignedTimes: number[] = []
  aligned.blocks.forEach((block, i) => {
    const [a, filler, b] = block.words
    expect([a!.start, a!.end, a!.timing], `block ${i}: first word carries ITS OWN asr time`).toEqual([10 * i + 0.1, 10 * i + 0.7, 'aligned'])
    expect([b!.start, b!.end, b!.timing], `block ${i}: last word carries ITS OWN asr time`).toEqual([10 * i + 2.1, 10 * i + 2.9, 'aligned'])
    expect([filler!.start, filler!.end, filler!.timing], `block ${i}: filler interpolates between the in-block neighbours only`).toEqual([10 * i + 0.7, 10 * i + 2.1, 'estimated'])
    expect(filler!.start, `block ${i}: filler never leaves the block (invariant 1 / model.ts:30)`).toBeGreaterThanOrEqual(block.start)
    expect(filler!.end, `block ${i}: filler never leaves the block`).toBeLessThanOrEqual(block.end)
    expect(a!.end, `block ${i}: invariant 1 word order`).toBeLessThanOrEqual(filler!.start)
    expect(filler!.end, `block ${i}: invariant 1 word order`).toBeLessThanOrEqual(b!.start)
    alignedTimes.push(a!.start, a!.end, b!.start, b!.end)
  })
  for (let index = 1; index < alignedTimes.length; index++) expect(alignedTimes[index], 'aligned times ascend globally — no ASR word matched into the wrong block').toBeGreaterThan(alignedTimes[index - 1]!)
  expect(canonical(project), 'input never mutated').toBe(before)
})

test('ADVERSARIAL (stateful): retimeAll THEN QC — gap/duration issues recompute off the new times, not cached state: the original project (1.6 s gaps, 2 s blocks) is clean, the 0.04×-scaled project gains GAP_TINY on both followers and DURATION_SHORT on every block, the incremental checker on the SCALED project (cache warmed via a first changedBlock call) equals the full pass over the same three blocks, re-timing never marks fresh translations stale (invariant 10, domain.md:65), and the original project still checks clean (no shared QC state)', () => {
  const blocks = [
    makeBlock(0, 2, spacedWords('alpha beta gamma', 0, 2), 'SPK_QC', 'blk-qc-1'),
    makeBlock(3.6, 5.6, spacedWords('delta epsilon zeta', 3.6, 5.6), 'SPK_QC', 'blk-qc-2'),
    makeBlock(7.2, 9.2, spacedWords('eta theta iota', 7.2, 9.2), 'SPK_QC', 'blk-qc-3'),
  ]
  const entries = Object.fromEntries(blocks.map((block, index) => [block.id, { text: `traduccion ${index + 1}`, status: 'edited' as const, sourceHash: sourceTextHash(block.text) }]))
  const project = makeProject({ duration: 100, fps: 25, blocks, speakers: [{ id: 'SPK_QC', label: 'QC', color: '#fff' }], speakerSource: 'manual', translations: [{ language: 'es', origin: 'imported', engine: null, entries }] })

  expect(checkCaptions(project), 'baseline clean (gaps 1.6 s ≥ 2/25 s, durations 2 s)').toEqual([])

  const retimed = retimeAll(project, { scale: 0.04 })
  const issues = checkCaptions(retimed)
  expect(issues.filter((issue) => issue.code === 'GAP_TINY').map((issue) => issue.blockId), 'GAP_TINY recomputed off the scaled times (0.064 s < 2/25 s) on both followers').toEqual(['blk-qc-2', 'blk-qc-3'])
  expect(issues.filter((issue) => issue.code === 'DURATION_SHORT').map((issue) => issue.blockId), 'DURATION_SHORT on all three (0.08 s < 0.7 s)').toEqual(['blk-qc-1', 'blk-qc-2', 'blk-qc-3'])
  expect(issues.filter((issue) => issue.code.startsWith('TRANSLATION')), 're-timing never marks translations stale (invariant 10)').toEqual([])

  const checker = createQcChecker(retimed)
  checker.changedBlock('blk-qc-1')
  const incremental = checker.changedBlock('blk-qc-2')
  const expected = checkCaptions(retimed).filter((issue) => ['blk-qc-1', 'blk-qc-2', 'blk-qc-3'].includes(issue.blockId))
  expect(incremental, 'incremental re-check equals the full pass over changed+neighbours even with a warmed cache (d.ts:212-222)').toEqual(expected)
  expect(incremental.some((issue) => issue.code === 'GAP_TINY' && issue.blockId === 'blk-qc-2'), 'the re-check is off the NEW times').toBe(true)
  expect(checkCaptions(project), 'the original project is untouched by the retime/QC sequence').toEqual([])
})

test('ADVERSARIAL (stateful): scheduleYield throwing on its k-th (2nd) call mid-parse of 4 001 cues — the import rejects with the seam error (surfaced untyped by design per the frozen adjudication on caller-injected seams), the seam was reached exactly on call 2 (past the 2 000-cue yield boundary, FR-07.7/types.ts:28), and the input project is byte-identical — no partial blocks, speakers or captionOrigin flip (US-07.1 line 23, import.ts:20-21)', async () => {
  const cues = Array.from({ length: 4_001 }, (_unused, index) => ({ start: index, end: index + 0.5, text: `word${index}` }))
  const project = makeProject({ duration: 100_000 })
  const before = canonical(project)
  let calls = 0
  const error = await captureError(() => importCaptions(project, srtFile('kth.srt', cues), { as: 'source', scheduleYield: async () => { calls += 1; if (calls === 2) throw new Error('yield-boom-2') } }))
  expect(error.message, 'the seam error surfaces').toBe('yield-boom-2')
  expect(calls, 'failed exactly on the k-th (second) call — after completing the first 2 000-cue chunk').toBe(2)
  expect(canonical(project), 'project unchanged — no partial state').toBe(before)
})

test('ADVERSARIAL (stateful): interleaved concurrent imports where ONE yield seam throws on its own k-th call — the victim (4 001 cues, seam rejects on call 2) leaves its input byte-identical while the co-running import (2 001 cues, own independent seam, 1 call) completes with EXACTLY its sequential result: per-import seam counters and all import state stay isolated between concurrent calls (FR-07.7 isolation, purity)', async () => {
  const manyCues = Array.from({ length: 4_001 }, (_unused, index) => ({ start: index, end: index + 0.5, text: `word${index}` }))
  const fewCues = Array.from({ length: 2_001 }, (_unused, index) => ({ start: index, end: index + 0.5, text: `word${index}` }))
  const victimProject = makeProject({ duration: 100_000 })
  const coProject = makeProject({ duration: 100_000 })
  const victimSnapshot = canonical(victimProject)
  const coSnapshot = canonical(coProject)

  let victimYields = 0
  let coYields = 0
  const [victim, co] = await Promise.allSettled([
    importCaptions(victimProject, srtFile('victim.srt', manyCues), { as: 'source', scheduleYield: async () => { victimYields += 1; if (victimYields === 2) throw new Error('yield-boom-2') } }),
    importCaptions(coProject, srtFile('co.srt', fewCues), { as: 'source', scheduleYield: async () => { coYields += 1 } }),
  ])

  expect(victim.status).toBe('rejected')
  expect(((victim as PromiseRejectedResult).reason as Error).message).toBe('yield-boom-2')
  expect(victimYields, 'victim failed on its own second yield').toBe(2)
  expect(co.status, 'the co-runner is unaffected by the other import\'s failing seam').toBe('fulfilled')
  expect(coYields, 'independent per-import seam counter').toBe(1)
  expect(canonical(victimProject), 'victim input unchanged').toBe(victimSnapshot)
  expect(canonical(coProject), 'co-runner input unchanged').toBe(coSnapshot)

  const sequential = await importCaptions(coProject, srtFile('co.srt', fewCues), { as: 'source', scheduleYield: NO_YIELD })
  const fulfilled = (co as PromiseFulfilledResult<{ project: Project; report: unknown }>).value
  const comparable = (project: Project): string => canonicalGolden({ ...project, speakers: project.speakers.map((speaker) => ({ label: speaker.label, color: speaker.color })) })
  expect(comparable(fulfilled.project), 'interleaved result equals the sequential result — no shared state between concurrent imports').toBe(comparable(sequential.project))
  expect(fulfilled.report, 'and the report matches').toEqual(sequential.report)
})
