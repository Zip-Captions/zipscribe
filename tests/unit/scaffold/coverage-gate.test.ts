// CC-01.11: coverage thresholds are enforced.
//
// Contract: FR-1.0.3 — "coverage config with the ≥ 85% engine gate reported";
// `settings.yml coverage` — engine lines 85 / branches 75, state lines 80,
// "enforced via vitest coverage.thresholds, not just reported";
// `.agent/AGENTS.md` — "CI (.github/workflows/ci.yml) enforces these gates on
// every PR". Two halves: the vitest config carries the thresholds (harness
// half, checked statically), and CI actually turns the gate on for `pnpm test`
// (builder half — RED today, there is no workflow yet). The behavioural probe
// drops one uncovered module under `src/engine/**` (removed in a `finally`) and
// expects a coverage-enabled `pnpm test` run to go red naming it.
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { exists, isChildRun, readText, REPO_ROOT, removeRepoPath, runIn, writeFixtureFile } from '../../helpers/repo'

const CI_WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/ci.yaml']

function ciWorkflowText(): string {
  return CI_WORKFLOWS.filter((file) => exists(file)).map((file) => readText(file)).join('\n')
}

function configText(): string {
  return ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js'].filter((file) => exists(file)).map((file) => readText(file)).join('\n')
}

describe('CC-01.11: coverage thresholds gate `pnpm test`', () => {
  test('CC-01.11: vitest.config.ts configures engine 85/75 and state 80 thresholds', () => {
    // Builder half first: without CI the gate never runs.
    expect(ciWorkflowText(), '.github/workflows/ci.yml exists').not.toBe('')
    const config = configText()
    expect(config, 'vitest.config.*').not.toBe('')
    expect(config, 'engine lines 85').toMatch(/(lines\s*:\s*85)/)
    expect(config, 'engine branches 75').toMatch(/(branches\s*:\s*75)/)
    expect(config, 'state lines 80').toMatch(/(lines\s*:\s*80)/)
  })

  test('CC-01.11: dropping engine coverage below 85% fails `pnpm test`', () => {
    // CI must run the suite with the coverage gate turned on.
    expect(ciWorkflowText(), 'CI workflow runs pnpm test with --coverage').toMatch(/test[^#\n]*--coverage/)
    if (isChildRun()) return
    // The config must scope coverage to engine + state only; otherwise an
    // unrelated uncovered file (ui, workers) would trip the engine threshold
    // and the probe below would not be proving anything about engine code.
    const config = configText()
    expect(config, 'coverage include is scoped to src/engine + src/state').toMatch(/include[^\]]*src\/engine/)
    // Uncovered module: enough uncovered lines to pull engine lines below 85%
    // regardless of what else exists. Deliberately not committed — removed in
    // the finally block below.
    const name = 'coverage-drop-probe.ts'
    const target = join(REPO_ROOT, 'src/engine', name)
    const body = Array.from({ length: 120 }, (_, index) => `export const value${index} = ${index}`).join('\n')
    writeFixtureFile(target, `${body}\n`)
    try {
      // Child run: the same two tests with `ZIPSCRIBE_CHILD=1` (set by
      // runTool), so the nested spawn is skipped and both tests pass — the
      // child's exit code is then decided by the per-file thresholds alone
      // (`--coverage` overrides the harness `coverage.enabled: false`, and the
      // probe on disk is at 0 % lines).
      const run = runIn(
        REPO_ROOT,
        'corepack',
        ['pnpm', 'run', '--silent', 'test', 'tests/unit/scaffold/coverage-gate.test.ts', '--coverage', '--coverage.reporter=text'],
        180_000,
      )
      expect(run.status, `a below-threshold engine file must fail pnpm test\n${run.output.slice(-4000)}`).not.toBe(0)
      expect(run.output, 'the failure names the threshold').toMatch(/threshold/i)
      expect(run.output, 'the failure names the uncovered file').toContain(name)
    } finally {
      removeRepoPath(join('src/engine', name))
      removeRepoPath('coverage')
    }
  })
})
