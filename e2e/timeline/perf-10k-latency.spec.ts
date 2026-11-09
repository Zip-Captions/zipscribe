// CC-103.4 (L5, chromium): US-2.2.6 — with 10 000 blocks loaded, the p95 of
// INPUT→STATE latency stays < 16 ms per interaction while panning, dragging
// and zooming (the unit file states this gate; conventions § Performance keeps
// the absolute floors as [RQ]). INP-style sampler: real input events are
// dispatched IN-PAGE (the page must not gate on isTrusted), and each sample
// measures the time until the bridge state visibly moved — a page that does
// nothing produces stalled (timed-out) samples and fails the non-vacuity
// guards instead of passing vacuously.
//
// The second test doubles as the ACCEPT-LEVEL pin of the CC-103.1 anchor zoom
// math under real load (cited mid-title): ⌘+wheel must keep the time under the
// cursor fixed at the NEW zoom.
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'
import { SAMPLE_SPEAKERS } from '../../tests/unit/editor/helpers/fixture-project'
import { perfBlocksFrom } from '../../tests/unit/timeline/helpers/timeline-fixture'

const SRC = '/fixtures/speech-2min.mp4'
const BLOCK_COUNT = 10_000
const BATCH = 500
const P95_BUDGET_MS = 16
const SAMPLES = { wheelPan: 40, zoomKey: 30, wheelZoom: 30, rulerClick: 40, blockClick: 25, playheadDrag: 30 }

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; blockCount: number; videoReady: boolean }
}
interface TimelineBridge {
  getTimelineState(): { t0: number; pxPerSec: number; focusedBlockId: string | null; selectionAnchorBlockId: string | null; selectionFocusBlockId: string | null; blockCount: number; dragging: boolean; snapEnabled: boolean }
  getBlock(blockId: string): { start: number; end: number; wordCount: number } | null
  timeAtX(x: number): number
  xAtTime(t: number): number
}

const SAMPLER = `
window.__zipPerf = (() => {
  const br = () => window.__zipTimelineBridge
  const ed = () => window.__zipEditorBridge
  if (!br || !ed) throw new Error('bridge missing')
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()))
  async function measure(dispatch, changed, budgetMs) {
    const t0 = performance.now()
    await dispatch()
    let waited = 0
    while (!changed() && waited < budgetMs) {
      await raf()
      waited = performance.now() - t0
    }
    if (!changed()) return -1
    return performance.now() - t0
  }
  return { measure }
})()
`

const p95 = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? Number.POSITIVE_INFINITY
}

async function bootAndSeed(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean(window.__zipEditorBridge), undefined, { timeout: 20_000 })
  await page.evaluate(([asset, src]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src), [MEDIA_ASSET, SRC] as const)
  await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
  const batches = Array.from({ length: BLOCK_COUNT / BATCH }, (_, i) => perfBlocksFrom(i * BATCH, BATCH))
  await page.evaluate(
    ([all, speakers]) => {
      const bridge = (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge
      if (!bridge) throw new Error('editor bridge gone')
      for (let i = 0; i < all.length; i++) {
        const reject = bridge.command('captions-import', { blocks: all[i], speakers: i === 0 ? speakers : undefined, replace: i === 0 })
        if (reject !== null) throw new Error(`seed batch ${i} rejected: ${reject.code}`)
      }
    },
    [batches, SAMPLE_SPEAKERS] as const,
  )
  await page.waitForFunction(() => (window as unknown as { __zipTimelineBridge?: TimelineBridge }).__zipTimelineBridge?.getTimelineState().blockCount === 10_000, undefined, { timeout: 60_000 })
  await page.evaluate(SAMPLER)
}

