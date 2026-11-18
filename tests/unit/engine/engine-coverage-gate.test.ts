// Intent-1 CC-I1.8 (L1, gate): engine unit-test coverage ≥ 85% lines on
// `src/engine/**` excluding the worker bootstrap glue — `src/engine/**/adapters/**`
// (browser-only mediabunny/ffmpeg/transformers/silero/sherpa adapters) and
// `src/workers/**`, the exact exclusion pair of the root vitest coverage block
// (vitest.config.ts) that `pnpm test --coverage` (CI quality) enforces perFile.
//
// How the gate runs (model-coverage.test.ts / media-coverage.test.ts precedent):
// a nested `vitest run` over the engine's coverage PROVIDERS (the unit-05/06
// suites plus the colocated src/engine/asr suites, and the state/workbench/
// editor suites that drive worker-host through the state layer) with coverage
// scoped to the non-glue engine paths and thresholds lines 85 / branches 75
// (settings.yml § coverage). Exit 0 is necessary but not sufficient — the
// json-summary totals are asserted too (defense in depth). The nested run
// clears ZIPSCRIBE_CHILD so the frozen self-skipping suites actually execute;
// it excludes this gate file so it cannot recurse.
//
// Scope note: `src/engine/boot/**` is NOT excluded here — the root gate
// measures it (boot/adapters/onnx-runtime-boot carries its own suite), and the
// intent wording's "worker bootstrap glue" is the adapters+workers pair above.
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isChildRun, REPO_ROOT } from '../../helpers/repo'

const REPORTS_DIR = 'coverage/engine-gate'
const SUMMARY = join(REPO_ROOT, REPORTS_DIR, 'coverage-summary.json')

interface CoverageNode {
  lines: { pct: number; covered: number; total: number }
  branches: { pct: number; covered: number; total: number }
}
interface CoverageSummary {
  total?: CoverageNode
  [file: string]: CoverageNode | undefined
}

describe('CC-I1.8: engine coverage gate ≥ 85% lines (settings.yml, glue excluded)', () => {
  test('CC-I1.8: `vitest run` over the engine providers with coverage scoped to src/engine/** (adapters excluded) clears lines 85 / branches 75', () => {
    // Child run (ZIPSCRIBE_CHILD=1 — the gates scaffold's nested suite):
    // excluded in vitest.config.ts and stands down here (no re-spawn).
    if (isChildRun()) return
    rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }
      delete env.ZIPSCRIBE_CHILD // the coverage PROVIDERS (frozen unit-05/06 suites) must run in the nested child
      const nested = spawnSync(
        'corepack',
        [
          'pnpm',
          'exec',
          'vitest',
          'run',
          'tests/unit/asr',
          'src/engine/asr',
          'tests/unit/diarization',
          'tests/unit/state',
          'tests/unit/workbench',
          'tests/unit/editor',
          '--exclude=**/engine-coverage-gate.test.ts',
          '--coverage.enabled',
          '--coverage.include=src/engine/asr/**',
          '--coverage.include=src/engine/diarize/**',
          '--coverage.include=src/engine/model.ts',
          '--coverage.include=src/engine/protocol.ts',
          '--coverage.include=src/engine/translate/**',
          '--coverage.exclude=**/*.test.ts',
          '--coverage.exclude=**/adapters/**',
          '--coverage.reporter=json-summary',
          `--coverage.reportsDirectory=${REPORTS_DIR}`,
          '--coverage.thresholds.lines=85',
          '--coverage.thresholds.branches=75',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', timeout: 600_000, env, maxBuffer: 32 * 1024 * 1024 },
      )
      const output = `${nested.stdout ?? ''}\n${nested.stderr ?? ''}`
      expect(nested.status, `scoped engine coverage run must pass its thresholds\n${output.slice(-4000)}`).toBe(0)
      expect(existsSync(SUMMARY), `coverage summary written to ${REPORTS_DIR}`).toBe(true)
      const summary = JSON.parse(readFileSync(SUMMARY, 'utf8')) as CoverageSummary
      const files = Object.keys(summary).filter((key) => key !== 'total') as string[]
      expect(files.length, 'the non-glue engine modules are covered by this suite').toBeGreaterThan(0)
      for (const dir of ['asr', 'diarize']) {
        expect(files.some((file) => /[\\/]engine[\\/][a-z]+[\\/]/.test(file) && file.includes(`/engine/${dir}/`)), `src/engine/${dir}/** contributes covered files`).toBe(true)
      }
      let linesCovered = 0
      let linesTotal = 0
      let branchesCovered = 0
      let branchesTotal = 0
      for (const file of files) {
        const node = summary[file]!
        linesCovered += node.lines.covered
        linesTotal += node.lines.total
        branchesCovered += node.branches.covered
        branchesTotal += node.branches.total
      }
      expect(linesTotal, 'engine line statements measured').toBeGreaterThan(0)
      expect((100 * linesCovered) / linesTotal, 'aggregate engine lines ≥ 85 (settings.yml engine_lines_min)').toBeGreaterThanOrEqual(85)
      expect((100 * branchesCovered) / branchesTotal, 'aggregate engine branches ≥ 75 (settings.yml engine_branches_min)').toBeGreaterThanOrEqual(75)
      for (const file of files) {
        expect(summary[file]!.lines.pct, `${file} lines ≥ 85 (perFile parity with the root coverage gate)`).toBeGreaterThanOrEqual(85)
      }
    } finally {
      rmSync(join(REPO_ROOT, REPORTS_DIR), { recursive: true, force: true })
    }
  }, 660_000)
})
