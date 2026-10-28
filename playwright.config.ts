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
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['./scripts/retry-pass-reporter.mjs']],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    trace: 'off',
  },
  webServer: {
    command: 'corepack pnpm run build && corepack pnpm run preview -- --port 4310 --strictPort',
    url: 'http://127.0.0.1:4310',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: probeRequested ? undefined : /retry-detection\.spec\.ts/,
    },
    {
      // Present but skipped by default (FR-1.0.4) — "webkit = view/export
      // tier", enabled per-unit once those specs exist.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: process.env.E2E_WEBKIT ? undefined : /.*/,
    },
  ],
})
