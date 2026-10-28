// CC-01.12: a test that passes only on Playwright retry fails the CI run.
//
// Runs with retries (the guarded config sets `retries: 1` in CI); the local
// flake passes on its first attempt and fails on the second, so the run ends
// with a retry-pass. The CI-visible detector must flag that and exit non-zero.
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const attempts = join(tmpdir(), 'zipscribe-retry-detection-attempts')

test('CC-01.12: local flake — passes on retry, so the run must be red', async () => {
  let count = 0
  try {
    count = Number(readFileSync(attempts, 'utf8')) || 0
  } catch {
    count = 0
  }
  writeFileSync(attempts, String(count + 1))
  expect(count, 'attempt #1 passes, attempt #2 fails (the classic retry-pass flake)').toBe(0)
})

test('CC-01.12: a genuinely passing test in the same run', () => {
  expect(1 + 1).toBe(2)
})

test('CC-01.12: the retry detector ignores ordinary passes', () => {
  expect('zipscribe').toContain('scribe')
})