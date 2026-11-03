// CC-07.7 (L1, gate): coverage ≥ 85% on `src/engine/captions/**`.
//
// How the gate runs (unit-03 `model-coverage.test.ts` / unit-04
// `media-coverage.test.ts` pattern): a nested `vitest run` over the coverage
// PROVIDERS (this directory's suites + the `src/engine/captions/**` colocated
// suites) with coverage restricted to `src/engine/captions/**` and thresholds
// lines 85 / branches 75, clearing ZIPSCRIBE_CHILD so the providers run
// inside the child. The json-summary totals are asserted as well (defense in
// depth: no accidental `coverage: false`).
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../helpers/repo'

const REPORTS_DIR = 'coverage/captions-gate'
const SUMMARY = join(REPO_ROOT, REPORTS_DIR, 'coverage-summary.json')

interface CoverageSummaryTotal {
  lines: { pct: number }
  branches: { pct: number }
}
interface CoverageSummary {
  total?: CoverageSummaryTotal
  [file: string]: unknown
}

describe('CC-07.7: engine/captions coverage gate ≥ 85%', () => {
  test('CC-07.7: `vitest run tests/unit/captions src/engine/captions` with coverage scoped to src/engine/captions/** clears lines 85 / branches 75', () => {
    // Child run (ZIPSCRIBE_CHILD=1 — the gates scaffold's nested suite):
    // excluded in vitest.config.ts and stands down here (no re-spawn).
    if (isChildRun()) return
    rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }
      delete env.ZIPSCRIBE_CHILD // the coverage PROVIDERS (the unit-07 caption suites) must run in the nested child
      const nested = spawnSync(
        'corepack',
        [
          'pnpm',
          'exec',
          'vitest',
          'run',
          'tests/unit/captions',
          'src/engine/captions',
          '--exclude=**/coverage.test.ts',
          '--coverage.enabled',
          '--coverage.include=src/engine/captions/**',
          '--coverage.exclude=**/*.test.ts',
          '--coverage.exclude=**/adapters/**',
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
      const captionFiles = Object.keys(summary).filter((key) => key !== 'total' && /[\\/]engine[\\/]captions[\\/]/.test(key))
      expect(captionFiles.length, 'src/engine/captions/** files are covered by this suite').toBeGreaterThan(0)
      expect(summary.total?.lines.pct, 'aggregate engine/captions lines ≥ 85 (CC-07.7)').toBeGreaterThanOrEqual(85)
      expect(summary.total?.branches.pct, 'aggregate engine/captions branches ≥ 75 (settings.yml)').toBeGreaterThanOrEqual(75)
    } finally {
      rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    }
  }, 360_000)
})
