// CC-06.5 (L4): concurrent ASR + diarize — one media decode tee-ing identical
// PcmChunks to the ASR worker (buffer) and the diarize worker (live stream
// port) IN PARALLEL produces results identical to running the two workers
// SEQUENTIALLY on the same fixture. Determinism doctrine: diar frames are
// compared after label canonicalization (first-appearance order) and 3-decimal
// rounding; ASR word identity compares [start, end, textLen] — the words' TEXT
// never crosses the page boundary (SECURITY-03).
//
// Structural preconditions (frames > 0, words > 0) keep an empty-vs-empty
// comparison from passing vacuously while the unit-01 diarize.worker stub is
// still in place — that is the readable RED entry.
import { expect, test } from '@playwright/test'
import { assertDiarModelCachePresent, routeDiarNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from './helpers/diarization'
import type { AsrRunSummary, DiarRunSummary } from './fixtures/harness'

const PORT = 4315

let server: HarnessServer | undefined

function canonicalFrames(summary: DiarRunSummary): (readonly [number, number, number, number])[] {
  const sorted = [...summary.frames].sort((a, b) => a.start - b.start || a.speaker - b.speaker)
  const order: number[] = []
  for (const f of sorted) if (!order.includes(f.speaker)) order.push(f.speaker)
  const r = (x: number) => Math.round(x * 1000) / 1000
  return sorted.map((f) => [r(f.start), r(f.end), order.indexOf(f.speaker), r(f.prob)] as const)
}

function canonicalWords(summary: AsrRunSummary): (readonly [number, number, number])[] {
  const r = (x: number) => Math.round(x * 1000) / 1000
  return [...summary.words].sort((a, b) => a.start - b.start || a.end - b.end).map((w) => [r(w.start), r(w.end), w.textLen] as const)
}

test.describe('CC-06.5: concurrent tee run matches sequential runs', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(25 * 60_000)

  test.beforeAll(async () => {
    assertDiarModelCachePresent()
    server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/diarization/fixtures/harness.html' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-06.5: diar frames and ASR words from the concurrent tee equal the sequential run', async ({ page }) => {
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeDiarNetwork(page, `http://127.0.0.1:${PORT}`, counters)
    await page.goto('/e2e/diarization/fixtures/harness.html')
    await page.waitForFunction(() => (globalThis as unknown as Record<string, unknown>).__zipscribeDiarHarnessReady === true, { timeout: 30_000 })

    const sequential = await page.evaluate((options) => (globalThis as unknown as { __zipscribeDiarHarness: { runSequential(o: typeof options): Promise<{ diar: DiarRunSummary; asr: AsrRunSummary }> } }).__zipscribeDiarHarness.runSequential(options), { fixture: 'fixtures/speech-2spk-2min.mp4' })
    expect(sequential.diar.error, `sequential diarize failed: ${JSON.stringify(sequential.diar.error)}`).toBeUndefined()
    expect(sequential.asr.error, `sequential asr failed: ${JSON.stringify(sequential.asr.error)}`).toBeUndefined()
    expect(sequential.diar.frames.length, 'sequential run produced frames (stub-guard against vacuous equality)').toBeGreaterThan(0)
    expect(sequential.asr.words.length, 'sequential run produced words').toBeGreaterThan(0)

    const concurrent = await page.evaluate((options) => (globalThis as unknown as { __zipscribeDiarHarness: { runConcurrent(o: typeof options): Promise<{ diar: DiarRunSummary; asr: AsrRunSummary }> } }).__zipscribeDiarHarness.runConcurrent(options), { fixture: 'fixtures/speech-2spk-2min.mp4' })
    expect(concurrent.diar.error, `concurrent diarize failed: ${JSON.stringify(concurrent.diar.error)}`).toBeUndefined()
    expect(concurrent.asr.error, `concurrent asr failed: ${JSON.stringify(concurrent.asr.error)}`).toBeUndefined()
    expect(concurrent.diar.frames.length, 'concurrent run produced frames').toBeGreaterThan(0)

    expect(canonicalFrames(concurrent.diar), 'tee-consumed diarization equals the sequential frames (labels canonicalized, 3-decimal grid)').toEqual(canonicalFrames(sequential.diar))
    expect(canonicalWords(concurrent.asr), 'tee-consumed ASR equals the sequential words (positions + lengths)').toEqual(canonicalWords(sequential.asr))
    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
  })
})
