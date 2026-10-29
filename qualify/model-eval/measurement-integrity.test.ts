// CC-02.1 / CC-02.2 — measurement-integrity re-derivation (adversarial round,
// fabrication resistance): every derived figure in the committed report must
// match the raw series recorded beside it. FR-02.1 mandates "median of 3
// runs" and US-02.1 records the per-run wall times (`wallMsRuns`) precisely so
// the median "can never hide a copied number" (tools/eval/harness.mjs
// scoreRow); US-02.3's perWindowGrowthBytes is likewise recomputable from
// `gpuMemBytesAfterWindow` (harness leakRun: max(0, round((last−first)/span))).
// The shape-only assertions in report-rows/leak-measurement accept any finite
// constant in these fields — this suite closes the gap: it recomputes each
// derived value from the raw evidence and rejects rows whose recorded figure
// contradicts it, so a fabricated RTF (or growth) fails the qualification
// gate instead of rubber-stamping it (conventions.md § Principles 1:
// machine-checked evidence).
import { expect, test } from 'vitest'
import { REPORT_JSON, isFiniteNumber, isRecord, parseJsonAt, rowsOf } from '../helpers/eval-report'

// The harness rounds `rtf` to 4 decimals (Math.round(rtf*1e4)/1e4) and each
// `wallMsRuns` entry to 0.1 ms (scoreRow), so the recomputation cannot be
// bit-exact: 1 % relative tolerance with a 1e-4 absolute floor covers both
// roundings while rejecting any plausible-but-fabricated constant (the
// measured RTFs are 0.02–0.07; a fabricated 0.0001 deviates by 99 %).
const RTF_REL_EPSILON = 0.01
const RTF_ABS_EPSILON = 0.0001
// `wallMs` is the median of the UNROUNDED runs, compared here against the
// median of the 0.1 ms-rounded series.
const WALL_TOLERANCE_MS = 1

// perWindowGrowthBytes is integer-exact under the harness formula; the
// epsilon only absorbs re-serialisation (1 % relative, 64 B absolute floor).
const GROWTH_REL_EPSILON = 0.01
const GROWTH_ABS_EPSILON = 64

/** tools/eval/harness.mjs median(): upper-middle element of the sorted copy. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

test('CC-02.1: every measured row records ≥3 finite positive runs and its rtf equals median(wallMsRuns)/durationSeconds', () => {
  // FR-02.1 "median of 3 runs" / US-02.1 "RTF(median of 3)": a row backed by
  // fewer than three runs cannot carry the median-of-3 criterion, and a
  // recorded rtf that contradicts its own run series was not measured.
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const problems: string[] = []
  rowsOf(report).forEach((value, index) => {
    if (!isRecord(value) || value['ok'] !== true) return
    const label = `rows[${index}](${String(value['engineId'])}/${String(value['model'])})`
    const durationSeconds = value['durationSeconds']
    if (!isFiniteNumber(durationSeconds) || durationSeconds <= 0) {
      problems.push(`${label}.durationSeconds must be a finite number > 0, got ${JSON.stringify(durationSeconds)}`)
      return
    }
    const runs = value['wallMsRuns']
    if (!Array.isArray(runs) || runs.length < 3) {
      problems.push(`${label}.wallMsRuns must record ≥ 3 runs (median of 3, FR-02.1), got ${JSON.stringify(runs)}`)
      return
    }
    if (!runs.every((run) => isFiniteNumber(run) && (run as number) > 0)) {
      problems.push(`${label}.wallMsRuns entries must all be finite numbers > 0, got ${JSON.stringify(runs)}`)
      return
    }
    const medianRun = median(runs as number[])
    const recomputed = medianRun / 1000 / durationSeconds
    const rtf = value['rtf']
    if (!isFiniteNumber(rtf)) {
      problems.push(`${label}.rtf must be a finite number, got ${JSON.stringify(rtf)}`)
    } else if (Math.abs((rtf as number) - recomputed) > Math.max(RTF_ABS_EPSILON, RTF_REL_EPSILON * recomputed)) {
      problems.push(`${label}.rtf ${JSON.stringify(rtf)} contradicts median(wallMsRuns)=${medianRun}ms / duration=${durationSeconds}s (recomputed ${recomputed}) — the row was not measured as recorded`)
    }
    const wallMs = value['wallMs']
    if (isFiniteNumber(wallMs) && Math.abs((wallMs as number) - medianRun) > Math.max(WALL_TOLERANCE_MS, RTF_REL_EPSILON * medianRun)) {
      problems.push(`${label}.wallMs ${JSON.stringify(wallMs)} contradicts median(wallMsRuns)=${medianRun}ms`)
    }
  })
  expect(problems, `derived measurements must match their raw series (${REPORT_JSON}):\n${problems.join('\n')}`).toEqual([])
})

test('CC-02.2: leak perWindowGrowthBytes is consistent with the recorded per-window samples', () => {
  // US-02.3 machine-checked evidence: perWindowGrowthBytes is a derived value
  // (harness leakRun: Math.max(0, Math.round((last − first) / (lastIdx −
  // firstIdx)))). Zeroing it while leaving the rising gpuMemBytesAfterWindow
  // samples in place — the fabrication that would flip the #1739 pin
  // recommendation — must fail the gate.
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const problems: string[] = []
  const leak = isRecord(report) && Array.isArray(report['leak']) ? report['leak'] : []
  leak.forEach((value, index) => {
    if (!isRecord(value)) return
    const label = `leak[${index}](${String(value['version'])}/${String(value['model'])})`
    const recorded = value['perWindowGrowthBytes']
    if (recorded === null || recorded === undefined) return
    if (!isFiniteNumber(recorded)) {
      problems.push(`${label}.perWindowGrowthBytes must be a finite number or null, got ${JSON.stringify(recorded)}`)
      return
    }
    const samples = value['gpuMemBytesAfterWindow']
    if (!Array.isArray(samples)) {
      problems.push(`${label}.perWindowGrowthBytes is recorded but gpuMemBytesAfterWindow is missing — no evidence the growth was measured`)
      return
    }
    const finiteIdx: number[] = []
    samples.forEach((sample, position) => {
      if (isFiniteNumber(sample)) finiteIdx.push(position)
    })
    if (finiteIdx.length < 2) {
      problems.push(`${label}.perWindowGrowthBytes=${recorded} but fewer than 2 finite gpuMemBytesAfterWindow samples exist — growth cannot be derived`)
      return
    }
    const firstIdx = finiteIdx[0] as number
    const lastIdx = finiteIdx[finiteIdx.length - 1] as number
    const first = samples[firstIdx] as number
    const last = samples[lastIdx] as number
    const derived = Math.max(0, Math.round((last - first) / Math.max(1, lastIdx - firstIdx)))
    if (Math.abs((recorded as number) - derived) > Math.max(GROWTH_ABS_EPSILON, GROWTH_REL_EPSILON * derived)) {
      problems.push(`${label}.perWindowGrowthBytes=${recorded} contradicts samples ${first} → ${last} bytes over ${lastIdx - firstIdx} windows (derived ${derived}) — the row was not measured as recorded`)
    }
  })
  expect(problems, `leak growth must match its raw sample series (${REPORT_JSON}):\n${problems.join('\n')}`).toEqual([])
})
