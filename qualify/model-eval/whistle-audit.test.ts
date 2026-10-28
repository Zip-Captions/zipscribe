// CC-02.9 `[RQ]` — Whistle (cactus needle.wasm) network audit: pass/fail
// recorded with a request log, redacted per FR-02.1 hygiene.
//
// The telemetry concern inherited from zip-captions Spike 1.4 Q1 (discovery.md
// prior-art) makes this the disqualifier for candidate C: the verdict itself
// (either value) plus the request log must be recorded; CC-02.4 then blocks
// *adoption* of Whistle while its audit is failed.
import { expect, test } from 'vitest'
import { REPORT_JSON, REPORT_MD, firstWhitespaceString, hostAllowed, isBoolean, isRecord, parseJsonAt, readModelHosts } from '../helpers/eval-report'
import { exists, readText } from '../../tests/helpers/repo'

function whistleEntry(report: unknown): Record<string, unknown> | null {
  if (!isRecord(report) || !Array.isArray(report['networkAudit'])) return null
  for (const entry of report['networkAudit']) {
    if (isRecord(entry) && entry['engineId'] === 'C') return entry
  }
  return null
}

test('CC-02.9: the Whistle audit records a pass/fail verdict with a redacted request log', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const entry = whistleEntry(report)
  expect(entry, `${REPORT_JSON}.networkAudit must contain the Whistle/needle (engineId C) audit (US-02.2, Spike 1.4 Q1 telemetry concern)`).not.toBeNull()
  if (!entry) return

  expect(isBoolean(entry['pass']), `Whistle audit pass/fail must be recorded (either value counts as recorded), got ${JSON.stringify(entry['pass'])}`).toBe(true)

  const artifactPath = entry['artifact']
  expect(typeof artifactPath === 'string' && exists(artifactPath), `Whistle audit artifact (request log) must exist, got ${JSON.stringify(artifactPath)}`).toBe(true)
  if (typeof artifactPath !== 'string') return

  const artifact = parseJsonAt(artifactPath)
  expect(isRecord(artifact), `${artifactPath} parses as JSON`).toBe(true)
  if (!isRecord(artifact)) return

  expect(Array.isArray(artifact['requests']), `${artifactPath}.requests is the request log`).toBe(true)
  const requests = Array.isArray(artifact['requests']) ? artifact['requests'].filter(isRecord) : []
  expect(requests.length, `${artifactPath} records the observed requests (audit actually ran)`).toBeGreaterThan(0)
  const hosts = readModelHosts()
  const offAllowlist = requests.filter((request) => typeof request['url'] !== 'string' || !hostAllowed(request['url'], hosts))
  // pass/fail must be CONSISTENT with the log: pass=true ⇔ nothing outside
  // self + model_hosts. (A recorded fail with an off-allowlist request is a
  // valid record; a recorded pass while off-allowlist requests are logged is not.)
  if (entry['pass'] === true) {
    expect(offAllowlist.length, `Whistle audit says pass=true but ${offAllowlist.length} logged requests fall outside self + model_hosts`).toBe(0)
  } else if (entry['pass'] === false) {
    expect(offAllowlist.length, 'Whistle audit says pass=false — the log must show at least one off-allowlist request (e.g. telemetry)').toBeGreaterThan(0)
  }

  // FR-02.1 hygiene / SECURITY-03: redacted log — urls/ids/timestamps only.
  const offender = firstWhitespaceString(artifact, artifactPath)
  expect(offender, `${artifactPath} is redacted — no free text/transcript strings (found at ${offender})`).toBeNull()

  // The human report records the verdict too (FR-02.6: rejection reasons for
  // anything dropped).
  expect(exists(REPORT_MD), `${REPORT_MD} exists`).toBe(true)
  const lower = readText(REPORT_MD).toLowerCase()
  expect(lower.includes('whistle'), `${REPORT_MD} names Whistle`).toBe(true)
  expect(/telemetry|network audit/.test(lower), `${REPORT_MD} records the Whistle network-audit verdict`).toBe(true)
})
