// CC-05.1 `[RQ]` — the 120-minute run within the memory gate on reference
// hardware (unit-05 US-1.2.2 / conventions § L6):
//
//   • T2 + tiny (CI-realistic tier, wasm): 120 min of `audio-120min.mp4`
//     transcribed on the COOP/COEP isolated path (the same spec-owned
//     `ZIPSCRIBE_ISOLATED=1` vite harness as e2e/asr/memory/recycle-10min —
//     production never sends those headers) with sustained JS-heap growth
//     < 1 GB, sampled via `performance.measureUserAgentSpecificMemory()`
//     (Chromium full-binary `channel:'chromium'`, the unit-04 memory-spec
//     requirement — headless-shell throws SecurityError).
//   • T1 + DEFAULT model (the unit-02 CC-02.11 recommendation, whisper-base
//     webgpu): GPU-process memory stays under the unit-02 recycle ceiling.
//     Sampling reuses the unit-02 method: out-of-band macOS `footprint` on
//     the Chrome GPU process (tools/eval/gpu-sampler.mjs), trusted only
//     because the unit-02 calibration validated it on this hardware
//     (docs/spikes/gpu-calibration.json `passed: true`).
//
// MEASUREMENT MODE ONLY (`ZIPSCRIBE_QUALIFY_MEASURE=1 pnpm qualify`, hours):
// without the flag the measurement tests skip so the frozen CC-02.5 qualify
// leg (scripts/qualify.ts, 150 s vitest spawn) stays fast; the preflight
// tests below always run and prove every threshold is READ from the spike
// artifacts, never invented. Unmeasurable → `ok:false` + null values +
// reason in `qualification/unit-05-measurements.json` — never a fabricated
// number (unit-02 row-field doctrine).
//
// Baseline doctrine: thresholds come from `recycleCeiling()` / the spike
// leak study (see qualify/asr/helpers/measurement.ts header for the
// adjudicated percentage-point convention citation and the interim
// sine-formant corpus AWAITING-OWNER caveat).
import { expect, test } from 'vitest'
import { chromium } from '@playwright/test'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { REPO_ROOT } from '../../tests/helpers/repo'
import {
  assertTinyModelCachePresent,
  defaultModel,
  gpuCalibration,
  HARNESS_PATH,
  HEAP_MEASUREMENT_TOLERANCE_MB,
  JS_HEAP_SUSTAINED_LIMIT_MB,
  MEASURE,
  PERF_FIXTURE_REPO_PATH,
  perfFixturePresent,
  PORT_T1_MEMORY,
  PORT_T2_MEMORY,
  QualifyGpuSampler,
  recordMeasurementRow,
  routeQualifyAsrNetwork,
  startQualifyHarnessServer,
  stopQualifyHarnessServer,
  type HarnessServer,
  spikeLaunchArgs,
  recycleCeiling,
  TINY_MODEL_ID,
  unmeasurableRow,
  type QualifyRunOptions,
  type QualifyRunSummary,
} from './helpers/measurement'

const SAMPLE_MS = 5_000
const GPU_SAMPLE_MS = 15_000
/** Weights load before the leak matters: the baseline is the floor of the
 *  samples after this settle window (model load is allocation, not growth). */
const SETTLE_MS = 60_000
/** 120 min of audio transcribes at roughly realtime on the reference
 *  machine (CC-05.2: 10 min → 11.1 min wall); the timeout bounds the run
 *  generously without hiding a hang. */
const RUN_TIMEOUT_MS = 4 * 60 * 60_000

const RECYCLE_MARGIN = 4

