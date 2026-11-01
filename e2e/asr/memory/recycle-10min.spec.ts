// CC-05.2 (L4, `memory` project): the 10-minute worker-recycling memory gate
// — peak heap stays ≤ 50 MB above baseline (settings.yml
// testing.memory_tests) while a real `speech-10min.mp4` transcription runs
// with `recycleEveryNWindows: 3`, AND recycling is transcript-preserving:
// blocks are identical to an unrecycled run of the same audio (CC-05.9's
// promise, verified end-to-end, not just in the L1 fake-session suite).
//
// Why the spec owns its server: same Playwright-webServer doctrine as
// e2e/media/memory/decode-memory.spec.ts — the root preview (4310) never
// sends COOP/COEP, so this spec spawns the isolated harness vite config
// (ZIPSCRIBE_ISOLATED=1 → COOP/COEP/Origin-Agent-Cluster) on port 4314 in
// beforeAll and kills it in afterAll. The `memory` project pins
// channel: 'chromium' (headless-shell throws SecurityError from
// measureUserAgentSpecificMemory).
//
// RED (tonight): runTranscription rejects on the missing
// `@engine/asr/worker-host` dynamic import; infrastructure preconditions
// (server up, crossOriginIsolated, model cache present) run FIRST so an
// infra break is never misattributed to the missing production code.
import { expect, test } from '@playwright/test'
import { assertModelCachePresent, routeAsrNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from '../helpers/asr'

const PORT = 4314
const BASE = `http://127.0.0.1:${PORT}`
const LIMIT_MB = 50
const SAMPLE_MS = 1_500
const TOLERANCE_MB = 50 // measureUserAgentSpecificMemory's own ±50 MB granularity

interface RunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  cancelled: boolean
  downgraded: boolean
  workerEpochs: number
  segmentCount: number
  blocks: { start: number; end: number; text: string }[]
  hypothesis: string
  eventSummary: { t: string; code?: string; notice?: string }[]
}

const baseOptions = {
  fixture: 'fixtures/speech-10min.mp4',
  modelId: 'whisper-tiny-timestamped',
  device: 'wasm' as const,
  language: 'en',
  tier: 'T2' as const,
}

test.describe('CC-05.2: 10-minute run recycles workers within the memory gate', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: BASE })
  test.setTimeout(25 * 60_000)

  let server: HarnessServer | undefined

  test.beforeAll(async () => {
    assertModelCachePresent()
    server = await startHarnessServer(PORT, { isolated: true, probePath: '/e2e/asr/fixtures/harness.html' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-05.2: recycled 10-minute run stays ≤ 50 MB above baseline with identical blocks', async ({ page }) => {
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeAsrNetwork(page, BASE, counters)
    await page.goto('/e2e/asr/fixtures/harness.html')
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeAsrHarnessReady === true, { timeout: 30_000 })
    // Infrastructure preconditions BEFORE the thing under test.
    expect(await page.evaluate(() => globalThis.crossOriginIsolated), 'isolated harness must make the page cross-origin isolated').toBe(true)

    const measurement = await page.evaluate(
      async ({ options, sampleMs }) => {
        type Measured = { bytes: number }
        const performanceMeasured = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<Measured> }
        if (typeof performanceMeasured.measureUserAgentSpecificMemory !== 'function') {
          throw new Error('measureUserAgentSpecificMemory unavailable (needs COOP/COEP + Chromium)')
        }
        const measure = () => performanceMeasured.measureUserAgentSpecificMemory!().then((result) => result.bytes / 1024 / 1024)
        const harness = (globalThis as unknown as { __zipscribeAsrHarness: { runTranscription(o: typeof options): Promise<RunSummary> } }).__zipscribeAsrHarness
        await new Promise((resolve) => setTimeout(resolve, 500))
        const baseline = await measure()
        let peak = baseline
        const run = harness.runTranscription(options)
        let finished = false
        void run.then(
          () => (finished = true),
          () => (finished = true),
        )
        while (!finished) {
          peak = Math.max(peak, await measure())
          await new Promise((resolve) => setTimeout(resolve, sampleMs))
        }
        const result = await run // re-throws the pipeline error in RED
        peak = Math.max(peak, await measure())
        return { baseline, peak, result }
      },
      { options: { ...baseOptions, recycleEveryNWindows: 3 }, sampleMs: SAMPLE_MS },
    )
    const recycled = measurement.result
    expect(recycled.error, `recycled run failed: ${JSON.stringify(recycled.error)} (events: ${JSON.stringify(recycled.eventSummary)})`).toBeUndefined()
    expect(recycled.cancelled).toBe(false)
    expect(recycled.segmentCount, 'the run produced segments').toBeGreaterThan(0)
    expect(recycled.workerEpochs, `recycling every 3 windows over a 10-minute run must spawn ≥ 2 worker instances (epochs: ${recycled.workerEpochs})`).toBeGreaterThanOrEqual(2)
    expect(recycled.eventSummary.some((event) => event.notice === 'WORKER_RECYCLED'), 'the host emitted WORKER_RECYCLED notices').toBe(true)

    const growth = measurement.peak - measurement.baseline
    expect(
      growth,
      `heap grew ${growth.toFixed(1)} MB (baseline ${measurement.baseline.toFixed(1)}, peak ${measurement.peak.toFixed(1)}) over a 10-minute recycled run — limit ${LIMIT_MB} MB + ${TOLERANCE_MB} MB measurement tolerance`,
    ).toBeLessThanOrEqual(LIMIT_MB + TOLERANCE_MB)

    // Recycling must be transcript-preserving (CC-05.9 end-to-end): the same
    // audio without recycling produces identical blocks.
    const unrecycled = await page.evaluate((options) => (globalThis as unknown as { __zipscribeAsrHarness: { runTranscription(o: typeof options): Promise<RunSummary> } }).__zipscribeAsrHarness.runTranscription(options), baseOptions)
    expect(unrecycled.error, `unrecycled run failed: ${JSON.stringify(unrecycled.error)}`).toBeUndefined()
    expect(JSON.stringify(unrecycled.blocks), 'recycled blocks must equal unrecycled blocks (recycling is invisible in the transcript)').toEqual(JSON.stringify(recycled.blocks))
    expect(unrecycled.workerEpochs, 'unrecycled run kept one worker epoch').toBe(1)

    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
    expect(counters.modelHost).toBeGreaterThan(0)
  })
})
