// CC-06.3 `[RQ]` — the 10-minute diarize run within the perf gate on
// reference hardware (unit-06 US/FR-06.1: "≤ 90 s T1 perf record; T2
// recorded, not gated"). Mirrors the unit-05 L6 doctrine
// (qualify/asr/memory-gate.test.ts): MEASUREMENT MODE ONLY
// (`ZIPSCRIBE_QUALIFY_MEASURE=1 pnpm qualify`); without the flag the
// measurement test skips and only the fast preflight audits run, keeping the
// frozen CC-02.5 `pnpm qualify` leg inside its 150 s budget.
//
// Threshold source: the unit spec (unit-06-speaker-diarization.md, CC-06.3) —
// a stated hardware gate, not a spike baseline. Honesty doctrine: an
// unmeasurable condition records `ok:false` + null values + reason in
// `qualification/unit-06-measurements.json`, NEVER a fabricated number.
//
// Tier classification: the harness surfaces each `model:ready` device; a
// `webgpu` segmentation/embedding pair is the T1 leg (gated at ≤ 90 s wall),
// a `wasm` run is the T2 leg (recorded, not gated). Until the builder exposes
// the diarization tier/device choice on the production path, a wasm-only run
// yields an honest unmeasurable T1 row (no fabricated pass).
//
// RED (unit-06 not merged): the diarize.worker stub never emits model:ready —
// measurement mode fails at the harness's model-ready gate; the preflight
// below passes today (fixture + constants + helper presence are all real).
import { expect, test } from 'vitest'
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../tests/helpers/repo'
import { assertDiarModelCachePresent, routeDiarNetwork, startHarnessServer, stopHarnessServer, type HarnessServer, type NetworkCounters } from '../../e2e/diarization/helpers/diarization'

const MEASURE = process.env.ZIPSCRIBE_QUALIFY_MEASURE === '1'
const PORT = 4328
const HARNESS_PATH = '/e2e/diarization/fixtures/harness.html'
const PERF_FIXTURE = 'fixtures/speech-10min.mp4'
const MEASUREMENTS_FILE = 'qualification/unit-06-measurements.json'
/** CC-06.3 (unit spec): T1 10-minute diarize ≤ 90 s wall. T2 recorded only. */
export const T1_DIARIZE_MAX_MS = 90_000

interface MeasurementRow {
  id: string
  run: string
  pass: boolean
  measured: string
  threshold: string
  values: Record<string, number | string | null>
  ok: boolean
  reason: string | null
}

