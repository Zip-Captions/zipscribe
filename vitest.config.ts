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
    // `isChildRun()` check on its recursive test). gates.test invokes
    // `runPnpm('test', ['--coverage'])` under the frozen 30 s runPnpm budget
    // (tests/helpers/repo.ts), so the child must be the command-wiring proof
    // plus a fast representative subset — files that RE-SPAWN full gate
    // commands (build/preview/playwright/fixtures regeneration/verify:unit) or
    // pay multi-second cold analyzer inits are pointless to duplicate inside
    // a time-boxed child and are measured red there on the 2-core CI runner
    // (CI run 40653032195: child at 30 s had not passed file 6). Each file
    // below is still executed in the authoritative runs of the very same CI
    // step: the parent `pnpm test --coverage` invocation and the
    // `verify:unit` run (whose runner clears ZIPSCRIBE_CHILD). Measured child
    // wall times (local / CI): retry-detection 13.8/≈20 s (spawns a full
    // `playwright test` child), network-audit 6.5/11.7 s (spawns pnpm build +
    // vite previews + chromium), engine-purity pair 4.8/≈13 s (type-aware
    // ESLint cold init per file), fixtures-pipeline 3.8/≈8 s (spawns `pnpm
    // fixtures` + `fixtures:verify` in scratch), verify-criteria pair 3/≈5 s
    // (spawns the verify:unit tool). Proper fix is widening the frozen child
    // timeout (builder Follow-ups "frozen-helper fragility"; test-author
    // backlog) — not done here because tests/helpers/repo.ts is frozen.
    exclude:
      process.env.ZIPSCRIBE_CHILD === '1'
        ? [
            '**/gates.test.ts',
            '**/network-audit.test.ts',
            '**/retry-detection.test.ts',
            '**/fixtures-pipeline.test.ts',
            '**/engine-purity.test.ts',
            '**/engine-purity-adversarial.test.ts',
            '**/verify-criteria.test.ts',
            '**/verify-criteria-adversarial.test.ts',
            // unit-02 per-PR contract tests spawn gate commands
            // (`pnpm qualify`, `node tools/eval/wer.mjs`,
            // `node scripts/qualification-check.ts`) — same child-safety rule.
            '**/qualify-runner.test.ts',
            '**/wer-golden.test.ts',
            // unit-02 adversarial additions (same child-safety rule): the
            // qualification-check probes spawn the CI job repeatedly and the
            // fabrication probes run scratch qualify suites (chromium +
            // vitest) — far beyond the 30 s child budget.
            '**/wer-cli-adversarial.test.ts',
            '**/qualification-check-adversarial.test.ts',
            '**/qualify-pipeline-fabrication-adversarial.test.ts',
            // unit-03 (CC-03.8): the scoped engine/model coverage gate spawns
            // a nested `vitest run` — same child-safety rule as coverage-gate.
            '**/model-coverage.test.ts',
            // unit-04 (CC-04.14): the scoped engine/audio coverage gate spawns
            // a nested `vitest run` — same child-safety rule as coverage-gate.
            '**/media-coverage.test.ts',
            // unit-04 (CC-04.12, RED phase): the worker wiring proof fails
            // until the builder replaces the unit-01 stub, so it cannot sit in
            // the gate-spawning child (its failure would mask the wiring
            // proof). It runs in the parent and in `verify:unit`, which clears
            // ZIPSCRIBE_CHILD. Retire this entry when unit-04 goes green.
            '**/media-worker-wiring.test.ts',
            // The unit-04 audio suites import `@engine/audio/*` modules that do
            // not exist yet (RED phase); inside the child's 30 s
            // representative-subset run their import errors would mask the
            // command-wiring proof. They execute in the parent suite and in
            // `verify:unit`/CI. Retire this block when unit-04 goes green.
            'tests/unit/audio/**/*.test.ts',
            // (unit-03's five contract suites were excluded here while the
            // unit was RED. Retired at review round 1, F7: they spawn nothing
            // and the set runs in 0.5 s, so the child now executes them and a
            // total break of the unit-03 contract is visible to the
            // command-wiring proof too.)
            // unit-04 CI (run 41151907753): the child died at the frozen 30 s
            // runPnpm budget (`exited null`) once unit-04's provider suites
            // filled the serial file stream. Same child-safety rule as the
            // gate-spawning scaffold pair — these five SPECTATOR suites spawn
            // ESLint (eslint-plugin-adversarial) or scratch git worktrees +
            // the verify-criteria tool (the four verify/* suites); they
            // contribute no src/engine or src/state coverage (the providers
            // are the src-adjacent and *-internals suites, all retained).
            // They execute in the parent `pnpm test` and in `verify:unit`,
            // which clears ZIPSCRIBE_CHILD.
            '**/eslint-plugin-adversarial.test.ts',
            '**/e2e-provenance-adversarial.test.ts',
            '**/verify-criteria-junit-adversarial.test.ts',
            '**/verify-criteria-e2e-backing.test.ts',
            '**/verify-criteria-junit-distrust.test.ts',
            // Same budget incident, second lever: with the unit-04 audio
            // provider suites in, the serial (fileParallelism:false) child
            // measured 15.0 s local / >30 s CI (killed, exited null). The
            // ten remaining SPECTATOR scaffold suites cost 3.9 s local
            // (~8 s CI) and provide no src/engine or src/state coverage —
            // providers-only (src/** + tests/unit/model/*-internals) is a
            // 9.5 s local child with thresholds green (unit-03 precedent:
            // relocated internals clear perFile 85/75 alone). They run in
            // the parent `pnpm test` and in `verify:unit` (clears CHILD).
            // The unit-03 F7 intent (frozen contract suites visible to the
            // command-wiring proof) is preserved: all tests/unit/model
            // suites stay in the child.
            '**/tests/unit/scaffold/fixtures.test.ts',
            '**/tests/unit/scaffold/licenses.test.ts',
            '**/tests/unit/scaffold/models-fetch.test.ts',
            '**/tests/unit/scaffold/redaction.test.ts',
            '**/tests/unit/scaffold/redaction-adversarial.test.ts',
            '**/tests/unit/scaffold/contract-verbatim.test.ts',
            '**/tests/unit/scaffold/bundle-budget.test.ts',
            '**/tests/unit/scaffold/bundle-budget-adversarial.test.ts',
            '**/tests/unit/scaffold/branch-policy.test.ts',
            '**/tests/unit/scaffold/coverage-gate.test.ts',
            ...defaultExclude,
          ]
        : defaultExclude,
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
