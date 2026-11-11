import { defineConfig, devices } from '@playwright/test'

// FR-1.0.4 / FR-1.0.12. chromium is first-class; the webkit project exists but
// every spec is skipped by default (enabled per-unit with E2E_WEBKIT=1).
// FR-1.0.12: `retries: 1` in CI plus a retry-pass detector — the base
// reporter's `onTestEnd` hook (wrapped by scripts/retry-pass-reporter.mjs)
// turns "passed only on retry" into a red run (conventions § flake policy).

// The retry-detection fixture is the detector's own negative test and is
// invoked explicitly by name (`playwright test e2e/retry-detection.spec.ts`)
// by tests/unit/scaffold/retry-detection.test.ts; it must not run — and must
// not red-flag — an ordinary `pnpm test:e2e` sweep.
const probeRequested = process.argv.some((arg) => arg.includes('retry-detection'))

export default defineConfig({
  testDir: './e2e',
  // Builder extension (unit-03): tests inside ONE file share one worker, so a
  // spec that owns a fixed-port local server (e2e/model/model-cache.spec.ts
  // spawns vite on 4311 in beforeAll and closes it in afterAll — unit-02
  // orphan-server doctrine) cannot have a sibling test kill its only live
  // server from another worker's afterAll. Cross-file parallelism stays.
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['./scripts/retry-pass-reporter.mjs']],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    trace: 'off',
  },
  // Builder extension (unit-06 closeout): 4315 is shared by FOUR spec files
  // (e2e/diarization ×3 + e2e/captions/align-mae.spec.ts). The unit-03
  // per-file-worker doctrine does not help cross-file port ownership: when a
  // sibling worker's strictPort spawn dies with EADDRINUSE, the next
  // startHarnessServer probe is answered by the FIRST spec's vite — and that
  // spec's afterAll then kills the server under the still-running sibling
  // (observed as `media worker error: undefined`, i.e. a dead Worker-script
  // fetch). A single persistent harness vite, owned by the runner for the
  // whole session, makes every spec-spawn a no-op (child exits EADDRINUSE,
  // probe answers from the live server, stopHarnessServer returns early on the
  // dead child) and removes the kill race without touching any frozen spec.
  webServer: [
    {
      command: 'corepack pnpm run build && corepack pnpm run preview -- --port 4310 --strictPort',
      url: 'http://127.0.0.1:4310',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'corepack pnpm exec vite --config e2e/diarization/fixtures/vite.harness.config.ts --port 4315 --strictPort',
      url: 'http://127.0.0.1:4315/e2e/diarization/fixtures/harness.html',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The memory specs belong to the `memory` project alone: they own a
      // spec-spawned server on 4312, so a second project matching them would
      // race that port. (testMatch unset here would otherwise match all of
      // ./e2e.)
      testIgnore: [probeRequested ? undefined : /retry-detection\.spec\.ts/, /memory\/.*\.spec\.ts/].filter((re) => re !== undefined),
    },
    {
      // Present but skipped by default (FR-1.0.4) — "webkit = view/export
      // tier", enabled per-unit once those specs exist.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      // Same 4312 race guard as chromium once webkit is enabled.
      testIgnore: process.env.E2E_WEBKIT ? [/memory\/.*\.spec\.ts/] : [/.*/],
    },
    {
      // CC-04.9 (unit-04): the 120-min decode memory gate (settings.yml
      // testing.memory_tests). It needs COOP/COEP
      // (`performance.measureUserAgentSpecificMemory()`), which the root
      // preview (4310, production parity) must never send — and Playwright
      // 1.64.1's per-project `webServer` is declared in the types but the
      // runner only starts the ROOT webServer
      // (webServerPluginsForConfig iterates the root config's webServers),
      // so a per-project server would be dead config. The spec instead owns
      // the isolated preview itself: `pnpm preview:isolated`
      // (ZIPSCRIBE_ISOLATED=1 → vite.config.ts COOP/COEP headers) on port
      // 4312, spawned in beforeAll and killed in afterAll — the same
      // spec-owned-server doctrine as e2e/model/model-cache.spec.ts (4311);
      // scripts/preview.mjs preempts stale holders of its own port and tears
      // down its ancestor chain, so a killed runner cannot orphan 4312.
      // `channel: 'chromium'` is required, not cosmetic: Playwright's
      // headless-shell binary (its default headless build) does not expose
      // `performance.measureUserAgentSpecificMemory()` (SecurityError
      // "not available" even cross-origin isolated); the full Chromium
      // browser in new-headless mode does. CI installs it with the pinned
      // `playwright install --with-deps chromium`.
      name: 'memory',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
      testMatch: /memory\/.*\.spec\.ts/,
      // Heap gates measure the USER AGENT footprint — a sibling spec's
      // workload is measurement contamination. Measured on reference
      // hardware (2026-11-09): CC-05.2 passes alone (8.5 min, inside the
      // limit) but peaked 870.3 MB (limit 100) with the 120-min decode spec
      // running as its sibling — the recycle test hook's
      // fast cadence cannot drain terminated worker heaps while the other
      // core pins GC with decode pressure. Same "single owner" doctrine as
      // the spec-owned ports: these specs measure alone or not at all.
      // (CI history: gh run 42633403941 931.5 MB — same shape.)
      workers: 1,
    },
  ],
})