async function runMemoryMeasurements(options: QualifyRunOptions, port: number): Promise<{
  heap: { baselineMb: number; lastMb: number; peakMb: number; sampleCount: number }
  result: QualifyRunSummary
  blocked: string[]
  modelHost: number
  gpu: { gpuPid: number | null; missingReason: string | null; firstBytes: number | null; maxBytes: number | null; growthBytes: number | null; sampleCount: number }
}> {
  const server: HarnessServer = await startQualifyHarnessServer(port, { isolated: true, probePath: HARNESS_PATH })
  const profileDir = join(REPO_ROOT, '.night', 'qualify', `chrome-${port}`)
  rmSync(profileDir, { recursive: true, force: true })
  // Persistent context (unit-02 harness doctrine): the profile directory is
  // the handle the GPU-process sampler needs (`--type=gpu-process` child).
  const context = await chromium.launchPersistentContext(profileDir, { channel: 'chromium', headless: true, args: spikeLaunchArgs() })
  let gpuTimer: ReturnType<typeof setInterval> | undefined
  try {
    const sampler = await QualifyGpuSampler.discover(profileDir)
    const gpuSamples: number[] = []
    gpuTimer = setInterval(() => {
      void sampler.sample().then((bytes) => {
        if (bytes !== null) gpuSamples.push(bytes)
      })
    }, GPU_SAMPLE_MS)
    const page = await context.newPage()
    const counters = { modelHost: 0, blocked: [] as string[] }
    await routeQualifyAsrNetwork(page, `http://127.0.0.1:${port}`, counters)
    await page.goto(`http://127.0.0.1:${port}${HARNESS_PATH}`)
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__zipscribeAsrHarnessReady === true, { timeout: 30_000 })
    expect(await page.evaluate(() => globalThis.crossOriginIsolated), 'isolated harness must make the page cross-origin isolated').toBe(true)

    const heap = await page.evaluate(
      async ({ runOptions, sampleMs, settleMs }) => {
        type Measured = { bytes: number }
        const measured = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<Measured> }
        if (typeof measured.measureUserAgentSpecificMemory !== 'function') {
          throw new Error('measureUserAgentSpecificMemory unavailable (needs COOP/COEP + Chromium full binary)')
        }
        const measure = () => measured.measureUserAgentSpecificMemory!().then((r) => r.bytes / 1024 / 1024)
        const harness = (globalThis as unknown as { __zipscribeAsrHarness: { runTranscription(o: QualifyRunOptions): Promise<QualifyRunSummary> } }).__zipscribeAsrHarness
        await new Promise((resolve) => setTimeout(resolve, settleMs))
        const samples: number[] = []
        const run = harness.runTranscription(runOptions)
        let finished = false
        void run.then(
          () => (finished = true),
          () => (finished = true),
        )
        while (!finished) {
          samples.push(await measure())
          await new Promise((resolve) => setTimeout(resolve, sampleMs))
        }
        const result = await run // re-throws a pipeline failure
        samples.push(await measure())
        if (samples.length === 0) throw new Error('no heap samples taken')
        return {
          samples,
          result,
        }
      },
      { runOptions: options, sampleMs: SAMPLE_MS, settleMs: SETTLE_MS },
    )

    const settledSamples = heap.samples
    const baselineMb = Math.min(...settledSamples)
    const peakMb = Math.max(...settledSamples)
    const lastMb = settledSamples[settledSamples.length - 1] as number
    const gpuFirst = gpuSamples.length > 0 ? (gpuSamples[0] as number) : null
    const gpuMax = gpuSamples.length > 0 ? Math.max(...gpuSamples) : null
    return {
      heap: { baselineMb, lastMb, peakMb, sampleCount: settledSamples.length },
      result: heap.result,
      blocked: [...new Set(counters.blocked)],
      modelHost: counters.modelHost,
      gpu: {
        gpuPid: sampler.gpuPid,
        missingReason: sampler.missingReason ?? (gpuSamples.length === 0 ? 'gpu-samples-unavailable' : null),
        firstBytes: gpuFirst,
        maxBytes: gpuMax,
        growthBytes: gpuFirst !== null && gpuMax !== null ? gpuMax - gpuFirst : null,
        sampleCount: gpuSamples.length,
      },
    }
  } finally {
    clearInterval(gpuTimer)
    await context.close()
    rmSync(profileDir, { recursive: true, force: true })
    await stopQualifyHarnessServer(server.child)
  }
}

