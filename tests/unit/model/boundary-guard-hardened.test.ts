// FR-03.5 (hardened, unit-03 adversary finding 2): the frozen
// `boundary-guard.test.ts` matches literal specifiers only, so
// `await import('@huggingface/' + 'transformers')` evaded it. This suite runs
// the hardened scanner (tests/unit/model/boundary-scan.ts — the executable
// mirror of the AST rule in scripts/eslint-engine-purity.mjs) over the REAL
// engine tree on every `pnpm test`, and pins the scanner's own semantics with
// positive and negative probes. Defense-in-depth per the unit-03 Risks item
// ("boundary lint test"), against a builder bypassing eslint-disable.
import { describe, expect, test } from 'vitest'
import { scanEngineSource } from './boundary-scan'
import { readText, walkFiles } from '../../helpers/repo'

const sdkViolations = (code: string) => scanEngineSource(code).filter((v) => v.rule !== 'framework-import')

describe('FR-03.5 hardened: engine SDK boundary (dynamic-import evasion closed)', () => {
  test('FR-03.5: the real src/engine/** tree is clean under the hardened scanner', () => {
    const engineFiles = walkFiles('src/engine').filter((file) => /\.(ts|tsx)$/.test(file))
    expect(engineFiles.length, 'engine sources exist').toBeGreaterThan(0)
    const violations: string[] = []
    for (const file of engineFiles) {
      const sdkAllowed = file.includes('/adapters/')
      for (const v of scanEngineSource(readText(file), { sdkAllowed })) {
        violations.push(`${file}:${v.line}: ${v.rule} — ${v.detail}`)
      }
    }
    expect(violations.join('\n'), 'engine purity: SDK glue belongs in src/engine/**/adapters/ or src/workers/ (FR-03.5)').toBe('')
  })

  test('FR-03.5: split-literal and template dynamic SDK imports are REJECTED (the characterized evasion)', () => {
    const probes: [string, string][] = [
      ['concatenated specifier', "export async function load(): Promise<unknown> {\n  return await import('@huggingface/' + 'transformers')\n}\n"],
      ['static template specifier', "export async function load(): Promise<unknown> {\n  return await import(`@huggingface/${'transformers'}`)\n}\n"],
      ['sherpa split', "export async function load(): Promise<unknown> {\n  return await import('sherpa-' + 'onnx')\n}\n"],
      ['cactus split in array join', "export async function load(): Promise<unknown> {\n  const parts = ['cac', 'tus'].join('')\n  return await import(parts)\n}\n"],
    ]
    for (const [label, code] of probes) {
      const violations = sdkViolations(code)
      expect(violations.length, `hardened scanner must reject the ${label}`).toBeGreaterThan(0)
      expect(violations.every((v) => v.rule === 'sdk-obfuscated-dynamic-import' || v.rule === 'non-static-dynamic-import'), `${label}: rejection must come from the dynamic-import rules`).toBe(true)
    }
  })

  test('FR-03.5: non-literal dynamic-import specifiers are rejected outside allowed dirs (non-static → violation)', () => {
    const probes: [string, string][] = [
      ['bare variable', "const p: string = ''\nexport async function load(): Promise<unknown> {\n  return await import(p)\n}\n"],
      ['member expression', "export async function load(cfg: { pkg: string }): Promise<unknown> {\n  return await import(cfg.pkg)\n}\n"],
      ['function-computed', "function pkg(): string {\n  return ''\n}\nexport async function load(): Promise<unknown> {\n  return await import(pkg())\n}\n"],
      ['mixed concat with variable', "declare const tail: string\nexport async function load(): Promise<unknown> {\n  return await import('@ffmpeg/' + tail)\n}\n"],
    ]
    for (const [label, code] of probes) {
      const violations = scanEngineSource(code).filter((v) => v.rule === 'non-static-dynamic-import' || v.rule === 'sdk-obfuscated-dynamic-import')
      expect(violations.length, `non-literal dynamic import (${label}) must be a violation even when no SDK name is provable`).toBeGreaterThan(0)
    }
  })

  test('FR-03.5: legitimate forms stay GREEN (precision — no prose/string false positives)', () => {
    const clean = [
      `import { createModelCache } from '../cache'`,
      `import type { Device } from '@engine/protocol'`,
      `// import { pipeline } from '@huggingface/transformers' — comment only, must not fire`,
      `/* await import('sherpa-onnx') in a block comment */`,
      `export const repo = 'https://huggingface.co/onnx-community/whisper-tiny'`,
      `export const kind = 'transformers-whisper' as const`,
      `export async function lazy(): Promise<unknown> {\n  return await import('./registry')\n}`,
      `export function talk(): string {\n  return 'we import(model) from the cache' // prose\n}`,
    ].join('\n')
    expect(scanEngineSource(clean)).toEqual([])
  })

  test('FR-03.5: **/adapters/** keeps its allowance — SDK imports are fine there, framework reconstitutions are not', () => {
    const legitAdapter = [
      `export async function loadSdk(): Promise<unknown> {\n  return await import('@huggingface/transformers')\n}`,
      `export async function loadSplit(): Promise<unknown> {\n  return await import('@huggingface/' + 'transformers')\n}`,
      `const p: string = ''\nexport async function loadVar(): Promise<unknown> {\n  return await import(p)\n}`,
    ].join('\n')
    expect(scanEngineSource(legitAdapter, { sdkAllowed: true }), 'adapter dirs may use the SDKs any way they like').toEqual([])
    const reactInAdapter = `export async function mount(): Promise<unknown> {\n  return await import('re' + 'act')\n}`
    expect(scanEngineSource(reactInAdapter, { sdkAllowed: true }).some((v) => v.rule === 'framework-import'), 'framework imports stay banned in adapters dirs').toBe(true)
  })

  test('FR-03.5: static SDK imports outside allowed dirs keep being rejected (frozen-guard coverage mirrored)', () => {
    const probes: string[] = [
      `import { pipeline } from '@huggingface/transformers'\n`,
      `import type { env } from '@huggingface/transformers'\n`,
      `export async function load(): Promise<unknown> {\n  return import('mediabunny')\n}\n`,
      `import 'sherpa-onnx'\n`,
    ]
    for (const code of probes) {
      expect(sdkViolations(code).length, `static/literal SDK form must be rejected:\n${code}`).toBeGreaterThan(0)
    }
  })
})
