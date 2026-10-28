// Adversarial suite (fresh-session red-team of unit-01): engine purity must
// reject React/SDK use at the lint level through the module-resolution forms a
// developer actually writes — including dynamic `import()`.
//
// Contract sources:
// - unit-01 FR-1.0.5: "For src/engine/**: no-restricted-imports blocks react,
//   react-dom and SDK packages outside **/adapters/**; no-restricted-globals
//   blocks document, window, localStorage".
// - unit-01 CC-01.3: "src/engine/** files reject React/DOM imports at lint level".
// - `.agent/AGENTS.md` § Engine purity: "src/engine/** is framework-agnostic
//   TypeScript: no React imports".
// - Official docs (https://eslint.org/docs/latest/rules/no-restricted-imports):
//   "This rule applies to static imports only, not dynamic ones" — so the core
//   rule cannot be the backstop for `import('react')`, and the custom plugin in
//   scripts/eslint-engine-purity.mjs only listens on Import/Export declarations.
import { describe, expect, test } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { REPO_ROOT } from '../../helpers/repo'

const PROBE_DIR = join(REPO_ROOT, 'src/engine/__lint-probe-adversarial__')

const FILES = {
  'dynamic-react.ts': `export async function mount(): Promise<number> {\n  const react = await import('react')\n  return typeof react === 'object' ? 1 : 0\n}\n`,
  'dynamic-sdk.ts': `export async function load(): Promise<unknown> {\n  return import('mediabunny')\n}\n`,
  'reexport-react.ts': `export * from 'react'\n`,
  'type-only-react.ts': `import type { ReactNode } from 'react'\nexport function render(node: ReactNode): ReactNode {\n  return node\n}\n`,
  'globalthis-dom.ts': `export function probeWindow(): number {\n  return globalThis.window ? 1 : 0\n}\nexport function probeDocument(): number {\n  return self.document ? 1 : 0\n}\n`,
} as const

function writeProbes(): void {
  rmSync(PROBE_DIR, { recursive: true, force: true })
  mkdirSync(PROBE_DIR, { recursive: true })
  for (const [name, source] of Object.entries(FILES)) {
    writeFileSync(join(PROBE_DIR, name), source)
  }
}

async function lint(): Promise<Map<string, string[]>> {
  const eslint = new ESLint({ cwd: REPO_ROOT })
  const results = await eslint.lintFiles(Object.keys(FILES).map((name) => join(PROBE_DIR, name)))
  const messages = new Map<string, string[]>()
  for (const result of results) messages.set(result.filePath, result.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`))
  return messages
}

describe('adversarial: engine-purity lint bypasses', () => {
  test('ADVERSARIAL CC-01.3: dynamic import("react") in src/engine is a lint error', async () => {
    writeProbes()
    try {
      const results = await lint()
      const messages = results.get(join(PROBE_DIR, 'dynamic-react.ts')) ?? []
      expect(
        messages.filter((m) => /no-restricted-imports|restricted-imports/.test(m)),
        `await import('react') inside src/engine is lint-clean: core no-restricted-imports is documented "static imports only" (eslint.org/docs/latest/rules/no-restricted-imports) and scripts/eslint-engine-purity.mjs has no ImportExpression listener — FR-1.0.5/CC-01.3 ("no React imports") is bypassed by one await\n${JSON.stringify(messages)}`,
      ).not.toEqual([])
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
    }
  })

  test('ADVERSARIAL CC-01.3: dynamic import("mediabunny") in src/engine (outside adapters) is a lint error', async () => {
    writeProbes()
    try {
      const results = await lint()
      const messages = results.get(join(PROBE_DIR, 'dynamic-sdk.ts')) ?? []
      expect(
        messages.filter((m) => /no-restricted-imports|restricted-imports/.test(m)),
        `await import('mediabunny') inside src/engine is lint-clean: same missing ImportExpression coverage — SDK glue escapes the adapters boundary via dynamic import (FR-1.0.5)\n${JSON.stringify(messages)}`,
      ).not.toEqual([])
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
    }
  })

  test('ADVERSARIAL CC-01.3: re-export and type-only React imports stay rejected (documents covered paths)', async () => {
    writeProbes()
    try {
      const results = await lint()
      const reexport = results.get(join(PROBE_DIR, 'reexport-react.ts')) ?? []
      expect(reexport.filter((m) => /restricted/.test(m)), `export * from 'react' must be rejected — got ${JSON.stringify(reexport)}`).not.toEqual([])
      const typeOnly = results.get(join(PROBE_DIR, 'type-only-react.ts')) ?? []
      expect(typeOnly.filter((m) => /restricted/.test(m)), `import type {...} from 'react' must be rejected — got ${JSON.stringify(typeOnly)}`).not.toEqual([])
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
    }
  })

  test('ADVERSARIAL CC-01.3: DOM globals via globalThis./self. property access are rejected', async () => {
    writeProbes()
    try {
      const results = await lint()
      const messages = results.get(join(PROBE_DIR, 'globalthis-dom.ts')) ?? []
      expect(
        messages.filter((m) => /restricted-globals/.test(m)),
        `globalThis.window / self.document in src/engine are lint-clean: no-restricted-globals only checks identifier references, so property access on the global object reaches the DOM globals the engine policy bans (conventions § Architecture rules: "no DOM *globals* (document, window)"; REVIEW.md #1)\n${JSON.stringify(messages)}`,
      ).not.toEqual([])
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
    }
  })
})
