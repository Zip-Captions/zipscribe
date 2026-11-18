// CC-301.5 (L1, gate): unit-test coverage ≥ 85% on `src/engine/translate/**`
// — the pure engine modules (engine/plan/session/track). The chrome adapter
// is EXCLUDED per the criterion (its own scripted-global suite exists; it is
// browser-API glue). Modelled on engine-coverage-gate.test.ts: a nested
// `vitest run` over the translate suites with a dedicated reportsDirectory;
// the child (ZIPSCRIBE_CHILD) stands down; the nested run excludes this file.
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../helpers/repo'

const REPORTS_DIR = 'coverage/translate-gate'
const SUMMARY = join(REPO_ROOT, REPORTS_DIR, 'coverage-summary.json')

interface CoverageNode {
  lines: { pct: number; covered: number; total: number }
  branches: { pct: number; covered: number; total: number }
}
interface CoverageSummary {
  total?: CoverageNode
  [file: string]: CoverageNode | undefined
}

describe('CC-301.5: translate coverage gate ≥ 85% (adapter excluded)', () => {
  test('CC-301.5: `vitest run` over the translate suites clears lines 85 on src/engine/translate/** (chrome-translator excluded)', () => {
    if (isChildRun()) return
    rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }
      delete env.ZIPSCRIBE_CHILD
      const nested = spawnSync(
        'corepack',
        [
          'pnpm',
          'exec',
          'vitest',
          'run',
          'tests/unit/translate',
          '--exclude=**/translate-coverage-gate.test.ts',
          '--coverage.enabled',
          '--coverage.include=src/engine/translate/**',
          '--coverage.exclude=**/chrome-translator.ts',
          '--coverage.exclude=**/*.test.ts',
          '--coverage.reporter=json-summary',
          `--coverage.reportsDirectory=${REPORTS_DIR}`,
          '--coverage.thresholds.lines=85',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 420_000, env, maxBuffer: 32 * 1024 * 1024 },
      )
      const output = `${nested.stdout ?? ''}\n${nested.stderr ?? ''}`
      expect(nested.status, `translate coverage run must pass lines 85\n${output.slice(-4000)}`).toBe(0)
      expect(existsSync(SUMMARY), `coverage summary written to ${REPORTS_DIR}`).toBe(true)
      const summary = JSON.parse(readFileSync(SUMMARY, 'utf8')) as CoverageSummary
      const files = Object.keys(summary).filter((key) => key !== 'total')
      expect(files.some((f) => /session\.[tj]s$/.test(f)), 'session.ts measured').toBe(true)
      expect(files.some((f) => /plan\.[tj]s$/.test(f)), 'plan.ts measured').toBe(true)
      expect(files.some((f) => /track\.[tj]s$/.test(f)), 'track.ts measured').toBe(true)
      expect(files.some((f) => /chrome-translator/.test(f)), 'adapter excluded from the gate').toBe(false)
      let linesCovered = 0
      let linesTotal = 0
      for (const file of files) {
        const node = summary[file]!
        linesCovered += node.lines.covered
        linesTotal += node.lines.total
        expect(node.lines.pct, `${file} lines ≥ 85 (CC-301.5 perFile)`).toBeGreaterThanOrEqual(85)
      }
      expect(linesTotal, 'translate line statements measured').toBeGreaterThan(0)
      expect((100 * linesCovered) / linesTotal, 'aggregate translate lines ≥ 85').toBeGreaterThanOrEqual(85)
    } finally {
      rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    }
  }, 480_000)
})
