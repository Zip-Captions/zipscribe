// CC-101.1 (L5, chromium): "the workbench never reflows under me" — CLS
// stays ≤ 0.02 across a mocked streaming transcription (job:segments batches
// + progress via the ziptest bridge, the fake-engine path of FR-2.0.6).
// Structural check on the PRODUCTION build: row count must reach the injected
// total (non-vacuity), then the summed `layout-shift` value (entries with
// recent user input excluded, per the CLS definition) must clear the budget.
// Generous CI timing, no absolute wall-clock assertions (conventions §
// Performance: structural budgets only in PR suites).
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET, makeSegments } from '../../tests/unit/workbench/helpers/fake-engine'

const JOB_ID = 'job-cls-1'
const BATCH_SIZES = [4, 8, 12, 16]
const CLS_BUDGET = 0.02

test.describe('CC-101.1: layout stability under streaming updates', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-101.1: streaming job:segments keeps cumulative CLS ≤ 0.02 with no layout thrash', async ({ page }) => {
    test.setTimeout(90_000)
    await page.addInitScript(() => {
      const sink: number[] = []
      ;(window as unknown as { __zipLayoutShifts: number[] }).__zipLayoutShifts = sink
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
          if (!shift.hadRecentInput && typeof shift.value === 'number') sink.push(shift.value)
        }
      }).observe({ type: 'layout-shift', buffered: true })
    })

    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean(window.__zipWorkbenchBridge), undefined, { timeout: 20_000 })
    await page.evaluate((asset) => window.__zipWorkbenchBridge?.openProject(asset), MEDIA_ASSET)

    await page.evaluate(
      (jobId) => window.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:progress', jobId, processedSec: 0, totalSec: 121.44 }),
      JOB_ID,
    )
    for (const size of BATCH_SIZES) {
      await page.evaluate(
        ([jobId, segments]) => window.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:segments', jobId, segments }),
        [JOB_ID, makeSegments(size)] as const,
      )
    }
    await page.evaluate(([jobId, processed, total]) => window.__zipWorkbenchBridge?.injectAsrEvent({ t: 'job:progress', jobId, processedSec: processed, totalSec: total }), [JOB_ID, 118, 121.44] as const)

    const expectedRows = BATCH_SIZES[BATCH_SIZES.length - 1] ?? 0
    await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid=streaming-segment-row]').length >= count,
      expectedRows,
      { timeout: 15_000 },
    )
    const rows = await page.locator('[data-testid=streaming-segment-row]').count()
    expect(rows, 'streamed rows actually rendered (non-vacuity of the CLS check)').toBeGreaterThanOrEqual(expectedRows)

    const cls = await page.evaluate(() => (window as unknown as { __zipLayoutShifts: number[] }).__zipLayoutShifts.reduce((sum, value) => sum + value, 0))
    expect(cls, `cumulative CLS across ${BATCH_SIZES.length} streaming updates must stay within the US-2.0.1 budget (measured ${cls.toFixed(4)})`).toBeLessThanOrEqual(CLS_BUDGET)
  })
})
