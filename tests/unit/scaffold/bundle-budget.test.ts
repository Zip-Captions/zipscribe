// CC-01.4: `pnpm check-bundle` fails when a 400 KB-gzip chunk is injected.
//
// Contract: FR-1.0.6 — "post-build script asserting initial JS ≤ 350 KB gzip;
// lazy chunks (workers/ffmpeg/mediabunny) excluded via config manifest";
// `scripts/check-bundle.mjs` reads `dist/`, gzips initial-entry chunks and
// compares against `bundle-budget.json` (§ Technical Specification). The
// negative test injects a 400 KB-gzip dummy into the *initial* graph and
// expects a non-zero exit; a lazily imported dummy must stay under budget.
import { afterEach, describe, expect, test } from 'vitest'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, exists, isPlaceholderScript, packageScripts, readJson, runPnpm } from '../../helpers/repo'

const BUDGET_FILE = 'bundle-budget.json'
const INJECTED = 'e2e-injected-budget-probe'

function buildOnce(): void {
  if (existsSync(join(REPO_ROOT, 'dist/index.html'))) return
  const result = runPnpm('build')
  expect(result.status, `pnpm build prerequisite failed\n${result.output.slice(-4000)}`).toBe(0)
}

function entryScripts(): string[] {
  const html = readFileSync(join(REPO_ROOT, 'dist/index.html'), 'utf8')
  return [...html.matchAll(/<script[^>]*src="([^"]+\.js)"/g)].map((match) => match[1]!.replace(/^\//, ''))
}

function unusedDistFiles(): string[] {
  const dist = join(REPO_ROOT, 'dist')
  const found: string[] = []
  const stack = [dist]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else found.push(full)
    }
  }
  return found
}

function injectInitialChunk(entry: string): void {
  const incompressible = Buffer.alloc(1024 * 1024)
  for (let i = 0; i < incompressible.length; i++) incompressible[i] = (i * 2654435761) % 251
  writeFileSync(join(REPO_ROOT, entry), `import './${INJECTED}.js'\n`)
  writeFileSync(join(REPO_ROOT, 'dist', `${INJECTED}.js`), incompressible)
}

function removeInjected(): void {
  for (const file of [`dist/${INJECTED}.js`, `dist/${INJECTED}.js.map`]) {
    if (existsSync(join(REPO_ROOT, file))) rmSync(join(REPO_ROOT, file))
  }
}

describe('CC-01.4: bundle budget gate', () => {
  afterEach(() => removeInjected())

  test('CC-01.4: bundle-budget.json declares the 350 KB gzip limit for initial JS', () => {
    expect(exists(BUDGET_FILE), `${BUDGET_FILE}`).toBe(true)
    const budget = readJson<{ initialJsGzipBytes?: number; maxInitialJsGzipBytes?: number; budgetBytes?: number }>(BUDGET_FILE)
    const limit = budget.initialJsGzipBytes ?? budget.maxInitialJsGzipBytes ?? budget.budgetBytes
    expect(limit, 'a numeric initial-JS gzip budget').toBe(350 * 1024)
  })

  test('CC-01.4: check-bundle is a real script, not a placeholder', () => {
    const scripts = packageScripts()
    expect(isPlaceholderScript(scripts['check-bundle']), `check-bundle = ${scripts['check-bundle'] ?? '<missing>'}`).toBe(false)
  })

  test('CC-01.4: `pnpm check-bundle` fails when a 400 KB-gzip dummy chunk is injected into initial JS', () => {
    buildOnce()
    const entries = entryScripts()
    expect(entries.length, 'dist/index.html must reference an initial script').toBeGreaterThan(0)
    const entry = entries[0]!
    const backup = readFileSync(join(REPO_ROOT, entry))
    try {
      injectInitialChunk(entry)
      const result = runPnpm('check-bundle')
      expect(result.status, `check-bundle must exit non-zero above budget\n${result.output.slice(-3000)}`).not.toBe(0)
      expect(result.output, 'the failure must name the budget').toMatch(/350|bundle|budget|gzip|kB/i)
    } finally {
      writeFileSync(join(REPO_ROOT, entry), backup)
    }
  })

  test('CC-01.4: a lazily imported (excluded) 400 KB-gzip dummy chunk does not fail the budget', () => {
    buildOnce()
    const incompressible = Buffer.alloc(1024 * 1024)
    for (let i = 0; i < incompressible.length; i++) incompressible[i] = (i * 40503) % 251
    writeFileSync(join(REPO_ROOT, 'dist', `${INJECTED}-lazy.js`), incompressible)
    try {
      const result = runPnpm('check-bundle')
      expect(result.status, `a lazy chunk excluded by the manifest must not trip the budget\n${result.output.slice(-3000)}`).toBe(0)
    } finally {
      removeInjected()
      rmSync(join(REPO_ROOT, 'dist', `${INJECTED}-lazy.js`), { force: true })
    }
  })

  test('CC-01.4: the real build stays within the declared budget', () => {
    buildOnce()
    const result = runPnpm('check-bundle')
    expect(result.status, `check-bundle on the real build\n${result.output.slice(-3000)}`).toBe(0)
  })
})