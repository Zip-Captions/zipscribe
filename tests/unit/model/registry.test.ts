// CC-03.1 (L1): registry populated from the spike report — all recommended
// tiers covered, license + punctuation + timestampMode filled.
//
// Contract: FR-03.1 — EngineKind, ModelSpec fields, rows imported from
// `docs/spikes/model-eval-report.md` recommendation (CC-02.11: T1
// whisper-base/webgpu, T2 sherpa-zipformer/wasm, T3 whistle/wasm), hard-coded
// (not runtime-fetched). Model provenance (architecture decision): every row
// pins repo + 40-hex `revision` + per-file SHA-256 — the pinned values live in
// `models/eval-registry.json` (written by tools/eval/pin-models.mjs), and the
// registry rows must match them exactly (no invented pins). URL shape is
// always `resolve/<revision>/…`, never `main` (FR-03.6).
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENGINE_KINDS, MODEL_REGISTRY, TIER_DEFAULT_MODEL, getModel, modelFileUrl } from '@engine/model/registry'
import type { EngineKind, ModelSpec } from '@engine/model/registry'
import { tierSelector } from '@engine/model/capability'
import { makeCapabilities } from './fakes'
import { REPO_ROOT } from '../../helpers/repo'
import type { Tier } from '@engine/protocol'

interface EvalRegistryFile {
  path: string
  sha256: string
  sizeBytes: number
}
interface EvalRegistryModel {
  repo: string
  revision: string
  files: EvalRegistryFile[]
}

function evalRegistry(): Map<string, EvalRegistryModel> {
  const parsed = JSON.parse(readFileSync(join(REPO_ROOT, 'models', 'eval-registry.json'), 'utf8')) as { models: Record<string, EvalRegistryModel> }
  const byRepo = new Map<string, EvalRegistryModel>()
  for (const model of Object.values(parsed.models)) byRepo.set(model.repo, model)
  return byRepo
}

const ENGINE_BY_SPIKE_ENGINE_ID: Record<string, EngineKind> = {
  A: 'transformers-whisper',
  B: 'sherpa-wasm',
  C: 'cactus-whistle',
}

/** Spike recommendation rows (unit-02 CC-02.11) keyed by their expected repo. */
const TIER_ROWS: { tier: Exclude<Tier, 'T4'>; repo: string; engine: EngineKind }[] = [
  { tier: 'T1', repo: 'onnx-community/whisper-base_timestamped', engine: ENGINE_BY_SPIKE_ENGINE_ID['A'] as EngineKind },
  { tier: 'T2', repo: 'csukuangfj/sherpa-onnx-zipformer-en-2023-06-26', engine: ENGINE_BY_SPIKE_ENGINE_ID['B'] as EngineKind },
  { tier: 'T3', repo: 'Cactus-Compute/whistle', engine: ENGINE_BY_SPIKE_ENGINE_ID['C'] as EngineKind },
]

function allSpecs(): ModelSpec[] {
  return Object.values(MODEL_REGISTRY)
}

