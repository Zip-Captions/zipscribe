// CC-02.8 `[RQ]` — the Parakeet verdict: loads-or-not in sherpa-onnx's WASM
// build (non-streaming `wasm/vad-asr` path) with RTF measured, or a
// documented blocker with an upstream issue link (unit spec Risks: "Parakeet
// (640 MB int8) may simply not load in sherpa's WASM build").
// Runtime-shape reference (entry naming only, not asserted):
// https://github.com/k2-fsa/sherpa-onnx/tree/master/wasm/vad-asr
import { expect, test } from 'vitest'
import { REPORT_MD, REPORT_JSON, isBoolean, isFiniteNumber, isNonEmptyString, isRecord, parseJsonAt } from '../helpers/eval-report'
import { exists, readText } from '../../tests/helpers/repo'

test('CC-02.8: the Parakeet verdict is recorded — loads with measured RTF, or a documented blocker', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const verdict = isRecord(report) ? report['parakeetVerdict'] : undefined
  expect(isRecord(verdict), `${REPORT_JSON}.parakeetVerdict records the Parakeet load/RTF outcome (CC-02.8)`).toBe(true)
  if (!isRecord(verdict)) return

  expect(isBoolean(verdict['loads']), `parakeetVerdict.loads must be a boolean (loads-or-not in sherpa WASM), got ${JSON.stringify(verdict['loads'])}`).toBe(true)

  if (verdict['loads'] === true) {
    expect(isFiniteNumber(verdict['rtf']) && (verdict['rtf'] as number) > 0, `Parakeet loads → RTF must be measured (finite > 0), got ${JSON.stringify(verdict['rtf'])}`).toBe(true)
  } else if (verdict['loads'] === false) {
    const blocker = verdict['blockerIssue']
    expect(isNonEmptyString(blocker) && /^https:\/\//.test(blocker), `Parakeet does not load → blockerIssue must be a documented upstream issue link, got ${JSON.stringify(blocker)}`).toBe(true)
  }

  expect(exists(REPORT_MD), `${REPORT_MD} exists`).toBe(true)
  expect(readText(REPORT_MD).toLowerCase().includes('parakeet'), `${REPORT_MD} records the Parakeet verdict (FR-02.6 rejection reasons / outcomes)`).toBe(true)
})
