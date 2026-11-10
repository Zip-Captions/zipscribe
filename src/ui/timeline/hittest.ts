// Unit-103 FR-103.2 — data-model hit-testing via a spatial index (CC-103.1
// parity). Shapes frozen by
// tests/unit/timeline/unit103-api-contract.d.ts § '@ui/timeline/hittest'.
// There are NO DOM block nodes (architecture § Timeline rendering): the
// canvas renderer and the controller both ask this index.
//
// Index = blocks sorted by start + a segment tree over that order carrying the
// subtree MAX-END (the augmented array FR-103.2 allows). A query walks only
// subtrees whose max-end reaches the window and prunes everything past the
// last start ≤ tB, so a visible-window query costs O(log n + k) in the
// matched count — never O(n) per query at 10 000 blocks. `hit` is a plain
// binary search: domain invariant 1 (blocks ordered & non-overlapping) makes
// the last block starting at/before `t` the only possible container.
//
// Pure: no React, no DOM globals. Pixels come from the viewport math only.

import type { CaptionBlock, Seconds } from '../../engine/model'
import { HANDLE_PX, timeToX, xToTime } from './viewport'
import type { TimelineViewport } from './viewport'

export interface BlockIndex {
  /** Blocks overlapping the time window [tA, tB] (tA ≤ tB), timeline order. */
  query(tA: Seconds, tB: Seconds): CaptionBlock[]
  /** Block containing `t` (`start <= t < end`), else null. */
  hit(t: Seconds): CaptionBlock | null
  all(): readonly CaptionBlock[]
}

export function createBlockIndex(blocks: readonly CaptionBlock[]): BlockIndex {
  const sorted = [...blocks].sort((a, b) => a.start - b.start)
  Object.freeze(sorted)
  const n = sorted.length
  const starts: number[] = sorted.map((b) => b.start)

  // Iterative segment tree over the start order, node = max end of its span.
  // Unused leaves hold −Infinity so they never satisfy `end >= tA`.
  let size = 1
  while (size < n) size *= 2
  const maxEnd: number[] = new Array<number>(2 * size).fill(Number.NEGATIVE_INFINITY)
  for (let i = 0; i < n; i++) {
    const b = sorted[i]
    if (b !== undefined) maxEnd[size + i] = b.end
  }
  for (let i = size - 1; i >= 1; i--) {
    const left = maxEnd[2 * i] ?? Number.NEGATIVE_INFINITY
    const right = maxEnd[2 * i + 1] ?? Number.NEGATIVE_INFINITY
    maxEnd[i] = Math.max(left, right)
  }

  /** Last index whose start is ≤ `t` (−1 when none). */
  function lastStartAtOrBefore(t: Seconds): number {
    let low = 0
    let high = n - 1
    let found = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      const s = starts[mid]
      if (s !== undefined && s <= t) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return found
  }

  function query(tA: Seconds, tB: Seconds): CaptionBlock[] {
    const out: CaptionBlock[] = []
    if (n === 0 || tA > tB) return out
    const last = lastStartAtOrBefore(tB)
    if (last < 0) return out
    const visit = (node: number, lo: number, hi: number): void => {
      if (lo > last) return
      if ((maxEnd[node] ?? Number.NEGATIVE_INFINITY) < tA) return
      if (lo === hi) {
        const b = sorted[lo]
        if (b !== undefined && b.end >= tA) out.push(b)
        return
      }
      const mid = (lo + hi) >> 1
      visit(2 * node, lo, mid)
      visit(2 * node + 1, mid + 1, hi)
    }
    visit(1, 0, size - 1)
    return out
  }

  function hit(t: Seconds): CaptionBlock | null {
    const i = lastStartAtOrBefore(t)
    if (i < 0) return null
    const b = sorted[i]
    return b !== undefined && t < b.end ? b : null
  }

  return { query, hit, all: () => sorted }
}

/** The 8 px grab zones on the block edges in PIXEL space (design.md § Trim handles); the nearer zone wins when the block is narrower than 2·HANDLE_PX. */
export function hitEdge(block: CaptionBlock, x: number, v: TimelineViewport): 'start' | 'end' | null {
  const distStart = Math.abs(x - timeToX(block.start, v))
  const distEnd = Math.abs(x - timeToX(block.end, v))
  const inStart = distStart <= HANDLE_PX
  const inEnd = distEnd <= HANDLE_PX
  if (inStart && inEnd) return distStart <= distEnd ? 'start' : 'end'
  if (inStart) return 'start'
  if (inEnd) return 'end'
  return null
}

/** Blocks whose pixel rect intersects the marquee pixel span [xA, xB] (normalized, inclusive), timeline order. */
export function blocksInPixelRange(index: BlockIndex, xA: number, xB: number, v: TimelineViewport): CaptionBlock[] {
  const left = Math.min(xA, xB)
  const right = Math.max(xA, xB)
  return index.query(xToTime(left, v), xToTime(right, v))
}
