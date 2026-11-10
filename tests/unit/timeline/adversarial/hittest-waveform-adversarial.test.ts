// Adverse round (unit-103 adversary, L1): data-model hit-testing and
// waveform re-bucketing against degenerate / adversarial data. Regenerated
// from the CONTRACTS: unit103-api-contract.d.ts § '@ui/timeline/hittest'
// (hit = `start <= t < end`, inclusive normalized marquee, "nearer zone wins")
// and § '@ui/timeline/waveform' (native resolution is the truth; empty tail →
// empty array), plus domain.md invariants 1/6. Titles: `adverse TL.<n>: …`.
import { describe, expect, test } from 'vitest'
import { block, word } from '../../editor/helpers/fixture-project'
import { makePeaks, makePeaksWithSilence, perfBlocksFrom } from '../helpers/timeline-fixture'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const loadHit = (): Promise<typeof import('@ui/timeline/hittest')> => import(/* @vite-ignore */ '@ui/timeline/hittest')
const loadWave = (): Promise<typeof import('@ui/timeline/waveform')> => import(/* @vite-ignore */ '@ui/timeline/waveform')
const loadVp = (): Promise<typeof import('@ui/timeline/viewport')> => import(/* @vite-ignore */ '@ui/timeline/viewport')

describe('adverse TL.hittest (CC-103.1/CC-103.4): boundaries, ties, 10k adversarial orderings', () => {
  test('adverse TL.10: CC-103.1 hitEdge grab zone is inclusive at exactly HANDLE_PX and dead one epsilon past it', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { hitEdge } = await loadHit()
    const v = { t0: 0, pxPerSec: 100 }
    const blk = block('blk_e', 3, 5, 'SPK_1', [word('w', 3, 5)])
    expect(hitEdge(blk, 300, v)).toBe('start') // dead on the start edge
    expect(hitEdge(blk, 500, v)).toBe('end') // dead on the end edge
    expect(hitEdge(blk, 308, v)).toBe('start') // exactly 8 px → inclusive
    expect(hitEdge(blk, 308.00001, v)).toBeNull() // 8 + ε px → miss
    expect(hitEdge(blk, 492, v)).toBe('end')
    expect(hitEdge(blk, 400, v)).toBeNull() // body centre of a 200 px block → no zone
  })

  test('adverse TL.11: CC-103.1 hitEdge on a near-zero-width block at ZOOM_MIN — nearer zone wins, never null', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { hitEdge } = await loadHit()
    const { ZOOM_MIN_PX_PER_SEC } = await loadVp()
    const v = { t0: 0, pxPerSec: ZOOM_MIN_PX_PER_SEC }
    const thin = block('blk_thin', 3, 3.001, 'SPK_1', [word('w', 3, 3.001)]) // 0.002 px wide
    expect(hitEdge(thin, 6, v)).toBe('start') // exact start edge
    expect(hitEdge(thin, 6.002, v)).toBe('end') // exact end edge (nearer)
    const mid = hitEdge(thin, 6.001, v) // distance tie — d.ts pins only "nearer wins"
    expect(mid === 'start' || mid === 'end').toBe(true)
  })

  test('adverse TL.12: CC-103.1 hit() is half-open start<=t<end for blocks exactly ADJACENCY_MIN_GAP_SEC apart', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createBlockIndex } = await loadHit()
    const { ADJACENCY_MIN_GAP_SEC } = await loadVp()
    expect(ADJACENCY_MIN_GAP_SEC).toBe(0.05)
    const a = block('blk_a', 1, 2, 'SPK_1', [word('a', 1, 2)])
    const b = block('blk_b', 2.05, 3, 'SPK_1', [word('b', 2.05, 3)])
    const c = block('blk_c', 3.05, 4, 'SPK_1', [word('c', 3.05, 4)])
    const idx = createBlockIndex([c, b, a]) // adversarial: reversed insertion
    expect(idx.all().map((x) => x.id)).toEqual(['blk_a', 'blk_b', 'blk_c']) // timeline order restored
    expect(idx.hit(2), 'end is EXCLUSIVE').toBeNull()
    expect(idx.hit(2.0499)).toBeNull()
    expect(idx.hit(2.05)?.id, 'start is inclusive').toBe('blk_b')
    expect(idx.hit(3.05)?.id).toBe('blk_c')
    expect(idx.hit(4)).toBeNull()
    expect(idx.hit(-0.001)).toBeNull()
  })

  test('adverse TL.13: CC-103.4 index over 10k blocks + duplicate timestamps + touching pairs — parity, no crash', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createBlockIndex } = await loadHit()
    const perf = perfBlocksFrom(0, 10_000)
    // Adversarial members placed past the perf grid (perf max end = 119.998).
    const dupA = block('blk_dup_a', 120.5, 120.51, 'SPK_1', [word('x', 120.5, 120.51)])
    const dupB = block('blk_dup_b', 120.5, 120.515, 'SPK_1', [word('y', 120.5, 120.515)])
    const touchA = block('blk_touch_a', 121.0, 121.02, 'SPK_1', [word('p', 121.0, 121.02)])
    const touchB = block('blk_touch_b', 121.07, 121.09, 'SPK_1', [word('q', 121.07, 121.09)]) // exactly ADJACENCY_MIN_GAP_SEC apart
    const shuffled = [...perf.slice(5_000), dupB, dupA, touchB, touchA, ...perf.slice(0, 5_000)] // rotated + reversed chunks
    const idx = createBlockIndex(shuffled)
    const all = idx.all()
    expect(all.length).toBe(10_004)
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]
      const cur = all[i]
      expect(prev !== undefined && cur !== undefined && cur.start >= prev.start, `sorted at ${String(i)}`).toBe(true)
    }
    // Parity vs the data model at every 97th block start plus the adversarial members.
    for (let k = 0; k < 10_000; k += 97) {
      const b = perf[k]
      if (b === undefined) continue
      expect(idx.hit(b.start)?.id, `hit at start of block ${String(k)}`).toBe(b.id)
      expect(idx.hit(b.end - 0.001)?.id, `hit just inside end of block ${String(k)}`).toBe(b.id)
      expect(idx.hit(b.end), `end exclusive at block ${String(k)}`).toBeNull()
    }
    const dupHits = idx.query(120.5, 120.5).map((b) => b.id)
    expect(dupHits).toEqual(expect.arrayContaining(['blk_dup_a', 'blk_dup_b'])) // both share start 120.5
    const touch = idx.query(121.0, 121.09).map((b) => b.id)
    expect(touch).toEqual(['blk_touch_a', 'blk_touch_b']) // timeline order
    expect(idx.hit(121.02), 'gap between the exactly-0.05-apart pair hits nothing').toBeNull()
    expect(idx.hit(121.07)?.id).toBe('blk_touch_b')
    const h = idx.hit(120.5) // duplicate starts: returns a containing block, never crashes
    expect(h).not.toBeNull()
    expect(['blk_dup_a', 'blk_dup_b']).toContain(h?.id)
  })

  test('adverse TL.14: CC-103.1 query degenerate windows and marquee pixel spans (xA==xB, reversed, negative)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { createBlockIndex, blocksInPixelRange } = await loadHit()
    const v = { t0: 0, pxPerSec: 100 }
    const a = block('blk_a', 1, 2, 'SPK_1', [word('a', 1, 2)])
    const b = block('blk_b', 3, 5, 'SPK_1', [word('b', 3, 5)])
    const idx = createBlockIndex([a, b])
    expect(idx.query(2, 1)).toEqual([]) // tA > tB → empty, never reversed
    expect(idx.query(-9, -2)).toEqual([])
    expect(idx.query(1, 1).map((x) => x.id)).toEqual(['blk_a']) // inclusive boundary window
    expect(blocksInPixelRange(idx, 300, 300, v).map((x) => x.id), 'zero-width marquee is inclusive').toEqual(['blk_b'])
    expect(blocksInPixelRange(idx, 500, 100, v).map((x) => x.id), 'reversed span normalizes').toEqual(['blk_a', 'blk_b'])
    expect(blocksInPixelRange(idx, -100, -50, v), 'negative span selects nothing').toEqual([])
  })
})