test.describe('CC-103.4: input→state latency p95 < 16 ms at 10k blocks', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-103.4: wheel-pan, zoom keys, ⌘+wheel zoom, ruler seek, block click and playhead scrub all stay under p95 16 ms', async ({ page }) => {
    test.setTimeout(240_000)
    await bootAndSeed(page)
    // The non-vacuity floor: 10k blocks really loaded before any timing.
    const loaded = await page.evaluate(() => (window as unknown as { __zipTimelineBridge?: TimelineBridge }).__zipTimelineBridge?.getTimelineState().blockCount)
    expect(loaded).toBe(BLOCK_COUNT)

    const results = await page.evaluate(async (samples) => {
      const br = () => (window as unknown as { __zipTimelineBridge?: TimelineBridge }).__zipTimelineBridge as TimelineBridge
      const ed = () => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge as EditorBridge
      const w = window as unknown as { __zipPerf: { measure(dispatch: () => void | Promise<void>, changed: () => boolean, budgetMs: number): Promise<number> } }
      const canvas = document.querySelector('[data-testid=timeline-canvas]') as HTMLCanvasElement | null
      if (!canvas) throw new Error('timeline canvas missing')
      const box = canvas.getBoundingClientRect()
      const laneY = box.top + box.height * 0.6
      const rulerY = box.top + Math.min(6, box.height * 0.08)
      const pointer = (type: string, x: number, y: number, extra: Record<string, number | boolean> = {}): void => {
        canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1, ...extra }))
      }
      const out: { wheelPan: number[]; zoomKey: number[]; wheelZoom: number[]; rulerClick: number[]; blockClick: number[]; playheadDrag: number[] } = { wheelPan: [], zoomKey: [], wheelZoom: [], rulerClick: [], blockClick: [], playheadDrag: [] }
      const budget = 500

      for (let i = 0; i < samples.wheelPan; i++) {
        const sign = i % 2 === 0 ? 1 : -1
        const before = br().getTimelineState().t0
        out.wheelPan.push(await w.__zipPerf.measure(() => {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 * sign, bubbles: true, cancelable: true, clientX: box.left + 400, clientY: rulerY }))
        }, () => Math.abs(br().getTimelineState().t0 - before) > 0.001, budget))
      }

      for (let i = 0; i < samples.zoomKey; i++) {
        const zoomIn = i % 2 === 0
        const key = zoomIn ? '=' : '-'
        const before = br().getTimelineState().pxPerSec
        out.zoomKey.push(await w.__zipPerf.measure(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }))
        }, () => (zoomIn ? br().getTimelineState().pxPerSec > before : br().getTimelineState().pxPerSec < before), budget))
      }

      for (let i = 0; i < samples.wheelZoom; i++) {
        const sign = i % 2 === 0 ? 1 : -1
        const before = br().getTimelineState().pxPerSec
        out.wheelZoom.push(await w.__zipPerf.measure(() => {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 * sign, ctrlKey: true, bubbles: true, cancelable: true, clientX: box.left + 400, clientY: laneY }))
        }, () => br().getTimelineState().pxPerSec !== before, budget))
      }

      for (let i = 0; i < samples.rulerClick; i++) {
        const x = 150 + ((i * 47) % 500)
        const before = ed().getEditorState().playhead
        out.rulerClick.push(await w.__zipPerf.measure(() => {
          pointer('pointerdown', box.left + x, rulerY)
          pointer('pointerup', box.left + x, rulerY)
        }, () => Math.abs(ed().getEditorState().playhead - before) > 0.001, budget))
      }

      // Block click on a block at least 1.5 px wide (skip sub-pixel hits —
      // they could land on a gap and stall the sample, which is the
      // non-vacuity guard doing its job).
      const pps = br().getTimelineState().pxPerSec
      for (let i = 0; i < samples.blockClick; i++) {
        const k = 500 + ((i * 137) % 9_000)
        const mid = k * 0.012 + 0.005
        if (0.01 * pps < 1.5) {
          out.blockClick.push(-1)
          continue
        }
        const x = br().xAtTime(mid)
        if (x < 40 || x > box.width - 40) {
          out.blockClick.push(-1)
          continue
        }
        const wantId = `blk_perf_${String(k)}`
        out.blockClick.push(await w.__zipPerf.measure(() => {
          pointer('pointerdown', box.left + x, laneY)
          pointer('pointerup', box.left + x, laneY)
        }, () => br().getTimelineState().selectionFocusBlockId === wantId, budget))
      }

      for (let i = 0; i < samples.playheadDrag; i++) {
        const sign = i % 2 === 0 ? 1 : -1
        const playhead = ed().getEditorState().playhead
        const x = br().xAtTime(playhead)
        const before = ed().getEditorState().playhead
        out.playheadDrag.push(await w.__zipPerf.measure(() => {
          pointer('pointerdown', box.left + Math.min(Math.max(x, 10), box.width - 10), rulerY)
          pointer('pointermove', box.left + Math.min(Math.max(x + 40 * sign, 10), box.width - 10), rulerY)
        }, () => Math.abs(ed().getEditorState().playhead - before) > 0.001, budget))
        pointer('pointerup', box.left + Math.min(Math.max(br().xAtTime(ed().getEditorState().playhead), 10), box.width - 10), rulerY)
      }

      const finalBlockCount = br().getTimelineState().blockCount
      return { out, finalBlockCount }
    }, SAMPLES)

    expect(results.finalBlockCount, 'the 10k set survived the whole sample run').toBe(BLOCK_COUNT)
    for (const [name, values] of Object.entries(results.out)) {
      const ok = values.filter((v) => v >= 0)
      expect(ok.length, `${name}: ≥ 90 % of samples saw a real state change (non-vacuity)`).toBeGreaterThanOrEqual(values.length * 0.9)
      expect(ok.every((v) => v > 0), `${name}: every counted sample measured a real event`).toBe(true)
      expect(p95(ok), `${name}: p95 input→state latency under the 16 ms budget (US-2.2.6)`).toBeLessThan(P95_BUDGET_MS)
    }
  })

  test('CC-103.4: ⌘+wheel zoom under 10k blocks keeps the time under the cursor fixed (CC-103.1 anchor-math acceptance)', async ({ page }) => {
    test.setTimeout(120_000)
    await bootAndSeed(page)
    const drift = await page.evaluate(async () => {
      const br = () => (window as unknown as { __zipTimelineBridge?: TimelineBridge }).__zipTimelineBridge as TimelineBridge
      const canvas = document.querySelector('[data-testid=timeline-canvas]') as HTMLCanvasElement | null
      if (!canvas) throw new Error('timeline canvas missing')
      const box = canvas.getBoundingClientRect()
      const x = box.left + 400
      const y = box.top + box.height * 0.6
      const raf = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))
      const maxDriftPx: number[] = []
      let changed = 0
      for (let i = 0; i < 20; i++) {
        const before = br().getTimelineState()
        const tAtCursor = br().timeAtX(400)
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: i % 2 === 0 ? 120 : -120, ctrlKey: true, bubbles: true, cancelable: true, clientX: x, clientY: y }))
        let waited = 0
        let after = br().getTimelineState()
        while (after.pxPerSec === before.pxPerSec && waited < 500) {
          await raf()
          after = br().getTimelineState()
          waited += 16
        }
        if (after.pxPerSec !== before.pxPerSec) changed += 1
        const driftSec = Math.abs(br().timeAtX(400) - tAtCursor)
        maxDriftPx.push(driftSec * (after.pxPerSec || before.pxPerSec))
      }
      return { maxDriftPx, changed }
    })
    // dispatchEvent is synchronous through the page's own handlers; the state
    // must already reflect the zoom when the dispatch returned.
    expect(drift.changed, 'the zoom actually happened on every ⌘+wheel (non-vacuity)').toBeGreaterThanOrEqual(18)
    expect(Math.max(...drift.maxDriftPx), 'the anchor time drifts ≤ 0.75 px at the new zoom (CC-103.1 anchor math)').toBeLessThanOrEqual(0.75)
  })
})
