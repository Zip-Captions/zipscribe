// ADVERSARIAL (unit-03 review round 1, finding F2): an e2e-declared criterion
// must be credited ONLY from Playwright evidence.
//
// The round-1 bypass: delete `e2e/model/model-cache.spec.ts`, and three passing
// VITEST tests whose titles merely mention ``CC-03.3`` still satisfied the
// criterion (`citationsOf` scanned the whole title, and nothing tracked which
// runner produced a case). The fix (scripts/verify-criteria.ts) does two
// things this suite pins:
//   1. citations come only from the LEADING citation run of a title, and
//   2. a criterion cited by any `e2e/**` spec is credited only by a case whose
//      `source === 'playwright'`.
// Run against a scratch tree that mirrors the repo's unit-03 spec with the
// real e2e specs removed, the verifier must report CC-03.3 UNCOVERED.
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { copyTree, isChildRun, linkScratchToolchain, removeScratch, REPO_ROOT, scratchDir, writeFixtureFile } from '../../../helpers/repo'

// The CC-03.3 contract lives in this unit file + its e2e spec.
const UNIT_FILE = '.ai-dlc/local-transcribe-engine/unit-03-model-manager.md'

function copyInto(root: string, repoRelativePath: string): void {
  cpSync(join(REPO_ROOT, repoRelativePath), join(root, repoRelativePath), { recursive: true })
}

/**
 * A FULL-TREE copy of the repo with the real e2e spec deleted and a vitest
 * title planted that cites CC-03.3 — the exact round-1 attack. Round 2's
 * lesson: an e2e-less scratch tree is NOT the same condition as "the spec was
 * deleted", because a disk scan of `e2e/` would then treat the criterion as
 * never-e2e. The unit spec's own "Playwright:" wording must keep it e2e-bound.
 */
function fullTreeWithDeletedSpec(): string {
  const root = scratchDir('adv-e2e-provenance')
  // The parts verify-criteria actually reads: the unit spec (with its
  // "Playwright:" wording) and the sibling spec tree for the known-ID rule.
  copyInto(root, UNIT_FILE)
  copyInto(root, '.ai-dlc/knowledge')
  // CRITICAL (round 2): the e2e directory EXISTS and holds the real spec's
  // sibling files, then the spec itself is deleted — the exact production
  // condition. An absent e2e/ dir is a different (and weaker) scenario.
  copyInto(root, 'e2e/model/fixtures')
  writeFixtureFile(
    join(root, 'tests/unit/model/adversarial/__planted__.test.ts'),
    [
      "import { test, expect } from 'vitest'",
      "test('CC-03.3: forged — no e2e execution behind this', () => {",
      "  expect(1).toBe(1)",
      "})",
      '',
    ].join('\n'),
  )
  linkScratchToolchain(root)
  return root
}

/**
 * A scratch tree that looks like the repo to verify-criteria: the unit spec,
 * the criteria-declaring sibling specs, ONE vitest file that merely mentions
 * CC-03.3 in passing, and NO e2e specs at all.
 */
function scratchWithoutE2e(): string {
  const root = scratchDir('adv-e2e-provenance')
  copyInto(root, UNIT_FILE)
  copyInto(root, '.ai-dlc/knowledge')
  writeFixtureFile(
    join(root, 'src/__fixture__/mentions.test.ts'),
    [
      "import { test, expect } from 'vitest'",
      "test('CC-03.2: capability tier matrix works', () => {",
      "  expect(1 + 1).toBe(2)",
      "})",
      "test('CC-03.2: something unrelated that discusses CC-03.3 in prose', () => {",
      "  // This title has a leading citation (CC-03.2) and mentions CC-03.3 later.",
      "  expect(2 + 2).toBe(4)",
      "})",
      '',
    ].join('\n'),
  )
  linkScratchToolchain(root)
  return root
}

function runVerify(root: string): { status: number | null; output: string } {
  const run = spawnSync('corepack', ['pnpm', 'run', '--silent', 'verify:unit', UNIT_FILE, '--root', root], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
    timeout: 300_000,
  })
  return { status: run.status ?? 1, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}` }
}

describe('ADVERSARIAL CC-03.3: vites provenance — e2e criteria need playwright evidence', () => {
  test('ADVERSARIAL CC-03.3: deleting the REAL e2e spec + citing the ID from vitest still leaves it UNCOVERED', () => {
    if (isChildRun()) return // spawns vitest itself; the gates-scaffold child cannot nest that
    const root = fullTreeWithDeletedSpec()
    try {
      const run = runVerify(root)
      const cc33 = run.output.split('\n').find((line) => line.startsWith('| CC-03.3'))
      expect(cc33, `CC-03.3 row must be present in the report\n${run.output.slice(-3000)}`).toBeDefined()
      expect(cc33, 'a vitest case that merely mentions CC-03.3 must never count as passing').toMatch(/FAIL/)
      expect(run.output, 'the uncovered e2e criterion must be named').toContain('UNCOVERED: CC-03.3')
      expect(run.status, 'an uncovered untagged criterion is a gate failure').not.toBe(0)
    } finally {
      removeScratch(root)
    }
  }, 360_000)

  test('ADVERSARIAL CC-03.3: a trailing (non-leading) CC-03.3 mention in a passing vitest title is not a citation', () => {
    if (isChildRun()) return
    const root = scratchWithoutE2e()
    try {
      const run = runVerify(root)
      // The second fixture test has a leading CC-03.2 and mentions CC-03.3 in
      // prose; only the leading run may count, so CC-03.2 passes and CC-03.3
      // stays uncovered.
      const cc32 = run.output.split('\n').find((line) => line.startsWith('| CC-03.2'))
      expect(cc32, 'the leading citation still counts').toMatch(/pass/)
      expect(run.output, 'the prose mention must not credit CC-03.3').toContain('UNCOVERED: CC-03.3')
    } finally {
      removeScratch(root)
    }
  }, 360_000)

  test('ADVERSARIAL CC-03.3: cleanup leaves no scratch tree behind', () => {
    const root = scratchWithoutE2e()
    removeScratch(root)
    expect(existsSync(root), 'scratch tree removed').toBe(false)
  })
})