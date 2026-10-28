// CC-01.12: a test that passes only on Playwright retry fails the CI run.
//
// Contract: FR-1.0.12 — "Playwright `retries: 1` with retry-pass detection that
// fails the run"; `knowledge/conventions.md` § Coverage and flakiness — "any
// test that passed only on retry … blocks merge". The hook is Playwright's
// `test:result` fixture of the base reporter, which unit-01 must wrap in
// `playwright.config.ts`.
//
// The behavioural negative test lives in `e2e/retry-detection.spec.ts` (it
// needs the real Playwright runner).
import { describe, expect, test } from 'vitest'
import { exists, readText, runCommand } from '../../helpers/repo'

describe('CC-01.12: retry-pass detection is wired into Playwright', () => {
  test('CC-01.12: every Playwright config sets retries and installs the retry-pass hook', () => {
    const configs = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].filter((file) => exists(file))
    expect(configs.length, 'playwright.config.* at the repo root').toBeGreaterThan(0)
    const config = configs.map((file) => readText(file)).join('\n')
    expect(config, 'retries must be configured (1 in CI)').toMatch(/retries\s*:/)
    expect(config, "the base reporter's test:result / onTestEnd hook").toMatch(/onTestEnd|test:result/)
  })

  test('CC-01.12: the guarded e2e command exits non-zero when a test passed only on retry', () => {
    // `playwright test e2e/retry-detection.spec.ts` runs the three-test fixture:
    // one flake (pass → fail) plus two honest passes. The retry detector must
    // turn that into a red run.
    const result = runCommand('corepack', ['pnpm', 'exec', 'playwright', 'test', 'e2e/retry-detection.spec.ts', '--project=chromium'], { timeoutMs: 120_000 })
    expect(result.output, 'the fixture must actually execute through the real config').toContain('retry-detection')
    expect(result.status, `a retry-pass must fail the run\n${result.output.slice(-4000)}`).not.toBe(0)
  })
})