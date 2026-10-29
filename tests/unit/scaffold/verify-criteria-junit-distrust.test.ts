// Unit-03 adversarial finding 1 (HIGH): verify-criteria must never credit an
// e2e-sourced criterion from a junit file that this run's Playwright spawn did
// not genuinely produce. The adversary's proof: delete
// `e2e/model/model-cache.spec.ts`, plant a forged `<repo>/test-results/junit.xml`
// containing CC-03.3 testcases → the criterion was credited "pass"; a
// playwright child with `status !== 0` (or a null spawnSync result) was also
// accepted. Both violate the unit-02 spawn-null doctrine (scripts/qualify.ts
// readQualifyResults @ eb61046 — "never trust cached results after a spawn
// that did not complete").
//
// These tests drive the trust policy in scripts/lib/junit-trust.ts directly
// with an injected spawner (spawn itself is the system boundary being mocked),
// so every scenario is deterministic, fast, and touches no real tree — the
// real-flow attribution (CC-03.3's 3 cases from a genuine spawn) is proven by
// `corepack pnpm verify:unit --from-branch` in the gate sweep and by the
// scratch-worktree re-proof in the fixer report.
import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { collectPlaywrightEvidence, parseJunit } from '../../../scripts/lib/junit-trust.ts'

function forgedJunit(id: string, count: number): string {
  const cases = Array.from({ length: count }, (_, i) => `<testcase classname="e2e/model/model-cache.spec.ts" name="${id}: case ${i + 1}" time="0.1"/>`).join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="chromium" tests="${count}" failures="0" skipped="0">\n    ${cases}\n  </testsuite>\n</testsuites>\n`
}

function scratch(label: string): { dir: string; tmpJunit: string; persistentJunit: string } {
  const dir = mkdtempSync(join(tmpdir(), `zipscribe-junit-trust-${label}-`))
  mkdirSync(join(dir, 'tmp', 'pw'), { recursive: true })
  mkdirSync(join(dir, 'test-results'), { recursive: true })
  return { dir, tmpJunit: join(dir, 'tmp', 'pw', 'junit.xml'), persistentJunit: join(dir, 'test-results', 'junit.xml') }
}

describe('verify-criteria junit distrust (unit-03 adversary finding 1)', () => {
  test('ADVERSARIAL F1: planted junit + no genuine spawn (status 0, wrote nothing) → zero e2e credit', () => {
    const { tmpJunit, persistentJunit } = scratch('planted')
    writeFileSync(persistentJunit, forgedJunit('CC-03.3', 3))
    writeFileSync(tmpJunit, forgedJunit('CC-03.3', 3))
    // The forged files ARE parseable — rejection must come from the trust
    // policy (wipe + freshness), never from a parser accident.
    expect(parseJunit(persistentJunit)).toHaveLength(3)

    const result = collectPlaywrightEvidence({
      tmpJunitFile: tmpJunit,
      persistentJunitFile: persistentJunit,
      spawn: () => ({ status: 0, output: '' }),
      parse: parseJunit,
    })
    expect(result.cases, 'a pre-existing junit can never be counted as this run\'s evidence').toEqual([])
    expect(result.failure).toMatch(/no fresh JUnit results/)
    expect(existsSync(persistentJunit), 'the pre-existing junit target must be wiped before the spawn').toBe(false)
    expect(existsSync(tmpJunit), 'the pre-existing tmp junit target must be wiped before the spawn').toBe(false)
  })

  test('ADVERSARIAL F1: junit (re)created during the window + nonzero child status → zero e2e credit', () => {
    for (const status of [1, 2] as const) {
      const { tmpJunit, persistentJunit } = scratch(`nonzero-${status}`)
      const result = collectPlaywrightEvidence({
        tmpJunitFile: tmpJunit,
        persistentJunitFile: persistentJunit,
        spawn: (junitFile) => {
          // An attacker (or a broken reporter) writes a pristine junit DURING
          // the window — a failing child still yields zero credit.
          mkdirSync(dirname(junitFile), { recursive: true })
          writeFileSync(junitFile, forgedJunit('CC-03.3', 3))
          writeFileSync(persistentJunit, forgedJunit('CC-03.3', 3))
          return { status, output: 'boom' }
        },
        parse: parseJunit,
      })
      expect(result.cases, `status ${status} must yield no partial trust`).toEqual([])
      expect(result.failure).toContain(`exited ${status}`)
    }
  })

  test('ADVERSARIAL F1: null spawn status (killed / timed out / failed to spawn) → zero e2e credit', () => {
    // Mirrors the spawnSync === null doctrine: the process never reported, so
    // any file on disk describes someone else's run.
    const { tmpJunit, persistentJunit } = scratch('null-status')
    const result = collectPlaywrightEvidence({
      tmpJunitFile: tmpJunit,
      persistentJunitFile: persistentJunit,
      spawn: (junitFile) => {
        mkdirSync(dirname(junitFile), { recursive: true })
        writeFileSync(junitFile, forgedJunit('CC-03.3', 3))
        writeFileSync(persistentJunit, forgedJunit('CC-03.3', 3))
        return { status: null, output: '' }
      },
      parse: parseJunit,
    })
    expect(result.cases).toEqual([])
    expect(result.failure).toMatch(/did not complete/)
  })

  test('ADVERSARIAL F1: file present with a back-dated mtime (status 0) → freshness window rejects it', () => {
    // Pins the timestamp gate independently of the wipe: the spawn "writes"
    // a junit whose mtime is older than the window start minus tolerance.
    const { tmpJunit, persistentJunit } = scratch('stale')
    const result = collectPlaywrightEvidence({
      tmpJunitFile: tmpJunit,
      persistentJunitFile: persistentJunit,
      spawn: (junitFile) => {
        mkdirSync(dirname(junitFile), { recursive: true })
        writeFileSync(junitFile, forgedJunit('CC-03.3', 3))
        const stale = new Date(Date.now() - 60_000)
        utimesSync(junitFile, stale, stale)
        return { status: 0, output: '' }
      },
      parse: parseJunit,
    })
    expect(result.cases, 'a junit not modified during the spawn window is not this run\'s evidence').toEqual([])
    expect(result.failure).toMatch(/no fresh JUnit results/)
  })

  test('GENUINE F1: a spawn that exits 0 and writes junit inside the window → credited', () => {
    const { tmpJunit, persistentJunit } = scratch('genuine')
    const result = collectPlaywrightEvidence({
      tmpJunitFile: tmpJunit,
      persistentJunitFile: persistentJunit,
      spawn: (junitFile) => {
        // The real reporter writes to PLAYWRIGHT_JUNIT_OUTPUT_FILE (tmp path).
        mkdirSync(dirname(junitFile), { recursive: true })
        writeFileSync(junitFile, forgedJunit('CC-03.3', 3))
        return { status: 0, output: '3 passed' }
      },
      parse: parseJunit,
    })
    expect(result.failure).toBeNull()
    expect(result.cases).toHaveLength(3)
    expect(result.cases.every((c) => c.status === 'passed')).toBe(true)
    expect(result.cases[0]?.title).toBe('CC-03.3: case 1')
  })
})
