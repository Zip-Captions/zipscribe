// Adversarial round (boundary-value category): retimeAll / solveRetime at the
// degenerate map edges — unit-07 US-07.4 (lines 33-36): the map is
// `t → anchor + (t − anchor) × scale + offset`, clamped to media duration; the
// frozen contract (unit07-api-contract.d.ts lines 334-352) types scale as
// plain number and throws TypeError only for the degenerate fromA === fromB
// solve. Domain invariant 1 (knowledge/domain.md: `0 ≤ word[i].start ≤
// word[i].end ≤ word[i+1].start` within a block; blocks ordered) and
// invariant 6 (3-decimal times) are global — retime.ts lines 30-34 claim the
// map "is monotone, so clamping keeps start ≤ end and word order".
import { describe, expect, test } from 'vitest'
import { retimeAll, solveRetime } from '@engine/captions/retime'
import type { Project, WordToken } from '@engine/model@07'
import { makeBlock, makeProject } from '../project-support'

function words(...pairs: [number, number][]): WordToken[] {
  return pairs.map(([start, end], index) => ({ text: `w${index}`, start, end, timing: 'asr' as const }))
}

function project(): Project {
  return makeProject({
    duration: 100,
    blocks: [
      makeBlock(10, 12, words([10, 10.8], [10.8, 12]), 'SPK_1', 'blk-a'),
      makeBlock(20, 21, words([20, 20.5], [20.5, 21]), 'SPK_1', 'blk-b'),
    ],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
  })
}

function assertInvariant1(result: Project): void {
  for (const block of result.blocks) {
    expect(block.start, `block ${block.id}: start ≤ end (domain invariant 1)`).toBeLessThanOrEqual(block.end)
    expect(block.start).toBeGreaterThanOrEqual(0)
    expect(block.end).toBeLessThanOrEqual(result.asset.duration)
    for (const word of block.words) {
      expect(word.start, `word ${word.text}: start ≤ end (domain invariant 1)`).toBeLessThanOrEqual(word.end)
    }
    for (let index = 1; index < block.words.length; index += 1) {
      expect(block.words[index]!.start, `word order preserved (domain invariant 1)`).toBeGreaterThanOrEqual(block.words[index - 1]!.end)
    }
  }
}

describe('retimeAll scale/anchor edges that keep the map monotone (survived)', () => {
  test('scale 0 collapses every time onto anchor + offset, clamped — degenerate but invariant-1 legal (start == end)', () => {
    const result = retimeAll(project(), { scale: 0, anchorSec: 5 })
    for (const block of result.blocks) {
      expect(block.start).toBe(5)
      expect(block.end).toBe(5)
      for (const word of block.words) expect(word.start).toBe(5)
    }
    assertInvariant1(result)
  })

  test('anchor at the media end: pre-anchor times stretch left, early times clamp to 0, start ≤ end survives (scale > 0)', () => {
    const result = retimeAll(project(), { anchorSec: 100, scale: 2 })
    const [a, b] = result.blocks
    expect(a!.start, '100 + (10−100)×2 = −80 → 0').toBe(0)
    expect(a!.end, '100 + (12−100)×2 = −76 → 0').toBe(0)
    const late = makeProject({
      duration: 100,
      blocks: [makeBlock(90, 95, words([90, 92], [92, 95]), 'SPK_1', 'blk-late')],
      speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
    })
    const stretched = retimeAll(late, { anchorSec: 100, scale: 2 })
    expect(stretched.blocks[0]!.start, '100 + (90−100)×2 = 80').toBeCloseTo(80, 3)
    expect(stretched.blocks[0]!.end, '100 + (95−100)×2 = 90').toBeCloseTo(90, 3)
    assertInvariant1(stretched)
  })

  test('anchor at the media end with a forward offset: everything clamps onto duration without inverting', () => {
    const result = retimeAll(project(), { anchorSec: 100, scale: 2, offsetSec: 200 })
    for (const block of result.blocks) expect(block.end).toBe(100)
    assertInvariant1(result)
  })

  test('solveRetime on monotone picks stays invariant-1 legal under retimeAll (sanity around the red probes)', () => {
    const solution = solveRetime(10, 12, 20, 21)
    expect(solution.scale).toBeGreaterThan(0)
    const result = retimeAll(project(), solution)
    expect(result.blocks[0]!.start).toBeCloseTo(12, 3)
    expect(result.blocks[1]!.start).toBeCloseTo(21, 3)
    assertInvariant1(result)
  })
})

describe('retime scale < 0 — non-monotone map against a global invariant (VIOLATION probes)', () => {
  test('retimeAll VIOLATION: a negative scale (allowed by the typed contract) inverts block and word intervals, breaking domain invariant 1', () => {
    // The map t → anchor + (t − anchor) × scale + offset with scale < 0 is
    // strictly decreasing; clamping to [0, duration] cannot restore start ≤
    // end. retime.ts lines 30-34 assert the opposite ("The map is monotone,
    // so clamping keeps start ≤ end and word order (domain invariant 1)").
    const result = retimeAll(project(), { scale: -1, offsetSec: 50 })
    const a = result.blocks[0]!
    expect(a.start, 'expected the engine to reject or repair a non-monotone map (invariant 1, domain.md); measured inversion must stay visible if this fails').toBeLessThanOrEqual(a.end)
    assertInvariant1(result)
  })

  test('retimeAll VIOLATION: solveRetime on reversed two-point picks solves a negative scale and the composed map breaks invariant 1', () => {
    // US-07.4 two-point sync (unit file line 35) types no guard for the
    // user-picked order; the frozen contract reserves TypeError solely for
    // fromA === fromB. The editor mis-pick (earlier block given the later
    // time) therefore composes straight into an invariant-violating project.
    const solution = solveRetime(10, 30, 20, 10) // scale (10−30)/(20−10) = −2, offset 50
    expect(solution.scale, 'a decreasing two-point solve is currently accepted').toBeLessThan(0)
    const result = retimeAll(project(), solution)
    const a = result.blocks[0]!
    expect(a.start, 'point A maps to 30, its 12 s end maps to 26 — inverted interval (domain invariant 1)').toBeLessThanOrEqual(a.end)
    assertInvariant1(result)
  })
})
