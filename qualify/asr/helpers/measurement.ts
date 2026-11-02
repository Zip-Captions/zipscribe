// Shared readers/record-writer for the unit-05 L6 release-qualification
// suites (`qualify/asr/**` — CC-05.1, CC-05.6). These suites run ONLY under
// `pnpm qualify` on reference hardware (settings.yml reference_hardware),
// never in the per-PR `pnpm test` run (vitest.config.ts includes only
// src/** and tests/unit/**; the suites are additionally gated behind
// ZIPSCRIBE_QUALIFY_MEASURE=1 — see vitest.config.qualify.ts § registration).
//
// Measurement mode (`ZIPSCRIBE_QUALIFY_MEASURE=1 pnpm qualify`) executes the
// hour-long runs (120-min memory gate, default-model golden WER) and records
// measured-vs-threshold rows into `qualification/unit-05-measurements.json`
// using the existing qualification record schema (conventions.md § Release
// qualification): `{ id, pass, measured, threshold }` plus the spike-row
// honesty fields (`ok`, per-value `null` + `reason` when a measurement is
// unmeasurable — NEVER a fabricated number, same doctrine as the unit-02
// report rows' `peakJsHeapBytes`/`peakJsHeapReason` and
// `gpuMemGrowthPerWindowBytes`/`gpuMemReason`).
//
// Baseline doctrine: every threshold is READ from the committed spike
// artifacts (`docs/spikes/model-eval-report.json`,
// `docs/spikes/gpu-calibration.json`) and never invented — the same rule the
// adjudicated CC-05.5 helper follows (`e2e/asr/helpers/asr.ts`
// `spikeTinyWerBaseline`, ledger "UNIT-05 SLICE C1 LANDED + CC-05.5
// TEST-DEFECT ADJUDICATED", 2026-11-01T02:45Z, executed at `5c432d4`): the
// spike stores `wer` as a RATIO (whisper rows `wer: 1` = 100 %), the gate is
// stated in percentage points, so every baseline here is `row.wer * 100`.
// The corpus is interim (sine-formant synthetic speech — real-corpus
// vendoring AWAITING-OWNER), so absolute WER is corpus-bound: the assertion
// is a regression guard at baseline + tolerance, not a quality claim.
import { spawnSync } from 'node:child_process'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { REPO_ROOT } from '../../../tests/helpers/repo'
import { getModel, TIER_DEFAULT_MODEL } from '@engine/model/registry'

const execFileAsync = promisify(execFile)

/** Measurement mode: hour-long runs execute only when explicitly enabled
 *  (the release flow). Without it the suites stay fast artifact audits, so
 *  the frozen CC-02.5 `pnpm qualify` leg (scripts/qualify.ts, 150 s vitest
 *  spawn) keeps completing inside its budget. */
export const MEASURE = process.env.ZIPSCRIBE_QUALIFY_MEASURE === '1'

// --- gate constants (from the unit spec / settings.yml, never tuned here) ---

/** CC-05.1 T2+tiny: "< 1 GB sustained JS-heap growth" (US-1.2.2). */
export const JS_HEAP_SUSTAINED_LIMIT_MB = 1_024
/** `performance.measureUserAgentSpecificMemory()`'s own ±50 MB granularity —
 *  the same measurement tolerance the CC-05.2 spec applies (e2e/asr/memory/
 *  recycle-10min.spec.ts `TOLERANCE_MB`), not a threshold loosening. */
export const HEAP_MEASUREMENT_TOLERANCE_MB = 50
/** CC-05.6: "≤ spike baseline + 2 pts" (both categories). */
export const GOLDEN_WER_TOLERANCE_POINTS = 2

export const PERF_FIXTURE_REPO_PATH = 'fixtures/audio-120min.mp4'
export const REPORT_JSON = 'docs/spikes/model-eval-report.json'
export const GPU_CALIBRATION_JSON = 'docs/spikes/gpu-calibration.json'
export const MEASUREMENTS_FILE = 'qualification/unit-05-measurements.json'

/** Reference ports above the e2e range (4310–4314) — spec-owned servers,
 *  started in beforeAll and killed in afterAll (unit-02 orphan doctrine). */
