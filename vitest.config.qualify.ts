// Vitest project for the L6 release-qualification suites (`qualify/**`).
//
// Wiring (conventions.md § Testing strategy, L6 row): the default `pnpm test`
// run (vitest.config.ts) includes only `src/**` and `tests/unit/**`, so the
// qualify suites NEVER run in the per-PR pipeline. The FR-02.10 runner —
// `pnpm qualify`, unit-02 FR-02.10 — executes them on reference hardware
// (settings.yml reference_hardware), e.g.:
//
//   corepack pnpm exec vitest run --config vitest.config.qualify.ts
//
// …then records machine info + results into
// `qualification/<version>.json` per conventions § Release qualification.
// Because the suites are data-driven over `docs/spikes/**` artifacts (report,
// leak study, request logs), a re-run is a fast artifact audit, not a GPU
// benchmark — the measurements themselves are produced by the spike harness
// (FR-02.1/02.2) during the owner's qualification session.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['qualify/**/*.test.ts'],
    // Artifact readers only; serial keeps ordering deterministic and mirrors
    // the main config's discipline.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
