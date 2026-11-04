// CC-07.4 (L1) / US-07.4: retimeAll maps every block AND word time
// t → anchor + (t − anchor) × scale + offset, clamped to media bounds, purely
// (one undoable command upstream); solveRetime derives (offset, scale) from
// two picked points. Engine half only — the dialog/undo wiring is unit-101.
import { expect, test } from 'vitest'
import { retimeAll, solveRetime } from '@engine/captions/retime'
import type { Project, WordToken } from '@engine/model@07'
import { canonical } from './canonical'
import { makeBlock, makeProject } from './project-support'

const EPS = 1e-6

function words(...pairs: [number, number][]): WordToken[] {
  return pairs.map(([start, end], index) => ({ text: `w${index}`, start, end, timing: 'asr' as const }))
}

function syncedProject(): Project {
  return makeProject({
    duration: 100,
    blocks: [makeBlock(10, 12, words([10, 10.8], [10.8, 12]), 'SPK_1', 'blk-a'), makeBlock(20, 21, words([20, 20.5], [20.5, 21]), 'SPK_1', 'blk-b')],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
  })
}

test('CC-07.4 / US-07.4: every block and word time maps t → anchor + (t − anchor) × scale + offset (golden)', () => {
  const result = retimeAll(syncedProject(), { anchorSec: 2, scale: 2, offsetSec: 1 })
  const [a, b] = result.blocks
  // anchor 2, scale 2, offset 1: t → 2 + (t−2)×2 + 1 = 2t − 1.
  expect(a!.start).toBeCloseTo(19, 3)
  expect(a!.end).toBeCloseTo(23, 3)
  expect(a!.words[0]!.start, 'words move with their blocks').toBeCloseTo(19, 3)
  expect(a!.words[0]!.end).toBeCloseTo(20.6, 3)
  expect(b!.start).toBeCloseTo(39, 3)
  expect(b!.end).toBeCloseTo(41, 3)
})

test('CC-07.4: fixing a constant offset — "block starts at 4 s, not 1 s" (US-07.4)', () => {
  const project = makeProject({ duration: 30, blocks: [makeBlock(1, 2, words([1, 1.5], [1.5, 2]))], speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }] })
  const result = retimeAll(project, { offsetSec: 3 })
  expect(result.blocks[0]!.start).toBeCloseTo(4, 3)
  expect(result.blocks[0]!.end).toBeCloseTo(5, 3)
  expect(result.blocks[0]!.words[0]!.start).toBeCloseTo(4, 3)
})

test('CC-07.4: frame-rate drift correction — 23.976 → 25 fps stretch about anchor 0 (US-07.4)', () => {
  const project = makeProject({ duration: 60, blocks: [makeBlock(0, 47.952, words([0, 23.976], [23.976, 47.952]))], speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }] })
  const result = retimeAll(project, { scale: 25 / 23.976, anchorSec: 0 })
  expect(result.blocks[0]!.end, '47.952 s of 23.976 fps material lands on 50.000 s of 25 fps media').toBeCloseTo(50, 3)
  expect(result.blocks[0]!.words[0]!.end).toBeCloseTo(25, 3)
})

test('CC-07.4: defaults are the identity map (pure no-op, new object)', () => {
  const project = syncedProject()
  const result = retimeAll(project)
  expect(canonical(result)).toBe(canonical(project))
})

test('CC-07.4: times clamp at the media bounds — never negative, never past duration', () => {
  const result = retimeAll(syncedProject(), { offsetSec: -15 }) // 10−15 = −5 → 0
  const a = result.blocks[0]!
  expect(a.start, 'clamped to the media start').toBe(0)
  expect(a.end).toBe(0) // 12 − 15 = −3 also clamps to 0 (monotone clamp)
  for (const word of a.words) expect(word.start, 'words clamp too').toBe(0)

  const forward = retimeAll(syncedProject(), { offsetSec: 95 }) // past duration 100
  const last = resultForwardBlock(forward)
  expect(last.start, 'clamped to the media end').toBe(100)
  expect(last.end).toBe(100)
})

function resultForwardBlock(project: Project): { start: number; end: number } {
  return project.blocks[1]!
}

test('CC-07.4: scale compresses toward the anchor and clamps into [0, duration]', () => {
  const result = retimeAll(syncedProject(), { anchorSec: 10, scale: 0.5 })
  const a = result.blocks[0]!
  const b = result.blocks[1]!
  expect(a.start).toBeCloseTo(10, 3) // anchor stays put
  expect(a.end).toBeCloseTo(11, 3)
  expect(b.start).toBeCloseTo(15, 3)
  expect(b.end).toBeCloseTo(15.5, 3)
})

test('CC-07.4: retimeAll is pure — the input project is never mutated', () => {
  const project = syncedProject()
  const snapshot = structuredClone(project)
  retimeAll(project, { offsetSec: 7, scale: 1.25, anchorSec: 3 })
  expect(canonical(project), 'input untouched').toBe(canonical(snapshot))
})

test('CC-07.4 / US-07.4: two-point solve — solved (offset, scale) maps both picked points exactly', () => {
  // Editor picks block A "actually starts at 12" and block B "actually at 21".
  const solution = solveRetime(10, 12, 20, 21) // scale (21−12)/(20−10) = 0.9; offset 12 − 10×0.9 = 3
  expect(solution.scale).toBeCloseTo(0.9, 9)
  expect(solution.offsetSec).toBeCloseTo(3, 9)
  const result = retimeAll(syncedProject(), solution)
  expect(result.blocks[0]!.start, 'point A exact').toBeCloseTo(12, 3)
  expect(result.blocks[1]!.start, 'point B exact').toBeCloseTo(21, 3)
  expect(result.blocks[0]!.words[0]!.start, 'words follow the solved map').toBeCloseTo(12, 3)
})

test('CC-07.4: degenerate two-point solve (identical source times) throws TypeError', () => {
  expect(() => solveRetime(5, 1, 5, 9)).toThrow(TypeError)
})

test('CC-07.4: solved retime respects the media clamp', () => {
  const solution = solveRetime(10, 95, 20, 200) // scale 10.5, offset −90
  const result = retimeAll(syncedProject(), solution)
  for (const block of result.blocks) {
    expect(block.start, 'within media bounds').toBeGreaterThanOrEqual(0)
    expect(block.end, 'within media bounds').toBeLessThanOrEqual(100)
    for (const word of block.words) {
      expect(word.start).toBeGreaterThanOrEqual(0)
      expect(word.end).toBeLessThanOrEqual(100)
    }
  }
})
