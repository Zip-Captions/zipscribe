// CC-01.3: `src/engine/**` rejects React/DOM at lint level.
//
// Contract source: FR-1.0.5 — for `src/engine/**`, `no-restricted-imports`
// blocks `react`, `react-dom` and SDK packages outside `**/adapters/**`;
// `no-restricted-globals` blocks `document`, `window`, `localStorage`; DOM
// *types* stay allowed (`knowledge/conventions.md` § Architecture rules).
//
// The test drives the project's own ESLint config against a throwaway source
// tree, so it proves the rules — not the absence of engine files.
import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import { REPO_ROOT } from '../../helpers/repo'

const FIXTURE_DIR = join(REPO_ROOT, 'src/engine/__lint-probe__')

const FILES = {
  'clean.ts': `export function add(a: number, b: number): number {\n  return a + b\n}\n`,
  'react-import.ts': `import { useState } from 'react'\nexport const x = typeof useState\n`,
  'react-dom-import.ts': `import { createRoot } from 'react-dom/client'\nexport const y = typeof createRoot\n`,
  'sdk-import.ts': `import { pipeline } from '@huggingface/transformers'\nexport const z = typeof pipeline\n`,
  'sdk-import-in-adapters.ts': `import { pipeline } from '@huggingface/transformers'\nexport const z = typeof pipeline\n`,
  'dom-global.ts': `export function probe(): number {\n  return document ? 1 : 0\n}\n`,
  'window-global.ts': `export function probe(): number {\n  return window ? 1 : 0\n}\n`,
  'localstorage-global.ts': `export function probe(): unknown {\n  return localStorage\n}\n`,
  'dom-types.ts': `export function scale(ctx: CanvasRenderingContext2D, factor: number): void {\n  ctx.scale(factor, factor)\n}\nexport function fileSize(file: File): number {\n  return file.size\n}\n`,
} as const

function writeProbes(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true })
  for (const [name, source] of Object.entries(FILES)) {
    const target = name === 'sdk-import-in-adapters.ts' ? join(FIXTURE_DIR, 'nested/adapters', name) : join(FIXTURE_DIR, name)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, source)
  }
}

async function lint(paths: string[]): Promise<Map<string, string[]>> {
  const lintConfig = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', 'eslint.config.cjs'].find((name) => existsSync(join(REPO_ROOT, name)))
  expect(lintConfig, 'eslint config exists at the repo root').toBeDefined()
  const eslint = new ESLint({ cwd: REPO_ROOT })
  const results = await eslint.lintFiles(paths)
  const messages = new Map<string, string[]>()
  for (const result of results) messages.set(result.filePath, result.messages.map((m) => `${m.ruleId ?? 'parse'}@${m.severity}: ${m.message}`))
  return messages
}

describe('CC-01.3: engine purity is enforced by lint', () => {
  test('CC-01.3: engine files importing react / react-dom are lint errors', async () => {
    writeProbes()
    try {
      const results = await lint([join(FIXTURE_DIR, 'react-import.ts'), join(FIXTURE_DIR, 'react-dom-import.ts')])
      for (const [file, messages] of results) {
        expect(messages.some((m) => m.startsWith('2:') && /import|restricted/i.test(m)), `${file} must be rejected by no-restricted-imports — got ${JSON.stringify(messages)}`).toBe(true)
      }
    } finally {
      rmSync(FIXTURE_DIR, { recursive: true, force: true })
    }
  })

  test('CC-01.3: engine files touching document / window / localStorage are lint errors', async () => {
    writeProbes()
    try {
      const results = await lint([join(FIXTURE_DIR, 'dom-global.ts'), join(FIXTURE_DIR, 'window-global.ts'), join(FIXTURE_DIR, 'localstorage-global.ts')])
      for (const [file, messages] of results) {
        expect(messages.some((m) => m.startsWith('2:') && /no-restricted-globals|restricted/i.test(m)), `${file} must be rejected by no-restricted-globals — got ${JSON.stringify(messages)}`).toBe(true)
      }
    } finally {
      rmSync(FIXTURE_DIR, { recursive: true, force: true })
    }
  })

  test('CC-01.3: SDK imports are rejected in engine code but allowed under **/adapters/**', async () => {
    writeProbes()
    try {
      const results = await lint([join(FIXTURE_DIR, 'sdk-import.ts'), join(FIXTURE_DIR, 'nested/adapters/sdk-import-in-adapters.ts')])
      const direct = results.get(join(FIXTURE_DIR, 'sdk-import.ts')) ?? []
      const adapter = results.get(join(FIXTURE_DIR, 'nested/adapters/sdk-import-in-adapters.ts')) ?? []
      expect(direct.some((m) => /restricted|import/i.test(m)), `src/engine must not import SDKs — got ${JSON.stringify(direct)}`).toBe(true)
      expect(adapter.filter((m) => m.endsWith('error')), `**/adapters/** may import SDKs — got ${JSON.stringify(adapter)}`).toEqual([])
    } finally {
      rmSync(FIXTURE_DIR, { recursive: true, force: true })
    }
  })

  test('CC-01.3: clean engine code and DOM types stay lint-clean', async () => {
    writeProbes()
    try {
      const results = await lint([join(FIXTURE_DIR, 'clean.ts'), join(FIXTURE_DIR, 'dom-types.ts')])
      for (const [file, messages] of results) {
        const errors = messages.filter((m) => m.startsWith('2:'))
        expect(errors, `${file} must pass — DOM types are allowed in the engine`).toEqual([])
      }
    } finally {
      rmSync(FIXTURE_DIR, { recursive: true, force: true })
    }
  })
})