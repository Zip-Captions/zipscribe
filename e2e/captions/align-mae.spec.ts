// CC-07.3 (L4): honest word-timing MAE — the REAL pipeline (media worker
// decode → real asr.worker via createAsrWorkerHost → real importCaptions of
// the en-clean reference captions → real alignCaptionsToWords with the run's
// ASR words) must bring aligned word times within 1.5× the unit-02 spike
// direct-transcription baseline (docs/spikes/model-eval-report.json
// wordTimingMAEms — READ, never invented).
//
// MAE definition (pinned here): mean over aligned words of
// (|aligned.start − gt.start| + |aligned.end − gt.end|) / 2. Words the
// aligner left 'estimated' are excluded (they are re-interpolated, not ASR
// evidence — counting them would let a no-op aligner "score").
//
// Corpus honesty (unit-02 doctrine): the speech-2min corpus is
// sine-formant synthetic speech (interim, AWAITING-OWNER real corpus) and the
// spike T2 row measured WER ≈ 1 on the related taxi corpus — so the
// alignment-rate and MAE numbers here are regression guards, not quality
// claims. The alignedRatio > 0 non-vacuity check is what keeps the MAE
// assertion from being satisfied by zero aligned words.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { assertModelCachePresent, routeAsrNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from '../asr/helpers/asr'
import type { AlignRunOptions, AlignRunSummary } from './fixtures/align-harness'

const PORT = 4315
const MAE_MULTIPLIER = 1.5

let server: HarnessServer | undefined

interface GroundTruthWord {
  text: string
  start: number
  end: number
}

/** The unit-02 direct-transcription word-timing baseline — read from the
 *  spike artifact (whisper-tiny T2), never invented (unit-02 doctrine). */
function spikeTinyWordTimingMaeBaseline(): { value: number; source: string } {
  const report = JSON.parse(readFileSync(join(REPO_ROOT, 'docs/spikes/model-eval-report.json'), 'utf8')) as {
    rows: { engine: string; model: string; tier: string; wordTimingMAEms?: number }[]
  }
  const row = report.rows.find((r) => r.model === 'onnx-community/whisper-tiny_timestamped' && r.tier === 'T2' && r.engine === 'transformers.js')
  if (!row || row.wordTimingMAEms === undefined) throw new Error('docs/spikes/model-eval-report.json has no whisper-tiny T2 wordTimingMAEms row')
  return { value: row.wordTimingMAEms, source: 'docs/spikes/model-eval-report.json rows[whisper-tiny_timestamped,T2].wordTimingMAEms' }
}

const normalizeToken = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()

test.describe('CC-07.3: caption↔ASR alignment honest word-timing MAE vs spike baseline', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e`')
  test.use({ baseURL: `http://127.0.0.1:${PORT}` })
  test.setTimeout(15 * 60_000)

  test.beforeAll(async () => {
    assertModelCachePresent()
    server = await startHarnessServer(PORT, { isolated: false, probePath: '/e2e/captions/fixtures/align-harness.html' })
  })
  test.afterAll(async () => {
    if (server) await stopHarnessServer(server.child)
  })

  test('CC-07.3: aligned caption words over speech-2min.mp4 stay within 1.5× the spike word-timing MAE baseline', async ({ page }) => {
    const { value: baseline, source } = spikeTinyWordTimingMaeBaseline()
    const groundTruth = (JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures/harness/ground-truth/speech-2min.json'), 'utf8')) as { words: GroundTruthWord[] }).words
    const counters: NetworkCounters = { modelHost: 0, blocked: [] }
    await routeAsrNetwork(page, `http://127.0.0.1:${PORT}`, counters)
    await page.goto('/e2e/captions/fixtures/align-harness.html')
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeCaptionsHarnessReady === true, { timeout: 30_000 })

    const options: AlignRunOptions = {
      fixture: 'fixtures/speech-2min.mp4',
      refCaption: 'fixtures/captions/en-clean-ref.srt',
      modelId: 'whisper-tiny-timestamped',
      device: 'wasm',
      language: 'en',
      tier: 'T2',
    }
    const summary = await page.evaluate((runOptions) => (globalThis as unknown as { __zipscribeCaptionsHarness: { runAlign(o: AlignRunOptions): Promise<AlignRunSummary> } }).__zipscribeCaptionsHarness.runAlign(runOptions), options)

    expect(summary.error, `pipeline run failed: ${JSON.stringify(summary.error)} (events: ${JSON.stringify(summary.eventSummary)})`).toBeUndefined()
    expect(summary.cancelled).toBe(false)
    expect(summary.asrWordCount, 'the ASR run produced word tokens').toBeGreaterThan(0)
    expect(summary.captionBlockCount, 'the reference captions parsed into 12 cues').toBe(12)
    expect(summary.captionWordCount, 'reference captions carry every ground-truth word').toBe(groundTruth.length)
    expect(summary.report.wordsTotal).toBe(groundTruth.length)

    // Index pairing sanity: the aligned list must still be the reference
    // captions (US-07.3: align never changes text) — otherwise the pairing
    // below is meaningless and the spec must say so loudly.
    expect(summary.alignedWords.map((word) => normalizeToken(word.text)), 'aligned word sequence is the unmodified reference text').toEqual(groundTruth.map((word) => normalizeToken(word.text)))

    // Non-vacuity: at least SOME words must actually be aligned, or the MAE
    // below would be over an empty set (see header — interim corpus).
    expect(summary.report.alignedRatio, `no caption word matched the ASR words (alignedRatio ${summary.report.alignedRatio}) — alignment is vacuous`).toBeGreaterThan(0)

    const errors: number[] = []
    summary.alignedWords.forEach((word, index) => {
      if (word.timing !== 'aligned') return
      const gt = groundTruth[index]!
      errors.push((Math.abs(word.start - gt.start) + Math.abs(word.end - gt.end)) / 2)
    })
    expect(errors.length, 'aligned words feed the MAE').toBeGreaterThan(0)
    const maeMs = (errors.reduce((sum, error) => sum + error, 0) / errors.length) * 1_000
    const limit = baseline * MAE_MULTIPLIER
    expect(maeMs, `word-timing MAE ${maeMs.toFixed(0)} ms exceeds baseline ${baseline} ms (${source}) × ${MAE_MULTIPLIER} = ${limit.toFixed(0)} ms over ${errors.length} aligned words`).toBeLessThanOrEqual(limit)

    expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
    expect(counters.modelHost, 'model weights came from the local cache via the huggingface resolve route').toBeGreaterThan(0)
  })
})
