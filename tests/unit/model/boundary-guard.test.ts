// FR-03.5 / AGENTS engine-purity (unit-03 Risks: "Engine-specific import
// shapes leaking into the pipeline → boundary lint test").
//
// Static scan: NO file under `src/engine/**` may import an engine SDK
// (@huggingface/transformers and friends, sherpa-onnx, cactus-needle/needle,
// onnxruntime, @ffmpeg/*, mediabunny) unless it lives under `src/engine/**/
// adapters/` — the DI seam where the manager test-suite injects fakes. This
// is the executable form of `.agent/AGENTS.md` § Engine purity for the unit-03
// SDK set and complements the eslint purity rules (defense in depth against a
// builder bypassing eslint-disable).
import { describe, expect, test } from 'vitest'
import { readText, walkFiles } from '../../helpers/repo'

const SDK_IMPORT_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: '@huggingface/transformers', pattern: /from\s+['"]@huggingface\/[^'"]+['"]|import\s*\(\s*['"]@huggingface\/[^'"]+['"]\s*\)|import\s+['"]@huggingface\/[^'"]+['"]/ },
  { name: 'transformers (bare)', pattern: /from\s+['"]transformers['"]|import\s+['"]transformers['"]/ },
  { name: 'sherpa-onnx', pattern: /from\s+['"]sherpa-onnx[^'"]*['"]|import\s*\(\s*['"]sherpa-onnx[^'"]*['"]\s*\)|import\s+['"]sherpa-onnx[^'"]*['"]/ },
  { name: 'cactus', pattern: /from\s+['"](?:@?cactus[^'"]*|needle\.wasm[^'"]*)['"]|import\s+['"](?:@?cactus[^'"]*|needle\.wasm[^'"]*)['"]/ },
  { name: 'onnxruntime', pattern: /from\s+['"]onnxruntime[^'"]*['"]|import\s*\(\s*['"]onnxruntime[^'"]*['"]\s*\)|import\s+['"]onnxruntime[^'"]*['"]/ },
  { name: '@ffmpeg/*', pattern: /from\s+['"]@ffmpeg\/[^'"]+['"]|import\s+['"]@ffmpeg\/[^'"]+['"]/ },
  { name: 'mediabunny', pattern: /from\s+['"]mediabunny[^'"]*['"]|import\s+['"]mediabunny[^'"]*['"]/ },
]

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('FR-03.5: engine SDK import boundary', () => {
  test('FR-03.5: no src/engine/** file imports an engine SDK outside **/adapters/**', () => {
    const engineFiles = walkFiles('src/engine').filter((file) => /\.(ts|tsx)$/.test(file))
    expect(engineFiles.length, 'engine sources exist').toBeGreaterThan(0)
    const violations: string[] = []
    for (const file of engineFiles) {
      if (file.includes('/adapters/')) continue
      const text = stripComments(readText(file))
      for (const sdk of SDK_IMPORT_PATTERNS) {
        if (sdk.pattern.test(text)) violations.push(`${file}: imports ${sdk.name}`)
      }
    }
    expect(violations.join('\n'), 'engine purity: SDK glue belongs in src/engine/**/adapters/ or src/workers/ (FR-03.5)').toBe('')
  })

  test('FR-03.5: the scan actually detects a violation (adversarial self-check)', () => {
    const poisoned = `import { pipeline } from '@huggingface/transformers'\nexport const x = 1\n`
    const hit = SDK_IMPORT_PATTERNS.some((sdk) => sdk.pattern.test(stripComments(poisoned)))
    expect(hit, 'the boundary scanner must catch a transformers import').toBe(true)
    const clean = `import { createModelCache } from '../cache'\n// import { pipeline } from '@huggingface/transformers' — comment only\nexport const y = 2\n`
    expect(SDK_IMPORT_PATTERNS.some((sdk) => sdk.pattern.test(stripComments(clean))), 'comments must not false-positive').toBe(false)
  })
})
