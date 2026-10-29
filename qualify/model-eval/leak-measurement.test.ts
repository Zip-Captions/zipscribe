// CC-02.2 `[RQ]` — transformers.js issue #1739 GPU-memory leak measured on the
// pinned 3.8.1 AND latest 4.x (US-02.3): whisper-small_timestamped, pinned dtype
// recipe, T1, 20 consecutive 28 s windows as separate pipeline calls, with the
// per-window GPU-process memory, the per-window growth, whether `dispose()`
// reclaims it, and the recommended worker-recycle ceiling (bytes) for unit-05.
// Data-driven over the harness JSON mirror of the report.
import { expect, test } from 'vitest'
import { REPORT_JSON, isBoolean, isFiniteNumber, isNonEmptyString, isRecord, parseJsonAt } from '../helpers/eval-report'

function leakEntries(): Array<Record<string, unknown>> {
  const report = parseJsonAt(REPORT_JSON)
  if (!isRecord(report) || !Array.isArray(report['leak'])) return []
  return report['leak'].filter(isRecord)
}

test('CC-02.2: leak rows exist for BOTH the pinned 3.8.1 and latest 4.x (US-02.3)', () => {
  const entries = leakEntries()
  expect(entries.length, `${REPORT_JSON}.leak records the #1739 study (both runtime versions)`).toBeGreaterThan(0)
  const versions = entries.map((entry) => String(entry['version']))
  expect(versions.some((v) => v === '3.8.1' || v.startsWith('3.8.')), `a 3.8.1 (pinned) leak row exists; versions seen: ${versions.join(', ')}`).toBe(true)
  expect(versions.some((v) => /^4\.\d/.test(v)), `a latest-4.x leak row exists; versions seen: ${versions.join(', ')}`).toBe(true)
})

test('CC-02.2: each leak row measures 20×28 s windows on whisper-small_timestamped and records growth, reclaim and recycle ceiling', () => {
  const entries = leakEntries()
  const problems: string[] = []
  for (const entry of entries) {
    const label = `leak(${String(entry['version'])}/${String(entry['model'])})`
    const model = entry['model']
    if (!isNonEmptyString(model) || !model.includes('whisper-small') || !model.includes('timestamped')) {
      problems.push(`${label}.model must be whisper-small_timestamped (US-02.3), got ${JSON.stringify(model)}`)
    }
    if (entry['device'] !== 'webgpu') problems.push(`${label}.device must be webgpu (T1 study), got ${JSON.stringify(entry['device'])}`)
    if (entry['windowSeconds'] !== 28) problems.push(`${label}.windowSeconds must be 28 (≤ 28 s VAD windows, discovery.md), got ${JSON.stringify(entry['windowSeconds'])}`)
    if (entry['windowCount'] !== 20) problems.push(`${label}.windowCount must be 20 (US-02.3), got ${JSON.stringify(entry['windowCount'])}`)
    const samples = entry['gpuMemBytesAfterWindow']
    if (!Array.isArray(samples) || samples.length < 20 || !samples.every((s) => isFiniteNumber(s) && (s as number) >= 0)) {
      problems.push(`${label}.gpuMemBytesAfterWindow must be ≥ 20 finite GPU-process memory samples (bytes), one per window`)
    }
    if (!isFiniteNumber(entry['perWindowGrowthBytes'])) problems.push(`${label}.perWindowGrowthBytes must be a finite number, got ${JSON.stringify(entry['perWindowGrowthBytes'])}`)
    if (!isBoolean(entry['disposeReclaims'])) problems.push(`${label}.disposeReclaims must record whether pipeline dispose() reclaims (US-02.3), got ${JSON.stringify(entry['disposeReclaims'])}`)
    if (!isFiniteNumber(entry['recycleCeilingBytes']) || (entry['recycleCeilingBytes'] as number) < 0) {
      problems.push(`${label}.recycleCeilingBytes (unit-05 worker-recycle ceiling recommendation) must be a finite number ≥ 0, got ${JSON.stringify(entry['recycleCeilingBytes'])}`)
    }
  }
  expect(problems, `leak measurement shape (US-02.3 / #1739):\n${problems.join('\n')}`).toEqual([])
})

test('CC-02.2: a pin recommendation is recorded (3.8.1 vs 4.x, decides the version pin)', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const recommendation = isRecord(report) ? report['leakPinRecommendation'] : undefined
  expect(isNonEmptyString(recommendation), 'leakPinRecommendation: the pin decision the spike data produces (settings.yml version_pins rationale)').toBe(true)
  const text = String(recommendation)
  expect(/3\.8|4\./.test(text), `leakPinRecommendation must state the version it keeps/adopts, got "${text}"`).toBe(true)
})
