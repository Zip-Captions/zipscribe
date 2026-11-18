// CC-301.3 (L4): no main-thread long task > 50 ms while the REAL translation
// session translates 1000 blocks in a real Chromium page (AGENTS.md
// off-main-thread gate; unit-301 spec "the session yields between batches").
// The session runs with its PRODUCTION default scheduler; the page's
// PerformanceObserver('longtask') sees the page context — any > 50 ms entry
// during the run means the batching/yielding leaked synchronous work.
//
// The scripted Translator/LanguageDetector live in the harness (the built-in
// APIs are Chrome-internal, not the thing under test — their adapter
// contract is unit-tested). NOTHING of session/plan/track/applyEntries is
// stubbed.
//
// Single fixed-port spec-owned server (4318) per the e2e doctrine;
// ZIPSCRIBE_CHILD guard: the gates-scaffold child run must not spawn it.
import { expect, test } from '@playwright/test'
import { startHarnessServer, stopHarnessServer, type HarnessServer } from '../asr/helpers/asr'

const PORT = 4318
const LONG_TASK_LIMIT_MS = 50
const BLOCK_COUNT = 1000

let server: HarnessServer | undefined

test.describe('CC-301.3: the translation session never blocks the main thread', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  // 1000 sequential scripted translates at the criterion's 30–90 ms
  // per-call profile (within the stated 30–300 ms envelope) ≈ 1 min.
  test.setTimeout(6 * 60_000)

  test.beforeAll(async () => {
    server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/translate/fixtures/harness.html', configPath: 'e2e/translate/fixtures/vite.harness.config.ts' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-301.3: 1000-block session run produces no main-thread long task > 50 ms', async ({ page }) => {
    const blocked: string[] = []
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1' && url.port === String(PORT)) return route.continue()
      blocked.push(url.origin)
      return route.abort()
    })

    await page.goto('/e2e/translate/fixtures/harness.html')
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeTranslateHarnessReady === true, { timeout: 30_000 })

    await page.evaluate(() => (globalThis as unknown as { __zipscribeTranslateHarness: { startLongTaskWatch(): void } }).__zipscribeTranslateHarness.startLongTaskWatch())
    const summary = (await page.evaluate((blockCount) => (globalThis as unknown as { __zipscribeTranslateHarness: { run(o: { blockCount: number }): Promise<Record<string, unknown>> } }).__zipscribeTranslateHarness.run({ blockCount }), BLOCK_COUNT)) as unknown as { ok: boolean; error?: { code: string; detail?: string }; planned: number; translated: number; passThrough: number; failed: number; cancelled: boolean; entriesApplied: number; translateCalls: number }
    const longTasks = await page.evaluate(() => (globalThis as unknown as { __zipscribeTranslateHarness: { stopLongTaskWatch(): { duration: number; startTime: number; name: string }[] } }).__zipscribeTranslateHarness.stopLongTaskWatch())

    expect(summary.error, `session run failed: ${JSON.stringify(summary.error)}`).toBeUndefined()
    expect(summary.ok, 'run completed').toBe(true)
    // The run must have been REAL: the full workload translated and applied.
    expect(summary.planned).toBe(BLOCK_COUNT)
    expect(summary.translated, 'all blocks translated').toBe(BLOCK_COUNT)
    expect(summary.failed).toBe(0)
    expect(summary.cancelled).toBe(false)
    expect(summary.entriesApplied, 'job output applied through the frozen track module').toBe(BLOCK_COUNT)
    expect(summary.translateCalls, 'every block crossed the engine seam').toBe(BLOCK_COUNT)
    expect(blocked, `non-allowlisted origins requested: ${[...new Set(blocked)].join(', ')}`).toEqual([])

    const violations = longTasks.filter((entry) => entry.duration > LONG_TASK_LIMIT_MS)
    expect(violations, `main-thread long tasks > ${LONG_TASK_LIMIT_MS} ms during the ${BLOCK_COUNT}-block session run: ${JSON.stringify(violations.map((v) => ({ durationMs: Math.round(v.duration), name: v.name })))}`).toEqual([])
  })
})
