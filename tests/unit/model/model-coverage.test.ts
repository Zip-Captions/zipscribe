// CC-03.8 (L1, gate): coverage ≥ 85% on `src/engine/model/**`.
//
// How the gate runs: a nested `vitest run tests/unit/model` with coverage
// restricted to `src/engine/model/**` and thresholds lines 85 / branches 75
// (settings.yml coverage; conventions § Coverage). The nested run clears
// ZIPSCRIBE_CHILD (it only targets this directory and excludes
// model-coverage.test.ts itself via `--exclude`, so it cannot recurse) — the
// five contract suites must run there, since they are the coverage PROVIDERS.
// Exit 0 is necessary but not sufficient — the json-summary totals are
// asserted too (defense in depth: no accidental `coverage: false`). Today this
// is RED by construction: the modules under `src/engine/model/**` do not
// exist, so the scoped suite fails and no ≥85% summary can exist.
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../helpers/repo'

const REPORTS_DIR = 'coverage/model-gate'
const SUMMARY = join(REPO_ROOT, REPORTS_DIR, 'coverage-summary.json')

interface CoverageSummaryTotal {
  lines: { pct: number }
  branches: { pct: number }
}
interface CoverageSummary {
  total?: CoverageSummaryTotal
  [file: string]: unknown
}

describe('CC-03.8: engine/model coverage gate ≥ 85%', () => {
  test('CC-03.8: `vitest run tests/unit/model` with coverage scoped to src/engine/model/** clears lines 85 / branches 75', () => {
    // Child run (ZIPSCRIBE_CHILD=1 — the gates scaffold's nested suite):
    // excluded in vitest.config.ts and stands down here (no re-spawn).
    if (isChildRun()) return
    rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }
      delete env.ZIPSCRIBE_CHILD // the coverage PROVIDERS (the five unit-03 suites) must run in the nested child
      const nested = spawnSync(
        'corepack',
        [
          'pnpm',
          'exec',
          'vitest',
          'run',
          'tests/unit/model',
          '--exclude=**/model-coverage.test.ts',
          '--coverage.enabled',
          '--coverage.include=src/engine/model/**',
          '--coverage.exclude=**/*.test.ts',
          '--coverage.reporter=json-summary',
          `--coverage.reportsDirectory=${REPORTS_DIR}`,
          '--coverage.thresholds.lines=85',
          '--coverage.thresholds.branches=75',
          '--coverage.thresholds.perFile=true',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300_000, env, maxBuffer: 32 * 1024 * 1024 },
      )
      const output = `${nested.stdout ?? ''}\n${nested.stderr ?? ''}`
      expect(nested.status, `scoped coverage run must pass its thresholds\n${output.slice(-4000)}`).toBe(0)
      expect(existsSync(SUMMARY), `coverage summary written to ${REPORTS_DIR}`).toBe(true)
      const summary = JSON.parse(readFileSync(SUMMARY, 'utf8')) as CoverageSummary
      const modelFiles = Object.keys(summary).filter((key) => key !== 'total' && /[\\/]engine[\\/]model[\\/]/.test(key))
      expect(modelFiles.length, 'src/engine/model/** files are covered by this suite').toBeGreaterThan(0)
      expect(summary.total?.lines.pct, 'aggregate engine/model lines ≥ 85').toBeGreaterThanOrEqual(85)
      expect(summary.total?.branches.pct, 'aggregate engine/model branches ≥ 75 (settings.yml)').toBeGreaterThanOrEqual(75)
    } finally {
      rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    }
  }, 360_000)
})
