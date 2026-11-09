// Adversarial round (boundary-value category): QC thresholds exactly at the
// US-07.5 values — unit-07 line 38: "reading speed > 20 CPS, line > 42 chars,
// > maxLinesPerBlock lines, duration < 0.7 s / > 7 s, gap < 2 frames, block
// outside media duration" — all default AND via settings overrides. Strict
// comparisons: the threshold value itself must be CLEAN, ±0.001/±1 char on the
// flagging side must fire. Frozen contract pins (unit07-api-contract.d.ts
// lines 189-205): GAP_TINY fires only for non-negative gaps < frames/fps;
// fps 'asset' = asset.fps > 0 ? asset.fps : 25.
import { describe, expect, test } from 'vitest'
import { checkCaptions } from '@engine/captions/qc'
import type { QcIssue, QcIssueCode } from '@engine/captions/contract@07'
import type { CaptionBlock, WordToken } from '@engine/model@07'
import { makeBlock, makeProject } from '../project-support'
import type { ProjectOverrides } from '../project-support'

function blockWithText(start: number, end: number, text: string, id: string): CaptionBlock {
  const pieces = text.split(/(\s+)/).filter((piece) => piece.length > 0)
  const tokens = pieces.filter((piece) => !/^\s/.test(piece))
  const separators = pieces.filter((piece) => /^\s/.test(piece))
  const step = tokens.length > 0 ? (end - start) / tokens.length : 0
  const words: WordToken[] = tokens.map((token, index) => ({ text: token, start: start + index * step, end: start + (index + 1) * step, timing: 'asr', ...(separators[index]?.includes('\n') ? { breakAfter: true } : {}) }))
  return makeBlock(start, end, words, 'SPK_1', id)
}

function codes(issues: QcIssue[]): QcIssueCode[] {
  return issues.map((issue) => issue.code)
}

function projectWith(blocks: CaptionBlock[], overrides: ProjectOverrides = {}) {
  return makeProject({ blocks, speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }], ...overrides })
}

describe('QC threshold boundaries at the US-07.5 defaults', () => {
  test('CPS: exactly 20 is clean, the next 3-decimal step above 20 fires', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 1, 'a'.repeat(20), 'b')])))).not.toContain('CPS_HIGH')
    expect(codes(checkCaptions(projectWith([blockWithText(0, 2, 'a'.repeat(40), 'b')])))).not.toContain('CPS_HIGH')
    const hot = checkCaptions(projectWith([blockWithText(0, 0.999, 'a'.repeat(20), 'b')]))
    const issue = hot.find((i) => i.code === 'CPS_HIGH')
    expect(issue, '20 chars / 0.999 s = 20.020 CPS > 20').toBeDefined()
    expect(issue!.value).toBeCloseTo(20.02, 3)
  })

  test('duration: exactly 0.7 s and exactly 7.0 s are clean; 0.699 / 7.001 fire', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 0.7, 'a', 'b')])))).not.toContain('DURATION_SHORT')
    const short = checkCaptions(projectWith([blockWithText(0, 0.699, 'a', 'b')]))
    expect(short.find((i) => i.code === 'DURATION_SHORT')?.value).toBeCloseTo(0.699, 3)
    expect(codes(checkCaptions(projectWith([blockWithText(0, 7, 'a', 'b')])))).not.toContain('DURATION_LONG')
    const long = checkCaptions(projectWith([blockWithText(0, 7.001, 'a', 'b')]))
    expect(long.find((i) => i.code === 'DURATION_LONG')?.value).toBeCloseTo(7.001, 3)
  })

  test('line length: exactly 42 is clean, 43 fires with the measured length (code-point semantics)', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 3, 'x'.repeat(42), 'b')])))).not.toContain('LINE_TOO_LONG')
    const long = checkCaptions(projectWith([blockWithText(0, 3, 'x'.repeat(43), 'b')]))
    expect(long.find((i) => i.code === 'LINE_TOO_LONG')?.value).toBe(43)

    const twentyOneEmoji = '😀'.repeat(21) // 21 code points, 42 UTF-16 units
    expect(codes(checkCaptions(projectWith([blockWithText(0, 3, twentyOneEmoji, 'b')]))), '42 UTF-16 units but 21 chars: clean under the code-point rule (estimate rule uses codePointCount)').not.toContain('LINE_TOO_LONG')
    const over = checkCaptions(projectWith([blockWithText(0, 3, '😀'.repeat(43), 'b')]))
    expect(over.find((i) => i.code === 'LINE_TOO_LONG')?.value, 'value counts code points').toBe(43)
  })

  test('lines per block: exactly style.maxLinesPerBlock is clean, +1 fires with the line count', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 1, 'aa\nbb', 'b')])))).not.toContain('TOO_MANY_LINES')
    const many = checkCaptions(projectWith([blockWithText(0, 1, 'aa\nbb\ncc', 'b')]))
    expect(many.find((i) => i.code === 'TOO_MANY_LINES')?.value).toBe(3)
  })

  test('gap at 25 fps default: exactly 2 frames (0.080 s) is clean; below fires; 0 fires; negative (overlap) never fires', () => {
    const pair = (gap: number) => projectWith([blockWithText(0, 1, 'a', 'prev'), blockWithText(1 + gap, 2 + gap, 'b', 'next')], { fps: 25, duration: 100 })
    expect(codes(checkCaptions(pair(0.08))), 'exactly 2 frames is not under 2 frames').not.toContain('GAP_TINY')
    expect(codes(checkCaptions(pair(0.079)))).toContain('GAP_TINY')
    expect(checkCaptions(pair(0.079)).find((i) => i.code === 'GAP_TINY')?.value).toBeCloseTo(0.079, 3)
    expect(codes(checkCaptions(pair(0))), 'a 0 gap is non-negative and under 2 frames').toContain('GAP_TINY')
    expect(codes(checkCaptions(pair(-0.001))), 'overlap is not a gap').not.toContain('GAP_TINY')
  })

  test('gap boundary at other exact frame counts: minGapFrames 4 (0.160 s) and fps 12.5 (2 frames = 0.160 s) — exactly at the threshold must be clean', () => {
    // Contract (unit07-api-contract.d.ts line 203): GAP_TINY fires ONLY for
    // gaps < minGapFrames / fps. 1.160 − 1.000 = exactly 0.160 in domain
    // invariant 6 decimals; float subtraction must not cross the threshold.
    const fourFrames = projectWith([blockWithText(0, 1, 'a', 'prev'), blockWithText(1.16, 2.16, 'b', 'next')], { fps: 25 })
    expect(codes(checkCaptions(fourFrames, { minGapFrames: 4 })), 'gap exactly 4/25 s is not < 4/25 s').not.toContain('GAP_TINY')
    const twelveAndHalf = projectWith([blockWithText(0, 1, 'a', 'prev'), blockWithText(1.16, 2.16, 'b', 'next')], { fps: 12.5 })
    expect(codes(checkCaptions(twelveAndHalf, { fps: 12.5 })), 'gap exactly 2/12.5 s is not < 2/12.5 s').not.toContain('GAP_TINY')
  })

  test('out of media: end exactly at asset.duration is clean, +0.001 fires with the overflow', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(4, 5, 'a', 'b')], { duration: 5 })))).not.toContain('OUT_OF_MEDIA')
    const out = checkCaptions(projectWith([blockWithText(4.5, 5.001, 'a', 'b')], { duration: 5 }))
    expect(out.find((i) => i.code === 'OUT_OF_MEDIA')?.value).toBeCloseTo(0.001, 3)
  })
})