test.describe('CC-05.1 preflight — thresholds READ from committed spike artifacts (always runs)', () => {
  test('CC-05.1: the unit-02 recycle ceiling and the validated GPU-sampler calibration exist', () => {
    const ceiling = recycleCeiling()
    expect(Number.isFinite(ceiling.ceilingBytes) && ceiling.ceilingBytes > 0, `recycle ceiling must be a finite number > 0, got ${ceiling.ceilingBytes} (${ceiling.source})`).toBe(true)
    expect(Number.isFinite(ceiling.perWindowGrowthBytes) && ceiling.perWindowGrowthBytes > 0, `per-window GPU growth must be a finite number > 0, got ${ceiling.perWindowGrowthBytes}`).toBe(true)
    const cal = gpuCalibration()
    expect(cal.passed, `the unit-02 GPU sampler must be calibrated on reference hardware (${cal.source}, reason: ${String(cal.missingReason)})`).toBe(true)
  })

  test('CC-05.1: the 120-min perf fixture and the spike launch environment are declared', () => {
    // Existence is only asserted in measurement mode (the fixture is a
    // gitignored setup artifact, `pnpm fixtures`).
    if (MEASURE) expect(perfFixturePresent(), `${PERF_FIXTURE_REPO_PATH} must exist on the qualification machine (setup step: pnpm fixtures)`).toBe(true)
    expect(spikeLaunchArgs().length, 'the spike environment declares the Chromium launch args the measurements must run under').toBeGreaterThan(0)
  })
})

