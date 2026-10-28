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
//
// Hermeticity (post-merge fix, develop deploy-staging run 40666707433): the
// `--from-branch` probes below require a checkout that IS a unit branch, so
// they never run in the ambient checkout — on develop/feature branches
// `--from-branch` correctly no-ops (conventions § Criterion traceability:
// "no-op on non-unit branches", settings.yml criteria gate), which made the
// old ambient control assertion unsatisfiable off a unit branch. Instead the
// probes run inside scratch git worktrees on a synthetic branch
// `ai-dlc/spec-lint/unit-999-fixture` whose only extra commit contributes the
// committed fixture (`tests/fixtures/criteria/unit-999-fixture.md`, defines
// CC-999.1/CC-999.2) as `.ai-dlc/spec-lint/unit-999-fixture.md` — the path
// `unitFileFromBranch()` (scripts/verify-criteria.ts) resolves for that branch
// name. The scratch commit is contained by no other ref, so the detached
// variant's `git branch --contains HEAD` fallback resolves ONLY the synthetic
// branch regardless of what the ambient checkout is. GITHUB_HEAD_REF/GITHUB_REF
// are cleared so both probes exercise the same fallback chain CI's detached
// `actions/checkout@v4` state does, not the ambient PR env. Assertions are
// unchanged in semantics and strengthened in depth: non-zero exit AND the
// uncovered CC-999 IDs named AND (R2-5) the canonical report never written.
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, removeScratch, scratchDir, writeFixtureFile, linkScratchToolchain } from '../../helpers/repo'

const FIXTURE_UNIT = 'tests/fixtures/criteria/unit-999-fixture.md'
const SCRATCH_BRANCH = 'ai-dlc/spec-lint/unit-999-fixture'
const SCRATCH_UNIT_FILE = '.ai-dlc/spec-lint/unit-999-fixture.md'

function git(args: string[], cwd: string = REPO_ROOT): { status: number | null; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000 })
  return { status: result.status, stderr: result.stderr ?? '' }
}

/** Drop the scratch branch and any worktree still holding it (crash-residual idempotence). */
function destroyScratchBranch(): void {
  const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15_000 })
  let path = ''
  for (const line of (list.stdout ?? '').split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line === `branch refs/heads/${SCRATCH_BRANCH}`) spawnSync('git', ['worktree', 'remove', '--force', path], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15_000 })
  }
  git(['worktree', 'prune'])
  git(['branch', '-D', SCRATCH_BRANCH])
}

describe('adversarial: verify:unit as the CI-enforced criteria gate', () => {
  test('ADVERSARIAL CC-01.9/CC-01.1: --from-branch enforces the unit gate on a detached checkout at the unit-branch commit (CI PR state)', () => {
    const namedTree = scratchDir('verify-named')
    const detachedTree = scratchDir('verify-detached')
    try {
      destroyScratchBranch()
      const add = git(['worktree', 'add', '-b', SCRATCH_BRANCH, namedTree, 'HEAD'])
      expect(add.status, `git worktree add -b ${SCRATCH_BRANCH} failed\n${add.stderr}`).toBe(0)
      // The fixture lives in the committed tree, so it is present in the
      // scratch checkout; stage it at the path `--from-branch` resolves for
      // SCRATCH_BRANCH and commit it on the scratch branch alone.
      writeFixtureFile(join(namedTree, SCRATCH_UNIT_FILE), readFileSync(join(namedTree, FIXTURE_UNIT), 'utf8'))
      expect(git(['add', SCRATCH_UNIT_FILE], namedTree).status, 'git add scratch unit file').toBe(0)
      const commit = git(['-c', 'user.name=zipscribe-test-harness', '-c', 'user.email=harness@zipscribe.invalid', 'commit', '--no-verify', '-m', 'test: scratch unit-999 fixture for hermetic verify:unit control'], namedTree)
      expect(commit.status, `git commit scratch fixture failed\n${commit.stderr}`).toBe(0)
      // DETACHED at the unit-branch commit — the same git state GitHub Actions
      // `actions/checkout@v4` produces for every PR. The criteria gate must
      // either verify or fail loudly here, never silently no-op.
      const addDetached = git(['worktree', 'add', '--detach', detachedTree, SCRATCH_BRANCH])
      expect(addDetached.status, `git worktree add --detach ${SCRATCH_BRANCH} failed\n${addDetached.stderr}`).toBe(0)

      for (const [label, cwd] of [
        ['named unit branch', namedTree],
        ['detached HEAD at the unit-branch commit (the CI PR state)', detachedTree],
      ] as const) {
        const probe = spawnSync('node', ['scripts/verify-criteria.ts', 'unit', '--from-branch', '--no-run'], {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, CI: '1', NO_COLOR: '1', GITHUB_HEAD_REF: undefined, GITHUB_REF: undefined },
          timeout: 20_000,
        })
        const output = `${probe.stdout ?? ''}\n${probe.stderr ?? ''}`
        expect(probe.status, `verify:unit --from-branch --no-run exited ${probe.status} on the ${label} — the criteria gate no-ops or green-lights where settings.yml requires it to fail (untagged CC-999.1/CC-999.2 of the scratch fixture proven by no tests)\n${output.slice(-2000)}`).not.toBe(0)
        for (const id of ['CC-999.1', 'CC-999.2']) {
          expect(output, `the ${label} probe must name the uncovered fixture criterion ${id}, not no-op on an ambient branch\n${output.slice(-2000)}`).toContain(`UNCOVERED: ${id}`)
        }
        // R2-5: a `--no-run` control prints its all-FAIL table but never
        // writes the canonical reports/criteria/<name>.md.
        expect(output, `the ${label} probe must announce the R2-5 no-write guard\n${output.slice(-2000)}`).toContain('canonical report NOT written')
        expect(existsSync(join(cwd, 'reports', 'criteria', 'unit-999-fixture.md')), `--no-run on the ${label} wrote the canonical criteria report`).toBe(false)
      }
    } finally {
      git(['worktree', 'remove', '--force', namedTree])
      git(['worktree', 'remove', '--force', detachedTree])
      git(['worktree', 'prune'])
      git(['branch', '-D', SCRATCH_BRANCH])
      removeScratch(namedTree)
      removeScratch(detachedTree)
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
