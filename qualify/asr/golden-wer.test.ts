// CC-05.6 `[RQ]` — golden WER with the DEFAULT model on reference hardware
// (unit file: `en-clean` ≤ spike baseline + 2 pts; `fr-clean` with
// `language:'fr'` ≤ baseline + 2 pts; FR-05.7 "default model: release
// qualification, `tiny` smoke per-PR").
//
// DEFAULT model = the unit-02 CC-02.11 tier recommendation for T1
// (`TIER_DEFAULT_MODEL` — whisper-base_timestamped, the only tier default
// whose engine is multilingual, so the `language:'fr'` leg is possible on
// it). Baseline doctrine: the threshold is READ from
// `docs/spikes/model-eval-report.json` rows[default-model, T1, webgpu].wer —
// percentage-point units per the adjudicated `spikeTinyWerBaseline` in
// `e2e/asr/helpers/asr.ts` (ledger "UNIT-05 SLICE C1 LANDED + CC-05.5
// TEST-DEFECT ADJUDICATED", 2026-11-01T02:45Z, executed at `5c432d4`: the
// spike stores `wer` as a ratio, the gate is in percentage points, ×100 on
// read) — never invented. The corpus is interim sine-formant synthetic
// speech (real-corpus vendoring AWAITING-OWNER), so absolute WER is
// corpus-bound: these are regression guards at baseline + 2 pts, not
// quality claims.
//
// Clips (categories per scripts/make-fixtures.ts + fixtures/harness manifest):
// `en-clean` → speech-2min.mp4 (language 'en'); `fr-clean` →
// taxi-fr-clean-1.mp4 + taxi-fr-clean-2.mp4 (language 'fr', engine FORCED to
// French — US-05.1). Per-category WER aggregates the clips (single reference
// / hypothesis pair scored through the frozen CC-02.6 CLI
// `tools/eval/wer.mjs`, Whisper normalizer).
//
// MEASUREMENT MODE ONLY (`ZIPSCRIBE_QUALIFY_MEASURE=1 pnpm qualify`, hours);
// the preflight (baseline + ground truth readable) always runs. Results are
// recorded measured-vs-threshold into
// `qualification/unit-05-measurements.json` (qualification record schema;
// unmeasurable → ok:false + null + reason, NEVER a fabricated number).
//
// SECURITY-03: hypothesis/reference text goes only to `.night/wer/**`
// scratch for the CLI call (deleted after); only numeric scores reach
// assertions, the record and this file's failure output.
import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium } from '@playwright/test'
import { assertDefaultModelCachePresent, defaultModel, defaultModelWerBaseline, GOLDEN_WER_TOLERANCE_POINTS, groundTruthTranscript, HARNESS_PATH, MEASURE, PORT_GOLDEN_WER, recordMeasurementRow, routeQualifyAsrNetwork, scoreWerPercent, spikeLaunchArgs, startQualifyHarnessServer, stopQualifyHarnessServer, type HarnessServer, type QualifyRunOptions, type QualifyRunSummary } from './helpers/measurement'

interface GoldenClip {
  fixture: string
  groundTruth: string
  language: 'en' | 'fr'
}

const GOLDEN_SETS: Record<'en-clean' | 'fr-clean', GoldenClip[]> = {
  'en-clean': [{ fixture: 'fixtures/speech-2min.mp4', groundTruth: 'speech-2min', language: 'en' }],
  'fr-clean': [
    { fixture: 'fixtures/taxi-fr-clean-1.mp4', groundTruth: 'taxi-fr-clean-1', language: 'fr' },
    { fixture: 'fixtures/taxi-fr-clean-2.mp4', groundTruth: 'taxi-fr-clean-2', language: 'fr' },
  ],
}

let server: HarnessServer | undefined

beforeAll(async () => {
  if (!MEASURE) return
  assertDefaultModelCachePresent()
  // Non-isolated: the golden WER gate needs no measureUserAgentSpecificMemory
  // (the CC-05.5 tiny-smoke precedent); the webgpu session runs identically.
  server = await startQualifyHarnessServer(PORT_GOLDEN_WER, { isolated: false, probePath: HARNESS_PATH })
})
afterAll(async () => {
  if (server) await stopQualifyHarnessServer(server.child)
})

