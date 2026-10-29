// ADVERSARIAL (unit-03 red-team): capability/tier gate abuse attempts.
// Questions probed here (adversary report §5):
//  - does the probe pin the SHAPE of a resolved adapter, or will any truthy
//    value be believed as "webgpu works"? (documented: any truthy value —
//    navigator.gpu.requestAdapter() only ever resolves null/undefined or a
//    real GPUAdapter, so the contract boundary is the browser itself)
//  - deviceMemory boundaries: 3.99 vs 4 vs 0 vs NaN vs null (never-blocks)
//  - can `tierSelector` opts talk the memory gate down? (largeModelMinDevice-
//    MemGB: 0 with a userModel pointing at a gated row — the spec says the
//    gate blocks REGARDLESS of user choice; opts must only be able to RAISE it)
//  - probe purity: env values pass through without reads of globals.
import { describe, expect, test } from 'vitest'
import { probeCapabilities, tierSelector } from '@engine/model/capability'
import type { CapabilityEnv } from '@engine/model/capability'
import { MODEL_REGISTRY } from '@engine/model/registry'
import { makeCapabilities } from '../fakes'
import type { ModelSpec } from '@engine/model/registry'
import type { Tier } from '@engine/protocol'

function baseEnv(navigator: CapabilityEnv['navigator']): CapabilityEnv {
  return { navigator, wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true }
}

function gatedRegistry(): Record<string, ModelSpec> {
  const shim: ModelSpec = {
    id: 'adv-large@ad200000',
    engine: 'transformers-whisper',
    repo: 'zipscribe-test/adv-large',
    revision: '0'.repeat(40),
    files: [],
    approxBytes: 1,
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: false,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    tierHint: 'T2' as Tier,
    runtimeWasm: [],
    enOnly: false,
    minDeviceMemGB: 16,
  }
  return { ...MODEL_REGISTRY, [shim.id]: shim }
}

describe('ADVERSARIAL CC-03.2: adapter belief + device-memory boundaries', () => {
  test('ADVERSARIAL CC-03.2: ANY truthy requestAdapter resolution is believed as a usable adapter (documented trust in navigator.gpu)', async () => {
    for (const junk of [{}, { label: 'bogus' }, 'not-an-adapter', 1, [], () => undefined]) {
      const caps = await probeCapabilities(baseEnv({ gpu: { requestAdapter: async () => junk } }))
      expect(caps.webgpuAdapter, `truthy junk ${JSON.stringify(junk) ?? 'symbol'} believed as adapter`).toBe(true)
      expect(caps.tier, `…and claims T1 with ${JSON.stringify(junk) ?? 'value'}`).toBe('T1')
    }
    // The dead-adapter consequence (WebGPU calls failing later) is a runtime
    // concern outside probeCapabilities: the probe's contract is exactly
    // "resolved non-null ⇒ adapter" per FR-03.2. Pinned here as documentation.
  })

  test('ADVERSARIAL CC-03.2: null AND undefined both mean "no adapter" (T2, never a throw)', async () => {
    for (const value of [null, undefined]) {
      const caps = await probeCapabilities(baseEnv({ gpu: { requestAdapter: async () => value } }))
      expect(caps.webgpuAdapter, `requestAdapter → ${String(value)}`).toBe(false)
      expect(caps.tier).toBe('T2')
    }
  })

  test('ADVERSARIAL CC-03.2: deviceMemory boundary 3.99 blocks, exactly 4 does not; 0/negative block; NaN is not < 4 (never silently blocks); null never gates', async () => {
    const below = await probeCapabilities(baseEnv({ gpu: null, deviceMemory: 3.99 }))
    expect(below.tier).toBe('T4')
    expect(below.reasons).toContain('LOW_DEVICE_MEMORY')
    const exact = await probeCapabilities(baseEnv({ gpu: { requestAdapter: async () => ({}) }, deviceMemory: 4 }))
    expect(exact.tier, 'the gate is < 4, not ≤ 4').toBe('T1')
    const zero = await probeCapabilities(baseEnv({ gpu: null, deviceMemory: 0 }))
    expect(zero.tier, '0 GB blocks').toBe('T4')
    const negative = await probeCapabilities(baseEnv({ gpu: null, deviceMemory: -1 }))
    expect(negative.tier, 'negative blocks (still < 4)').toBe('T4')
    const nan = await probeCapabilities(baseEnv({ gpu: { requestAdapter: async () => ({}) }, deviceMemory: Number.NaN }))
    expect(nan.tier, 'NaN is not < 4 — a garbage value must never silently block a working machine (pinned)').toBe('T1')
    const nullMem = await probeCapabilities(baseEnv({ gpu: null, deviceMemory: null }))
    expect(nullMem.deviceMemGB).toBeNull()
    expect(nullMem.tier, 'null (not exposed) never blocks').toBe('T2')
  })

  test('ADVERSARIAL CC-03.2: opts.largeModelMinDeviceMemGB can only RAISE the gate — 0 does not talk a gated userModel past the registry floor', async () => {
    const registry = gatedRegistry()
    const lowMem = makeCapabilities({ tier: 'T2', deviceMemGB: 8 })
    expect(() => tierSelector(lowMem, { userModel: 'adv-large@ad200000', registry, largeModelMinDeviceMemGB: 0 }), 'opts cannot lower the registry 16 GB floor').toThrow(/MEMORY/)
    expect(() => tierSelector(lowMem, { userModel: 'adv-large@ad200000', registry, largeModelMinDeviceMemGB: -100 }), 'not even with a negative').toThrow(/MEMORY/)
    expect(() => tierSelector(makeCapabilities({ tier: 'T2', deviceMemGB: 20 }), { userModel: 'adv-large@ad200000', registry, largeModelMinDeviceMemGB: 32 }), 'but it CAN raise the bar').toThrow(/MEMORY/)
    const allowed = tierSelector(makeCapabilities({ tier: 'T2', deviceMemGB: 16 }), { userModel: 'adv-large@ad200000', registry })
    expect(allowed.model, 'exactly the registry floor passes').toBe('adv-large@ad200000')
    const unknownMemory = tierSelector(makeCapabilities({ tier: 'T2', deviceMemGB: null }), { userModel: 'adv-large@ad200000', registry, largeModelMinDeviceMemGB: 0 })
    expect(unknownMemory.model, 'deviceMemGB null never gates, even with opts 0').toBe('adv-large@ad200000')
  })

  test('ADVERSARIAL CC-03.1: no SHIPPED registry row carries minDeviceMemGB — the memory gate is exercised only by synthetic rows (pinned fact)', () => {
    for (const spec of Object.values(MODEL_REGISTRY)) {
      expect(spec.minDeviceMemGB, `${spec.id}: shipped rows have no memory gate today`).toBeUndefined()
    }
  })

  test('ADVERSARIAL FR-03.2: probeCapabilities is pure — every field passes through from the injected env, globals untouched', async () => {
    const caps = await probeCapabilities({
      navigator: { gpu: { requestAdapter: async () => null }, deviceMemory: 32 },
      wasmSimd: true,
      audioDecoder: true,
      audioEncoder: false,
      videoEncoder: true,
      online: false,
    })
    expect(caps).toMatchObject({ webgpuAdapter: false, wasmSimd: true, audioDecoder: true, audioEncoder: false, videoEncoder: true, deviceMemGB: 32, online: false })
    expect(caps.tier, 'audioEncoder false → T3 (checked before the webgpu/wasm split)').toBe('T3')
  })
})
