// Memoizable pure selectors over the source track (FR-102.4). Binary searches —
// blocks and words are sorted by construction (domain invariant 1), enforced by
// the command reducers. Half-open boundary rule (frozen): active iff
// `word.start <= t < word.end`; null before the block, inside an internal word
// gap, and at/after `block.end` (the last word is half-open too).

import type { CaptionBlock, Seconds, WordToken } from '../engine/model'

/** Last index whose `key(item) <= t`, or -1. */
function lastIndexAtOrBefore<T>(items: readonly T[], t: Seconds, key: (item: T) => number): number {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const item = items[mid]
    if (item !== undefined && key(item) <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

export function activeWord(block: CaptionBlock, playhead: Seconds): WordToken | null {
  const index = lastIndexAtOrBefore(block.words, playhead, (w) => w.start)
  if (index < 0) return null
  const word = block.words[index]
  if (word === undefined) return null
  return word.start <= playhead && playhead < word.end ? word : null
}

/** The block containing `t` (`start <= t < end`), or null. */
export function activeBlock(blocks: readonly CaptionBlock[], playhead: Seconds): CaptionBlock | null {
  const index = lastIndexAtOrBefore(blocks, playhead, (b) => b.start)
  if (index < 0) return null
  const block = blocks[index]
  if (block === undefined) return null
  return block.start <= playhead && playhead < block.end ? block : null
}
