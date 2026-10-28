// Adversarial suite (fresh-session red-team of unit-01): verify:unit must be an
// actual gate in CI, and a criterion is only covered by a test that NAMES it —
// substring noise in a title is not a citation.
//
// Contract sources:
// - `.ai-dlc/settings.yml` (lines 3-4, 79-81): quality gates are "enforced in CI
//   on every PR"; criteria gate `pnpm verify:unit --from-branch` "unit derived
//   from ai-dlc/<intent>/<unit-stem>; no-op on non-unit branches".
// - `.agent/AGENTS.md` § Commands: `pnpm verify:unit --from-branch` is one of the
//   quality gates CI enforces on every PR.
// - `.github/workflows/ci.yml`: PR pipeline runs
//   `corepack pnpm verify:unit --from-branch` after `actions/checkout@v4` — which
//   checks out pull requests in DETACHED HEAD state, where
//   `git branch --show-current` prints nothing.
// - `.agent/REVIEW.md` Always-check 13 + `knowledge/conventions.md`
//   § Criterion traceability: "Tests name the criterion", "tests citing unknown
//   IDs" fail the gate.
import { afterAll, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPO_ROOT, runCommand, scratchDir, removeScratch, writeFixtureFile, linkScratchToolchain } from '../../helpers/repo'

const FIXTURE_UNIT = 'tests/fixtures/criteria/unit-999-fixture.md'

describe('adversarial: verify:unit as the CI-enforced criteria gate', () => {
  test('ADVERSARIAL CC-01.9/CC-01.1: --from-branch enforces the unit gate on a detached checkout at the unit-branch commit (CI PR state)', () => {
    const tree = scratchDir('verify-detached')
    const add = spawnSync('git', ['worktree', 'add', '--detach', tree, 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' })
    expect(add.status, `git worktree add failed\n${add.stderr}`).toBe(0)
    try {
      // The worktree is checked out DETACHED at this unit-branch commit — the
      // same git state GitHub Actions `actions/checkout@v4` produces for every
      // PR. The criteria gate must either verify or fail loudly here.
      const detached = spawnSync('node', ['scripts/verify-criteria.ts', 'unit', '--from-branch', '--no-run'], { cwd: tree, encoding: 'utf8', timeout: 60_000 })
      const output = `${detached.stdout ?? ''}\n${detached.stderr ?? ''}`
      // Control: the same commit on a named unit branch does resolve and does
      // fail under --no-run (criteria present, nothing proven).
      const named = runCommand('node', ['scripts/verify-criteria.ts', 'unit', '--from-branch', '--no-run'])
      expect(named.status, `control: on the named unit branch --no-run must fail (uncovered criteria)\n${named.output.slice(-2000)}`).not.toBe(0)
      expect(
        detached.status,
        `verify:unit --from-branch exited ${detached.status} in the CI PR state (detached HEAD at the unit-branch commit) — "${output.split('\n')[0] ?? ''}". The criteria gate silently no-ops precisely where CI enforces it (ci.yml runs it after a detached actions/checkout), so no PR is ever criteria-checked (settings.yml: gates "enforced in CI on every PR")\n${output.slice(-2000)}`,
      ).not.toBe(0)
    } finally {
      spawnSync('git', ['worktree', 'remove', '--force', tree], { cwd: REPO_ROOT, encoding: 'utf8' })
      removeScratch(tree)
    }
  })

  test('ADVERSARIAL CC-01.9: a test title containing an ID only as a substring does not cover the criterion', () => {
    // REVIEW.md #13 / conventions § Criterion traceability: "Tests name the
    // criterion" — a title like `NOTA-CITATION CC-999.2` discusses the ID in
    // prose, it does not name the test as covering the criterion. CC-999.2 must
    // stay UNCOVERED (exit non-zero), not be marked passing by substring noise.
    const root = scratchDir('verify-substring')
    writeFixtureFile(join(root, 'src/__fixture__/substring.test.ts'), `import { test, expect } from 'vitest'\ntest('CC-999.1: the covered criterion', () => {\n  expect(1).toBe(1)\n})\ntest('prose mentions NOTA-CITATION CC-999.2 as context only', () => {\n  expect(1).toBe(1)\n})\n`)
    linkScratchToolchain(root)
    const run = spawnSync('corepack', ['pnpm', 'run', '--silent', 'verify:unit', FIXTURE_UNIT, '--root', root], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', NO_COLOR: '1' },
      timeout: 120_000,
    })
    removeScratch(root)
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
    expect(
      run.status,
      `verify:unit exited ${run.status}: a test whose title merely contains "CC-999.2" inside the phrase "NOTA-CITATION CC-999.2" was counted as a citation and marked the criterion covered — the ID regex has no boundary, so accidental prose in any future test title can produce false-green coverage (REVIEW.md #13, conventions § Criterion traceability)\n${output.slice(-3000)}`,
    ).not.toBe(0)
  })
})
