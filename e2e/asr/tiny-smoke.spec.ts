// CC-05.5 (L4): the CI-served `tiny` whisper model (T2, wasm) on
// speech-2min.mp4 stays within 5 percentage points of the published spike
// baseline — the end-to-end proof that the unit-05 pipeline (worker host →
// real asr.worker → transcriber → blockize) yields usable transcripts,
// scored through the frozen CC-02.6 WER CLI (tools/eval/wer.mjs).
//
// Baseline doctrine (unit-02): the threshold is READ from
// docs/spikes/model-eval-report.json rows[whisper-tiny_timestamped,T2].wer —
// the spike publishes that number in percentage points ("WER ≈ 1") — and
// never invented. A model/pipeline that gets worse than spike+5 fails;
// a better score passes.
//
// Transcript hygiene (SECURITY-03): hypothesis/reference text goes only to
// the scratch dir under <repo>/.night/ (gitignored), is handed to the WER CLI
// as file paths, and is deleted afterwards. Only the numeric score appears in
// assertions and failure output.
//
// RED (tonight): runTranscription rejects — `@engine/asr/worker-host` is not
// implemented (dynamic-import failure in the harness), so nothing scores.
import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { assertModelCachePresent, routeAsrNetwork, spikeTinyWerBaseline, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from './helpers/asr'

const PORT = 4313
const TOLERANCE_POINTS = 5

let server: HarnessServer | undefined

interface RunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  cancelled: boolean
  segmentCount: number
  wordCount: number
  blocks: { start: number; end: number; text: string }[]
  hypothesis: string
  eventSummary: { t: string; code?: string; notice?: string }[]
}

function scoreWer(runId: string, reference: string, hypothesis: string): number {
  const scratch = join(REPO_ROOT, '.night', 'wer', runId)
  mkdirSync(scratch, { recursive: true })
  try {
    const refPath = join(scratch, 'reference.txt')
    const hypPath = join(scratch, 'hypothesis.txt')
    writeFileSync(refPath, reference, 'utf8')
    writeFileSync(hypPath, hypothesis, 'utf8')
    const run = spawnSync('node', ['tools/eval/wer.mjs', refPath, hypPath], { cwd: REPO_ROOT, encoding: 'utf8' })
    if (run.status !== 0) throw new Error(`WER CLI failed (${run.status}): ${run.stderr.slice(0, 300)}`)
    const numbers = run.stdout.trim().split(/\s+/).filter((token) => Number.isFinite(Number(token)))
    const last = numbers[numbers.length - 1]
    if (last === undefined) throw new Error(`WER CLI printed no score: ${run.stdout.slice(0, 200)}`)
    return Number(last) * 100
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

test.describe('CC-05.5: tiny-model end-to-end WER within spike baseline + 5 points', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(15 * 60_000)

  test.beforeAll(async () => {
    assertModelCachePresent()
    server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/asr/fixtures/harness.html' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-05.5: real tiny-model transcription of speech-2min.mp4 scores within spike baseline + 5 points', async ({ page }) => {
    const { value: baseline, source } = spikeTinyWerBaseline()
    const reference = (JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures/harness/ground-truth/speech-2min.json'), 'utf8')) as { transcript: string }).transcript
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeAsrNetwork(page, `http://127.0.0.1:${PORT}`, counters)
    await page.goto('/e2e/asr/fixtures/harness.html')
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeAsrHarnessReady === true, { timeout: 30_000 })

    const summary = await page.evaluate((options) => (globalThis as unknown as { __zipscribeAsrHarness: { runTranscription(o: typeof options): Promise<RunSummary> } }).__zipscribeAsrHarness.runTranscription(options), {
      fixture: 'fixtures/speech-2min.mp4',
      modelId: 'whisper-tiny-timestamped',
      device: 'wasm',
      language: 'en',
      tier: 'T2',
    })

    expect(summary.error, `pipeline run failed: ${JSON.stringify(summary.error)} (events: ${JSON.stringify(summary.eventSummary)})`).toBeUndefined()
    expect(summary.cancelled).toBe(false)
    expect(summary.segmentCount, 'the run produced segments').toBeGreaterThan(0)
    expect(summary.wordCount, 'segments carry word tokens (return_timestamps:word)').toBeGreaterThan(0)
    expect(summary.blocks.length, 'blockize produced blocks').toBeGreaterThan(0)
    for (const block of summary.blocks) {
      expect(block.end, `block end after start (${block.start})`).toBeGreaterThan(block.start)
    }

    const werPct = scoreWer(`cc055-${Date.now()}`, reference, summary.hypothesis)
    const limit = baseline + TOLERANCE_POINTS
    expect(werPct, `WER ${werPct.toFixed(2)}% exceeds spike baseline ${baseline} (percentage points, ${source}) + ${TOLERANCE_POINTS} points`).toBeLessThanOrEqual(limit)
    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
    expect(counters.modelHost, 'model weights came from the local cache via the huggingface resolve route').toBeGreaterThan(0)
  })
})