async function scoreGoldenSet(category: 'en-clean' | 'fr-clean'): Promise<{ werPct: number; clipCount: number; wordCount: number; blocked: string[]; modelHost: number }> {
  const clips = GOLDEN_SETS[category]
  const references: string[] = []
  const hypotheses: string[] = []
  let wordCount = 0
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: spikeLaunchArgs() })
  const counters = { modelHost: 0, blocked: [] as string[] }
  try {
    for (const clip of clips) {
      const context = await browser.newContext()
      const page = await context.newPage()
      await routeQualifyAsrNetwork(page, `http://127.0.0.1:${PORT_GOLDEN_WER}`, counters)
      await page.goto(`http://127.0.0.1:${PORT_GOLDEN_WER}${HARNESS_PATH}`)
      await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeAsrHarnessReady === true, { timeout: 30_000 })
      const options: QualifyRunOptions = {
        fixture: clip.fixture,
        modelId: defaultModel().registryId.split('@')[0]?.replace(/_/g, '-') ?? defaultModel().registryId,
        device: 'webgpu',
        tier: 'T1',
        language: clip.language,
      }
      const summary = await page.evaluate((runOptions) => (globalThis as unknown as { __zipscribeAsrHarness: { runTranscription(o: typeof runOptions): Promise<QualifyRunSummary> } }).__zipscribeAsrHarness.runTranscription(runOptions), options)
      expect(summary.error, `golden run failed for ${clip.groundTruth}: ${JSON.stringify(summary.error)} (events: ${JSON.stringify(summary.eventSummary)})`).toBeUndefined()
      expect(summary.cancelled, `golden run cancelled for ${clip.groundTruth}`).toBe(false)
      expect(summary.wordCount, `the default model produced words for ${clip.groundTruth}`).toBeGreaterThan(0)
      references.push(groundTruthTranscript(clip.groundTruth))
      hypotheses.push(summary.hypothesis)
      wordCount += summary.wordCount
      await context.close()
    }
  } finally {
    await browser.close()
  }
  const werPct = scoreWerPercent(`cc056-${category}-${Date.now()}`, references.join(' '), hypotheses.join(' '))
  return { werPct, clipCount: clips.length, wordCount, blocked: [...new Set(counters.blocked)], modelHost: counters.modelHost }
}

async function assertGoldenSetWithinBaseline(category: 'en-clean' | 'fr-clean'): Promise<void> {
  const { value: baseline, source } = defaultModelWerBaseline()
  const limit = baseline + GOLDEN_WER_TOLERANCE_POINTS
  const threshold = `aggregate WER ≤ spike baseline ${baseline} percentage points (${source}) + ${GOLDEN_WER_TOLERANCE_POINTS} pts`
  const scored = await scoreGoldenSet(category)
  expect(scored.blocked, `non-allowlisted origins requested: ${scored.blocked.join(', ')}`).toEqual([])
  expect(scored.modelHost, 'model weights were served from the local cache via the huggingface resolve route').toBeGreaterThan(0)
  recordMeasurementRow({
    id: 'CC-05.6',
    run: category,
    pass: scored.werPct <= limit,
    measured: `${category} aggregate WER ${scored.werPct.toFixed(2)} pts (${scored.clipCount} clip(s), ${scored.wordCount} hypothesis words)`,
    threshold,
    values: { werPoints: Number(scored.werPct.toFixed(2)), baselinePoints: baseline, tolerancePoints: GOLDEN_WER_TOLERANCE_POINTS, limitPoints: limit, clipCount: scored.clipCount, wordCount: scored.wordCount },
    ok: true,
    reason: null,
  })
  expect(scored.werPct, `${category}: WER ${scored.werPct.toFixed(2)} pts exceeds ${threshold}`).toBeLessThanOrEqual(limit)
}

test.describe('CC-05.6 preflight — baseline and goldens READ from committed artifacts (always runs)', () => {
  test('CC-05.6: the DEFAULT-model spike WER baseline is readable in percentage points', () => {
    const { value, source } = defaultModelWerBaseline()
    expect(Number.isFinite(value) && value > 0, `baseline must be a finite positive percentage-point value, got ${value} (${source})`).toBe(true)
    expect(source, `the source must document the ratio→percentage-point conversion (CC-05.5 adjudication convention), got "${source}"`).toContain('×100')
    expect(defaultModel().registryId, 'the DEFAULT model is the T1 tier recommendation').toBe('whisper-base_timestamped@608c49e6')
  })

  test('CC-05.6: the golden-set taxonomy is declared (fixture ground-truth EXISTENCE is asserted in measurement mode — fixtures/ is a setup tree, absent from qualification scratch copies)', () => {
    for (const [category, clips] of Object.entries(GOLDEN_SETS)) {
      expect(clips.length, `${category} has clips`).toBeGreaterThan(0)
      for (const clip of clips) {
        expect(clip.fixture.startsWith('fixtures/'), `${clip.groundTruth} references a fixtures/ clip`).toBe(true)
        expect(['en', 'fr']).toContain(clip.language)
      }
    }
    if (MEASURE) {
      for (const [category, clips] of Object.entries(GOLDEN_SETS)) {
        for (const clip of clips) {
          expect(groundTruthTranscript(clip.groundTruth).trim().length > 0, `${category}/${clip.groundTruth} has a non-empty committed transcript`).toBe(true)
        }
      }
    }
  })
})

test.describe('CC-05.6 measurement — golden WER with the default model (ZIPSCRIBE_QUALIFY_MEASURE=1)', () => {
  test(
    'CC-05.6: en-clean golden WER with the default model ≤ spike baseline + 2 pts',
    { skip: !MEASURE, timeout: 60 * 60_000 },
    async () => {
      await assertGoldenSetWithinBaseline('en-clean')
    },
  )

  test(
    'CC-05.6: fr-clean golden WER with language:fr ≤ spike baseline + 2 pts',
    { skip: !MEASURE, timeout: 60 * 60_000 },
    async () => {
      await assertGoldenSetWithinBaseline('fr-clean')
    },
  )
})
