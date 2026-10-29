// L1 module tests for capability detection + tier selection (FR-03.2,
// FR-03.3). The acceptance gate for CC-03.2 is the frozen suite
// `tests/unit/model/capability.test.ts`; these are the source-adjacent unit
// tests required by knowledge/conventions.md for every engine module — they
// also keep the module covered in child runs where the frozen suites are
// excluded (vitest.config child-safety list).
import { describe, expect, test } from 'vitest'
import { probeCapabilities, tierSelector } from './capability'
import type { CapabilityEnv, Capabilities } from './capability'
import { MODEL_REGISTRY } from './registry'
import type { ModelSpec } from './registry'
import type { Tier } from '../protocol'

const ZIPFORMER_ROW = 'sherpa-zipformer-en-int8@11a70a47'

const adapterOk = { requestAdapter: () => Promise.resolve({ label: 'fake' }) }
const adapterNull = { requestAdapter: () => Promise.resolve(null) }
const adapterReject = { requestAdapter: () => Promise.reject(new Error('simulated adapter request failure')) }

function env(gpu: CapabilityEnv['navigator'], overrides: Partial<CapabilityEnv> = {}): CapabilityEnv {
  return { navigator: gpu, wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true, online: true, ...overrides }
}

describe('probeCapabilities — T-table (FR-03.2, architecture.md § Degradation tiers)', () => {
  test('T1 when navigator.gpu yields a usable adapter', async () => {
    const caps = await probeCapabilities(env({ gpu: adapterOk }))
    expect(caps).toMatchObject({ tier: 'T1', webgpuAdapter: true, online: true })
    expect(caps.deviceMemGB, 'not exposed → null (never blocks)').toBeNull()
    expect(caps.reasons).toEqual([])
  })

  test('T2 when there is no navigator.gpu, when the request resolves null, and when it rejects', async () => {
    for (const gpu of [undefined, { gpu: adapterNull }, { gpu: adapterReject }]) {
      const caps = await probeCapabilities(env(gpu))
      expect(caps.tier, 'no usable adapter → wasm tier, never a throw out of the probe').toBe('T2')
      expect(caps.webgpuAdapter).toBe(false)
    }
  })

  test('T4 on no-webgpu-and-no-simd or deviceMemory < 4, with content-free reasons', async () => {
    const noRuntime = await probeCapabilities(env(undefined, { wasmSimd: false }))
    expect(noRuntime.tier).toBe('T4')
    expect(noRuntime.reasons).toContain('NO_WEBGPU_AND_NO_WASM_SIMD')

    const lowMem = await probeCapabilities(env({ gpu: adapterOk, deviceMemory: 2 }))
    expect(lowMem.tier).toBe('T4')
    expect(lowMem.reasons).toContain('LOW_DEVICE_MEMORY')
    expect(lowMem.deviceMemGB).toBe(2)

    const fourGb = await probeCapabilities({ navigator: { deviceMemory: 4 }, wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true, online: true })
    expect(fourGb.tier, 'gate is < 4, not <= 4').toBe('T2')
    expect(fourGb.deviceMemGB).toBe(4)
  })

  test('webgpu present rescues wasmSimd false (the webgpu path needs no ORT-wasm SIMD)', async () => {
    const caps = await probeCapabilities(env({ gpu: adapterOk }, { wasmSimd: false }))
    expect(caps.tier).toBe('T1')
    expect(caps.wasmSimd).toBe(false)
  })

  test('T3 without WebCodecs AudioDecoder or AudioEncoder; online passes through', async () => {
    expect((await probeCapabilities(env(undefined, { audioEncoder: false }))).tier).toBe('T3')
    expect((await probeCapabilities(env({ gpu: adapterOk }, { audioDecoder: false }))).tier, 'T3 outranks T1 when codecs are missing').toBe('T3')
    const offline = await probeCapabilities(env(undefined, { online: false }))
    expect(offline.online).toBe(false)
    expect(offline.tier, 'offline is orthogonal to tier').toBe('T2')
  })
})

describe('tierSelector — spike defaults, override, memory gate (FR-03.3)', () => {
  function caps(tier: Tier, overrides: Partial<Capabilities> = {}): Capabilities {
    return { tier, webgpuAdapter: tier === 'T1', wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true, deviceMemGB: null, online: true, reasons: [], ...overrides }
  }

  test('per-tier defaults map to the spike rows and the webgpu/wasm device rule', () => {
    expect(tierSelector(caps('T1'), { registry: MODEL_REGISTRY })).toMatchObject({ tier: 'T1', device: 'webgpu', engine: 'transformers-whisper' })
    expect(tierSelector(caps('T2'), { registry: MODEL_REGISTRY })).toMatchObject({ tier: 'T2', device: 'wasm', engine: 'sherpa-wasm' })
    expect(tierSelector(caps('T3'), { registry: MODEL_REGISTRY })).toMatchObject({ tier: 'T3', device: 'wasm', engine: 'cactus-whistle' })
    for (const tier of ['T1', 'T2', 'T3'] as const) expect(MODEL_REGISTRY[tierSelector(caps(tier), { registry: MODEL_REGISTRY }).model], `${tier} selects a registry row`).toBeDefined()
  })

  test('T4 throws blocked (no selectable model → no download)', () => {
    expect(() => tierSelector(caps('T4', { reasons: ['NO_WEBGPU_AND_NO_WASM_SIMD'] }))).toThrow(/T4|BLOCKED/)
  })

  test('user override is honored; unknown id throws UNKNOWN_MODEL', () => {
    const tiny = Object.keys(MODEL_REGISTRY).find((id) => id.includes('whisper-tiny')) as string
    expect(tierSelector(caps('T2'), { userModel: tiny }).model).toBe(tiny)
    expect(() => tierSelector(caps('T1'), { userModel: 'nope@00000000' })).toThrow(/UNKNOWN_MODEL/)
  })

  test('device-memory gate blocks minDeviceMemGB rows below the threshold; null memory never gates', () => {
    const large: ModelSpec = { ...(MODEL_REGISTRY[ZIPFORMER_ROW] as ModelSpec), id: 'large-test@deadbeef', minDeviceMemGB: 16 }
    const registry = { [large.id]: large }
    expect(() => tierSelector(caps('T2', { deviceMemGB: 8 }), { userModel: large.id, registry })).toThrow(/MEMORY/)
    expect(tierSelector(caps('T2', { deviceMemGB: 16 }), { userModel: large.id, registry }).model).toBe(large.id)
    expect(tierSelector(caps('T2', { deviceMemGB: null }), { userModel: large.id, registry }).model, 'unknown memory never gates').toBe(large.id)
    const modest: ModelSpec = { ...(MODEL_REGISTRY[ZIPFORMER_ROW] as ModelSpec), id: 'modest-min-8@abcdef01', minDeviceMemGB: 8 }
    const registry2 = { [modest.id]: modest }
    expect(() => tierSelector(caps('T2', { deviceMemGB: 12 }), { userModel: modest.id, registry: registry2 })).toThrow(/MEMORY/) // default option (16) gates above the row's own 8
    expect(tierSelector(caps('T2', { deviceMemGB: 12 }), { userModel: modest.id, registry: registry2, largeModelMinDeviceMemGB: 8 }).model, 'option override lowers the gate').toBe(modest.id)
    expect(() => tierSelector(caps('T2', { deviceMemGB: 6 }), { userModel: modest.id, registry: registry2, largeModelMinDeviceMemGB: 2 })).toThrow(/MEMORY/) // row min still floors a lowered option
  })
})
