// CC-02.5 — adversarial probes of the anti-fabrication gate itself:
// `node scripts/qualification-check.ts` (the CI job).
//
// Contract anchors:
// - conventions.md § Release qualification line 86: "contentHash = SHA-256
//   over `src/**`, `public/**`, `package.json`, `pnpm-lock.yaml`, and the
//   model registry".
// - conventions.md § Release qualification line 87: "The `qualification-check`
//   CI job … recomputes the hash and fails on mismatch, missing IDs or any
//   `pass:false`."
// - conventions.md § Release exit line 79: "`qualification/X.Y.Z.json`
//   present, its content hash matches the release tree … and every
//   `[RQ]`/`[MANUAL]` criterion of every completed unit passes" — an ID
//   deleted from `results[]` cannot be shown to pass.
// - unit spec CC-02.5: rejects after a one-byte change under `src/`, accepts
//   unchanged.
//
// All probes run on a scratch copy of the hash inputs so the committed
// artifacts are never mutated. The frozen qualify-runner.test.ts covers the
// in-repo byte-flip/accept-unchanged legs; this file extends coverage to the
// remaining hash inputs and the missing-ID leg.
import { afterAll, beforeAll, expect, test } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT, runIn } from '../../helpers/repo'

const QUALIFICATION_FILE = join('qualification', '0.0.0-spike.json')
const GENERATED_PUBLIC = ['public/wasm', 'public/sherpa', 'public/hf-cache', 'public/fixtures', 'public/eval4x']

let scratch: string

/** Copy the committed hash inputs + qualification file into a scratch tree. */
function makeScratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zsap-qc-'))
  for (const file of ['package.json', 'pnpm-lock.yaml']) {
    cpSync(join(REPO_ROOT, file), join(dir, file))
  }
  for (const tree of ['scripts', 'src', 'public', 'models', 'qualification', 'docs']) {
    cpSync(join(REPO_ROOT, tree), join(dir, tree), {
      recursive: true,
      filter: (source) => !GENERATED_PUBLIC.some((skip) => source.startsWith(join(REPO_ROOT, skip))),
    })
  }
  mkdirSync(join(dir, '.cache'), { recursive: true })
  return dir
}

function check(dir: string): { status: number | null; output: string } {
  const res = runIn(dir, 'node', ['scripts/qualification-check.ts'], 60_000)
  return { status: res.status, output: res.stdout + res.stderr }
}

function readQualification(dir: string): { contentHash: string; results: Array<{ id: string; pass: boolean; measured: string; threshold: string }>; manual: unknown[] } {
  return JSON.parse(readFileSync(join(dir, QUALIFICATION_FILE), 'utf8'))
}

function writeQualification(dir: string, value: unknown): void {
  writeFileSync(join(dir, QUALIFICATION_FILE), `${JSON.stringify(value, null, 2)}\n`)
}

beforeAll(() => {
  scratch = makeScratch()
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('CC-02.5: an untouched copy of the committed release tree + qualification file is accepted', () => {
  // Sanity leg for every tamper below: the scratch must otherwise mirror the
  // real tree byte-for-byte, or a "REJECT" result would prove nothing.
  const res = check(scratch)
  expect(res.output).toMatch(/ACCEPT/)
  expect(res.status, `baseline accept must exit 0, got ${res.status} (${res.output})`).toBe(0)
})

test('CC-02.5: a byte flip in models/eval-registry.json (pinned model SHA-256) is rejected', () => {
  // conventions.md line 86 names the model registry as a hash input —
  // flipping a recorded model SHA must invalidate the qualification, or a
  // swapped model could ship under a clean verdict.
  const dir = makeScratch()
  const registryPath = join(dir, 'models', 'eval-registry.json')
  const original = readFileSync(registryPath, 'utf8')
  const sha = original.match(/\b[0-9a-f]{64}\b/)?.[0]
  expect(sha, 'probe precondition: the registry must record a model SHA-256').toBeDefined()
  const flipped = original.replace(sha!, sha!.slice(0, 63) + (sha![63] === '0' ? '1' : '0'))
  expect(flipped, 'probe precondition: the registry must contain a hex SHA-256 to flip').not.toBe(original)
  writeFileSync(registryPath, flipped)
  const res = check(dir)
  expect(res.status, `registry tamper must exit non-zero (${res.output})`).not.toBe(0)
  expect(res.output).toMatch(/REJECT/)
  expect(res.output).toMatch(/contentHash mismatch/)
})

test('CC-02.5: a byte flip under src/ is rejected (scratch complement of the frozen in-repo probe)', () => {
  // CC-02.5's named leg, re-proven on a scratch copy where the tamper is
  // independent of any other test touching the real tree.
  const dir = makeScratch()
  const srcDir = join(dir, 'src')
  const findFile = (d: string): string => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) {
        const nested = findFile(full)
        if (nested) return nested
      } else if (statSync(full).size > 0) return full
    }
    return ''
  }
  const target = findFile(srcDir)
  expect(target, 'probe precondition: src/ must contain a file').not.toBe('')
  const original = readFileSync(target)
  writeFileSync(target, `${original}\n// tampered\n`)
  const res = check(dir)
  expect(res.status, `src tamper must exit non-zero (${res.output})`).not.toBe(0)
  expect(res.output).toMatch(/REJECT/)
})

