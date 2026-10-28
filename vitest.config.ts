import { defineConfig, defaultExclude } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test-only configuration. The product config (shared with `pnpm build`) is
// `vite.config.ts`, owned by the builder; this file must stay valid with or
// without it (unit-01 is authored before any implementation exists).
//
// Notes:
// - Node is the default environment; DOM tests opt in per file with
//   `// @vitest-environment jsdom`.
// - Tests run one at a time (`fileParallelism: false`, `sequence.concurrent:
//   false`): the scaffold tests spawn gate commands and vite previews on
//   fixed ports, so they must not overlap.
// - Coverage thresholds mirror `.ai-dlc/settings.yml` § coverage. They are off
//   for a bare `vitest run`: unit-01 has no engine logic yet, so there is
//   nothing to measure. `pnpm test --coverage` — CC-01.11 — turns the gate on;
//   once unit-02+ land engine/state code the `enabled: false` line goes away.
// Builder extension (unit report): the CC-01.2 regeneration test runs
// `pnpm fixtures` in a scratch tree WITHOUT node_modules; the generator needs
// to find the real repo (for the pinned ffmpeg-static) from there. The
// scaffold helpers spawn children with a spread of this process's env, so
// exporting it here reaches every gate/scratch child.
process.env.ZIPSCRIBE_REPO_ROOT ??= new URL('.', import.meta.url).pathname

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    // The gate-spawning scaffold re-enters the suite when it is itself the
    // spawned child (`ZIPSCRIBE_CHILD=1` — same guard as gates.test's own
    // `isChildRun()` check on its recursive test). Running the whole gates
    // file inside a 30 s-bounded child would re-run lint/typecheck/build/e2e
    // children pointlessly and push the child over its time budget.
    exclude: process.env.ZIPSCRIBE_CHILD === '1' ? ['**/gates.test.ts', ...defaultExclude] : defaultExclude,
    // The gate-spawning scaffold tests mutate shared state (`dist/`, `src/`
    // probes, scratch previews) and shell out to build/e2e commands — files
    // must not overlap (gates.test.ts documents the same expectation).
    fileParallelism: false,
    // In-file concurrency is off: several scaffold tests spawn a vite preview
    // on the fixed port 4178 (network-audit, retry-detection) and would
    // preempt each other's live server if they overlapped.
    sequence: {
      concurrent: false,
    },
    hookTimeout: 30_000,
    // The vitest default (5 s) is too tight for the type-aware ESLint-API
    // probes and `pnpm fixtures` regeneration on a 2-core CI runner (CI run
    // 40646526713: those tests died at 6.3–7.2 s). Gate-spawning tests carry
    // their own explicit per-test timeouts and are unaffected.
    testTimeout: 30_000,
    coverage: {
      // Opt-in until there is engine/state code to measure (see above).
      enabled: false,
      provider: 'v8',
      // vitest cleans its reportsDirectory at startup and keeps temp results
      // in <dir>/.tmp; coverage-gate.test.ts runs a nested `pnpm test
      // --coverage` inside the suite and deletes `coverage/` on exit, so
      // parent and child must never share one (CI run 40646526713: shared
      // `coverage/.tmp` → ENOENT `coverage-N.json` killed the run). Every
      // scaffold-spawned child carries ZIPSCRIBE_CHILD=1 (runTool).
      reportsDirectory: process.env.ZIPSCRIBE_CHILD === '1' ? 'coverage/child' : 'coverage-main',
      reporter: ['text', 'json-summary'],
      include: ['src/engine/**', 'src/state/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'src/engine/**/adapters/**', 'src/workers/**'],
      thresholds: {
        // Every reported file must clear the gate (a below-threshold file fails
        // the run even when the aggregate is above it).
        perFile: true,
        'src/engine/**': { lines: 85, branches: 75 },
        'src/state/**': { lines: 80 },
      },
    },
  },
  resolve: {
    alias: {
      '@engine': new URL('./src/engine', import.meta.url).pathname,
      '@state': new URL('./src/state', import.meta.url).pathname,
      '@ui': new URL('./src/ui', import.meta.url).pathname,
    },
  },
})
