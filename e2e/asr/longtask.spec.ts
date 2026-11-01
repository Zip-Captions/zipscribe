// CC-05.3 (L4): no main-thread long task > 50 ms attributable to engine code
// while a ≥ 60 s window of the transcription pipeline runs in a real page
// (unit-05 spec "Inference never blocks the main thread"; AGENTS.md off-main-
// thread gate). The page's PerformanceObserver('longtask') only sees the PAGE
// context — inference/demux/decode live in workers — so any > 50 ms entry
// means engine work (or a synchronous bridge) leaked onto the main thread.
//
// RED (tonight): `@engine/asr/worker-host` / `@engine/asr/blockize` do not
// exist, so runTranscription rejects on the dynamic import with the module-
// resolution error — the intended RED reason (the stub asr.worker would only
// produce an empty run once they land; the stub's instant job:done with zero
// segments is caught by the segment-count assertion).
//
// Fixture choice: the generated perf fixture (audio-120min.mp4, `pnpm
// fixtures --perf`) when present, else speech-10min.mp4 repeated until the
// observation window reaches 60 s — the gate must measure a real window, not
// an early exit.
import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { assertModelCachePresent, routeAsrNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from './helpers/asr'

const PORT = 4313
const LONG_TASK_LIMIT_MS = 50
const MIN_WINDOW_MS = 60_000
const PERF_FIXTURE = join(REPO_ROOT, 'fixtures/audio-120min.mp4')

let server: HarnessServer | undefined

test.describe('CC-05.3: engine code never blocks the main thread', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(existsSync(PERF_FIXTURE) ? 35 * 60_000 : 25 * 60_000)

  test.beforeAll(async () => {
    assertModelCachePresent()
    server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/asr/fixtures/harness.html' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-05.3: no main-thread long task > 50 ms during a ≥ 60 s transcription window', async ({ page }) => {
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeAsrNetwork(page, `http://127.0.0.1:${PORT}`, counters)
    await page.goto('/e2e/asr/fixtures/harness.html')
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeAsrHarnessReady === true, { timeout: 30_000 })

    const harness = {
      start: () => page.evaluate(() => (globalThis as unknown as { __zipscribeAsrHarness: { startLongTaskWatch(): void } }).__zipscribeAsrHarness.startLongTaskWatch()),
      stop: () => page.evaluate(() => (globalThis as unknown as { __zipscribeAsrHarness: { stopLongTaskWatch(): { duration: number; startTime: number; name: string }[] } }).__zipscribeAsrHarness.stopLongTaskWatch()),
    }
    await harness.start()

    const fixture = existsSync(PERF_FIXTURE) ? 'fixtures/audio-120min.mp4' : 'fixtures/speech-10min.mp4'
    let observedMs = 0
    let runs = 0
    let firstSummary: Awaited<ReturnType<typeof runOnce>> | undefined
    const startedAt = Date.now()
    async function runOnce() {
      return page.evaluate((options) => (globalThis as unknown as { __zipscribeAsrHarness: { runTranscription(o: typeof options): Promise<Record<string, unknown>> } }).__zipscribeAsrHarness.runTranscription(options), {
        fixture,
        modelId: 'whisper-tiny-timestamped',
        device: 'wasm',
        language: 'en',
        tier: 'T2',
      })
    }
    while (observedMs < MIN_WINDOW_MS && runs < 4) {
      const summary = await runOnce()
      runs += 1
      observedMs = Date.now() - startedAt
      firstSummary ??= summary
    }
    const longTasks = await harness.stop()

    // The window itself must have been real (a trivially-short observation
    // could never fail the gate).
    expect(longTasks.length >= 0 && observedMs, `observation window must reach ${MIN_WINDOW_MS} ms (observed ${observedMs} ms over ${runs} run(s) of ${fixture})`).toBeGreaterThan(MIN_WINDOW_MS)
    // The run actually transcribed (RED today: this throws before it is ever
    // reached — harness module not resolvable).
    expect(firstSummary, 'at least one run completed').toBeDefined()
    expect(firstSummary!.error, `run failed: ${JSON.stringify(firstSummary!.error)}`).toBeUndefined()
    expect(Number(firstSummary!.segmentCount)).toBeGreaterThan(0)
    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')} (models must come from the local cache; wasm from /wasm/)`).toEqual([])
    expect(counters.modelHost).toBeGreaterThan(0)

    const violations = longTasks.filter((entry) => entry.duration > LONG_TASK_LIMIT_MS)
    expect(violations, `main-thread long tasks > ${LONG_TASK_LIMIT_MS} ms during a ${Math.round(observedMs / 1000)} s transcription window: ${JSON.stringify(violations.map((v) => ({ durationMs: Math.round(v.duration), name: v.name })))}`).toEqual([])
  })
})