test('CC-02.5: re-adding a dependency to package.json after qualification is rejected', () => {
  // The task scenario: a removed engine dependency (speech-asr) reappearing
  // in package.json after the qualification was written changes the hashed
  // release tree (conventions.md line 86 names package.json).
  const dir = makeScratch()
  const pkgPath = join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  const deps = (pkg.dependencies ??= {})
  expect(deps['speech-asr'], 'probe precondition: speech-asr must not be a dependency at HEAD').toBeUndefined()
  deps['speech-asr'] = '^0.1.0'
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  const res = check(dir)
  expect(res.status, `dependency re-add must exit non-zero (${res.output})`).not.toBe(0)
  expect(res.output).toMatch(/REJECT/)
  expect(res.output).toMatch(/contentHash mismatch/)
})

test('CC-02.5: a hand-edit of a qualification result to pass:false is rejected, and flipping it back to true is accepted (hash-valid files are trusted — the anti-fabrication burden is on the qualify assertions)', () => {
  // conventions.md line 87 names `pass:false` explicitly. The flip-back leg
  // is a characterization: the check verifies the hash + pass flags, not the
  // provenance of each flag — qualify-pipeline-fabrication-adversarial.test.ts
  // measures what that means for fabricated measurements.
  const dir = makeScratch()
  const record = readQualification(dir)
  const target = record.results.find((r) => r.id === 'CC-02.7')
  expect(target, 'probe precondition: CC-02.7 result present').toBeDefined()
  target!.pass = false
  writeQualification(dir, record)
  const rejected = check(dir)
  expect(rejected.status, `pass:false must exit non-zero (${rejected.output})`).not.toBe(0)
  expect(rejected.output).toMatch(/REJECT/)
  expect(rejected.output).toMatch(/CC-02\.7/)
  target!.pass = true
  writeQualification(dir, record)
  const accepted = check(dir)
  expect(accepted.output, 'hand-editing pass back to true keeps the hash valid → ACCEPT (characterization)').toMatch(/ACCEPT/)
  expect(accepted.status).toBe(0)
})

test('CC-02.5: tampering docs/spikes/model-eval-report.json does NOT invalidate the qualification (characterization of the hash scope)', () => {
  // conventions.md line 86 enumerates the hash inputs — docs/spikes is not
  // among them (by design: regenerating the report must not invalidate a
  // passing qualify run). Consequence: a fabricated report is caught only by
  // the qualify assertions themselves — see qualify-pipeline-fabrication-
  // adversarial.test.ts for whether they actually catch it.
  const dir = makeScratch()
  const reportPath = join(dir, 'docs', 'spikes', 'model-eval-report.json')
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { rows: Array<{ rtf: number }> }
  expect(report.rows.length, 'probe precondition: committed report has rows').toBeGreaterThan(0)
  report.rows[0]!.rtf = 0.0001
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  const res = check(dir)
  expect(res.output).toMatch(/ACCEPT/)
  expect(res.status).toBe(0)
})

test('CC-02.5: deleting a criterion result from the qualification file is rejected (missing ID)', () => {
  // conventions.md line 87: the job "fails on mismatch, missing IDs or any
  // pass:false"; line 79 (release exit): "every [RQ]/[MANUAL] criterion of
  // every completed unit passes" — with the CC-02.2 row deleted there is no
  // evidence that the #1739 leak criterion passed, yet its ID is also gone
  // from the missing-ID detection path.
  const dir = makeScratch()
  const record = readQualification(dir)
  expect(record.results.some((r) => r.id === 'CC-02.2'), 'probe precondition: CC-02.2 result present').toBe(true)
  record.results = record.results.filter((r) => r.id !== 'CC-02.2')
  writeQualification(dir, record)
  const res = check(dir)
  expect(res.status, `deleted CC-02.2 result must be rejected as a missing ID, got exit ${res.status} (${res.output})`).not.toBe(0)
  expect(res.output, `rejection must name the missing ID, got: ${res.output}`).toMatch(/CC-02\.2/)
})
