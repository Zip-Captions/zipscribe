// CC-06.2 (L4): single-speaker over-clustering guard — speech-2min.mp4 is a
// ONE-speaker clip; the real diarize worker must not hallucinate a second
// voice. The measurable reading (recorded as an ASSUMPTION in the unit
// report): in EVERY run the dominant cluster covers ≥ 90 % of the total
// frame-time budget AND the run reports a single speaker — 3 runs, guard
// holds 3/3 (a stricter witness of the ≥ 90 % criterion than a median).
// Frames cross the boundary as numbers only (SECURITY-03).
import { expect, test } from '@playwright/test'
import { assertDiarModelCachePresent, routeDiarNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from './helpers/diarization'
import type { DiarRunSummary } from './fixtures/harness'

const PORT = 4315
const RUNS = 3
const DOMINANT_SHARE_MIN = 0.9

let server: HarnessServer | undefined

function dominantShare(frames: DiarRunSummary['frames']): number {
  const bySpeaker = new Map<number, number>()
  let total = 0
  for (const f of frames) {
    const span = f.end - f.start
    total += span
    bySpeaker.set(f.speaker, (bySpeaker.get(f.speaker) ?? 0) + span)
  }
  if (total === 0) return 0
  return Math.max(...bySpeaker.values()) / total
}

test.describe('CC-06.2: single-speaker clip does not over-cluster (≥ 90 % guard)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(20 * 60_000)

  test.beforeAll(async () => {
    assertDiarModelCachePresent()
    server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/diarization/fixtures/harness.html' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-06.2: speech-2min.mp4 yields exactly one speaker with ≥ 90 % frame-time share in each of 3 runs', async ({ page }) => {
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeDiarNetwork(page, `http://127.0.0.1:${PORT}`, counters)
    await page.goto('/e2e/diarization/fixtures/harness.html')
    await page.waitForFunction(() => (globalThis as unknown as Record<string, unknown>).__zipscribeDiarHarnessReady === true, { timeout: 30_000 })

    for (let run = 0; run < RUNS; run++) {
      const summary = await page.evaluate((options) => (globalThis as unknown as { __zipscribeDiarHarness: { runDiarize(o: typeof options): Promise<DiarRunSummary> } }).__zipscribeDiarHarness.runDiarize(options), { fixture: 'fixtures/speech-2min.mp4' })
      expect(summary.error, `run ${run + 1} failed: ${JSON.stringify(summary.error)} (events: ${JSON.stringify(summary.eventSummary)})`).toBeUndefined()
      expect(summary.ok, `run ${run + 1} terminated with job:done`).toBe(true)
      expect(summary.frames.length, `run ${run + 1}: frames produced`).toBeGreaterThan(0)
      expect(summary.speakers, `run ${run + 1}: a single-speaker clip must cluster to ONE speaker (over-clustering guard)`).toBe(1)
      const share = dominantShare(summary.frames)
      expect(share, `run ${run + 1}: dominant cluster covers ${(share * 100).toFixed(1)} % of frame-time`).toBeGreaterThanOrEqual(DOMINANT_SHARE_MIN)
    }
    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
  })
})
