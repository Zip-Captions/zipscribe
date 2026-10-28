// CC-02.5 — the release-qualification runner contract (FR-02.10).
//
//   `pnpm qualify` must produce a schema-valid `qualification/0.0.0-spike.json`
//   (knowledge/conventions.md § Release qualification), and
//   `node scripts/qualification-check.ts` must accept it on an unchanged tree
//   and reject it after a one-byte change under `src/` (contentHash covers
//   src/**, public/**, package.json, pnpm-lock.yaml and the model registry).
//
// Executed like unit-01's gates.test.ts — spawned commands asserting exit
// codes and file presence. All of these are RED today because the commands
// do not exist yet; none of them fail on an import/compile error.
//
// The `qualify/**` suites themselves run only via `pnpm qualify` on reference
// hardware (vitest.config.qualify.ts) — this file tests the runner contract,
// not the measurements.
import { describe, expect, test } from 'vitest'
import { exists, isChildRun, isPlaceholderScript, packageScripts, readJson, readText, removeRepoPath, runCommand, runPnpm, walkFiles, writeFixtureFile } from '../../helpers/repo'

const QUALIFICATION_FILE = 'qualification/0.0.0-spike.json'
const CHECK_SCRIPT = 'scripts/qualification-check.ts'
// One-byte probe under src/ — contentHash covers src/**, so its presence (and
// removal in `finally`) is what flips the hash. Removed repo path only.
const SRC_PROBE = 'src/overnight-qualification-probe.txt'

function qualificationCheck(): { status: number | null; output: string; slug: string } {
  return runCommand('node', [CHECK_SCRIPT], { timeoutMs: 60_000 })
}

