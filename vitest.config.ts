import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test-only configuration. The product config (shared with `pnpm build`) is
// `vite.config.ts`, owned by the builder; this file must stay valid with or
// without it (unit-01 is authored before any implementation exists).
//
// Notes:
// - Node is the default environment; DOM tests opt in per file with
//   `// @vitest-environment jsdom`.
// - `sequence.concurrent` lets the tests that shell out to gate commands
//   (`pnpm lint`, `pnpm test:e2e`, …) run side by side: `spawnSync` blocks only
//   its worker thread, and the scaffold files' test bodies are independent.
// - Coverage thresholds mirror `.ai-dlc/settings.yml` § coverage. They are off
//   for a bare `vitest run`: unit-01 has no engine logic yet, so there is
//   nothing to measure. `pnpm test --coverage` — CC-01.11 — turns the gate on;
//   once unit-02+ land engine/state code the `enabled: false` line goes away.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    // The gate-spawning scaffold tests mutate shared state (`dist/`, `src/`
    // probes, scratch previews) and shell out to build/e2e commands — files
    // must not overlap (gates.test.ts documents the same expectation).
    fileParallelism: false,
    sequence: {
      concurrent: true,
    },
    hookTimeout: 30_000,
    coverage: {
      // Opt-in until there is engine/state code to measure (see above).
      enabled: false,
      provider: 'v8',
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