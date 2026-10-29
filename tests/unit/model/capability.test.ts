// CC-03.2 (L1): tier matrix unit-tested T1–T4 via fake envs incl.
// adapter-reject and low-memory paths.
//
// Contract: FR-03.2 — pure `probeCapabilities(env)` returning
// `Capabilities { tier, webgpuAdapter, wasmSimd, audioDecoder, audioEncoder,
// videoEncoder, deviceMemGB: number | null, online }`; T-table from
// architecture.md § Degradation tiers; `deviceMemGB` null when the browser
// does not expose it — never blocks. T4 (US-1.1.1): no WebGPU AND no WASM-SIMD,
// or deviceMemory < 4 → blocked state with reasons. WebGPU present with
// wasmSimd false still yields a working tier (the webgpu path does not need
// ORT-wasm SIMD). FR-03.3 — `tierSelector(caps, opts)` per spike defaults
// (T1 whisper-base, T2 sherpa-zipformer, T3 whistle), user override honored,
// device-memory gate blocks large models (large-v3-turbo/Parakeet class,
// `minDeviceMemGB`) below 16 GB.
import { describe, expect, test } from 'vitest'
import { probeCapabilities, tierSelector } from '@engine/model/capability'
import type { CapabilityEnv } from '@engine/model/capability'
import { MODEL_REGISTRY } from '@engine/model/registry'
import { makeCapabilities } from './fakes'
import type { Tier } from '@engine/protocol'

function envWith(gpu: CapabilityEnv['navigator'], overrides: Partial<CapabilityEnv> = {}, deviceMemory?: number): CapabilityEnv {
  const navigator = gpu === undefined || gpu === null ? (deviceMemory === undefined ? null : { deviceMemory }) : { ...gpu, ...(deviceMemory === undefined ? {} : { deviceMemory }) }
  return { navigator, wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true, online: true, ...overrides }
}

const adapterOk = { requestAdapter: async () => ({ label: 'fake-adapter' }) }
const adapterNull = { requestAdapter: async () => null }
const adapterReject = {
  requestAdapter: () =>
    Promise.reject(new Error('adapter request failed (simulated)')),
}

describe('CC-03.2: probeCapabilities tier matrix over fake envs', () => {
  test('CC-03.2: T1 — navigator.gpu with a usable adapter', async () => {
    const caps = await probeCapabilities(envWith({ gpu: adapterOk }))
    expect(caps.tier).toBe('T1')
    expect(caps.webgpuAdapter).toBe(true)
    expect(caps.reasons, 'working tier carries no blocked reasons').toEqual([])
    expect(caps.online).toBe(true)
  })

  test('CC-03.2: T2 — no navigator.gpu at all (device must come out as wasm)', async () => {
    const caps = await probeCapabilities(envWith(undefined))
    expect(caps.tier).toBe('T2')
    expect(caps.webgpuAdapter).toBe(false)
  })

  test('CC-03.2: T2 — adapter request resolves null', async () => {
    const caps = await probeCapabilities(envWith({ gpu: adapterNull }))
    expect(caps.tier).toBe('T2')
    expect(caps.webgpuAdapter).toBe(false)
  })

  test('CC-03.2: T2 — adapter request REJECTS (probe must not throw out)', async () => {
    const caps = await probeCapabilities(envWith({ gpu: adapterReject }))
    expect(caps.tier).toBe('T2')
    expect(caps.webgpuAdapter).toBe(false)
  })

  test('CC-03.2: T4 — no WebGPU AND no WASM-SIMD, with reasons', async () => {
    const caps = await probeCapabilities(envWith(undefined, { wasmSimd: false }))
    expect(caps.tier).toBe('T4')
    expect(caps.reasons.length, 'blocked state publishes reasons').toBeGreaterThan(0)
    expect(caps.reasons.join(',')).toMatch(/SIMD/i)
  })

  test('CC-03.2: T4 — deviceMemGB < 4 blocks (WebGPU present or not)', async () => {
    const noGpu = await probeCapabilities(envWith(undefined, {}, 2))
    expect(noGpu.tier).toBe('T4')
    expect(noGpu.reasons.join(',')).toMatch(/MEMORY/i)
    const webgpu = await probeCapabilities(envWith({ gpu: adapterOk }, {}, 3.5))
    expect(webgpu.tier).toBe('T4')
    expect(webgpu.reasons.join(',')).toMatch(/MEMORY/i)
  })

  test('CC-03.2: exactly 4 GB does not block (gate is < 4)', async () => {
    const caps = await probeCapabilities(envWith(undefined, {}, 4))
    expect(caps.tier).not.toBe('T4')
    expect(caps.deviceMemGB).toBe(4)
  })

  test('CC-03.2: deviceMemGB null (browser does not expose it) never blocks', async () => {
    const exposed = await probeCapabilities(envWith({ gpu: adapterOk }))
    expect(exposed.deviceMemGB, 'not exposed → null, not 0 (0 would mis-block)').toBeNull()
    expect(exposed.tier).toBe('T1')
    const notExposedWasm = await probeCapabilities(envWith(undefined))
    expect(notExposedWasm.deviceMemGB).toBeNull()
    expect(notExposedWasm.tier, 'still a working tier, never T4').not.toBe('T4')
  })

  test('CC-03.2: wasmSimd false + WebGPU present still picks a working tier', async () => {
    const caps = await probeCapabilities(envWith({ gpu: adapterOk }, { wasmSimd: false }))
    expect(caps.tier, 'the webgpu path does not depend on ORT-wasm SIMD').toBe('T1')
    expect(caps.wasmSimd).toBe(false)
  })

  test('CC-03.2: T3 — no WebCodecs AudioDecoder/AudioEncoder (Safari < 26 profile)', async () => {
    const noEncoder = await probeCapabilities(envWith({ gpu: adapterOk }, { audioEncoder: false }))
    expect(noEncoder.tier).toBe('T3')
    expect(noEncoder.videoEncoder, 'raw capability passthrough').toBe(true)
    const noDecoder = await probeCapabilities(envWith(undefined, { audioDecoder: false }))
    expect(noDecoder.tier).toBe('T3')
  })

  test('CC-03.2: online flag passes through from the env', async () => {
    const caps = await probeCapabilities(envWith(undefined, { online: false }))
    expect(caps.online).toBe(false)
    expect(caps.tier, 'offline is orthogonal to tier').toBe('T2')
  })
})

