// CC-02.4 / CC-02.9 — adversarial probes of the network-audit allowlist and
// the artifact redaction guard (qualify/helpers/eval-report.ts, the frozen
// contract both the harness audit and the qualify suite share).
//
// Contract anchors:
// - FR-02.1 hygiene: "transcripts never logged to CI artifacts".
// - SECURITY-03 (.agent/AGENTS.md, conventions.md line 12): transcript/
//   user content never in logs, error messages or artifacts.
// - conventions.md § Principles 4: privacy is TESTED, not trusted — the
//   guard must catch canary content at any depth, not just the fields the
//   harness happens to write today.
// - settings.yml operations.model_hosts = https://huggingface.co,
//   https://*.hf.co, https://*.huggingface.co (CSP connect-src +
//   request-audit allowlist).
//
// Redirect coverage (survived by audit + docs, pinned here by the host
// matrix instead of a live probe): Playwright emits a NEW request event per
// redirect hop and routes each hop, so an off-allowlist redirect target is
// both counted in the request log and blocked by the route handler
// (https://playwright.dev/docs/api/class-request).
import { expect, test } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { firstWhitespaceString, hostAllowed, readModelHosts } from '../../../qualify/helpers/eval-report'
import { REPO_ROOT, readJson } from '../../helpers/repo'

const NETWORK_DIR = join('docs', 'spikes', 'network')

test('CC-02.9: hostAllowed rejects look-alike and embedded-credential hosts outside the settings.yml allowlist', () => {
  const hosts = readModelHosts()
  expect(hosts.length, 'settings.yml model_hosts must be non-empty').toBeGreaterThan(0)
  const offAllowlist = [
    'https://huggingface.co.evil.com/models', // suffix look-alike
    'https://hf.co.evil.com/x', // wildcard look-alike
    'https://evil.com/@huggingface.co/model', // path userinfo look-alike
    'https://evil.com/?u=https%3A%2F%2Fhuggingface.co%2F', // encoded referrer bait
    'https://huggingface.co@evil.com/model', // userinfo (parses to evil.com)
    'https://cdn-lfs.huggingface.co.security.example/x', // legacy-host look-alike
    'https://not-huggingface.co/model',
    'https://not-hf.co/model',
    'https://evil-hf.co/model',
  ]
  for (const url of offAllowlist) {
    expect(hostAllowed(url, hosts), `${url} must be blocked (not in model_hosts)`).toBe(false)
  }
  const onAllowlist = [
    'https://huggingface.co/onnx-community/whisper-base_timestamped/resolve/main/config.json',
    'https://us.aws.cdn.hf.co/xet-bridge/abc', // wildcard *.hf.co (settings comment)
    'https://cdn-lfs.huggingface.co/legacy/x', // wildcard *.huggingface.co
    // Characterization: the *.hf.co wildcard also matches the bare HF apex
    // (hf.co is Hugging Face-operated, same trust boundary as the wildcard's
    // comment "every origin the app may contact at runtime" — defensible).
    'https://hf.co/x',
  ]
  for (const url of onAllowlist) {
    expect(hostAllowed(url, hosts), `${url} is on the allowlist and must pass`).toBe(true)
  }
})

test('CC-02.9: readModelHosts yields the exact settings.yml allowlist (no empty/wildcard-only parsing)', () => {
  const hosts = readModelHosts()
  expect(hosts.every((h) => typeof h === 'string' && h.length > 0), `all entries non-empty strings, got ${JSON.stringify(hosts)}`).toBe(true)
  expect(hosts.some((h) => h.includes('huggingface.co')), `huggingface.co must be in the allowlist, got ${JSON.stringify(hosts)}`).toBe(true)
  expect(hosts.some((h) => h.includes('hf.co')), `the hf.co wildcard must be in the allowlist, got ${JSON.stringify(hosts)}`).toBe(true)
})

test('CC-02.4: every committed request-log artifact is url-string-only and passes the whitespace guard', () => {
  // Redaction contract (FR-02.1 / SECURITY-03): request entries carry only
  // the URL — URLs contain no whitespace, so a string with whitespace in the
  // artifact is by construction not a URL → transcript/whitespace leak.
  const files = readdirSync(join(REPO_ROOT, NETWORK_DIR)).filter((f) => f.endsWith('.json'))
  expect(files.length, 'network artifacts A/B/C committed').toBeGreaterThanOrEqual(3)
  for (const file of files) {
    const artifact = readJson<{ engineId: string; pass: boolean; requests: Array<Record<string, unknown>> }>(join(NETWORK_DIR, file))
    expect(Array.isArray(artifact.requests), `${file}.requests must be an array`).toBe(true)
    for (const [i, request] of artifact.requests.entries()) {
      const keys = Object.keys(request)
      expect(keys, `${file}.requests[${i}] must carry only the url field (redaction contract), got ${JSON.stringify(keys)}`).toEqual(['url'])
      expect(typeof request.url, `${file}.requests[${i}].url must be a string`).toBe('string')
    }
    expect(firstWhitespaceString(artifact.requests), `${file}: whitespace-bearing string in a request log (transcript leak)`).toBeNull()
  }
})

