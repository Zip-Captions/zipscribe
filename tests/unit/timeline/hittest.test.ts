// CC-103.1 (L1): hit-test parity vs the DATA MODEL at 3 zoom levels, spatial
// index queries, and the frozen 8 px trim-handle zones (FR-103.2/FR-103.3).
// RED until the builder ships `src/ui/timeline/hittest.ts` (dynamic-import
// seam per unit103-api-contract.d.ts; gates-child skip per the frozen
// ZIPSCRIBE_CHILD doctrine).
import { expect, test } from 'vitest'
import { indexBlocks, timelineBlocks } from './helpers/timeline-fixture'
import type { CaptionBlock, Seconds } from '@engine/model@103'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'
const load = (): Promise<typeof import('@ui/timeline/hittest')> => import(/* @vite-ignore */ '@ui/timeline/hittest')
const VIEWPORT_WIDTH_PX = 800
const ZOOM_LEVELS: number[] = [12, 96, 480]

function bruteHit(blocks: readonly CaptionBlock[], t: Seconds): CaptionBlock | null {
  for (const b of blocks) if (t >= b.start && t < b.end) return b
  return null
}

function bruteRange(blocks: readonly CaptionBlock[], tA: Seconds, tB: Seconds): string[] {
  return blocks.filter((b) => b.start <= tB && tA <= b.end).map((b) => b.id)
}

test('CC-103.1: index.hit matches the data model at 3 zoom levels (200 probes)', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const blocks = indexBlocks()
  const index = m.createBlockIndex(blocks)
  expect(index.all().length, 'the index carries every block').toBe(blocks.length)
  for (const pxPerSec of ZOOM_LEVELS) {
    for (let i = 0; i < 200; i++) {
      // Off-grid probes so no probe lands on a block edge (half-open bounds are pinned separately).
      const t = 0.037 + i * 0.13
      expect(index.hit(t), `hit(${String(t)}) @ pxPerSec=${String(pxPerSec)} — parity vs the data model`).toBe(bruteHit(blocks, t))
    }
  }
})

test('CC-103.1: half-open containment — block.start hits, block.end does not', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const index = m.createBlockIndex(timelineBlocks())
  expect(index.hit(0.5)?.id, 'start <= t hits').toBe('blk_v1')
  expect(index.hit(2.5), 'end is exclusive → falls in the gap, not the next block').toBeNull()
  expect(index.hit(2.499)?.id).toBe('blk_v1')
  expect(index.hit(14.0), 'past the last block end').toBeNull()
})

test('CC-103.1: index.query matches the brute-force overlap range at 3 zoom levels', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const blocks = indexBlocks()
  const index = m.createBlockIndex(blocks)
  for (const pxPerSec of ZOOM_LEVELS) {
    const v = { t0: 3.25, pxPerSec }
    const winA = 3.25
    const winB = 3.25 + VIEWPORT_WIDTH_PX / pxPerSec
    expect(
      index.query(winA, winB).map((b) => b.id),
      `visible-window query @ pxPerSec=${String(pxPerSec)}`,
    ).toEqual(bruteRange(blocks, winA, winB))
  }
})

test('CC-103.1: marquee pixel range selects exactly the intersecting blocks (FR-103.3)', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const index = m.createBlockIndex(timelineBlocks())
  const v = { t0: 0, pxPerSec: 100 }
  // blk_v1 0.5–2.5 (50–250 px), blk_v2 3–5 (300–500), blk_v3 6–8.2 (600–820)…
  expect(
    m.blocksInPixelRange(index, 100, 350, v).map((b) => b.id),
    'a marquee across the blk_v1..blk_v2 span returns both, in order',
  ).toEqual(['blk_v1', 'blk_v2'])
  expect(m.blocksInPixelRange(index, 260, 299, v), 'a marquee inside a gap selects nothing').toEqual([])
  expect(
    m.blocksInPixelRange(index, 350, 100, v).map((b) => b.id),
    'reversed drag direction normalizes (right-to-left marquee)',
  ).toEqual(['blk_v1', 'blk_v2'])
})

test('CC-103.3: trim handles expose the frozen 8 px grab zones (design.md § Trim handles)', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const v = { t0: 0, pxPerSec: 100 }
  const blk = timelineBlocks()[0]
  if (blk === undefined) throw new Error('fixture missing')
  // blk_v1: 0.5–2.5 → edges at x=50 and x=250.
  expect(m.hitEdge(blk, 50, v), 'inside the start zone').toBe('start')
  expect(m.hitEdge(blk, 57, v), '7 px into the start zone (inside the block)').toBe('start')
  expect(m.hitEdge(blk, 243, v), 'inside the end zone').toBe('end')
  expect(m.hitEdge(blk, 258, v), '8 px beyond the end edge grabs it').toBe('end')
  expect(m.hitEdge(blk, 259, v), '9 px beyond misses').toBeNull()
  expect(m.hitEdge(blk, 150, v), 'mid-body is not an edge').toBeNull()
})

test('CC-103.3: a block narrower than 2×8 px resolves the edge zone to the nearer edge', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const v = { t0: 0, pxPerSec: 100 }
  const narrow: CaptionBlock = { id: 'blk_narrow', start: 4.0, end: 4.07, text: 'tiny', words: [{ text: 'tiny', start: 4.0, end: 4.07 }], speakerId: 'SPK_1' }
  // edges at x=400 and x=407 — the zones overlap; 401 is nearer the start, 406 nearer the end.
  expect(m.hitEdge(narrow, 401, v)).toBe('start')
  expect(m.hitEdge(narrow, 406, v)).toBe('end')
})
