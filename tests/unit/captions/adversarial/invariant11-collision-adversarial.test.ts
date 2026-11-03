// Adversarial round (EMPTY/ABSENT/DEGENERATE category): invariant-11 clamp
// counting at collision edges. Contract: domain.md line 66 (invariant 11
// "Import never violates invariants 1–4: overlapping cues are clamped
// (earlier cue ends at the later cue's start), zero/negative durations
// become 0.1 s … each counted … never silent") and line 56 (invariant 1
// "`0 ≤ word[i].start ≤ word[i].end ≤ word[i+1].start` within a block;
// blocks ordered & non-overlapping"), unit-07 US-07.1 line 22. Implementation
// under test: src/engine/captions/import.ts clampAndFix (lines 420–443) —
// a single file-order pass that clamps only each previous cue against the
// current one.
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { CaptionBlock } from '@engine/model@07'
import { makeProject } from '../project-support'

const enc = new TextEncoder()
const NO_YIELD = async (): Promise<void> => undefined

const p = (value: number, width: number): string => String(value).padStart(width, '0')
const srtTime = (totalMs: number): string => `${p(Math.floor(totalMs / 3_600_000), 2)}:${p(Math.floor(totalMs / 60_000) % 60, 2)}:${p(Math.floor(totalMs / 1_000) % 60, 2)},${p(totalMs % 1_000, 3)}`

function srt(cues: { start: number; end: number; text: string }[]): Uint8Array {
  return enc.encode(cues.map((cue, index) => `${index + 1}\n${srtTime(Math.round(cue.start * 1000))} --> ${srtTime(Math.round(cue.end * 1000))}\n${cue.text}`).join('\n\n'))
}

async function importSource(cues: { start: number; end: number; text: string }[]): Promise<{ blocks: CaptionBlock[]; adjustments: { code: string; count: number }[] }> {
  const { project, report } = await importCaptions(makeProject(), { name: 'collision.srt', bytes: srt(cues) }, { as: 'source', scheduleYield: NO_YIELD })
  return { blocks: project.blocks, adjustments: report.adjustments }
}

test('degenerate VIOLATION: equal-start cues leave blocks overlapping after clamping — invariant 11 counts the fix but the 0.1 s zero-duration repair (import.ts:426/435) re-introduces the overlap the clamp just removed (domain.md:66 "Import never violates invariants 1–4"; domain.md:56 "blocks ordered & non-overlapping")', async () => {
  const { blocks, adjustments } = await importSource([
    { start: 5, end: 7, text: 'first here' },
    { start: 5, end: 6, text: 'second here' },
  ])
  expect(blocks).toHaveLength(2)
  expect(adjustments, 'the fix is counted — "never silent" holds').toEqual([
    { code: 'OVERLAP_CLAMPED', count: 1 },
    { code: 'ZERO_DURATION_FIXED', count: 1 },
  ])
  // The counting is honest; the RESULT is not: cue 1 is clamped to end 5,
  // then the zero-duration rule pushes it to 5.1 — past cue 2's start.
  for (let index = 1; index < blocks.length; index++) {
    expect(blocks[index - 1]!.end, 'invariant 1: previous block must not pass the next block start').toBeLessThanOrEqual(blocks[index]!.start)
  }
})

test('degenerate VIOLATION: a zero-duration cue followed by an equal-start cue — the 0.1 s fix and the overlap clamp fight and the overlap wins (domain.md:56/66 invariants 1/11)', async () => {
  const { blocks, adjustments } = await importSource([
    { start: 5, end: 5, text: 'zero one' },
    { start: 5, end: 6, text: 'after one' },
  ])
  expect(blocks).toHaveLength(2)
  expect(adjustments, 'both fixes are counted').toEqual([
    { code: 'OVERLAP_CLAMPED', count: 1 },
    { code: 'ZERO_DURATION_FIXED', count: 2 },
  ])
  for (let index = 1; index < blocks.length; index++) {
    expect(blocks[index - 1]!.end, 'invariant 1: no residual overlap after import').toBeLessThanOrEqual(blocks[index]!.start)
  }
})

test('degenerate VIOLATION: an out-of-order cue file (later cue listed first) ends with blocks neither ordered nor non-overlapping — the file-order clamp pushes the earlier-listed cue to the later cue start and the zero-duration fix then re-overlaps it; import preserves file segmentation (invariant 12) but never sorts (domain.md:56 "blocks ordered & non-overlapping", domain.md:66 "Import never violates invariants 1–4")', async () => {
  const { blocks, adjustments } = await importSource([
    { start: 5, end: 6, text: 'later one' },
    { start: 0, end: 10, text: 'wide two' },
  ])
  expect(blocks).toHaveLength(2)
  expect(adjustments, 'the clamp pass ran and counted').toEqual([
    { code: 'OVERLAP_CLAMPED', count: 1 },
    { code: 'ZERO_DURATION_FIXED', count: 1 },
  ])
  expect(blocks[0]!.start, 'invariant 1: blocks ordered').toBeLessThanOrEqual(blocks[1]!.start)
  expect(blocks[0]!.end, 'invariant 1: blocks non-overlapping').toBeLessThanOrEqual(blocks[1]!.start)
})

test('ADVERSARIAL (degenerate): fully nested cues are clamped in order — every clamp counted (OVERLAP_CLAMPED), none silent, and the resulting blocks are ordered and non-overlapping (invariants 1 + 11)', async () => {
  const { blocks, adjustments } = await importSource([
    { start: 0, end: 10, text: 'wide one' },
    { start: 2, end: 4, text: 'mid two' },
    { start: 3, end: 5, text: 'three here' },
  ])
  expect(blocks).toHaveLength(3)
  expect(adjustments).toEqual([{ code: 'OVERLAP_CLAMPED', count: 2 }])
  expect(blocks.map((block) => [block.start, block.end])).toEqual([[0, 2], [2, 3], [3, 5]])
})

test('ADVERSARIAL (degenerate): a lone zero-duration and a lone negative-duration cue each become exactly 0.1 s and count ONE ZERO_DURATION_FIXED (invariant 11; 3-decimal rule per the import.test.ts:85 adjudication)', async () => {
  const zero = await importSource([{ start: 5, end: 5, text: 'only one' }])
  expect(zero.adjustments).toEqual([{ code: 'ZERO_DURATION_FIXED', count: 1 }])
  expect(zero.blocks[0]!.end - zero.blocks[0]!.start).toBeCloseTo(0.1, 3)

  const negative = await importSource([{ start: 5, end: 4, text: 'back one' }])
  expect(negative.adjustments).toEqual([{ code: 'ZERO_DURATION_FIXED', count: 1 }])
  expect(negative.blocks[0]!.end - negative.blocks[0]!.start).toBeCloseTo(0.1, 3)
})
