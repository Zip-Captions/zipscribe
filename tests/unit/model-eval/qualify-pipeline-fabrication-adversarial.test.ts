// CC-02.1 / CC-02.2 — fabrication resistance of the qualification pipeline
// itself (unit-02's raison d'être after build-1 was REJECTED for fabricated
// measurements passing shape-only checks — docs/overnight-ledger.md, and the
// BUILD_VERIFIED failure recorded in the unit report).
//
// Contract anchors:
// - FR-02.1: "**median of 3 runs**, model SHA-256 recorded" — enforced by the
//   harness (US-02.1: "RTF(median of 3)"), not just performed by it.
// - conventions.md § Principles 1: every step ends with "**machine-checked
//   evidence**"; a qualify suite that cannot distinguish a real measurement
//   from a plausible-looking constant is not machine-checking.
// - conventions.md § Criterion traceability: qualification results are keyed
//   by criterion ID; verify fails when a criterion has no evidence.
//
// Every probe copies the committed release tree + qualification artifacts into
// a scratch checkout, applies a tamper that leaves every shape assertion in
// qualify/model-eval/ satisfied but contradicts the recorded raw series, and
// asserts the pipeline refuses it. A pristine baseline suite runs first:
// these tests fail (red) only for the tampered leg, never for infrastructure.
import { afterAll, beforeAll, expect, test } from 'vitest'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT, runIn } from '../../helpers/repo'

const COPIED_FILES = ['package.json', 'pnpm-lock.yaml', 'vitest.config.qualify.ts']
const COPIED_DIRS = ['scripts', 'qualify', 'tests', 'src', 'public', 'models', 'docs', '.ai-dlc']
const GENERATED_PUBLIC = ['public/wasm', 'public/sherpa', 'public/hf-cache', 'public/fixtures', 'public/eval4x']

interface SuiteVerdict {
  status: number | null
  passed: number
  failed: number
  failedTitles: string[]
}

function makeScratch(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `zsap-fab-${label}-`))
  for (const file of COPIED_FILES) cpSync(join(REPO_ROOT, file), join(dir, file))
  for (const tree of COPIED_DIRS) {
    cpSync(join(REPO_ROOT, tree), join(dir, tree), {
      recursive: true,
      filter: (source) => !GENERATED_PUBLIC.some((skip) => source.startsWith(join(REPO_ROOT, skip))),
    })
  }
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
  mkdirSync(join(dir, '.cache'), { recursive: true })
  return dir
}

interface ReportRow {
  engineId: string
  rtf: number
  wallMs: number
  wallMsRuns: number[]
  durationSeconds: number
}
interface LeakEntry {
  version: string
  perWindowGrowthBytes: number
  disposeReclaims: boolean
  disposeBeforeBytes: number
  disposeAfterBytes: number
  gpuMemBytesAfterWindow: number[]
}
interface EvalReport {
  rows: ReportRow[]
  baselineCheck: { whisperBaseT1Rtf: number }
  leak: LeakEntry[]
}

function readReport(dir: string): EvalReport {
  return JSON.parse(readFileSync(join(dir, 'docs', 'spikes', 'model-eval-report.json'), 'utf8')) as EvalReport
}

function writeReport(dir: string, report: unknown): void {
  writeFileSync(join(dir, 'docs', 'spikes', 'model-eval-report.json'), `${JSON.stringify(report, null, 2)}\n`)
}

function runQualifySuite(dir: string): SuiteVerdict {
  const res = runIn(dir, 'node', ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.qualify.ts', '--reporter=json', '--outputFile=.cache/q.json'], 280_000)
  const verdict: SuiteVerdict = { status: res.status, passed: 0, failed: 0, failedTitles: [] }
  try {
    const json = JSON.parse(readFileSync(join(dir, '.cache', 'q.json'), 'utf8')) as {
      testResults?: Array<{ assertionResults?: Array<{ status?: string; fullName?: string; title?: string }> }>
    }
    for (const file of json.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) {
        if (assertion.status === 'passed') verdict.passed++
        else if (assertion.status === 'failed') {
          verdict.failed++
          verdict.failedTitles.push(assertion.fullName ?? assertion.title ?? '(untitled)')
        }
      }
    }
  } catch {
    // no JSON reporter output → the run died; verdict.status carries that.
  }
  return verdict
}