test('CC-02.4: firstWhitespaceString catches every whitespace class at any nesting depth and in keys', () => {
  // The guard must not be field-name-aware — the harness could gain fields
  // tomorrow, and the canary principle (conventions § Principles 4) is depth
  // and key agnostic.
  const cases: Array<[string, unknown]> = [
    ['space in value', { url: 'https://x/a b' }],
    ['tab in value', { url: 'https://x/a\tb' }],
    ['CR in value', { url: 'https://x/a\rb' }],
    ['LF in value', { url: 'https://x/a\nb' }],
    ['NBSP in value', { url: 'https://x/a\u00a0b' }],
    ['ideographic space deep', { a: { b: [{ c: 'x\u3000y' }] } }],
    ['line separator', { a: { b: 'x\u2028y' } }],
    ['space in key', { 'a b': 1 }],
    ['tab in deep key', { a: { 'x\ty': 1 } }],
  ]
  for (const [label, value] of cases) {
    expect(firstWhitespaceString(value), `guard must catch whitespace (${label})`).not.toBeNull()
  }
})

test('CC-02.4: a canary transcript embedded at any depth of a request log is caught (SECURITY-03)', () => {
  // The exact canary shape from the unit-02 corpus — if the harness ever
  // wrote hypothesis text into an artifact, the guard must flag it no matter
  // where it nests or whether it is url-encoded (a URL-encoded transcript
  // still carries %20, not literal whitespace — so also check the decoded
  // form the way a reviewer would read the artifact).
  const canary = 'the team walked across the old bridge before sunrise'
  const naiveEmbed = { requests: [{ url: `https://huggingface.co/${encodeURIComponent(canary)}` }, { note: canary }] }
  expect(firstWhitespaceString(naiveEmbed), 'raw transcript text anywhere in the artifact must be caught').not.toBeNull()
  const urlOnlyEncoded = { requests: [{ url: `https://huggingface.co/${encodeURIComponent(canary)}` }] }
  // Characterization of the frozen guard's limit: percent-encoding hides the
  // whitespace (no literal \s survives) and the url field is trusted by the
  // contract ("request entries carry only the URL"). The harness builds urls
  // itself and never interpolates transcript text; a future change that does
  // should extend this guard — recorded as a follow-up in the unit report.
  expect(firstWhitespaceString(urlOnlyEncoded)).toBeNull()
})

test('CC-02.4: zero-width characters slip the whitespace guard (documented heuristic limit of the frozen helper)', () => {
  // \u200b is not \s — characterization so the limit is on record; the
  // contract is "no whitespace in request strings", which the guard enforces
  // exactly.
  expect(firstWhitespaceString({ url: 'a\u200bb\u200bc' })).toBeNull()
})

test('CC-02.4: no committed eval artifact contains ≥5 consecutive words of any ground-truth transcript (SECURITY-03)', () => {
  // "Transcripts never logged to CI artifacts" (FR-02.1) — the direct audit
  // over everything the spike committed: docs/spikes/** and qualification/**.
  const gtDir = join(REPO_ROOT, 'fixtures', 'harness', 'ground-truth')
  const transcripts = readdirSync(gtDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(gtDir, f), 'utf8')) as { transcript: string })
    .map((j) => j.transcript)
  expect(transcripts.length, 'ground-truth fixtures exist').toBeGreaterThanOrEqual(5)
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const grams: string[] = []
  for (const transcript of transcripts) {
    const words = normalize(transcript).split(' ')
    for (let i = 0; i + 5 <= words.length; i++) grams.push(words.slice(i, i + 5).join(' '))
  }
  expect(grams.length, 'probe precondition: transcripts long enough for 5-grams').toBeGreaterThan(0)
  const artifacts: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(json|md)$/.test(entry.name)) artifacts.push(full)
    }
  }
  walk(join(REPO_ROOT, 'docs', 'spikes'))
  walk(join(REPO_ROOT, 'qualification'))
  expect(artifacts.length, 'eval artifacts to audit').toBeGreaterThan(0)
  const offenders: string[] = []
  for (const artifact of artifacts) {
    const text = normalize(readFileSync(artifact, 'utf8'))
    for (const gram of grams) {
      if (text.includes(gram)) offenders.push(`${artifact.replace(REPO_ROOT, '')} contains a transcript 5-gram`)
    }
  }
  expect(offenders, `audio-derived strings leaked into committed artifacts:\n${offenders.join('\n')}`).toEqual([])
})

// Sanity: the scan above must run against a tree where the files exist even
// if a future refactor moves them (guard fails loudly instead of vacuously).
test('CC-02.4: the audited artifact set covers the harness outputs named by the unit spec', () => {
  for (const p of [join('docs', 'spikes', 'model-eval-report.json'), join('docs', 'spikes', 'model-eval-report.md'), join('docs', 'spikes', 'network', 'A.json'), join('docs', 'spikes', 'network', 'B.json'), join('docs', 'spikes', 'network', 'C.json'), join('qualification', '0.0.0-spike.json'), join('qualification', 'manual.json')]) {
    expect(existsSync(join(REPO_ROOT, p)), `${p} must exist to be audited`).toBe(true)
  }
})
