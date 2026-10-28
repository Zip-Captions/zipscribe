// CC-02.4 `[RQ]` — network audit (US-02.2) passes for every adopted engine.
//
// The harness records a request log per evaluated engine (FR-02.1 hygiene:
// redacted — urls/ids/timestamps only, never transcript text, SECURITY-03).
// "Any request outside `self` + settings.yml operations.model_hosts fails
// adoption" — the audit entry's `pass` must be true for every engine in the
// CC-02.11 default recommendation, and it must be RECOMPUTABLE from the
// recorded request log against the allowlist (the flag alone is not trusted).
// Engines B (ORT/sherpa) must load their wasm from `/wasm` on `self`, never a
// CDN — a CDN ORT host is outside the allowlist and fails the recompute.
import { expect, test } from 'vitest'
import { REPORT_JSON, adoptedEngineIds, firstWhitespaceString, hostAllowed, isBoolean, isRecord, parseJsonAt, readModelHosts } from '../helpers/eval-report'
import { exists } from '../../tests/helpers/repo'

function auditEntries(report: unknown): Array<Record<string, unknown>> {
  if (!isRecord(report) || !Array.isArray(report['networkAudit'])) return []
  return report['networkAudit'].filter(isRecord)
}

function requestsOf(artifact: unknown): Array<Record<string, unknown>> {
  if (!isRecord(artifact) || !Array.isArray(artifact['requests'])) return []
  return artifact['requests'].filter(isRecord)
}

test('CC-02.4: every adopted engine has a passing network audit, recomputable from its request log', () => {
  const report = parseJsonAt(REPORT_JSON)
  expect(report, `${REPORT_JSON} must exist and parse`).not.toBeNull()
  const adopted = adoptedEngineIds(report)
  expect(adopted.length, 'the default recommendation (CC-02.11) names adopted engines').toBeGreaterThan(0)
  const entries = auditEntries(report)
  expect(entries.length, `${REPORT_JSON}.networkAudit records an audit per evaluated engine (US-02.2)`).toBeGreaterThan(0)
  const hosts = readModelHosts()
  expect(hosts.length, 'settings.yml operations.model_hosts allowlist parsed').toBeGreaterThan(0)

  const problems: string[] = []
  for (const engineId of adopted) {
    const entry = entries.find((candidate) => candidate['engineId'] === engineId)
    if (!entry) {
      problems.push(`adopted engine ${engineId} has no networkAudit entry (US-02.2 — no audit, no adoption)`)
      continue
    }
    if (!isBoolean(entry['pass'])) problems.push(`networkAudit(${engineId}).pass must be a recorded boolean, got ${JSON.stringify(entry['pass'])}`)
    if (entry['pass'] !== true) problems.push(`networkAudit(${engineId}).pass must be true for an adopted engine (US-02.2: any request outside self + model_hosts fails adoption)`)
    const artifactPath = entry['artifact']
    if (typeof artifactPath !== 'string' || !exists(artifactPath)) {
      problems.push(`networkAudit(${engineId}).artifact must reference an existing request log, got ${JSON.stringify(artifactPath)}`)
      continue
    }
    const artifact = parseJsonAt(artifactPath)
    if (!isRecord(artifact)) {
      problems.push(`${artifactPath} must exist and parse as JSON`)
      continue
    }
    if (artifact['engineId'] !== engineId) problems.push(`${artifactPath}.engineId mismatch: ${JSON.stringify(artifact['engineId'])} != ${engineId}`)
    if (artifact['pass'] !== entry['pass']) problems.push(`${artifactPath}.pass (${JSON.stringify(artifact['pass'])}) disagrees with the report entry (${JSON.stringify(entry['pass'])})`)
    const requests = requestsOf(artifact)
    if (requests.length === 0) problems.push(`${artifactPath}.requests is empty — an audit run records the request log`)
    let outside = 0
    for (const request of requests) {
      const url = request['url']
      if (typeof url !== 'string' || !hostAllowed(url, hosts)) {
        outside += 1
        problems.push(`${artifactPath}: request outside self + model_hosts allowlist: ${JSON.stringify(String(url).slice(0, 80))}`)
      }
    }
    const recomputedPass = outside === 0
    if (isBoolean(artifact['pass']) && artifact['pass'] !== recomputedPass) {
      problems.push(`${artifactPath}.pass=${artifact['pass']} contradicts the recomputed verdict (${outside === 0 ? 'pass' : 'fail'}) from ${requests.length} recorded requests`)
    }
    // FR-02.1 hygiene / SECURITY-03: the log is redacted — no free text.
    const offender = firstWhitespaceString(artifact, artifactPath)
    if (offender) problems.push(`${artifactPath}: un-redacted free-text string at ${offender} (FR-02.1 hygiene — transcripts are never logged)`)
  }
  expect(problems, `network-audit pass for every adopted engine (US-02.2):\n${problems.join('\n')}`).toEqual([])
})
