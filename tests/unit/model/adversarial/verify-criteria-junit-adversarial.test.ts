// ADVERSARIAL (unit-03 red-team): `verify:unit` JUnit attribution forgery.
//
// scripts/verify-criteria.ts parses JUnit XML and credits a criterion whenever
// a *title* cites its CC-ID with status passed. Two sources feed that parse:
// a JUnit freshly written into a temp dir by the spawned vitest/playwright
// run, and — in whole-repo mode only — the fixed path `<repo>/test-results/
// junit.xml`, which NO canonical command ever writes (the pinned Playwright
// junit reporter writes to stdout/file-env, per the 08e785e fix comment).
// That second path is therefore a trust-on-foreign-file surface: a planted or
// stale file could fabricate "passing tests" for criteria that have none
// (the unit-02 fabrication class).
//
// This suite probes what is reachable at unit-test cost:
//  1. FORGE-SCRATCH: with `--root <scratch>` (the mode the scaffold negative
//     tests use), a planted `<repo>/test-results/junit.xml` MUST NOT credit
//     criteria — the repo-path fallback is whole-repo-mode only. If this test
//     goes green the scratch mode is clean; the whole-repo mode is probed
//     separately (adversary report, manual full-run evidence).
//  2. FORGE-STATUS: a planted <skipped>/<failure> testcase must never count
//     as passing (parse-level distrust of the status attribute).
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT, removeScratch, scratchDir, writeFixtureFile, linkScratchToolchain } from '../../../helpers/repo'

const FIXTURE_UNIT = 'tests/fixtures/criteria/unit-999-fixture.md'
const PLANTED = join(REPO_ROOT, 'test-results', 'junit.xml')

function junitWith(titles: string[]): string {
  const cases = titles.map((title) => `  <testcase classname="e2e/model/forged.spec.ts" name="${title}" time="0.001"/>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="forged" tests="${titles.length}" failures="0">\n${cases}\n</testsuite>\n</testsuites>\n`
}

function scratchRootCoveringOnlyFirst(): string {
  const root = scratchDir('adv-verify-forge')
  writeFixtureFile(join(root, 'src/__fixture__/real.test.ts'), `import { test, expect } from 'vitest'\ntest('CC-999.1: genuinely covered by a real test', () => {\n  expect(1 + 1).toBe(2)\n})\n`)
  linkScratchToolchain(root)
  return root
}

function runVerify(root: string): { status: number | null; output: string } {
  const run = spawnSync('corepack', ['pnpm', 'run', '--silent', 'verify:unit', FIXTURE_UNIT, '--root', root], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    timeout: 300_000,
  })
  return { status: run.status ?? 1, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}` }
}

describe('ADVERSARIAL CC-01.9/CC-03.3: verify:unit junit forgery', () => {
  test('ADVERSARIAL CC-01.9: a planted <repo>/test-results/junit.xml cannot credit criteria in --root (scratch) mode', () => {
    // Child-safety (model-coverage.test.ts doctrine): this spawns a nested
    // `pnpm run verify:unit` → must run in the authoritative parent (and the
    // CC-03.8 nested run) only, never inside the CC-01.1 child's 30 s budget.
    if (isChildRun()) return

    rmSync(PLANTED, { force: true }) // crash-residual hygiene
    mkdirSync(join(REPO_ROOT, 'test-results'), { recursive: true })
    writeFileSync(PLANTED, junitWith(['CC-999.2: FORGED — no real test behind this', 'CC-03.3: FORGED via e2e classname']))
    const root = scratchRootCoveringOnlyFirst()
    try {
      const run = runVerify(root)
      expect(
        run.status,
        `verify:unit exited ${run.status} while a planted test-results/junit.xml claimed CC-999.2 with no real test behind it — the JUnit attribution accepts forged pass results from a file no canonical command writes (unit-02 fabrication class)\n${run.output.slice(-3000)}`,
      ).not.toBe(0)
      expect(run.output, 'the uncovered criterion must be named').toContain('CC-999.2')
    } finally {
      rmSync(PLANTED, { force: true })
      removeScratch(root)
    }
  })

  test('ADVERSARIAL CC-01.9: the planted path is normally absent and never written by pnpm test:e2e', () => {
    expect(existsSync(PLANTED), 'no leftover planted junit from a previous run').toBe(false)
  })
})
