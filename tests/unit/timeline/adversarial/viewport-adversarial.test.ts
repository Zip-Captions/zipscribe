// Adversarial round (unit-103 adversary, L1): boundary / extreme / degenerate
// probes on the pure viewport math. REGENERATED from the CONTRACTS, not from
// the existing suites: unit103-api-contract.d.ts § '@ui/timeline/viewport'
// (frozen formulas + "No clamping here" for anchorZoom), unit file US-2.2.1
// ("never past adjacent block start/end − 0.05 s") / US-2.2.6 (anchor zoom),
// design.md § Trim handles (8 px zones, snap within 8 px). Titles follow the
// ADVERSE doctrine: `adverse TL.<n>: CC-103.x …`.
import { describe, expect, test } from 'vitest'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const load = (): Promise<typeof import('@ui/timeline/viewport')> => import(/* @vite-ignore */ '@ui/timeline/viewport')

describe('adverse TL.viewport (CC-103.1): zoom extremes, snap/pan edges, degenerate inputs', () => {
  test('adverse TL.1: CC-103.1 exact quantized mapping at the ZOOM_MIN and ZOOM_MAX extremes', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await load()
    // ZOOM_MIN (2 px/s): 3.141 s → 6.282 px, inverse exact at a 3-decimal time.
    expect(m.timeToX(3.141, { t0: 0, pxPerSec: m.ZOOM_MIN_PX_PER_SEC })).toBe(6.282)
    expect(m.xToTime(6.282, { t0: 0, pxPerSec: m.ZOOM_MIN_PX_PER_SEC })).toBe(3.141)
    // ZOOM_MAX (1000 px/s): IEEE accumulation (11.845·1000 = 11845.000…02) is
    // quantized away — the frozen inverse stays a `.toBe` (d.ts § viewport).
    expect(m.timeToX(12.345, { t0: 0.5, pxPerSec: m.ZOOM_MAX_PX_PER_SEC })).toBe(11845)
    expect(m.xToTime(11845, { t0: 0.5, pxPerSec: m.ZOOM_MAX_PX_PER_SEC })).toBe(12.345)
  })

  test('adverse TL.2: CC-103.1 snapTime boundary is inclusive at exactly SNAP_PX and exclusive beyond (pxPerSec 128 → exact binary pixels)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await load()
    const v = { t0: 0, pxPerSec: 128 } // 1 px = 1/128 s → binary-exact distances
    expect(m.snapTime(5.0, [5.0625], v)).toBe(5.0625) // exactly 8 px → snaps (≤ SNAP_PX)
    expect(m.snapTime(5.0, [5.0703125], v)).toBeNull() // exactly 9 px → no snap
    expect(m.snapTime(5.0, [], v)).toBeNull() // empty candidates
    // Nearest wins over range order.
    expect(m.snapTime(5.0, [5.0625, 5.03125], v)).toBe(5.03125)
    expect(m.snapTime(5.0, [4.9375, 5.0625], v)).toBe(4.9375)
  })

  test('adverse TL.3: CC-103.1 panBy clamps exactly at t0 = 0 and at duration − visibleWidth', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await load()
    const v = { t0: 0, pxPerSec: 100 }
    expect(m.panBy(v, -5000, 800, 121.44)).toEqual({ t0: 0, pxPerSec: 100 }) // never negative
    expect(m.panBy(v, 20000, 800, 121.44)).toEqual({ t0: 113.44, pxPerSec: 100 }) // visible window ends at duration
    // Content narrower than the viewport → t0 pinned at 0.
    expect(m.panBy({ t0: 0, pxPerSec: 4 }, -400, 800, 121.44).t0).toBe(0)
  })

  test('adverse TL.4: CC-103.1 anchorZoom keeps t0 fixed at anchor = t0 and stays UNCLAMPED (frozen: pure math)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await load()
    const z = m.anchorZoom({ t0: 5, pxPerSec: 100 }, 5, 2)
    expect(z.t0).toBe(5) // anchor exactly at t0 → t0 unchanged
    expect(z.pxPerSec).toBe(200)
    const raw = m.anchorZoom({ t0: 0, pxPerSec: m.ZOOM_MAX_PX_PER_SEC }, 10, 500)
    expect(raw.pxPerSec, 'd.ts § anchorZoom: "No clamping here (pure math)"').toBe(500_000)
  })

  test('adverse TL.5: CC-103.1 zoomKey at the exact bounds neither drifts t0 nor crosses the bound; fitViewport survives 0/NaN', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await load()
    expect(m.zoomKey({ t0: 10, pxPerSec: m.ZOOM_MAX_PX_PER_SEC }, 1, 800)).toEqual({ t0: 10, pxPerSec: 1000 })
    expect(m.zoomKey({ t0: 10, pxPerSec: m.ZOOM_MIN_PX_PER_SEC }, -1, 800)).toEqual({ t0: 10, pxPerSec: 2 })
    expect(m.fitViewport(0, 800)).toEqual({ t0: 0, pxPerSec: m.ZOOM_MIN_PX_PER_SEC })
    expect(m.fitViewport(Number.NaN, 800).pxPerSec).toBe(m.ZOOM_MIN_PX_PER_SEC)
    expect(m.fitViewport(121.44, 0).pxPerSec).toBe(m.ZOOM_MIN_PX_PER_SEC)
  })

  test('adverse TL.6: CC-103.1 loopShade on null / inverted / zero-length regions returns geometry, never throws', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await load()
    const v = { t0: 0, pxPerSec: 100 }
    expect(m.loopShade(null, v)).toBeNull()
    expect(m.loopShade([5, 3], v), 'inverted region shades with negative width (pure mapping, no clamp mandated)').toEqual({ x: 500, width: -200 })
    expect(m.loopShade([2, 2], v)).toEqual({ x: 200, width: 0 })
  })

  test('adverse TL.7: CC-103.1 createViewportState exposes a frozen snapshot and honours unsubscribe', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const m = await load()
    const s = m.createViewportState({ t0: 0, pxPerSec: 100 })
    expect(Object.isFrozen(s.get())).toBe(true)
    let seen = 0
    const off = s.subscribe(() => {
      seen += 1
    })
    s.set({ t0: 1, pxPerSec: 120 })
    expect(seen).toBe(1)
    expect(s.get()).toEqual({ t0: 1, pxPerSec: 120 })
    off()
    s.set({ t0: 2, pxPerSec: 140 })
    expect(seen, 'unsubscribed listener is not called').toBe(1)
  })
})
