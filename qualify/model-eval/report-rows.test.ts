// CC-02.1 `[RQ]` — measured rows for engines A, B, C at T1 (B, C at least T2)
// and forced-T2 for A, per US-02.1. Asserted data-driven over the harness
// artifacts (docs/spikes/model-eval-report.md + its JSON mirror), so the
// builder's measurement run on reference hardware flips these green.
import { expect, test } from 'vitest'
import { exists, readText } from '../../tests/helpers/repo'
import { DEVICES, ENGINE_IDS, ENGINE_VOCAB, REPORT_MD, REPORT_JSON, TIMESTAMP_MODES, isBoolean, isFiniteNumber, isNonEmptyString, isRecord, parseJsonAt, rowsOf } from '../helpers/eval-report'

const US_02_1_STRING_FIELDS = ['engine', 'version', 'model', 'revision', 'device', 'corpusClip', 'license'] as const
const US_02_1_NUMBER_FIELDS = ['wer', 'wordTimingMAEms', 'rtf', 'peakJsHeapBytes', 'gpuMemGrowthPerWindowBytes'] as const
const US_02_1_BOOL_FIELDS = ['punctuated', 'confidence', 'languageDetect'] as const

function rowLabel(row: Record<string, unknown>, index: number): string {
  return `rows[${index}](${String(row['engineId'])}/${String(row['engine'])}/${String(row['model'])}/${String(row['device'])})`
}

test('CC-02.1: the measured spike report is committed at docs/spikes/model-eval-report.md (FR-02.6)', () => {
  expect(exists(REPORT_MD), `${REPORT_MD} must exist (FR-02.6 code-owned report path)`).toBe(true)
  const md = readText(REPORT_MD)
  expect(md.trim().length, `${REPORT_MD} is not empty`).toBeGreaterThan(0)
  const lower = md.toLowerCase()
  for (const engine of Object.values(ENGINE_VOCAB)) {
    expect(lower.includes(engine), `${REPORT_MD} records measured rows for engine "${engine}"`).toBe(true)
  }
  // Whistle (candidate C model) and Parakeet (candidate B model) are named too.
  expect(lower.includes('whistle'), `${REPORT_MD} records the Whistle rows (candidate C)`).toBe(true)
})