const suites: string[] = []
function trackedScratch(label: string): string {
  const dir = makeScratch(label)
  suites.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of suites) rmSync(dir, { recursive: true, force: true })
})

beforeAll(async () => {
  // Infrastructure baseline: the UNMODIFIED copied tree must pass the whole
  // qualify suite — otherwise every tamper below proves nothing.
  const dir = trackedScratch('baseline')
  const baseline = runQualifySuite(dir)
  expect(baseline.status, `baseline qualify suite must exit 0 (${baseline.failedTitles.join('; ')})`).toBe(0)
  expect(baseline.failed, 'baseline qualify suite must have no failed assertions').toBe(0)
  expect(baseline.passed, 'baseline qualify suite must run assertions at all').toBeGreaterThan(10)
}, 290_000)

test('CC-02.1: a fabricated RTF that contradicts the recorded wallMsRuns must be rejected by the qualification gate', () => {
  // FR-02.1: RTF is "median of 3 runs". The committed row records the raw
  // series (wallMsRuns, durationSeconds) beside the rtf, and the rtf is
  // derivable from them — the qualify suite cross-checks rtf only against
  // baselineCheck (both hand-editable), never against the series. So a
  // constant "fast" RTF consistent with baselineCheck survives the gate:
  // exactly the build-1 failure mode. Median(wallMsRuns)/durationSeconds is
  // recomputed here to prove the tampered value contradicts the evidence.
  const dir = trackedScratch('rtf')
  const report = readReport(dir)
  const row = report.rows.find((r) => r.engineId === 'A')
  expect(row, 'probe precondition: row A exists').toBeTruthy()
  const runs = row!.wallMsRuns
  expect(Array.isArray(runs), 'probe precondition: wallMsRuns recorded').toBe(true)
  expect(runs.length, 'probe precondition: wallMsRuns non-empty').toBeGreaterThan(0)
  const median = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)] ?? Number.NaN
  const honestRtf = median / 1000 / row!.durationSeconds
  expect(Number.isFinite(honestRtf), 'probe precondition: honest RTF derivable').toBe(true)
  expect(Math.abs(honestRtf - row!.rtf) / honestRtf, 'probe precondition: committed rtf matches median(wallMsRuns)/duration').toBeLessThan(0.05)
  row!.rtf = 0.0001
  report.baselineCheck.whisperBaseT1Rtf = 0.0001
  writeReport(dir, report)
  const verdict = runQualifySuite(dir)
  expect(
    verdict.failed,
    `RTF 0.0001 contradicts median(wallMsRuns)=${median}ms / duration=${row!.durationSeconds}s (honest ${honestRtf.toFixed(4)}) — the gate must fail it, got ${verdict.failed} failed assertions and exit ${verdict.status} (passed: ${verdict.passed})`,
  ).toBeGreaterThan(0)
}, 290_000)

test('CC-02.1: a row backed by a single recorded run cannot carry the median-of-3 criterion', () => {
  // US-02.1: "RTF(median of 3)"; FR-02.1 enforces "median of 3 runs". A row
  // whose wallMsRuns has one entry is internally consistent (median of one)
  // but violates the run count — the harness produces three runs or an
  // ok:false row (tools/eval/harness.mjs runRow breaks on the first failed
  // run), so a one-entry series cannot come from a real measurement. No
  // qualify assertion inspects wallMsRuns.
  const dir = trackedScratch('single-run')
  const report = readReport(dir)
  const row = report.rows.find((r) => r.engineId === 'A')
  expect(row, 'probe precondition: row A exists').toBeTruthy()
  expect(row!.wallMsRuns.length, 'probe precondition: committed rows record 3 runs').toBe(3)
  const kept = row!.wallMsRuns[1] ?? Number.NaN
  expect(Number.isFinite(kept), 'probe precondition: wallMsRuns[1] finite').toBe(true)
  row!.wallMsRuns = [kept]
  row!.wallMs = kept
  row!.rtf = kept / 1000 / row!.durationSeconds
  writeReport(dir, report)
  const verdict = runQualifySuite(dir)
  expect(
    verdict.failed,
    `wallMsRuns shrunk to 1 run (median of 3 required) must fail the gate, got ${verdict.failed} failed assertions and exit ${verdict.status}`,
  ).toBeGreaterThan(0)
}, 290_000)