test.describe('CC-05.1 measurement — 120-min run within the memory gate (ZIPSCRIBE_QUALIFY_MEASURE=1)', () => {
  test(
    'CC-05.1: T2+tiny 120-min run keeps sustained JS-heap growth under 1 GB on the COOP/COEP isolated path',
    { skip: !MEASURE, timeout: RUN_TIMEOUT_MS },
    async () => {
      assertTinyModelCachePresent()
      const options: QualifyRunOptions = {
        fixture: PERF_FIXTURE_REPO_PATH,
        modelId: TINY_MODEL_ID,
        device: 'wasm',
        language: 'en',
        tier: 'T2',
      }
      const run = await runMemoryMeasurements(options, PORT_T2_MEMORY)
      const growthMb = run.heap.lastMb - run.heap.baselineMb
      const limitMb = JS_HEAP_SUSTAINED_LIMIT_MB + HEAP_MEASUREMENT_TOLERANCE_MB
      const threshold = `sustained JS-heap growth < 1 GB (${JS_HEAP_SUSTAINED_LIMIT_MB} MB) + ${HEAP_MEASUREMENT_TOLERANCE_MB} MB measureUserAgentSpecificMemory granularity (recycle-10min.spec.ts tolerance precedent)`

      expect(run.result.error, `the 120-min T2 run failed: ${JSON.stringify(run.result.error)} (events: ${JSON.stringify(run.result.eventSummary)})`).toBeUndefined()
      expect(run.result.cancelled).toBe(false)
      expect(run.result.segmentCount, 'the run produced segments').toBeGreaterThan(0)
      expect(run.blocked, `non-allowlisted origins requested: ${run.blocked.join(', ')}`).toEqual([])
      expect(run.modelHost, 'model weights were served from the local cache via the huggingface resolve route').toBeGreaterThan(0)

      recordMeasurementRow({
        id: 'CC-05.1',
        run: 'T2+tiny-120min',
        pass: growthMb <= limitMb,
        measured: `JS heap growth ${growthMb.toFixed(1)} MB (baseline ${run.heap.baselineMb.toFixed(1)} → last ${run.heap.lastMb.toFixed(1)} MB, peak ${run.heap.peakMb.toFixed(1)} MB, ${run.heap.sampleCount} samples) over 120 min on the COOP/COEP isolated path`,
        threshold,
        values: {
          heapBaselineMb: Number(run.heap.baselineMb.toFixed(1)),
          heapLastMb: Number(run.heap.lastMb.toFixed(1)),
          heapPeakMb: Number(run.heap.peakMb.toFixed(1)),
          heapGrowthMb: Number(growthMb.toFixed(1)),
          heapLimitMb: JS_HEAP_SUSTAINED_LIMIT_MB,
          measurementToleranceMb: HEAP_MEASUREMENT_TOLERANCE_MB,
          sampleCount: run.heap.sampleCount,
          segmentCount: run.result.segmentCount,
          workerEpochs: run.result.workerEpochs,
        },
        ok: true,
        reason: null,
      })
      expect(growthMb, `T2+tiny 120-min run: heap grew ${growthMb.toFixed(1)} MB (baseline ${run.heap.baselineMb.toFixed(1)} → last ${run.heap.lastMb.toFixed(1)}, peak ${run.heap.peakMb.toFixed(1)} MB over ${run.heap.sampleCount} samples) — ${threshold}`).toBeLessThanOrEqual(limitMb)
    },
  )

  test(
    'CC-05.1: T1+default-model 120-min run keeps GPU-process memory under the unit-02 recycle ceiling',
    { skip: !MEASURE, timeout: RUN_TIMEOUT_MS },
    async () => {
      const ceiling = recycleCeiling()
      const threshold = `GPU-process growth (out-of-band footprint, unit-02 method) < recycleCeilingBytes ${ceiling.ceilingBytes} (${ceiling.source})`
      // Cadence from the spike data, not invented: recycle at a quarter of
      // the ceiling so even an unlucky sample interval cannot let growth
      // reach the ceiling between recycles (FR-05.3 "before the ceiling").
      const cadence = Math.max(1, Math.floor(ceiling.ceilingBytes / (ceiling.perWindowGrowthBytes * RECYCLE_MARGIN)))
      const options: QualifyRunOptions = {
        fixture: PERF_FIXTURE_REPO_PATH,
        modelId: defaultModel().registryId.split('@')[0]?.replace(/_/g, '-') ?? defaultModel().registryId,
        device: 'webgpu',
        language: 'en',
        tier: 'T1',
        recycleEveryNWindows: cadence,
      }
      const run = await runMemoryMeasurements(options, PORT_T1_MEMORY)
      const baseValues = {
        heapGrowthMb: Number((run.heap.lastMb - run.heap.baselineMb).toFixed(1)),
        gpuPid: run.gpu.gpuPid,
        gpuSampleCount: run.gpu.sampleCount,
        gpuFirstBytes: run.gpu.firstBytes,
        gpuMaxBytes: run.gpu.maxBytes,
        gpuGrowthBytes: run.gpu.growthBytes,
        recycleCeilingBytes: ceiling.ceilingBytes,
        recycleCadenceWindows: cadence,
        segmentCount: run.result.segmentCount,
        workerEpochs: run.result.workerEpochs,
      }

      expect(run.result.error, `the 120-min T1 run failed: ${JSON.stringify(run.result.error)} (events: ${JSON.stringify(run.result.eventSummary)})`).toBeUndefined()
      expect(run.result.cancelled).toBe(false)
      expect(run.blocked, `non-allowlisted origins requested: ${run.blocked.join(', ')}`).toEqual([])
      expect(run.modelHost, 'default-model weights/references were served locally').toBeGreaterThan(0)

      if (run.gpu.gpuPid === null || run.gpu.growthBytes === null) {
        const reason = `gpu-sampler-unavailable (${String(run.gpu.missingReason)}; calibration ${gpuCalibration().source})`
        const row = unmeasurableRow('CC-05.1', 'T1+default-120min', threshold, reason, ['gpuPid', 'gpuSampleCount', 'gpuFirstBytes', 'gpuMaxBytes', 'gpuGrowthBytes'])
        recordMeasurementRow({ ...row, values: { ...baseValues, ...row.values } })
      } else {
        recordMeasurementRow({
          id: 'CC-05.1',
          run: 'T1+default-120min',
          pass: run.gpu.growthBytes < ceiling.ceilingBytes,
          measured: `GPU-process growth ${run.gpu.growthBytes} bytes (${run.gpu.sampleCount} footprint samples, ${run.gpu.firstBytes} → max ${run.gpu.maxBytes}) over 120 min at recycle cadence ${cadence} windows; JS heap growth ${baseValues.heapGrowthMb} MB observed`,
          threshold,
          values: baseValues,
          ok: true,
          reason: null,
        })
      }
      expect(run.gpu.growthBytes, `T1+default 120-min run GPU gate — ${threshold}${run.gpu.missingReason ? ` (sampler: ${run.gpu.missingReason})` : ''}`).not.toBeNull()
      expect(run.gpu.growthBytes as number, `T1+default 120-min run: GPU process grew ${String(run.gpu.growthBytes)} bytes across ${run.gpu.sampleCount} samples — ${threshold}`).toBeLessThan(ceiling.ceilingBytes)
    },
  )
})