function recordMeasurementRow(row: MeasurementRow): void {
  const outPath = join(REPO_ROOT, MEASUREMENTS_FILE)
  const existing = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as { rows?: MeasurementRow[] }) : {}
  const rows = Array.isArray(existing.rows) ? existing.rows : []
  const at = rows.findIndex((r) => r.id === row.id && r.run === row.run)
  if (at >= 0) rows.splice(at, 1, row)
  else rows.push(row)
  const record = {
    version: '0.0.0-spike',
    unit: 'unit-06-speaker-diarization',
    recordedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => `${a.id}/${a.run}`.localeCompare(`${b.id}/${b.run}`)),
  }
  mkdirSync(join(REPO_ROOT, 'qualification'), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`)
}

function unmeasurableRow(id: string, run: string, threshold: string, reason: string, valueKeys: string[]): MeasurementRow {
  const values: Record<string, number | string | null> = {}
  for (const key of valueKeys) values[key] = null
  return { id, run, pass: false, measured: `unmeasurable: ${reason}`, threshold, values, ok: false, reason }
}

interface DiarRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  frames: unknown[]
  speakers: number
  eventSummary: { t: string; code?: string; device?: string }[]
  runWallMs: number
}

test.describe('CC-06.3 [RQ]: 10-min diarize ≤ 90 s on T1 (T2 recorded)', () => {
  test('CC-06.3: the perf gate threshold comes from the unit spec and the perf fixture is committed', () => {
    expect(T1_DIARIZE_MAX_MS, 'CC-06.3 T1 gate: 90 s wall for a 10-minute run').toBe(90_000)
    expect(existsSync(join(REPO_ROOT, PERF_FIXTURE)), `perf fixture committed: ${PERF_FIXTURE}`).toBe(true)
    expect(existsSync(join(REPO_ROOT, 'e2e/diarization/fixtures/harness.html')), 'diarization harness page present').toBe(true)
    expect(typeof assertDiarModelCachePresent, 'model-cache gate helper importable (reference hardware runs `pnpm models:fetch` first)').toBe('function')
  })

  test(
    'CC-06.3: real 10-minute diarize on reference hardware (T1 gated at ≤ 90 s; T2 recorded)',
    { skip: !MEASURE, timeout: 30 * 60_000 },
    async () => {
    assertDiarModelCachePresent()
    const server: HarnessServer = await startHarnessServer(PORT, { isolated: false, probePath: HARNESS_PATH })
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const counters: NetworkCounters = { modelHost: 0, blocked: [] }
      await routeDiarNetwork(page, `http://127.0.0.1:${PORT}`, counters)
      await page.goto(HARNESS_PATH)
      await page.waitForFunction(() => (globalThis as unknown as Record<string, unknown>).__zipscribeDiarHarnessReady === true, { timeout: 30_000 })
      const summary = await page.evaluate((options) => (globalThis as unknown as { __zipscribeDiarHarness: { runDiarize(o: typeof options): Promise<DiarRunSummary> } }).__zipscribeDiarHarness.runDiarize(options), { fixture: PERF_FIXTURE })
      expect(summary.error, `10-min diarize failed: ${JSON.stringify(summary.error)} (events: ${JSON.stringify(summary.eventSummary)})`).toBeUndefined()
      const devices = summary.eventSummary.filter((e) => e.t === 'model:ready').map((e) => e.device as string)
      const isT1 = devices.length > 0 && devices.every((d) => d === 'webgpu')
      const isT2 = devices.length > 0 && devices.every((d) => d === 'wasm')
      if (isT1) {
        const pass = summary.runWallMs <= T1_DIARIZE_MAX_MS
        recordMeasurementRow({ id: 'CC-06.3', run: 'T1', pass, measured: `${summary.runWallMs} ms wall (10-min diarize, webgpu)`, threshold: `≤ ${T1_DIARIZE_MAX_MS} ms`, values: { wallMs: summary.runWallMs, speakers: summary.speakers, frames: summary.frames.length }, ok: true, reason: null })
        expect(summary.runWallMs, `CC-06.3 T1 gate: 10-min diarize took ${summary.runWallMs} ms`).toBeLessThanOrEqual(T1_DIARIZE_MAX_MS)
      } else if (isT2) {
        recordMeasurementRow({ id: 'CC-06.3', run: 'T2', pass: true, measured: `${summary.runWallMs} ms wall (10-min diarize, wasm) — recorded, not gated`, threshold: 'record only (CC-06.3)', values: { wallMs: summary.runWallMs, speakers: summary.speakers, frames: summary.frames.length }, ok: true, reason: null })
        recordMeasurementRow(unmeasurableRow('CC-06.3', 'T1', `≤ ${T1_DIARIZE_MAX_MS} ms`, 'production path selected wasm for every session — the builder must expose the T1/webgpu diarization tier for the gated leg (no fabricated T1 pass)', ['wallMs']))
      } else {
        recordMeasurementRow(unmeasurableRow('CC-06.3', 'T1', `≤ ${T1_DIARIZE_MAX_MS} ms`, `no model:ready device reported (eventSummary carries ${summary.eventSummary.length} events) — cannot classify tier`, ['wallMs']))
        recordMeasurementRow(unmeasurableRow('CC-06.3', 'T2', 'record only', 'no model:ready device reported — cannot classify tier', ['wallMs']))
      }
      expect(counters.blocked, `non-allowlisted origins requested: ${[...new Set(counters.blocked)].join(', ')}`).toEqual([])
    } finally {
      await browser.close()
      await stopHarnessServer(server.child)
    }
    },
  )
})