export const PORT_T2_MEMORY = 4325
export const PORT_T1_MEMORY = 4326
export const PORT_GOLDEN_WER = 4327

export const HARNESS_PATH = '/e2e/asr/fixtures/harness.html'
/** CI-served tiny row (models-fetch cache dir) + the DEFAULT-model row. */
export const TINY_MODEL_ID = 'whisper-tiny-timestamped'
export const DEFAULT_TIER = 'T1' as const

// --- artifact readers --------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseJsonAt(repoPath: string): unknown | null {
  const absolute = join(REPO_ROOT, repoPath)
  if (!existsSync(absolute)) return null
  try {
    return JSON.parse(readFileSync(absolute, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** The DEFAULT production model: the unit-02 CC-02.11 tier recommendation
 *  (`TIER_DEFAULT_MODEL`, src/engine/model/registry.ts) for the T1 tier —
 *  the only tier whose default is multilingual (the sherpa-zipformer T2
 *  default is `enOnly`, so a `language:'fr'` golden is impossible on it). */
export function defaultModel(): { registryId: string; repo: string } {
  const registryId = TIER_DEFAULT_MODEL[DEFAULT_TIER]
  const spec = getModel(registryId)
  if (!spec) throw new Error(`TIER_DEFAULT_MODEL[${DEFAULT_TIER}] = ${registryId} is not in MODEL_REGISTRY`)
  return { registryId, repo: spec.repo }
}

/**
 * The spike WER baseline of the DEFAULT model, in PERCENTAGE POINTS.
 *
 * Units adjudication (mirrors `spikeTinyWerBaseline` in
 * `e2e/asr/helpers/asr.ts`, adjudicated per ledger
 * "UNIT-05 SLICE C1 LANDED + CC-05.5 TEST-DEFECT ADJUDICATED"
 * 2026-11-01T02:45Z + fix `5c432d4`): the spike artifact stores `wer` as a
 * ratio (whisper rows `wer: 1` = 100 %) while CC-05.6 states its gate in
 * percentage points ("≤ spike baseline + 2 pts"), so the ratio is converted
 * ×100 here — same-unit arithmetic on both sides.
 *
 * Corpus caveat (same as that helper): the corpus is interim sine-formant
 * synthetic speech — real-corpus vendoring is AWAITING-OWNER — so the
 * absolute WER is corpus-bound; the assertion is a regression guard at
 * baseline + 2 points, not an absolute quality claim.
 */
export function defaultModelWerBaseline(): { value: number; source: string } {
  const { repo } = defaultModel()
  const report = parseJsonAt(REPORT_JSON)
  if (!isRecord(report) || !Array.isArray(report.rows)) throw new Error(`${REPORT_JSON} missing rows[]`)
  const row = report.rows.find(
    (r): r is Record<string, unknown> =>
      isRecord(r) &&
      r.engine === 'transformers.js' &&
      r.model === repo &&
      r.tier === DEFAULT_TIER &&
      r.device === 'webgpu' &&
      r.ok === true &&
      isFiniteNumber(r.wer),
  )
  if (!row) throw new Error(`${REPORT_JSON} has no ok whisper T1 webgpu row for ${repo} (the DEFAULT model must have a measured spike row)`)
  return { value: (row.wer as number) * 100, source: `${REPORT_JSON} rows[${repo},T1,webgpu].wer (ratio ×100 → percentage points, CC-05.5 adjudication convention)` }
}

/** The unit-02 #1739 leak study of the PINNED runtime: the recycle ceiling
 *  (bytes) CC-05.1's T1 row compares GPU-process growth against, and the
 *  per-window growth that derives a safe recycle cadence from it. */
export function recycleCeiling(): { ceilingBytes: number; perWindowGrowthBytes: number; source: string } {
  const report = parseJsonAt(REPORT_JSON)
  if (!isRecord(report) || !Array.isArray(report.leak)) throw new Error(`${REPORT_JSON} missing leak[]`)
  const entry = report.leak.find(
    (l): l is Record<string, unknown> =>
      isRecord(l) &&
      typeof l.version === 'string' &&
      l.version.startsWith('3.8.') &&
      l.device === 'webgpu' &&
      isFiniteNumber(l.recycleCeilingBytes) &&
      (l.recycleCeilingBytes as number) >= 0 &&
      isFiniteNumber(l.perWindowGrowthBytes) &&
      (l.perWindowGrowthBytes as number) > 0,
  )
  if (!entry) throw new Error(`${REPORT_JSON}.leak has no pinned-3.8.x webgpu row with a recycle ceiling + per-window growth`)
  return {
    ceilingBytes: entry.recycleCeilingBytes as number,
    perWindowGrowthBytes: entry.perWindowGrowthBytes as number,
    source: `${REPORT_JSON} leak[${entry.version}/${entry.model}].recycleCeilingBytes (unit-02 CC-02.2 study)`,
  }
}

/** The unit-02 GPU-sampler validation (FR-02.2): before any GPU number is
 *  trusted, the out-of-band `footprint` sampler must have observed a known
 *  allocation on this class of machine. */
export function gpuCalibration(): { passed: boolean; gpuPid: number | null; missingReason: string | null; source: string } {
  const cal = parseJsonAt(GPU_CALIBRATION_JSON)
  if (!isRecord(cal)) return { passed: false, gpuPid: null, missingReason: 'calibration artifact missing', source: GPU_CALIBRATION_JSON }
  return {
    passed: cal.passed === true,
    gpuPid: isFiniteNumber(cal.gpuPid) ? cal.gpuPid : null,
    missingReason: typeof cal.missingReason === 'string' ? cal.missingReason : null,
    source: GPU_CALIBRATION_JSON,
  }
}

/** Chromium launch args the spike measured under (environment.launchArgs). */
export function spikeLaunchArgs(): string[] {
  const report = parseJsonAt(REPORT_JSON)
  const args = isRecord(report) && isRecord(report.environment) && Array.isArray(report.environment.launchArgs) ? report.environment.launchArgs : []
  return args.filter((a): a is string => typeof a === 'string')
}

export function groundTruthTranscript(name: string): string {
  const path = join(REPO_ROOT, 'fixtures/harness/ground-truth', `${name}.json`)
  if (!existsSync(path)) throw new Error(`ground truth missing: fixtures/harness/ground-truth/${name}.json`)
  const gt = JSON.parse(readFileSync(path, 'utf8')) as { transcript?: unknown }
  if (typeof gt.transcript !== 'string' || gt.transcript.trim() === '') throw new Error(`ground truth ${name}.json has no transcript`)
  return gt.transcript
}

interface EvalRegistryRow {
  repo: string
  files: { path: string }[]
}

/** Model cache precondition for the DEFAULT model (setup step `pnpm
 *  models:fetch`, never a download at test time — settings.yml determinism). */
export function assertDefaultModelCachePresent(): void {
  const registry = JSON.parse(readFileSync(join(REPO_ROOT, 'models/eval-registry.json'), 'utf8')) as { models: Record<string, EvalRegistryRow> }
  const { registryId } = defaultModel()
  const dir = registryId.split('@')[0]?.replace(/_/g, '-')
  const row = dir ? Object.values(registry.models).find((r) => r.repo === defaultModel().repo) : undefined
  if (!dir || !row) throw new Error(`models/eval-registry.json has no row for ${defaultModel().repo}`)
  for (const file of row.files) {
    if (!existsSync(join(REPO_ROOT, '.cache/models', dir, file.path))) {
      throw new Error(`model cache incomplete: .cache/models/${dir}/${file.path} missing — run \`pnpm models:fetch\` (setup step, never during a test)`)
    }
  }
}

export function perfFixturePresent(): boolean {
  return existsSync(join(REPO_ROOT, PERF_FIXTURE_REPO_PATH))
}

// --- WER scoring (frozen CC-02.6 CLI; tiny-smoke scratch doctrine) -----------

/**
 * Score WER through `tools/eval/wer.mjs` (the unit-02 CLI) and return
 * PERCENTAGE POINTS (CLI prints a ratio; ×100 — same conversion as
 * `e2e/asr/tiny-smoke.spec.ts` `scoreWer`). SECURITY-03: reference and
 * hypothesis text live only in `.night/wer/<runId>` scratch for the CLI call
 * and are deleted immediately; only the numeric score crosses back.
 */
export function scoreWerPercent(runId: string, reference: string, hypothesis: string): number {
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

// --- network policy (frozen e2e/asr/helpers/asr.ts doctrine, extended) -------

export interface QualifyNetworkCounters {
  modelHost: number
  blocked: string[]
}

/** The frozen unit-05 route policy (e2e/asr/helpers/asr.ts `routeAsrNetwork`:
 *  app/harness from the vite server, /fixtures/** from disk, /wasm/** from
 *  the build-time public mirror, huggingface resolve from the SHA-256-verified
 *  local model cache, EVERYTHING ELSE aborted) with the DEFAULT model's repo
 *  added to the cache map — the frozen helper maps only the CI-served tiny
 *  row. Kept byte-identical in behaviour otherwise (tests never touch the
 *  network; CORP/ACAO so COEP require-corp accepts fulfilled responses). */
export async function routeQualifyAsrNetwork(page: Page, base: string, counters: QualifyNetworkCounters): Promise<void> {
  const cacheDirByRepo: Record<string, string> = {
    'onnx-community/whisper-tiny_timestamped': 'whisper-tiny-timestamped',
    [defaultModel().repo]: defaultModel().registryId.split('@')[0]?.replace(/_/g, '-') ?? '',
  }
  const origin = base.endsWith('/') ? base.slice(0, -1) : base
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(`${origin}/`)) {
      if (url.startsWith(`${origin}/fixtures/`)) {
        const rel = decodeURIComponent(url.slice(origin.length + '/fixtures/'.length).split('?')[0] ?? '')
        const path = join(REPO_ROOT, 'fixtures', rel)
        if (!path.startsWith(join(REPO_ROOT, 'fixtures')) || !existsSync(path)) return route.fulfill({ status: 404, body: `fixture not found: ${rel}` })
        return route.fulfill({ status: 200, body: readFileSync(path), headers: { 'content-type': 'application/octet-stream' } })
      }
      if (url.startsWith(`${origin}/wasm/`)) {
        const rel = decodeURIComponent(url.slice(origin.length + '/wasm/'.length).split('?')[0] ?? '')
        const path = join(REPO_ROOT, 'public/wasm', rel)
        if (!path.startsWith(join(REPO_ROOT, 'public/wasm')) || !existsSync(path)) return route.fulfill({ status: 404, body: 'wasm not found' })
        return route.fulfill({ status: 200, body: readFileSync(path), headers: { 'content-type': 'application/wasm' } })
      }
      await route.continue()
      return
    }
    const host = new URL(url).host
    if (host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')) {
      counters.modelHost += 1
      const match = url.match(/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/)
      const repo = match?.[1]
      const file = match?.[2]
      const dir = repo ? cacheDirByRepo[repo] : undefined
      const cached = repo && file && dir ? join(REPO_ROOT, '.cache/models', dir, file) : undefined
      if (cached && cached.startsWith(join(REPO_ROOT, '.cache/models')) && existsSync(cached)) {
        return route.fulfill({
          status: 200,
          body: readFileSync(cached),
          headers: { 'content-type': 'application/octet-stream', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' },
        })
      }
      return route.abort('blockedbyclient')
    }
    counters.blocked.push(host)
    return route.abort('blockedbyclient')
  })
}

// --- GPU-process sampler (unit-02 method, out of process) --------------------

/**
 * Reuse of the unit-02 GPU-memory measurement method (tools/eval/gpu-sampler.
 * mjs + docs/spikes/gpu-calibration.json): the WebGPU leak lives in the
 * Chrome GPU PROCESS, invisible to page-side heap sampling, so it is sampled
 * out-of-band via macOS `footprint` (kernel phys_footprint). The sampler
 * module is executed via `node -e` — the repo's TS typecheck scope has no JS
 * imports (no allowJs), and spawning keeps the exact unit-02 code path
 * (`footprintBytes` / `findGpuHelperPid`).
 */
export class QualifyGpuSampler {
  readonly gpuPid: number | null
  readonly missingReason: string | null

  private constructor(gpuPid: number | null, missingReason: string | null) {
    this.gpuPid = gpuPid
    this.missingReason = missingReason
  }

  /**
   * Locate the Chrome GPU process the unit-02 way (tools/eval/gpu-sampler.mjs
   * findGpuHelperPidByUserDataDir): every process carrying the persistent
   * profile dir of the launched browser, of which `--type=gpu-process` is the
   * GPU process. @playwright/test's Browser does not expose `process()`, so
   * the profile directory is the reliable handle (the unit-02 harness used
   * the same persistent-context launch).
   */
  static async discover(userDataDir: string | null): Promise<QualifyGpuSampler> {
    if (userDataDir === null) return new QualifyGpuSampler(null, 'browser-profile-unavailable')
    const body = `const p = m.findGpuHelperPidByUserDataDir(process.argv[1]); process.stdout.write(JSON.stringify(p))`
    const pid = await runSamplerModule<number | null>(body, userDataDir)
    return pid === null || pid === undefined ? new QualifyGpuSampler(null, 'gpu-helper-process-not-found') : new QualifyGpuSampler(pid, null)
  }

  async sample(): Promise<number | null> {
    if (this.gpuPid === null) return null
    return runSamplerModule<number | null>(`process.stdout.write(JSON.stringify(m.footprintBytes(${this.gpuPid})))`)
  }
}

async function runSamplerModule<T>(body: string, ...args: string[]): Promise<T | null> {
  const moduleUrl = `file://${join(REPO_ROOT, 'tools/eval/gpu-sampler.mjs')}`
  const script = `const m = await import(${JSON.stringify(moduleUrl)}); ${body}`
  try {
    const { stdout } = await execFileAsync('node', ['--input-type=module', '-e', script, ...args], { cwd: REPO_ROOT, timeout: 30_000 })
    return JSON.parse(stdout) as T
  } catch {
    return null
  }
}

// --- measurement record (existing qualification schema + honesty fields) ----

export interface MeasurementRow {
  id: string
  run: string
  pass: boolean
  /** Human-readable measured-vs-threshold line (qualification results[] shape). */
  measured: string
  threshold: string
  /** Machine-readable values; UNMEASURABLE entries are null with `reason` —
   *  never a fabricated number (unit-02 row-field doctrine). */
  values: Record<string, number | string | null>
  ok: boolean
  reason: string | null
}

/**
 * Upsert measurement rows into `qualification/unit-05-measurements.json`
 * (sibling of `qualification/0.0.0-spike.json` — the committed CC-02 record
 * and the frozen CC-02.5 legs are untouched; the release flow promotes these
 * results[] entries per conventions § Release qualification).
 */
export function recordMeasurementRow(row: MeasurementRow): void {
  const outPath = join(REPO_ROOT, MEASUREMENTS_FILE)
  const existing = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')) as { rows?: MeasurementRow[] }) : {}
  const rows = Array.isArray(existing.rows) ? existing.rows : []
  const at = rows.findIndex((r) => r.id === row.id && r.run === row.run)
  if (at >= 0) rows.splice(at, 1, row)
  else rows.push(row)
  const record = {
    version: '0.0.0-spike',
    unit: 'unit-05-transcription-pipeline',
    recordedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => `${a.id}/${a.run}`.localeCompare(`${b.id}/${b.run}`)),
  }
  mkdirSync(join(REPO_ROOT, 'qualification'), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`)
}

/** The honest unmeasurable row: ok:false, every numeric value null, reason. */
export function unmeasurableRow(id: string, run: string, threshold: string, reason: string, valueKeys: string[]): MeasurementRow {
  const values: Record<string, number | string | null> = {}
  for (const key of valueKeys) values[key] = null
  return { id, run, pass: false, measured: `unmeasurable: ${reason}`, threshold, values, ok: false, reason }
}

// --- harness run summary (page boundary; mirrors e2e/asr spec interfaces) ----

export interface QualifyRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  cancelled: boolean
  downgraded: boolean
  workerEpochs: number
  detectedLanguage: string | null
  segmentCount: number
  wordCount: number
  blocks: { start: number; end: number; text: string }[]
  hypothesis: string
  eventSummary: { t: string; code?: string; notice?: string }[]
  runWallMs: number
}

export interface QualifyRunOptions {
  fixture: string
  modelId: string
  device: 'wasm' | 'webgpu'
  language: string | null
  tier: 'T1' | 'T2'
  recycleEveryNWindows?: number
}