test('CC-02.2: fabricated zero GPU-memory growth against recorded rising samples must be rejected', () => {
  // US-02.3 / #1739: the leak study's perWindowGrowthBytes is a derived
  // measurement — recomputable from gpuMemBytesAfterWindow (windowCount,
  // windowSeconds are recorded beside them). The 4.x row is the one that
  // decided the pin (leakPinRecommendation); zeroing its growth while
  // leaving the raw samples in place is a fabrication the shape-only CC-02.2
  // assertions accept today (only finiteness is checked).
  const dir = trackedScratch('leak')
  const report = readReport(dir)
  const entries = report.leak
  expect(entries.length, 'probe precondition: leak rows exist').toBeGreaterThan(0)
  const entry = entries.find((e) => e.version.startsWith('4.')) ?? entries[entries.length - 1]
  expect(entry, 'probe precondition: a leak entry exists').toBeTruthy()
  const samples = entry!.gpuMemBytesAfterWindow
  expect(Array.isArray(samples), 'probe precondition: per-window samples recorded').toBe(true)
  expect(samples.length, 'probe precondition: ≥ 2 samples').toBeGreaterThanOrEqual(2)
  const first = samples[0] ?? Number.NaN
  const last = samples[samples.length - 1] ?? Number.NaN
  expect(Number.isFinite(first) && Number.isFinite(last), 'probe precondition: samples finite').toBe(true)
  expect(last > first, 'probe precondition: committed samples rise (the leak was measured)').toBe(true)
  entry!.perWindowGrowthBytes = 0
  entry!.disposeReclaims = false
  entry!.disposeAfterBytes = entry!.disposeBeforeBytes
  writeReport(dir, report)
  const verdict = runQualifySuite(dir)
  expect(
    verdict.failed,
    `perWindowGrowthBytes=0 contradicts samples rising ${samples[0]} → ${samples[samples.length - 1]} bytes — the gate must fail it, got ${verdict.failed} failed assertions and exit ${verdict.status}`,
  ).toBeGreaterThan(0)
}, 290_000)

test('CC-02.1: deleting every test for a criterion must not leave the runner recording it as passing', () => {
  // scripts/qualify.ts buckets vitest assertion labels with `label.includes(id)`
  // and records pass when failed===0 && passed>0 — so 'CC-02.1' is satisfied
  // by the CC-02.10/CC-02.11 assertions and a criterion whose own tests were
  // deleted is still written pass:true with exit 0. conventions.md § Release
  // exit: "every [RQ]/[MANUAL] criterion … passes" requires EVIDENCE keyed to
  // the ID; conventions.md § Criterion traceability requires the trace back.
  const dir = trackedScratch('attribution')
  const home = join(dir, 'qualify', 'model-eval', 'report-rows.test.ts')
  expect(existsSync(home), 'probe precondition: report-rows.test.ts exists at HEAD').toBe(true)
  rmSync(home)
  const res = runIn(dir, 'node', ['scripts/qualify.ts'], 280_000)
  const written = JSON.parse(readFileSync(join(dir, 'qualification', '0.0.0-spike.json'), 'utf8')) as {
    results: Array<{ id: string; pass: boolean; measured: string }>
  }
  const cc1 = written.results.find((r) => r.id === 'CC-02.1')
  const evidence = `runner exit ${res.status}, written CC-02.1 record: ${JSON.stringify(cc1)} (output tail: ${res.stdout.split('\n').at(-2)})`
  expect(
    res.status === 0 && cc1?.pass === true ? 'fabricated pass' : 'rejected',
    `with report-rows.test.ts deleted, CC-02.1 has zero own assertions — the run must fail or record it not-passed; got ${evidence}`,
  ).toBe('rejected')
}, 290_000)