describe('CC-02.5: qualify runner + qualification-check contract', () => {
  test('CC-02.5: package.json exposes a real `qualify` script (FR-02.10)', () => {
    const scripts = packageScripts()
    expect(scripts['qualify'], 'package.json script "qualify" (the FR-02.10 runner command name is contract)').toBeDefined()
    expect(isPlaceholderScript(scripts['qualify']), '`qualify` is a real script, not a stub').toBe(false)
  })

  test('CC-02.5: `pnpm qualify` exits 0 and writes qualification/0.0.0-spike.json', () => {
    if (isChildRun()) return
    expect(packageScripts()['qualify'], 'package.json script "qualify"').toBeDefined()
    const result = runPnpm('qualify', [], 180_000)
    expect(result.status, `${result.slug} exited ${result.status}\n${result.output.slice(-4000)}`).toBe(0)
    expect(exists(QUALIFICATION_FILE), `${QUALIFICATION_FILE} written by the runner (FR-02.10)`).toBe(true)
  }, 240_000)

  test('CC-02.5: qualification/0.0.0-spike.json is schema-valid (conventions § Release qualification)', () => {
    expect(exists(QUALIFICATION_FILE), `${QUALIFICATION_FILE} must exist (produced by \`pnpm qualify\`)`).toBe(true)
    const file = readJson<Record<string, unknown>>(QUALIFICATION_FILE)

    expect(typeof file['version'], 'version: string').toBe('string')
    expect((file['version'] as string).length, 'version non-empty').toBeGreaterThan(0)
    expect(file['contentHash'], 'contentHash: SHA-256 hex over src/**, public/**, package.json, pnpm-lock.yaml, model registry').toMatch(/^[0-9a-f]{64}$/)
    expect(Number.isFinite(Date.parse(String(file['startedAt']))), `startedAt: parseable timestamp, got ${String(file['startedAt'])}`).toBe(true)

    const machine = file['machine']
    expect(machine, 'machine: {browser, os, cpu, gpu, ramGB}').toBeTypeOf('object')
    if (machine && typeof machine === 'object' && !Array.isArray(machine)) {
      const m = machine as Record<string, unknown>
      for (const key of ['browser', 'os', 'cpu', 'gpu']) {
        expect(typeof m[key], `machine.${key} is a string`).toBe('string')
        expect(String(m[key]).trim().length, `machine.${key} non-empty`).toBeGreaterThan(0)
      }
      expect(m['ramGB'], 'machine.ramGB is a finite number').toBeTypeOf('number')
      expect(Number.isFinite(m['ramGB'] as number), 'machine.ramGB finite').toBe(true)
    }

    expect(Array.isArray(file['results']), 'results: array').toBe(true)
    const results = (file['results'] ?? []) as Array<Record<string, unknown>>
    for (const entry of results) {
      expect(String(entry['id']), `results entry id is a CC-ID, got ${String(entry['id'])}`).toMatch(/^CC-/)
      expect(entry['pass'], `results[${String(entry['id'])}].pass is boolean`).toBeTypeOf('boolean')
      expect(Object.keys(entry)).toEqual(expect.arrayContaining(['measured', 'threshold']))
    }
    // The spike file records every [RQ] criterion of this unit — the qualify
    // suites flip these pass flags on reference hardware.
    const rqIds = ['CC-02.1', 'CC-02.2', 'CC-02.3', 'CC-02.4', 'CC-02.7', 'CC-02.8', 'CC-02.9', 'CC-02.11']
    const recorded = new Set(results.map((entry) => String(entry['id'])))
    for (const id of rqIds) {
      expect(recorded.has(id), `results[] records the [RQ] criterion ${id}`).toBe(true)
    }

    expect(Array.isArray(file['manual']), 'manual: array').toBe(true)
    const manual = (file['manual'] ?? []) as Array<Record<string, unknown>>
    const manualIds = new Set(manual.map((entry) => String(entry['id'])))
    expect(manualIds.has('CC-02.10'), 'manual[] records the [MANUAL] license criterion CC-02.10').toBe(true)
    for (const entry of manual) {
      expect(typeof entry['by'], `manual[${String(entry['id'])}].by`).toBe('string')
      expect(typeof entry['date'], `manual[${String(entry['id'])}].date`).toBe('string')
      expect(typeof entry['result'], `manual[${String(entry['id'])}].result`).toBe('string')
    }
  })

  test('CC-02.5: qualification-check accepts the file on an unchanged tree (exit 0)', () => {
    if (isChildRun()) return
    expect(exists(CHECK_SCRIPT), `${CHECK_SCRIPT} (verification entry point) exists`).toBe(true)
    expect(exists(QUALIFICATION_FILE), `${QUALIFICATION_FILE} exists to verify`).toBe(true)
    const result = qualificationCheck()
    expect(result.status, `${result.slug} exited ${result.status} on an unchanged tree\n${result.output.slice(-4000)}`).toBe(0)
  }, 90_000)

  test('CC-02.5: qualification-check rejects after a one-byte change under src/ (hash mismatch)', () => {
    if (isChildRun()) return
    expect(exists(CHECK_SCRIPT), `${CHECK_SCRIPT} exists`).toBe(true)
    expect(exists(QUALIFICATION_FILE), `${QUALIFICATION_FILE} exists`).toBe(true)
    try {
      const probe = 'x'
      const written = Buffer.byteLength(probe)
      writeFixtureFile(SRC_PROBE, probe)
      expect(written, 'probe is exactly one byte under src/').toBe(1)
      const result = qualificationCheck()
      expect(result.status, `${result.slug} must exit non-zero after a one-byte change under src/\n${result.output.slice(-4000)}`).not.toBe(0)
    } finally {
      removeRepoPath(SRC_PROBE)
    }
    expect(exists(SRC_PROBE), 'probe removed (tree restored)').toBe(false)
  }, 90_000)

  test('CC-02.5: CI defines a `qualification-check` job for release branches (FR-02.10)', () => {
    const workflows = walkFiles('.github/workflows').filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    expect(workflows.length, '.github/workflows contains CI workflows (unit-01)').toBeGreaterThan(0)
    const jobOwner = workflows.find((file) => /^\s+qualification-check:\s*$/m.test(readText(file)))
    expect(jobOwner, 'a workflow defines a `qualification-check` job (conventions § CI/CD, release/* pipeline)').toBeDefined()
    if (jobOwner) {
      const text = readText(jobOwner)
      expect(text.includes('scripts/qualification-check.ts'), `${jobOwner} runs scripts/qualification-check.ts`).toBe(true)
      expect(/release\/|release\*/.test(text), `${jobOwner} is wired for release/* branches`).toBe(true)
    }
  })
})
