// FR-102.4 (L1): `activeWord(blockId, playhead)` — exported binary-search
// selector with the frozen boundary semantics of the contract: active iff
// `word.start <= t < word.end`; null before the block, inside an internal
// word GAP, and at/after `block.end` (the last word is half-open too).
import { describe, expect, test } from 'vitest'
import { activeBlock, activeWord } from '@state/selectors'
import { block, word } from './helpers/fixture-project'
import type { CaptionBlock } from '@engine/model@102'

const b: CaptionBlock = block('blk_aw', 1, 6, 'SPK_1', [word('one', 1, 2), word('two', 2.5, 3.5), word('three', 4, 5.5)])

describe('FR-102.4: activeWord boundaries', () => {
  test('FR-102.4: exactly-on-boundary — word.start is inclusive, word.end is exclusive', () => {
    expect(activeWord(b, 1)?.text, 'block/word start is inclusive').toBe('one')
    expect(activeWord(b, 2), 'word end is exclusive → next-word gap begins').toBeNull()
    expect(activeWord(b, 2.5)?.text).toBe('two')
    expect(activeWord(b, 4)?.text).toBe('three')
  })

  test('FR-102.4: gap inside the block yields null', () => {
    expect(activeWord(b, 2.2), 'between word 1 end and word 2 start').toBeNull()
    expect(activeWord(b, 3.8), 'between word 2 end and word 3 start').toBeNull()
  })

  test('FR-102.4: before the block and at/after block.end yield null', () => {
    expect(activeWord(b, 0.999)).toBeNull()
    expect(activeWord(b, 0)).toBeNull()
    expect(activeWord(b, 5.499)?.text, 'last word until its end').toBe('three')
    expect(activeWord(b, 5.5), 'last word end is exclusive too').toBeNull()
    expect(activeWord(b, 6)).toBeNull()
    expect(activeWord(b, 6.5)).toBeNull()
  })

  test('FR-102.4: adjacent words (zero gap) hand over at the shared boundary', () => {
    const tight = block('blk_tight', 0, 2, 'SPK_1', [word('a', 0, 1), word('b', 1, 2)])
    expect(activeWord(tight, 1)?.text).toBe('b')
  })

  test('FR-102.4: binary-search correctness on a 1001-word block (mid + every boundary)', () => {
    const words = Array.from({ length: 1001 }, (_, i) => word(`w${i}`, i / 10, i / 10 + 0.05))
    const many = block('blk_many', 0, 100.1, 'SPK_1', words)
    expect(activeWord(many, 50.03)?.text, 'mid-block interpolation lands in w500').toBe('w500')
    for (const i of [0, 1, 499, 500, 501, 1000]) {
      const w = words[i]
      if (w === undefined) throw new Error('fixture word')
      expect(activeWord(many, w.start)?.text, `word ${i} start inclusive`).toBe(w.text)
      expect(activeWord(many, w.end), `word ${i} end exclusive`).toBeNull()
      expect(activeWord(many, (w.start + w.end) / 2)?.text, `word ${i} interior`).toBe(w.text)
    }
  })

  test('FR-102.4: activeBlock uses the same half-open rule; gaps between blocks yield null', () => {
    const blocks = [block('x1', 0, 1, 'SPK_1', [word('a', 0, 1)]), block('x2', 2, 3, 'SPK_1', [word('b', 2, 3)])]
    expect(activeBlock(blocks, 0)?.id).toBe('x1')
    expect(activeBlock(blocks, 1)).toBeNull()
    expect(activeBlock(blocks, 1.5)).toBeNull()
    expect(activeBlock(blocks, 2)?.id).toBe('x2')
    expect(activeBlock(blocks, 3)).toBeNull()
  })
})