describe('adverse TL.waveform (CC-103.4): degenerate PeaksData, zoom past native, silence runs', () => {
  test('adverse TL.15: CC-103.4 rebucketPeaks returns [] for every degenerate input (bucketSec/pxPerSec/width 0, NaN, negative)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { rebucketPeaks } = await loadWave()
    const peaks = makePeaks(0.01, 100)
    const v = { t0: 0, pxPerSec: 100 }
    expect(rebucketPeaks(makePeaks(0.01, 0), v, 800)).toEqual([])
    expect(rebucketPeaks({ bucketSec: 0, min: peaks.min, max: peaks.max }, v, 800)).toEqual([])
    expect(rebucketPeaks({ bucketSec: -1, min: peaks.min, max: peaks.max }, v, 800)).toEqual([])
    expect(rebucketPeaks({ bucketSec: Number.NaN, min: peaks.min, max: peaks.max }, v, 800)).toEqual([])
    expect(rebucketPeaks(peaks, { t0: 0, pxPerSec: 0 }, 800)).toEqual([])
    expect(rebucketPeaks(peaks, { t0: 0, pxPerSec: Number.NaN }, 800)).toEqual([])
    expect(rebucketPeaks(peaks, { t0: 0, pxPerSec: -50 }, 800)).toEqual([])
    expect(rebucketPeaks(peaks, v, 0)).toEqual([])
    expect(rebucketPeaks(peaks, v, -10)).toEqual([])
    expect(rebucketPeaks(peaks, v, 800, 0)).toEqual([])
    expect(rebucketPeaks(peaks, { t0: 999, pxPerSec: 100 }, 800), 'visible tail past the data end → empty array (frozen)').toEqual([])
  })

  test('adverse TL.16: CC-103.4 zoom PAST native resolution copies native min/max exactly (no invented averages) and buckets stay contiguous', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { rebucketPeaks } = await loadWave()
    const peaks = makePeaks(0.01, 1000) // native 10 ms buckets over [0, 10)
    const out = rebucketPeaks(peaks, { t0: 0, pxPerSec: 1000 }, 800, 4) // 4 px = 4 ms buckets
    expect(out.length, 'visible 0.8 s / 0.004 s buckets').toBe(200)
    // Independent oracle for the frozen rule: a bucket spanning several natives
    // merges them (min of mins / max of maxes); one inside a native copies it.
    const expected = (t0: number, t1: number): { min: number; max: number } => {
      const n0 = Math.floor(t0 / peaks.bucketSec + 1e-12)
      const n1 = Math.min(peaks.min.length - 1, Math.ceil(t1 / peaks.bucketSec - 1e-12) - 1)
      let mn = Number.POSITIVE_INFINITY
      let mx = Number.NEGATIVE_INFINITY
      for (let n = n0; n <= n1; n++) {
        mn = Math.min(mn, peaks.min[n] as number)
        mx = Math.max(mx, peaks.max[n] as number)
      }
      return { min: mn, max: mx }
    }
    for (let i = 0; i < out.length; i++) {
      const b = out[i]
      if (b === undefined) continue
      const want = expected(b.t0, b.t1)
      expect(b.min, `bucket ${String(i)} min merges/copies natives`).toBe(want.min)
      expect(b.max, `bucket ${String(i)} max merges/copies natives`).toBe(want.max)
      expect(b.t1 - b.t0).toBeCloseTo(0.004, 10)
      const next = out[i + 1]
      if (next !== undefined) expect(next.t0, 'contiguous grid').toBe(b.t1)
    }
    const inside = out.filter((b) => Math.floor((b.t0 + 1e-12) / peaks.bucketSec) === Math.ceil((b.t0 + 0.004) / peaks.bucketSec - 1e-12) - 1)
    expect(inside.length, 'a strict majority of buckets sit fully inside one native bucket').toBeGreaterThan(120)
    // Partial tail: a bucket straddling the data end draws only from real native data.
    const tail = rebucketPeaks(peaks, { t0: 9.99, pxPerSec: 1000 }, 800, 4)
    for (const b of tail) {
      expect(b.t0).toBeLessThan(10)
      expect(Number.isFinite(b.min) && Number.isFinite(b.max)).toBe(true)
    }
  })

  test('adverse TL.17: CC-103.4 silenceMarkers — full run, touching runs, negative threshold, degenerate bucketSec', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { silenceMarkers } = await loadWave()
    const peaks = makePeaks(0.01, 100)
    expect(silenceMarkers(peaks, Number.NaN), 'NaN threshold marks nothing (comparison false)').toEqual([])
    expect(silenceMarkers(peaks, -0.1), 'negative threshold marks nothing').toEqual([])
    const one = makePeaksWithSilence(0.1, 10, 3, 6)
    expect(silenceMarkers(one, 0.1)).toEqual([[0.3, 0.6]])
    const allSilent = makePeaks(0.1, 10, () => 0)
    expect(silenceMarkers(allSilent, 0.1)).toEqual([[0, 1]])
    const two = makePeaks(0.1, 6, (i) => (i === 0 || i === 1 || i === 3 || i === 4 ? 0 : 0.5))
    expect(silenceMarkers(two, 0.1)).toEqual([
      [0, 0.2],
      [0.3, 0.5],
    ])
    expect(silenceMarkers({ bucketSec: 0, min: peaks.min, max: peaks.max }, 0.1)).toEqual([])
  })
})
