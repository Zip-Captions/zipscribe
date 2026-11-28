// CC-110.2 (L1): the pure expansion-decision fn `activeSpanIdAt` — the row
// model's owner rule (issue #48 design): ONLY the block whose TIME SPAN
// contains the playhead expands; boundaries are half-open [start, end) so a
// boundary frame belongs to NO row (the previous row collapses). Exercised
// directly (review-r2 F4: previously covered only through L2 playhead
// transitions). Pure function, synthetic blocks, no DOM, no content beyond
// synthetic ids (SECURITY-03 trivial).
// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { block, word } from '../editor/helpers/fixture-project'
import type { CaptionBlock } from '@engine/model@104'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

async function loadActiveSpanIdAt(): Promise<(blocks: readonly CaptionBlock[], playhead: number) => string | null> {
  // Structural cast (not the frozen unit-104 contract type): `activeSpanIdAt`
  // is the unit-110 export the contract file predates.
  const mod = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as {
    activeSpanIdAt: (blocks: readonly CaptionBlock[], playhead: number) => string | null
  }
  return mod.activeSpanIdAt
}

function fixture(): CaptionBlock[] {
  return [
    block('blk_a', 0.2, 1.2, 'SPK_1', [word('alpha', 0.2, 1.2)]),
    block('blk_long', 5, 8, 'SPK_1', [word('long', 5, 8)]),
    block('blk_b', 9, 10, 'SPK_2', [word('beta', 9, 10)]),
  ]
}

describe('CC-110.2 (L1): activeSpanIdAt — half-open [start, end) span containment', () => {
  test('CC-110.2: empty block list and pre-first-start playheads select no row', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const activeSpanIdAt = await loadActiveSpanIdAt()
    expect(activeSpanIdAt([], 0.5), 'no blocks → no active row').toBeNull()
    const blocks = fixture()
    expect(activeSpanIdAt(blocks, 0), 'playhead before every span → null').toBeNull()
    expect(activeSpanIdAt(blocks, 0.19), 'just-before the first start → null').toBeNull()
  })

  test('CC-110.2: the containing block wins; boundaries are half-open — start inclusive, end exclusive', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const activeSpanIdAt = await loadActiveSpanIdAt()
    const blocks = fixture()
    expect(activeSpanIdAt(blocks, 0.2), 'playhead EXACTLY at a start belongs to that row (inclusive lower)').toBe('blk_a')
    expect(activeSpanIdAt(blocks, 0.7), 'mid-span → that row').toBe('blk_a')
    expect(activeSpanIdAt(blocks, 1.2), 'playhead EXACTLY at an end belongs to NO row (exclusive upper — collapse rule)').toBeNull()
    expect(activeSpanIdAt(blocks, 6.5), 'the long middle row spans it').toBe('blk_long')
    expect(activeSpanIdAt(blocks, 8), 'end of the long row → null (boundary frame collapses it)').toBeNull()
    expect(activeSpanIdAt(blocks, 9.5), 'the last row spans it').toBe('blk_b')
  })

  test('CC-110.2: gaps select no row, playheads past the end select no row, later-containing blocks win on overlap', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const activeSpanIdAt = await loadActiveSpanIdAt()
    const blocks = fixture()
    expect(activeSpanIdAt(blocks, 3), 'in a gap between spans → null').toBeNull()
    expect(activeSpanIdAt(blocks, 10), 'just past the final end → null').toBeNull()
    expect(activeSpanIdAt(blocks, 99), 'far past every span → null').toBeNull()
    // Sorted blocks may overlap: the scan keeps advancing while start <=
    // playhead, so the LAST block whose span contains the playhead decides.
    const overlapping = [block('blk_x', 2, 6, 'SPK_1', [word('x', 2, 6)]), block('blk_y', 4, 8, 'SPK_1', [word('y', 4, 8)])]
    expect(activeSpanIdAt(overlapping, 3), 'in the first span only → first row').toBe('blk_x')
    expect(activeSpanIdAt(overlapping, 5), 'in both spans → the later block (scan order) wins').toBe('blk_y')
    expect(activeSpanIdAt(overlapping, 7), 'in the second span only → second row').toBe('blk_y')
  })
})
