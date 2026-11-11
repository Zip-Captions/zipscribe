// CC-06.1 (L4): 2-speaker fixture end-to-end — the REAL diarize worker over
// the protocol union produces frames whose per-word speaker accuracy (≥ 85 %)
// and DER-style error (≤ 20 %) hold against the fixture ground truth, as the
// MEDIAN of 3 runs (no cherry-picking; metrics are the reviewed test-owned
// calculator in tests/unit/diarization/helpers/metrics.ts).
//
// Ground truth (SECURITY-03): `fixtures/harness/ground-truth/speech-2spk-2min.json`
// stays on the node side — only frames (numbers) cross the page boundary;
// failure output carries counts and scores, never text. The CC-06.1
// prerequisite assertion (every ground-truth word carries a string `speaker`,
// exactly 2 labels, two contiguous runs) fails FIRST until the ground truth
// gains speaker annotation — that is the sanctioned RED entry point, alongside
// the absent model cache and the unit-01 diarize.worker stub.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { derStyle, median, wordSpeakerAccuracy, type GtWord } from '../../tests/unit/diarization/helpers/metrics'
import { assertDiarModelCachePresent, routeDiarNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from './helpers/diarization'
import type { DiarRunSummary } from './fixtures/harness'

const PORT = 4315
const RUNS = 3

let server: HarnessServer | undefined

interface GtFile {
  words: { text: string; start: number; end: number; speaker?: string }[]
}

async function runDiar(page: import('@playwright/test').Page, fixture: string): Promise<DiarRunSummary> {
  return page.evaluate((options) => (globalThis as unknown as { __zipscribeDiarHarness: { runDiarize(o: typeof options): Promise<DiarRunSummary> } }).__zipscribeDiarHarness.runDiarize(options), { fixture })
}

test.describe('CC-06.1: 2-speaker accuracy ≥ 85 % / DER-style ≤ 20 % (3-run median)', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(20 * 60_000)

  test.beforeAll(async () => {
    server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/diarization/fixtures/harness.html' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-06.1: speech-2spk-2min.mp4 ground truth carries exactly two contiguous speaker runs', () => {
    const gt = JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures/harness/ground-truth/speech-2spk-2min.json'), 'utf8')) as GtFile
    expect(gt.words.length, 'ground truth has words').toBeGreaterThan(0)
    for (const w of gt.words) {
      expect(typeof w.speaker, `word [${w.start.toFixed(2)}] must carry a speaker label (CC-06.1 prerequisite)`).toBe('string')
      expect((w.speaker as string).length).toBeGreaterThan(0)
    }
    const labels = [...new Set(gt.words.map((w) => w.speaker))]
    expect(labels.length, 'exactly two speakers').toBe(2)
    const runs: string[] = []
    for (const w of gt.words) {
      const last = runs[runs.length - 1]
      if (w.speaker !== last) runs.push(w.speaker as string)
    }
    expect(runs.length, 'two contiguous runs (speaker switch happens exactly once)').toBe(2)
  })

  test('CC-06.1: 3-run median word accuracy ≥ 85 % and DER-style ≤ 20 %', async ({ page }) => {
    assertDiarModelCachePresent()
    const gt = JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures/harness/ground-truth/speech-2spk-2min.json'), 'utf8')) as GtFile
    const words: GtWord[] = gt.words.map((w) => ({ start: w.start, end: w.end, speaker: w.speaker as string }))
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeDiarNetwork(page, `http://127.0.0.1:${PORT}`, counters)
    await page.goto('/e2e/diarization/fixtures/harness.html')
    await page.waitForFunction(() => (globalThis as unknown as Record<string, unknown>).__zipscribeDiarHarnessReady === true, { timeout: 30_000 })

    const accuracies: number[] = []
    const ders: number[] = []
    for (let run = 0; run < RUNS; run++) {
      const summary = await runDiar(page, 'fixtures/speech-2spk-2min.mp4')
      expect(summary.error, `run ${run + 1} failed: ${JSON.stringify(summary.error)} (events: ${JSON.stringify(summary.eventSummary)})`).toBeUndefined()
      expect(summary.ok, `run ${run + 1} terminated with job:done`).toBe(true)
      expect(summary.frames.length, `run ${run + 1}: frames produced`).toBeGreaterThan(0)
      expect(summary.speakers, `run ${run + 1}: at least one speaker`).toBeGreaterThanOrEqual(1)
      for (const f of summary.frames) {
        expect(f.end, 'frame end after start').toBeGreaterThan(f.start)
        expect(f.prob).toBeGreaterThanOrEqual(0)
        expect(f.prob).toBeLessThanOrEqual(1)
        expect(Number.isInteger(f.speaker)).toBe(true)
      }
      const accuracy = wordSpeakerAccuracy(words, summary.frames)
      const der = derStyle(words, summary.frames)
      accuracies.push(accuracy.accuracy)
      ders.push(der.der)
    }
    const medianAccuracy = median(accuracies)
    const medianDer = median(ders)
    expect(medianAccuracy, `3-run median word accuracy ${(medianAccuracy * 100).toFixed(2)} % below threshold (runs: ${accuracies.map((a) => (a * 100).toFixed(1)).join('/')})`).toBeGreaterThanOrEqual(0.85)
    expect(medianDer, `3-run median DER-style ${(medianDer * 100).toFixed(2)} % above threshold (runs: ${ders.map((d) => (d * 100).toFixed(1)).join('/')})`).toBeLessThanOrEqual(0.2)
    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
  })
})
