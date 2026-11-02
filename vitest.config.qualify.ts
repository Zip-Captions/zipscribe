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
//
// Registered suites:
//   qualify/model-eval/**  — unit-02 [RQ] criteria (CC-02.1/.2/.3/.4/.7/.8/
//       .9/.11), fast artifact audits (the frozen CC-02.5 `pnpm qualify` leg
//       in tests/unit/model-eval/qualify-runner.test.ts runs this config
//       inside a 150 s spawn budget — keep every always-on test fast).
//   qualify/asr/memory-gate.test.ts  — CC-05.1 `[RQ]`: 120-min run within
//       the memory gate (T2+tiny JS-heap < 1 GB on the COOP/COEP isolated
//       path; T1+default-model GPU-process memory under the unit-02 recycle
//       ceiling via the unit-02 out-of-band sampler).
//   qualify/asr/golden-wer.test.ts   — CC-05.6 `[RQ]`: golden WER with the
//       DEFAULT model (en-clean / fr-clean `language:'fr'` ≤ spike baseline
//       + 2 pts, baselines READ from docs/spikes/model-eval-report.json).
// The unit-05 suites EXECUTE their hour-long measurements only under
// `ZIPSCRIBE_QUALIFY_MEASURE=1` (the release flow:
// `ZIPSCRIBE_QUALIFY_MEASURE=1 pnpm qualify` on reference hardware); without
// the flag their measurement tests skip and only the fast preflight audits
// run — keeping this config completable inside the CC-02.5 leg's budget.
// Their measured-vs-threshold rows land in
// `qualification/unit-05-measurements.json` (record schema per conventions
// § Release qualification; unmeasurable → ok:false + null + reason).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Same source aliases as vitest.config.ts (the suites read the unit-03
    // registry — TIER_DEFAULT_MODEL — for the DEFAULT-model baseline).
    alias: {
      '@engine': new URL('./src/engine', import.meta.url).pathname,
      '@state': new URL('./src/state', import.meta.url).pathname,
      '@ui': new URL('./src/ui', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['qualify/**/*.test.ts'],
    // Artifact readers only; serial keeps ordering deterministic and mirrors
    // the main config's discipline.
    fileParallelism: false,
    sequence: { concurrent: false },
    // Default budget for the fast audits; the unit-05 measurement tests set
    // their own multi-hour timeouts (test-level overrides).
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
