// CC-01.13 (adapted for the Free-plan private repo — `.agent/overnight-pipeline.md`
// Adaptation 2): `develop` exists and is the default branch; a PR from a feature
// branch into `main` is rejected by the `branch-policy` check.
//
// The platform-level half (rulesets/required checks rejecting direct/force
// pushes on `main` and `develop`) cannot be created on this plan; it is recorded
// as a documented skip below and reported to the owner, never marked done.
import { describe, expect, test } from 'vitest'
import { exists, readText } from '../../helpers/repo'

const BRANCH_POLICY = '.github/workflows/branch-policy.yml'
const FEATURE_SOURCES = ['release/', 'hotfix/']

function triggerBlock(text: string): string {
  const match = text.match(/^on:\s*\n((?:[ \t].*\n|\n)+)/m)
  return match ? match[1]! : ''
}

describe('CC-01.13: git flow branches and the branch-policy check', () => {
  test('CC-01.13: `.github/workflows/branch-policy.yml` exists and runs on pull_request into main', () => {
    expect(exists(BRANCH_POLICY), BRANCH_POLICY).toBe(true)
    const source = readText(BRANCH_POLICY)
    const triggers = triggerBlock(source).length > 0 ? triggerBlock(source) : source
    expect(triggers, 'trigger').toMatch(/pull_request/)
    expect(triggers, 'only PRs whose base is main are policed').toMatch(/main/)
  })

  test('CC-01.13: a PR from a feature branch into main is rejected (e.g. `ai-dlc/…`)', () => {
    expect(exists(BRANCH_POLICY), BRANCH_POLICY).toBe(true)
    const source = readText(BRANCH_POLICY)
    expect(source, 'the check fails the job').toMatch(/exit 1|process\.exit\(1\)/)
    for (const prefix of FEATURE_SOURCES) expect(source, `allowed head prefix ${prefix}`).toContain(prefix)
  })

  test('CC-01.13: the policy honours the feature prefixes that must never reach main', () => {
    expect(exists(BRANCH_POLICY), BRANCH_POLICY).toBe(true)
    const source = readText(BRANCH_POLICY)
    expect(source, 'ai-dlc/ and feature/ are mentioned as rejected heads').toMatch(/ai-dlc\/|feature\//)
  })

  test.skip(
    'CC-01.13: platform branch protection on main/develop rejects direct and force pushes — awaiting GitHub Pro/org plan (see .agent/overnight-pipeline.md Adaptation 2)',
    () => {
      // Verified by `gh api repos/{owner}/{repo}/branches/main/protection` in the
      // owner's environment once the plan allows it. Documented, not omitted,
      // so the criterion never silently passes.
    },
  )

  test.todo('CC-01.13: develop is the default branch (verified out-of-band via `gh api repos/{owner}/{repo}` → default_branch=develop)')
})