describe('CC-03.1: registry rows from the spike report, provenance pinned', () => {
  test('CC-03.1: EngineKind covers the three spike engines and every row uses one', () => {
    expect([...ENGINE_KINDS].sort()).toEqual(['cactus-whistle', 'sherpa-wasm', 'transformers-whisper'])
    for (const spec of allSpecs()) {
      expect(ENGINE_KINDS, `${spec.id}: engine`).toContain(spec.engine)
    }
  })

  test('CC-03.1: all three spike tiers are covered by recommended rows', () => {
    for (const row of TIER_ROWS) {
      const spec = allSpecs().find((candidate) => candidate.repo === row.repo)
      expect(spec, `registry has a row for ${row.repo} (${row.tier})`).toBeDefined()
      expect(spec?.engine, `${row.repo}: engine kind`).toBe(row.engine)
      expect(TIER_DEFAULT_MODEL[row.tier], `tierSelector default for ${row.tier} is the recommended row`).toBe(spec?.id)
      expect(getModel(TIER_DEFAULT_MODEL[row.tier]), `default row exists`).toBeDefined()
    }
  })

  test('CC-03.1: every row has license, punctuation, timestampMode, languages filled', () => {
    expect(allSpecs().length, 'registry is populated').toBeGreaterThanOrEqual(3)
    const timestampModes = new Set(['word-native', 'word-derived', 'segment', 'none'])
    for (const spec of allSpecs()) {
      expect(typeof spec.license, `${spec.id}: license is a string`).toBe('string')
      expect(spec.license.trim().length, `${spec.id}: license non-empty`).toBeGreaterThan(0)
      expect(typeof spec.punctuation, `${spec.id}: punctuation`).toBe('boolean')
      expect(typeof spec.confidence, `${spec.id}: confidence`).toBe('boolean')
      expect(typeof spec.languageDetect, `${spec.id}: languageDetect`).toBe('boolean')
      expect(timestampModes.has(spec.timestampMode), `${spec.id}: timestampMode`).toBe(true)
      expect(Array.isArray(spec.languages), `${spec.id}: languages is an array`).toBe(true)
      expect(spec.languages.length, `${spec.id}: languages non-empty`).toBeGreaterThan(0)
      expect(typeof spec.enOnly, `${spec.id}: enOnly flag (US-1.1.2)`).toBe('boolean')
    }
  })

  test('CC-03.1: every row pins revision (40-hex) and per-file sha256 (64-hex) + bytes', () => {
    for (const spec of allSpecs()) {
      expect(spec.revision, `${spec.id}: revision is a 40-hex commit SHA`).toMatch(/^[0-9a-f]{40}$/)
      expect(spec.files.length, `${spec.id}: has files`).toBeGreaterThan(0)
      let fileSum = 0
      for (const file of spec.files) {
        expect(file.sha256, `${spec.id}/${file.path}: sha256 is 64-hex`).toMatch(/^[0-9a-f]{64}$/)
        expect(Number.isInteger(file.bytes) && file.bytes > 0, `${spec.id}/${file.path}: bytes`).toBe(true)
        fileSum += file.bytes
      }
      expect(spec.approxBytes, `${spec.id}: approxBytes covers the file set`).toBeGreaterThanOrEqual(fileSum)
      expect(Array.isArray(spec.runtimeWasm), `${spec.id}: runtimeWasm is string[]`).toBe(true)
      expect(spec.runtimeWasm.length, `${spec.id}: runtimeWasm lists the engine runtime (FR-03.8 double-caching of wasm is acceptable)`).toBeGreaterThan(0)
      for (const wasm of spec.runtimeWasm) expect(typeof wasm, `${spec.id}: runtimeWasm entry is a string path`).toBe('string')
    }
  })

  test('CC-03.1: rows match the pinned models/eval-registry.json provenance (no invented pins)', () => {
    const pins = evalRegistry()
    for (const spec of allSpecs()) {
      const pin = pins.get(spec.repo)
      expect(pin, `${spec.id}: repo ${spec.repo} is pinned in models/eval-registry.json`).toBeDefined()
      if (pin === undefined) continue
      expect(spec.revision, `${spec.id}: revision equals the pinned x-repo-commit`).toBe(pin.revision)
      const pinByPath = new Map(pin.files.map((file) => [file.path, file]))
      expect(spec.files.map((file) => file.path).sort()).toEqual([...pinByPath.keys()].sort())
      for (const file of spec.files) {
        const pinned = pinByPath.get(file.path)
        expect(pinned, `${spec.id}/${file.path}: pinned`).toBeDefined()
        expect(file.sha256, `${spec.id}/${file.path}: sha256 equals the pinned digest`).toBe(pinned?.sha256)
        expect(file.bytes, `${spec.id}/${file.path}: bytes equals the pinned size`).toBe(pinned?.sizeBytes)
      }
    }
  })

  test('CC-03.1: file URLs use resolve/<revision>/… and never main (FR-03.6)', () => {
    for (const spec of allSpecs()) {
      for (const file of spec.files) {
        const url = modelFileUrl(spec, file)
        expect(url, `${spec.id}/${file.path}`).toBe(`https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file.path}`)
        expect(url).not.toMatch(/\/resolve\/main\//)
      }
    }
  })

  test('CC-03.1: every id referenced by tierSelector exists in the registry', () => {
    const tiers: Tier[] = ['T1', 'T2', 'T3']
    for (const tier of tiers) {
      const selection = tierSelector(makeCapabilities({ tier }), { registry: MODEL_REGISTRY })
      expect(getModel(selection.model), `tierSelector(${tier}) references an existing row`).toBeDefined()
      expect(selection.engine, `${tier}: engine matches the row`).toBe(getModel(selection.model)?.engine)
    }
  })
})
