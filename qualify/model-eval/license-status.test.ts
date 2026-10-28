// CC-02.10 `[MANUAL]` — Omnilingual/Moonshine/MedASR license status.
//
// The sign-off itself is owner-manual (M level, .agent/AGENTS.md — recorded
// in the unit report / qualification file `manual[]`, never marked done by an
// agent). This qualify entry is the machine-checkable part: the report records
// a `verified-ok | blocked-pending` status per candidate D entry, and the
// benchmark rows never contain a candidate that is still blocked (unit spec:
// "Do not benchmark until license verified").
import { expect, test } from 'vitest'
import { LICENSE_STATUSES, REPORT_MD, REPORT_JSON, isNonEmptyString, isRecord, parseJsonAt, rowsOf } from '../helpers/eval-report'
import { exists, readText } from '../../tests/helpers/repo'

const CANDIDATES_D = ['omnilingual', 'moonshine', 'medasr'] as const

test('CC-02.10: license status (verified-ok | blocked-pending) recorded for every candidate D entry', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const licenses = isRecord(report) && Array.isArray(report['licenses']) ? report['licenses'].filter(isRecord) : []
  expect(licenses.length, `${REPORT_JSON}.licenses records the license verification outcome (FR-02.6)`).toBeGreaterThan(0)

  const problems: string[] = []
  for (const candidate of CANDIDATES_D) {
    const entry = licenses.find((license) => isNonEmptyString(license['candidate']) && license['candidate'].toLowerCase().includes(candidate))
    if (!entry) {
      problems.push(`no license entry for "${candidate}" (candidate D: Omnilingual 300M / Moonshine v2 / MedASR)`)
      continue
    }
    if (!(LICENSE_STATUSES as readonly string[]).includes(String(entry['status']))) {
      problems.push(`license entry "${String(entry['candidate'])}".status must be verified-ok|blocked-pending, got ${JSON.stringify(entry['status'])}`)
    }
  }
  expect(problems, `license status per candidate D entry (CC-02.10, awaiting owner sign-off):\n${problems.join('\n')}`).toEqual([])

  expect(exists(REPORT_MD), `${REPORT_MD} exists`).toBe(true)
  expect(readText(REPORT_MD).toLowerCase().includes('license'), `${REPORT_MD} records license verification results (FR-02.6)`).toBe(true)
})

test('CC-02.10: no blocked-pending candidate has a benchmark row (license verified before benchmarking)', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const licenses = isRecord(report) && Array.isArray(report['licenses']) ? report['licenses'].filter(isRecord) : []
  const blocked = licenses.filter((license) => String(license['status']) === 'blocked-pending' && isNonEmptyString(license['model']))
  const models = rowsOf(report)
    .filter(isRecord)
    .map((row) => String(row['model']).toLowerCase())
  const violations = blocked.filter((license) => models.some((model) => model.includes(String(license['model']).toLowerCase())))
  expect(violations.map((license) => String(license['candidate'])), 'blocked-pending candidates must not appear in the measured rows (unit spec candidate D rule)').toEqual([])
})
