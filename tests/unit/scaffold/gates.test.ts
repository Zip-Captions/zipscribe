// CC-01.1 and CC-01.5: the quality-gate commands exist and are green.
//
// The five gates are named in `.ai-dlc/settings.yml quality_gates` and are the
// contract unit-01 must satisfy. Because the gates launch Playwright/vite, this
// file runs them one at a time (`fileParallelism: false`).
import { describe, expect, test } from 'vitest'
import { exists, isChildRun, packageScripts, runPnpm } from '../../helpers/repo'

describe('CC-01.1: the five quality gate commands', () => {
  test('CC-01.1: every gate script named in settings.yml exists in package.json', () => {
    const scripts = packageScripts()
    for (const gate of ['lint', 'typecheck', 'test', 'build', 'check-bundle', 'test:e2e']) {
      expect(scripts[gate]?.trim().length ?? 0, `package.json script "${gate}"`).toBeGreaterThan(0)
    }
  })

  test('CC-01.1: `pnpm lint` exits 0', () => {
    expect(exists('eslint.config.js') || exists('eslint.config.mjs') || exists('eslint.config.ts')).toBe(true)
    const result = runPnpm('lint')
    expect(result.status, `${result.slug} exited ${result.status}\n${result.output.slice(-4000)}`).toBe(0)
  }, 300_000)

  test('CC-01.1: `pnpm typecheck` exits 0', () => {
    expect(exists('tsconfig.json')).toBe(true)
    const result = runPnpm('typecheck')
    expect(result.status, `${result.slug} exited ${result.status}\n${result.output.slice(-4000)}`).toBe(0)
  }, 300_000)

  test('CC-01.1: `pnpm test` exits 0', () => {
    // A child (this very test's own spawned suite) must not re-spawn the suite.
    if (isChildRun()) return
    // CI adaptation (orchestrator adjudication, Actions run 43358141096): the child was SIGTERM'd at the 90 s
    // spawnSync default mid-run on the CI runner (child log tail: completed files, no summary); local idle child
    // now ~50 s — the suite outgrew the 77-file/690-test era the unit-102 tuning note was written for. 240 s is
    // comfortably above the 90 s CI kill, bounded at half the parent's 600 s vitest per-test budget. This is an
    // anti-hang bound, not a quality threshold: assertions and coverage thresholds unchanged, the repo.ts default
    // (90 s) stays for every other gate call.
    const result = runPnpm('test', ['--coverage'], 240_000)
    expect(result.status, `${result.slug} exited ${result.status}\n${result.output.slice(-6000)}`).toBe(0)
  }, 600_000)

  test('CC-01.1: `pnpm build` then `pnpm check-bundle` both exit 0', () => {
    const build = runPnpm('build')
    expect(build.status, `${build.slug} exited ${build.status}\n${build.output.slice(-4000)}`).toBe(0)
    const bundle = runPnpm('check-bundle')
    expect(bundle.status, `${bundle.slug} exited ${bundle.status}\n${bundle.output.slice(-4000)}`).toBe(0)
  }, 600_000)

  test('CC-01.1: lint and typecheck exit 0 under the CI environment too', () => {
    const previous = process.env.CI
    process.env.CI = 'true'
    try {
      const lint = runPnpm('lint')
      expect(lint.status, `${lint.slug} in CI exited ${lint.status}\n${lint.output.slice(-4000)}`).toBe(0)
      const typecheck = runPnpm('typecheck')
      expect(typecheck.status, `${typecheck.slug} in CI exited ${typecheck.status}`).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.CI
      else process.env.CI = previous
    }
  }, 600_000)

  test('CC-01.5: `pnpm test:e2e` passes the chromium Playwright smoke', () => {
    expect(exists('playwright.config.ts') || exists('playwright.config.js') || exists('playwright.config.mjs')).toBe(true)
    const result = runPnpm('test:e2e', ['--project=chromium'])
    expect(result.status, `${result.slug} exited ${result.status}\n${result.output.slice(-6000)}`).toBe(0)
  }, 900_000)
})