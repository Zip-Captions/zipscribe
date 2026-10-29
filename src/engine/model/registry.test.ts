// L1 module tests for the model registry (FR-03.1). The acceptance gate for
// CC-03.1 is the frozen suite `tests/unit/model/registry.test.ts` (pins vs
// models/eval-registry.json, tier coverage); these are the source-adjacent
// unit tests required by knowledge/conventions.md for every engine module —
// they also keep the module covered in child runs where the frozen suites are
// excluded (vitest.config child-safety list).
import { describe, expect, test } from 'vitest'
import { ENGINE_KINDS, MODEL_REGISTRY, TIER_DEFAULT_MODEL, getModel, modelFileUrl } from './registry'
import type { ModelSpec } from './registry'

describe('model registry (FR-03.1)', () => {
  test('engine kinds cover the three spike engines', () => {
    expect([...ENGINE_KINDS].sort()).toEqual(['cactus-whistle', 'sherpa-wasm', 'transformers-whisper'])
  })

  test('tier defaults resolve to existing rows with the spike engines (CC-02.11 recommendation)', () => {
    const expected: Record<'T1' | 'T2' | 'T3', { engine: string; engineKind: string }> = {
      T1: { engine: 'whisper-base', engineKind: 'transformers-whisper' },
      T2: { engine: 'zipformer', engineKind: 'sherpa-wasm' },
      T3: { engine: 'whistle', engineKind: 'cactus-whistle' },
    }
    for (const [tier, want] of Object.entries(expected)) {
      const id = TIER_DEFAULT_MODEL[tier as 'T1' | 'T2' | 'T3']
      const spec = getModel(id)
      expect(spec, `${tier} default ${id} exists`).toBeDefined()
      expect(spec?.id, `${tier} default id is its registry key`).toBe(id)
      expect(spec?.engine, `${tier} default engine`).toBe(want.engineKind)
      expect(id).toContain(want.engine)
    }
  })

  test('getModel returns undefined for unknown ids', () => {
    expect(getModel('no-such-model@00000000')).toBeUndefined()
  })

  test('modelFileUrl pins the revision — never main (FR-03.6)', () => {
    const spec = getModel(TIER_DEFAULT_MODEL.T1) as ModelSpec
    const url = modelFileUrl(spec, spec.files[0] as (typeof spec.files)[number])
    expect(url).toBe(`https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${spec.files[0]?.path}`)
    expect(url).not.toMatch(/\/resolve\/(main|master)\//)
  })

  test('every row is self-consistent: key === id, approxBytes covers files, enrichment typed (FR-03.1)', () => {
    for (const [key, spec] of Object.entries(MODEL_REGISTRY)) {
      expect(key, `${spec.id}: registry key equals id`).toBe(spec.id)
      expect(spec.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(spec.languages.length).toBeGreaterThan(0)
      expect(spec.runtimeWasm.length, `${spec.id}: engine runtime assets listed (FR-03.8)`).toBeGreaterThan(0)
      expect(spec.approxBytes).toBeGreaterThanOrEqual(spec.files.reduce((sum, file) => sum + file.bytes, 0))
    }
  })
})
