// CC-02.3 `[RQ]` — `wordTimingMAEms` plus the capability flags
// (`languageDetect`, `confidence`, `punctuated`) recorded for every adopted
// row. FR-02.7: word-timing MAE (not WER) judges the editor's
// manual-correction burden; FR-02.8: the capability probes become the unit-03
// registry flags; FR-02.4: `punctuated` resolves the Whisper-no-punctuation
// gap. "Adopted" = an engine named in the CC-02.11 default recommendation.
import { expect, test } from 'vitest'
import { REPORT_JSON, REPORT_MD, adoptedEngineIds, isBoolean, isFiniteNumber, isRecord, parseJsonAt, rowsOf } from '../helpers/eval-report'
import { exists, readText } from '../../tests/helpers/repo'

test('CC-02.3: every adopted row records wordTimingMAEms and the capability flags (FR-02.7/FR-02.8)', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const adopted = adoptedEngineIds(report)
  expect(adopted.length, 'the default recommendation (CC-02.11) names at least one adopted engine').toBeGreaterThan(0)

  const problems: string[] = []
  let adoptedRowCount = 0
  rowsOf(report).forEach((value, index) => {
    if (!isRecord(value) || typeof value['engineId'] !== 'string' || !adopted.includes(value['engineId'])) return
    adoptedRowCount += 1
    const label = `rows[${index}](${String(value['engineId'])}/${String(value['model'])})`
    if (!isFiniteNumber(value['wordTimingMAEms']) || (value['wordTimingMAEms'] as number) < 0) {
      problems.push(`${label}.wordTimingMAEms must be a finite ms value ≥ 0 (FR-02.7), got ${JSON.stringify(value['wordTimingMAEms'])}`)
    }
    for (const flag of ['languageDetect', 'confidence', 'punctuated'] as const) {
      if (!isBoolean(value[flag])) problems.push(`${label}.${flag} must be a boolean capability flag (FR-02.8 → unit-03 registry), got ${JSON.stringify(value[flag])}`)
    }
  })
  expect(adoptedRowCount, 'at least one measured row belongs to an adopted engine').toBeGreaterThan(0)
  expect(problems, `MAE + capability flags on every adopted row:\n${problems.join('\n')}`).toEqual([])
})

test('CC-02.3: the punctuation decision input is recorded for every evaluated row (FR-02.4/FR-02.8)', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const problems: string[] = []
  rowsOf(report).forEach((value, index) => {
    if (!isRecord(value)) return
    for (const flag of ['languageDetect', 'confidence', 'punctuated'] as const) {
      if (!isBoolean(value[flag])) problems.push(`rows[${index}].${flag} must be a probed boolean (FR-02.8), got ${JSON.stringify(value[flag])}`)
    }
  })
  expect(problems, `capability probes on every row:\n${problems.join('\n')}`).toEqual([])
  // FR-02.4: the report must resolve the Whisper-no-punctuation gap, so the
  // punctuation decision is a named part of it.
  expect(exists(REPORT_MD), `${REPORT_MD} must exist to record the punctuation decision`).toBe(true)
  const lower = readText(REPORT_MD).toLowerCase()
  expect(lower.includes('punctuat'), `${REPORT_MD} records the punctuation decision (FR-02.4)`).toBe(true)
})