describe('QC threshold boundaries via settings overrides', () => {
  test('cpsMax override: exactly the new threshold is clean', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 2, 'a'.repeat(60), 'b')]), { cpsMax: 30 }))).not.toContain('CPS_HIGH')
    expect(checkCaptions(projectWith([blockWithText(0, 2, 'a'.repeat(61), 'b')]), { cpsMax: 30 }).find((i) => i.code === 'CPS_HIGH')?.value).toBeCloseTo(30.5, 3)
  })

  test('duration overrides: exactly the new bounds are clean, ±0.001 fires', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 2, 'a', 'b')]), { minDurationSec: 2 }))).not.toContain('DURATION_SHORT')
    expect(codes(checkCaptions(projectWith([blockWithText(0, 1.999, 'a', 'b')]), { minDurationSec: 2 }))).toContain('DURATION_SHORT')
    expect(codes(checkCaptions(projectWith([blockWithText(0, 1, 'a', 'b')]), { maxDurationSec: 1 }))).not.toContain('DURATION_LONG')
    expect(codes(checkCaptions(projectWith([blockWithText(0, 1.001, 'a', 'b')]), { maxDurationSec: 1 }))).toContain('DURATION_LONG')
  })

  test('lineCharsMax override: exactly the new limit is clean, +1 fires', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 3, 'x'.repeat(10), 'b')]), { lineCharsMax: 10 }))).not.toContain('LINE_TOO_LONG')
    expect(checkCaptions(projectWith([blockWithText(0, 3, 'x'.repeat(11), 'b')]), { lineCharsMax: 10 }).find((i) => i.code === 'LINE_TOO_LONG')?.value).toBe(11)
  })

  test('maxLinesPerBlock override: exactly the override is clean, +1 fires', () => {
    expect(codes(checkCaptions(projectWith([blockWithText(0, 1, 'aa\nbb', 'b')]), { maxLinesPerBlock: 2 }))).not.toContain('TOO_MANY_LINES')
    expect(codes(checkCaptions(projectWith([blockWithText(0, 1, 'aa\nbb', 'b')]), { maxLinesPerBlock: 1 }))).toContain('TOO_MANY_LINES')
  })

  test('gap overrides: minGapFrames 0 silences, checkGaps false silences, fps override 24 re-places the boundary between 0.083 and 0.084', () => {
    const pair = (gap: number, fps?: number) => projectWith([blockWithText(0, 1, 'a', 'prev'), blockWithText(1 + gap, 2 + gap, 'b', 'next')], { fps: fps ?? 25 })
    expect(codes(checkCaptions(pair(0), { minGapFrames: 0 })), '0 frames: no gap can be under 0 frames').not.toContain('GAP_TINY')
    expect(codes(checkCaptions(pair(0), { checkGaps: false }))).not.toContain('GAP_TINY')
    expect(codes(checkCaptions(pair(0.083), { fps: 24 })), '0.083 s < 2/24 s = 0.0833 s').toContain('GAP_TINY')
    expect(codes(checkCaptions(pair(0.084), { fps: 24 })), '0.084 s > 2/24 s').not.toContain('GAP_TINY')
  })

  test('fps asset fallback: asset.fps 0 and negative fall back to 25 (threshold 0.080 s)', () => {
    for (const fps of [0, -25]) {
      const pair = (gap: number) => projectWith([blockWithText(0, 1, 'a', 'prev'), blockWithText(1 + gap, 2 + gap, 'b', 'next')], { fps })
      expect(codes(checkCaptions(pair(0.079))), `asset.fps ${fps}: threshold is 2/25 s`).toContain('GAP_TINY')
      expect(codes(checkCaptions(pair(0.08))), `asset.fps ${fps}: exactly 2 frames at the 25 fps fallback is clean`).not.toContain('GAP_TINY')
    }
  })
})
