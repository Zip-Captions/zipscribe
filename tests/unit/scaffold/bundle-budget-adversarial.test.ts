// Adversarial suite (fresh-session red-team of unit-01): check-bundle must fail
// for ANY statically-reachable initial JS above the budget — the exclusion is
// for lazy chunks only.
//
// Contract sources:
// - `.ai-dlc/settings.yml` quality_gates bundle_budget rule: "initial JS ≤ 350 KB
//   gzip; models/wasm/ffmpeg/mediabunny/export **lazy-loaded and excluded**" —
//   exclusion is conditional on being lazy-loaded.
// - unit-01 CC-01.4: "check-bundle fails when a 400 KB-gzip dummy chunk is
//   injected (negative test)".
// - scripts/check-bundle.mjs own header: the initial set is "scripts referenced
//   by dist/index.html plus their static (analyzable) imports".
import { afterAll, describe, expect, test } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT, runPnpm } from '../../helpers/repo'

const PROBE = 'zipscribe-adv-budget-probe'

function buildOnce(): void {
  if (existsSync(join(REPO_ROOT, 'dist/index.html'))) return
  const result = runPnpm('build')
  expect(result.status, `pnpm build prerequisite failed\n${result.output.slice(-4000)}`).toBe(0)
}

function entryScripts(): string[] {
  const html = readFileSync(join(REPO_ROOT, 'dist/index.html'), 'utf8')
  return [...html.matchAll(/<script[^>]*src="([^"]+\.js)"/g)].map((match) => match[1]!.replace(/^\//, ''))
}

function incompressible(): Buffer {
  // Deterministic but high-entropy: the earlier `(i * 2654435761) % 251`
  // pattern has period 251 and gzips 1 MB down to ~4 KB, which let even a
  // correct walker stay under the 350 KB budget and hid the breach this probe
  // exists to demonstrate. A 64-bit LCG produces near-incompressible bytes.
  const buf = Buffer.alloc(1024 * 1024)
  let state = 0x9e3779b97f4a7c15n
  for (let i = 0; i < buf.length; i++) {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn
    buf[i] = Number((state >> 33n) & 0xffn)
  }
  return buf
}

const created: string[] = []
function created_(file: string): string {
  created.push(file)
  return file
}
afterAll(() => {
  for (const file of created.splice(0)) rmSync(file, { force: true })
})

describe('adversarial: initial-graph chunks must count regardless of name or syntax', () => {
  test('ADVERSARIAL CC-01.4: a statically-imported 400 KB-gzip chunk whose name matches excludePatterns still trips the budget', () => {
    buildOnce()
    const entry = entryScripts()[0]!
    const backup = readFileSync(join(REPO_ROOT, entry))
    // Name carries "worker" AND "mediabunny" — two bundle-budget.json
    // excludePatterns substrings. The chunk is NOT lazy: the entry statically
    // imports it (spaceful `import './x.js'` form — the form check-bundle's
    // walker does recognize), so it is initial JS the browser loads before the
    // app runs. settings.yml excludes lazy chunks, not name-matching chunks.
    const probeName = `${PROBE}-worker-mediabunny.js`
    try {
      writeFileSync(created_(join(REPO_ROOT, 'dist', 'assets', probeName)), incompressible())
      writeFileSync(join(REPO_ROOT, entry), `${backup.toString('utf8')}\nimport './${probeName}'\n`)
      const result = runPnpm('check-bundle')
      expect(
        result.status,
        `check-bundle exited ${result.status}: a statically-imported ~1 MB-gzip chunk named "*worker*"/"*mediabunny*" slipped the budget because excludePatterns matches chunk names, not laziness (settings.yml bundle_budget rule binds exclusion to "lazy-loaded")\n${result.output.slice(-3000)}`,
      ).not.toBe(0)
    } finally {
      writeFileSync(join(REPO_ROOT, entry), backup)
      rmSync(join(REPO_ROOT, 'dist', 'assets', probeName), { force: true })
    }
    // Self-check: the gate is green again once the injection is removed.
    const clean = runPnpm('check-bundle')
    expect(clean.status, `gate must pass on the restored build\n${clean.output.slice(-2000)}`).toBe(0)
  })

  test('ADVERSARIAL CC-01.4: a minified static import (vite/rollup emitted form) is counted in the initial graph', () => {
    buildOnce()
    const entry = entryScripts()[0]!
    const backup = readFileSync(join(REPO_ROOT, entry))
    // `import{a}from"./x.js"` (no whitespace around braces/from) is EXACTLY the
    // form vite 7 production builds emit for static cross-chunk imports —
    // reproduced with a scratch `vite build` whose shared chunk is imported by
    // a dynamic chunk: output contained `import{h as e}from"./index-….js"`.
    // check-bundle's staticImport regex demands `\sfrom`, so such imports are
    // neither counted nor flagged as tampering: any size of initial JS escapes
    // the budget silently — and a dangling import no longer trips the
    // "broken or tampered bundle" fail either.
    try {
      writeFileSync(created_(join(REPO_ROOT, 'dist', 'assets', `${PROBE}-chain.js`)), `export const a = 1\nimport{b}from'./${PROBE}-payload.js'\n`)
      writeFileSync(created_(join(REPO_ROOT, 'dist', 'assets', `${PROBE}-payload.js`)), incompressible())
      writeFileSync(join(REPO_ROOT, entry), `${backup.toString('utf8')}\nimport{a}from'./${PROBE}-chain.js'\n`)
      const result = runPnpm('check-bundle')
      expect(
        result.status,
        `check-bundle exited ${result.status}: static imports in vite's emitted minified form \`import{a}from"…"\` are invisible to the graph walker (regex requires "\\sfrom") — initial JS can grow unbounded or reference missing chunks without any failure\n${result.output.slice(-3000)}`,
      ).not.toBe(0)
    } finally {
      writeFileSync(join(REPO_ROOT, entry), backup)
      rmSync(join(REPO_ROOT, 'dist', 'assets', `${PROBE}-chain.js`), { force: true })
      rmSync(join(REPO_ROOT, 'dist', 'assets', `${PROBE}-payload.js`), { force: true })
    }
  })
})
