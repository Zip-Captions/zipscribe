// CC-02.7 `[RQ]` — `whisper-base` T1 RTF recorded, and the
// `settings.yml performance_baselines` entry `whisper-small ≥ 4× realtime`
// confirmed or corrected via the report's statement (follow-up settings patch
// PR is the orchestrator's action — the report must record which outcome).
//
// RTF here is real-time factor (wall time / audio duration): ≥ 4× realtime ⇔
// RTF ≤ 0.25. Thresholds themselves stay in `pnpm qualify`'s measured-value
// comparison; this suite proves the row and the verdict exist.
import { expect, test } from 'vitest'
import { REPORT_JSON, isFiniteNumber, isNonEmptyString, isRecord, parseJsonAt, rowsOf } from '../helpers/eval-report'

function baseT1Row(): Record<string, unknown> | null {
  const report = parseJsonAt(REPORT_JSON)
  for (const row of rowsOf(report)) {
    if (
      isRecord(row) &&
      row['engineId'] === 'A' &&
      isNonEmptyString(row['model']) &&
      row['model'].includes('whisper-base') &&
      row['device'] === 'webgpu' &&
      row['tier'] === 'T1'
    ) {
      return row
    }
  }
  return null
}

test('CC-02.7: a measured whisper-base T1 (webgpu) RTF row exists', () => {
  const row = baseT1Row()
  expect(row, `${REPORT_JSON}.rows contains a whisper-base row measured on engine A at T1 (device webgpu)`).not.toBeNull()
  if (!row) return
  expect(isFiniteNumber(row['rtf']) && (row['rtf'] as number) > 0, `whisper-base T1 rtf must be a finite number > 0, got ${JSON.stringify(row['rtf'])}`).toBe(true)
})

test('CC-02.7: the baseline confirm-or-correct statement is recorded', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const check = isRecord(report) ? report['baselineCheck'] : undefined
  expect(isRecord(check), `${REPORT_JSON}.baselineCheck records the settings.yml performance_baselines review (CC-02.7)`).toBe(true)
  if (!isRecord(check)) return

  expect(isFiniteNumber(check['whisperBaseT1Rtf']) && (check['whisperBaseT1Rtf'] as number) >= 0, `baselineCheck.whisperBaseT1Rtf mirrors the measured row, got ${JSON.stringify(check['whisperBaseT1Rtf'])}`).toBe(true)
  const measured = baseT1Row()
  if (measured) {
    const rtf = measured['rtf'] as number
    expect(Math.abs((check['whisperBaseT1Rtf'] as number) - rtf) / Math.max(rtf, 1e-9), 'baselineCheck.whisperBaseT1Rtf must match the measured whisper-base T1 row').toBeLessThan(0.01)
  }

  expect(isNonEmptyString(check['baseline']) && String(check['baseline']).includes('whisper-small'), `baselineCheck.baseline names the settings.yml entry under review, got ${JSON.stringify(check['baseline'])}`).toBe(true)
  expect(check['outcome'] === 'confirmed' || check['outcome'] === 'corrected', `baselineCheck.outcome must be 'confirmed' or 'corrected', got ${JSON.stringify(check['outcome'])}`).toBe(true)
  expect(isNonEmptyString(check['statement']), 'baselineCheck.statement records the confirmation/correction reasoning').toBe(true)
  if (check['outcome'] === 'corrected') {
    expect(String(check['statement']).toLowerCase().includes('settings'), 'a corrected baseline must reference the follow-up settings.yml patch PR (CC-02.7)').toBe(true)
  }
})