test('CC-02.1: the machine-readable rows mirror the report and are non-trivial', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse — machine-readable mirror of the report (FR-02.1 harness artifact)`).not.toBeNull()
  expect(isRecord(report), `${REPORT_JSON} is a JSON object`).toBe(true)
  const rows = rowsOf(report)
  // A@T1, A@forced-T2, B, C minimum (the Candidates table).
  expect(rows.length, `${REPORT_JSON}.rows has at least the four required measurement rows (A@T1, A@T2, B, C)`).toBeGreaterThanOrEqual(4)
})

test('CC-02.1: rows cover A at T1 (webgpu), A forced-T2 (wasm), and B and C at ≥T2 (wasm)', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const rows = rowsOf(report).filter(isRecord)

  const has = (engineId: string, device: string, tier?: string): boolean =>
    rows.some((row) => row['engineId'] === engineId && row['device'] === device && (tier === undefined || row['tier'] === tier))

  expect(has('A', 'webgpu', 'T1'), 'engine A (transformers.js) has a T1 webgpu row').toBe(true)
  expect(has('A', 'wasm', 'T2'), 'engine A has a forced-T2 wasm row (FR-02.3)').toBe(true)
  expect(has('B', 'wasm'), 'engine B (sherpa-onnx wasm/vad-asr, non-streaming) has at least a wasm row (≥T2)').toBe(true)
  expect(has('C', 'wasm'), 'engine C (cactus needle.wasm / Whistle) has at least a wasm row (≥T2)').toBe(true)
  for (const row of rows) {
    if (isNonEmptyString(row['engineId'])) {
      expect(ENGINE_IDS as readonly string[], `rows engineId is a Candidates-table letter, got ${String(row['engineId'])}`).toContain(row['engineId'])
    }
    if (isNonEmptyString(row['device'])) {
      expect(DEVICES as readonly string[], `row device ∈ webgpu|wasm, got ${String(row['device'])}`).toContain(row['device'])
    }
    if (isNonEmptyString(row['tier'])) {
      expect(['T1', 'T2', 'T3'], `row tier ∈ T1|T2|T3, got ${String(row['tier'])}`).toContain(row['tier'])
    }
  }
})

test('CC-02.1: every row carries the complete US-02.1 measurement record', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const problems: string[] = []
  rowsOf(report).forEach((value, index) => {
    if (!isRecord(value)) {
      problems.push(`rows[${index}] is not an object`)
      return
    }
    const label = rowLabel(value, index)
    for (const field of US_02_1_STRING_FIELDS) {
      if (!isNonEmptyString(value[field])) problems.push(`${label}.${field} must be a non-empty string, got ${JSON.stringify(value[field])}`)
    }
    for (const field of US_02_1_NUMBER_FIELDS) {
      if (!isFiniteNumber(value[field]) || (value[field] as number) < 0) problems.push(`${label}.${field} must be a finite number ≥ 0, got ${JSON.stringify(value[field])}`)
    }
    for (const field of US_02_1_BOOL_FIELDS) {
      if (!isBoolean(value[field])) problems.push(`${label}.${field} must be a boolean (capability probe, FR-02.8), got ${JSON.stringify(value[field])}`)
    }
    const engineId = value['engineId']
    if (engineId !== 'A' && engineId !== 'B' && engineId !== 'C') {
      problems.push(`${label}.engineId must be one of A|B|C, got ${JSON.stringify(engineId)}`)
    } else if (value['engine'] !== ENGINE_VOCAB[engineId]) {
      problems.push(`${label}.engine must be "${ENGINE_VOCAB[engineId]}" for engineId ${engineId}, got ${JSON.stringify(value['engine'])}`)
    }
    if (isNonEmptyString(value['revision']) && !/^[0-9a-f]{7,40}$/.test(value['revision'])) {
      // FR-02.9: every model row records the HF commit SHA (x-repo-commit).
      problems.push(`${label}.revision must be an HF commit SHA (FR-02.9), got ${JSON.stringify(value['revision'])}`)
    }
    if (!(TIMESTAMP_MODES as readonly string[]).includes(String(value['timestamps']))) {
      problems.push(`${label}.timestamps must be word-native|word-dtw|segment (US-02.1), got ${JSON.stringify(value['timestamps'])}`)
    }
    if (value['verified'] !== true) problems.push(`${label}.verified must be true (US-02.1), got ${JSON.stringify(value['verified'])}`)
  })
  expect(problems, `US-02.1 field record complete on every row:\n${problems.join('\n')}`).toEqual([])
})

test('CC-02.1: rows more than +3 points above vendor WER are flagged degraded-vs-vendor', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const problems: string[] = []
  rowsOf(report).forEach((value, index) => {
    if (!isRecord(value)) return
    const label = rowLabel(value, index)
    const vendorWer = value['vendorWer']
    const wer = value['wer']
    if (vendorWer === undefined) {
      if (value['degradedVsVendor'] !== undefined) problems.push(`${label}.degradedVsVendor without vendorWer — no vendor figure to compare`)
      return
    }
    if (!isFiniteNumber(vendorWer) || !isFiniteNumber(wer)) {
      problems.push(`${label}.vendorWer/wer must be finite numbers, got ${JSON.stringify(vendorWer)}/${JSON.stringify(wer)}`)
      return
    }
    if (wer - vendorWer > 3 && value['degradedVsVendor'] !== true) {
      problems.push(`${label} is ${wer} vs vendor ${vendorWer} (> +3 points) and must be flagged degraded-vs-vendor (US-02.1)`)
    }
  })
  expect(problems, `vendor-WER +3-point rule (US-02.1):\n${problems.join('\n')}`).toEqual([])
})
