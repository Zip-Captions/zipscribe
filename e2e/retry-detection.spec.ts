// CC-01.12: a test that passes only on Playwright retry fails the CI run.
//
// Runs with retries (the guarded config sets `retries: 1` in CI); the local
// flake fails on its first attempt and passes on the retry, so the run ends
// with a retry-pass. The CI-visible detector must flag that and exit non-zero.
import { test, expect } from '@playwright/test'

test('CC-01.12: local flake — passes on retry, so the run must be red', async ({}, testInfo) => {
  // Attempt 1: retry === 0 → fails. Retry: retry === 1 → passes. A run where
  // this test is "passed" yet retried is the retry-pass the detector bans.
  expect(testInfo.retry, 'attempt #1 fails, attempt #2 (the retry) passes').toBe(1)
})

test('CC-01.12: a genuinely passing test in the same run', () => {
  expect(1 + 1).toBe(2)
})

test('CC-01.12: the retry detector ignores ordinary passes', () => {
  expect('zipscribe').toContain('scribe')
})