describe('CC-03.2: tierSelector per-spike defaults, overrides, memory gate', () => {
  const baseCaps = makeCapabilities

  test('CC-03.2: spike defaults — T1→whisper-base (webgpu), T2→zipformer (wasm), T3→whistle (wasm)', () => {
    const t1 = tierSelector(baseCaps({ tier: 'T1', webgpuAdapter: true }), { registry: MODEL_REGISTRY })
    expect(t1.engine).toBe('transformers-whisper')
    expect(t1.model, 'spike-recommended T1 row').toContain('whisper-base')
    expect(t1.device).toBe('webgpu')
    const t2 = tierSelector(baseCaps({ tier: 'T2' }), { registry: MODEL_REGISTRY })
    expect(t2.engine).toBe('sherpa-wasm')
    expect(t2.model).toContain('zipformer')
    expect(t2.device).toBe('wasm')
    const t3 = tierSelector(baseCaps({ tier: 'T3', audioEncoder: false }), { registry: MODEL_REGISTRY })
    expect(t3.engine).toBe('cactus-whistle')
    expect(t3.model).toContain('whistle')
    expect(t3.device).toBe('wasm')
    for (const selection of [t1, t2, t3]) expect(MODEL_REGISTRY[selection.model], `${selection.model} is a registry row`).toBeDefined()
  })

  test('CC-03.2: T4 selection throws (blocked state — nothing selectable)', () => {
    expect(() => tierSelector(baseCaps({ tier: 'T4', reasons: ['NO_WEBGPU_AND_NO_WASM_SIMD'] }), { registry: MODEL_REGISTRY })).toThrow(/T4|BLOCKED/)
  })

  test('CC-03.2: user override is honored (cross-tier model choice)', () => {
    const whisperTinyId = Object.keys(MODEL_REGISTRY).find((id) => id.includes('whisper-tiny'))
    expect(whisperTinyId, 'whisper-tiny row present for override + CI tier').toBeDefined()
    const selection = tierSelector(baseCaps({ tier: 'T1', webgpuAdapter: true }), { userModel: whisperTinyId, registry: MODEL_REGISTRY })
    expect(selection.model).toBe(whisperTinyId)
    expect(selection.engine).toBe('transformers-whisper')
  })

  test('CC-03.2: unknown override id throws UNKNOWN_MODEL', () => {
    expect(() => tierSelector(baseCaps({ tier: 'T1' }), { userModel: 'no-such-model@00000000', registry: MODEL_REGISTRY })).toThrow(/UNKNOWN_MODEL/)
  })

  test('CC-03.2: deviceMemGB < 16 gates minDeviceMemGB models out (FR-03.3)', () => {
    const gatedRegistry = {
      ...MODEL_REGISTRY,
      'large-test@deadbeef': {
        ...makeSpecShim(),
        minDeviceMemGB: 16,
      },
    }
    const gatedId = 'large-test@deadbeef'
    expect(() => tierSelector(baseCaps({ tier: 'T2', deviceMemGB: 8 }), { userModel: gatedId, registry: gatedRegistry })).toThrow(/MEMORY/)
    expect(() => tierSelector(baseCaps({ tier: 'T2', deviceMemGB: 15 }), { userModel: gatedId, registry: gatedRegistry })).toThrow(/MEMORY/)
    const allowed = tierSelector(baseCaps({ tier: 'T2', deviceMemGB: 16 }), { userModel: gatedId, registry: gatedRegistry })
    expect(allowed.model).toBe(gatedId)
    const unknownMemory = tierSelector(baseCaps({ tier: 'T2', deviceMemGB: null }), { userModel: gatedId, registry: gatedRegistry })
    expect(unknownMemory.model, 'deviceMemGB null never gates').toBe(gatedId)
  })
})

// A minimal ModelSpec shim for the memory-gate unit (tierSelector only reads
// engine/id/minDeviceMemGB; full rows are covered by registry.test.ts).
function makeSpecShim() {
  return {
    id: 'large-test@deadbeef',
    engine: 'sherpa-wasm' as const,
    repo: 'zipscribe-test/large',
    revision: '0'.repeat(40),
    files: [],
    approxBytes: 670_478_772,
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: false,
    timestampMode: 'word-native' as const,
    license: 'Apache-2.0',
    tierHint: 'T2' as Tier,
    runtimeWasm: [],
    enOnly: false,
  }
}
