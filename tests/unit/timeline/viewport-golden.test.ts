// CC-103.1 (L1): viewport→pixel GOLDEN mapping, anchor-zoom math, fit/pan/
// snap/loop-shade geometry. Pure functions — no DOM. Golden table:
// fixtures/golden/timeline/viewport-mapping.json (synthetic, SECURITY-03).
// RED until the builder ships `src/ui/timeline/viewport.ts`: every test
// dynamic-imports it (the sanctioned missing-module RED per
// unit103-api-contract.d.ts — a gates-child run skips via the frozen
// ZIPSCRIBE_CHILD guard, same doctrine as the vitest.config child excludes).
import { expect, test } from 'vitest'
import golden from '../../../fixtures/golden/timeline/viewport-mapping.json'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'
const load = (): Promise<typeof import('@ui/timeline/viewport')> => import(/* @vite-ignore */ '@ui/timeline/viewport')

test('CC-103.1: golden viewport→pixel mapping table (timeToX / xToTime)', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  for (const c of golden.toPixel) {
    expect(m.timeToX(c.time, c.viewport), `timeToX(${String(c.time)}) @ t0=${String(c.viewport.t0)} pxPerSec=${String(c.viewport.pxPerSec)}`).toBe(c.x)
  }
  for (const c of golden.toTime) {
    expect(m.xToTime(c.x, c.viewport), `xToTime(${String(c.x)}) @ t0=${String(c.viewport.t0)} pxPerSec=${String(c.viewport.pxPerSec)}`).toBe(c.time)
  }
})

test('CC-103.1: golden anchor-zoom keeps the time under the cursor pixel fixed (US-2.2.6)', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  for (const c of golden.anchorZoom) {
    const z = m.anchorZoom(c.viewport, c.anchorTime, c.factor)
    expect(z.pxPerSec, `pxPerSec scales by the factor`).toBeCloseTo(c.expected.pxPerSec, 9)
    expect(z.t0, 't0 re-anchors at the cursor').toBeCloseTo(c.expected.t0, 9)
    const driftPx = Math.abs(m.xToTime(c.cursorX, z) - c.anchorTime) * c.expected.pxPerSec
    expect(driftPx, `time under cursorX=${String(c.cursorX)} stays at ${String(c.anchorTime)} s (≤ ${String(c.tolerancePx)} px)`).toBeLessThanOrEqual(c.tolerancePx)
  }
})

test('CC-103.1: timeToX/xToTime are exact inverses across the mapping range', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const v = { t0: 1.25, pxPerSec: 37.5 }
  for (const t of [0, 0.001, 1.25, 7.7, 33.333, 121.44]) {
    expect(m.xToTime(m.timeToX(t, v), v), `round trip t=${String(t)}`).toBeCloseTo(t, 9)
  }
})

test('CC-103.1: ⌘=/⌘− keyboard zoom steps clamp at the zoom bounds; ⌘0 fits the project', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  expect(m.ZOOM_KEY_FACTOR, 'zoom step is a multiplicative factor > 1').toBeGreaterThan(1)
  expect(m.ZOOM_MIN_PX_PER_SEC).toBeGreaterThan(0)
  expect(m.ZOOM_MAX_PX_PER_SEC).toBeGreaterThan(m.ZOOM_MIN_PX_PER_SEC)

  const maxed = m.zoomKey({ t0: 0, pxPerSec: m.ZOOM_MAX_PX_PER_SEC }, 1, 800)
  expect(maxed.pxPerSec, '⌘= at the ceiling stays clamped').toBe(m.ZOOM_MAX_PX_PER_SEC)
  const minned = m.zoomKey({ t0: 0, pxPerSec: m.ZOOM_MIN_PX_PER_SEC }, -1, 800)
  expect(minned.pxPerSec, '⌘− at the floor stays clamped').toBe(m.ZOOM_MIN_PX_PER_SEC)
  const up = m.zoomKey({ t0: 0, pxPerSec: 100 }, 1, 800)
  expect(up.pxPerSec, '⌘= scales up by the step factor').toBeCloseTo(100 * m.ZOOM_KEY_FACTOR, 9)

  const fit = m.fitViewport(121.44, 1214.4)
  expect(fit.t0, '⌘0 scrolls to the start').toBe(0)
  expect(fit.pxPerSec, '⌘0 fits the full duration into the width').toBeCloseTo(10, 9)
})

test('CC-103.1: wheel pan clamps the visible window to [0, duration]', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const v = { t0: 0, pxPerSec: 100 }
  expect(m.panBy(v, -500, 800, 121.44).t0, 'panning past the start clamps at 0').toBe(0)
  const end = m.panBy(v, 40_000, 800, 121.44)
  expect(end.t0, 'panning past the end clamps so the viewport tail meets the duration').toBeCloseTo(121.44 - 800 / 100, 9)
  expect(end.t0, 'a clamped viewport keeps a non-negative start').toBeGreaterThanOrEqual(0)
  const mid = m.panBy(v, 100, 800, 121.44)
  expect(mid.t0, 'an in-range pan moves exactly dxPx/pxPerSec').toBeCloseTo(1, 9)
  expect(mid.pxPerSec, 'pan never changes zoom').toBe(100)
})

test('CC-103.1: snap picks the nearest candidate within SNAP_PX and none beyond', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  expect(m.SNAP_PX, 'snap radius is the frozen 8 px (design.md § Trim handles)').toBe(8)
  const v = { t0: 0, pxPerSec: 100 }
  expect(m.snapTime(3.05, [3, 10], v), '5 px from candidate 3 → snaps').toBe(3)
  expect(m.snapTime(3.09, [3, 10], v), '9 px out of range → no snap').toBeNull()
  expect(m.snapTime(9.95, [3, 10], v), 'nearest candidate wins').toBe(10)
  expect(m.snapTime(5.5, [], v), 'no candidates → null').toBeNull()
})

test('CC-103.1: loop region maps to its shade rectangle (FR-103.6)', async ({ skip }) => {
  skip(CHILD, CHILD_REASON)
  const m = await load()
  const shade = m.loopShade([2, 5], { t0: 0, pxPerSec: 100 })
  expect(shade, 'a set loop renders a shade').not.toBeNull()
  expect(shade?.x, 'shade starts at timeToX(2)').toBe(200)
  expect(shade?.width, 'shade spans (5−2)·pxPerSec').toBe(300)
  expect(m.loopShade(null, { t0: 0, pxPerSec: 100 }), 'no loop → no shade').toBeNull()
  const scrolled = m.loopShade([2, 5], { t0: 1, pxPerSec: 100 })
  expect(scrolled?.x, 'the shade scrolls with the viewport').toBe(100)
})
