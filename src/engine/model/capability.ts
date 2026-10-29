// Capability detection & tier selection (FR-03.2, FR-03.3).
//
// `probeCapabilities` is PURE with respect to the injected `CapabilityEnv` —
// it never reads globals (DI per architecture.md invariant 2; the main-thread
// boot code adapts `navigator`/feature probes into this shape). The T-table is
// `knowledge/architecture.md` § Degradation tiers:
//   T1 webgpu adapter ok · T2 no usable webgpu adapter (wasm path) ·
//   T3 no WebCodecs AudioDecoder/AudioEncoder ·
//   T4 blocked: (no webgpu AND no WASM-SIMD) or deviceMemory < 4 GB.
// `navigator.deviceMemory` is Chromium-only and coarse — `null` (not exposed)
// NEVER gates (US-1.1.1 / FR-03.2). Offline is orthogonal to tier.
//
// Engine purity: framework-agnostic TS — the environment arrives by injection
// only; no DOM globals are touched here.

import { MODEL_REGISTRY, TIER_DEFAULT_MODEL } from './registry'
import type { EngineKind, ModelSpec } from './registry'
import type { Device, Tier } from '@engine/protocol'

/**
 * Injected environment for `probeCapabilities` (FR-03.2). `requestAdapter`
 * mimics `navigator.gpu.requestAdapter()`: resolves an adapter object
 * (usable), resolves `null` (no adapter) or rejects (request failed) — the
 * latter two both mean "no usable webgpu adapter", never a throw out of the
 * probe (US-1.1.1: adapter request failure → retry path on T2, not a crash).
 */
export interface CapabilityEnv {
  navigator?: {
    gpu?: { requestAdapter(): Promise<unknown> } | null
    /** `navigator.deviceMemory` in GB — Chromium-only, coarse; null/undefined = not exposed (never blocks). */
    deviceMemory?: number | null
  } | null
  wasmSimd: boolean
  audioDecoder: boolean
  audioEncoder: boolean
  videoEncoder: boolean
  online?: boolean
}

export interface Capabilities {
  tier: Tier
  webgpuAdapter: boolean
  wasmSimd: boolean
  audioDecoder: boolean
  audioEncoder: boolean
  videoEncoder: boolean
  deviceMemGB: number | null
  online: boolean
  /**
   * Non-empty exactly when `tier === 'T4'` (blocked state, US-1.1.1).
   * Content-free reason codes: `'NO_WEBGPU_AND_NO_WASM_SIMD'`,
   * `'LOW_DEVICE_MEMORY'`.
   */
  reasons: string[]
}

/** T4 device-memory floor in GB (architecture.md T-table: `navigator.deviceMemory` < 4 → blocked). */
const MIN_DEVICE_MEM_GB = 4

/** FR-03.3 default gate for `minDeviceMemGB` (large-v3-turbo/Parakeet class) models, overridable via options. */
const DEFAULT_LARGE_MODEL_MIN_MEM_GB = 16

export async function probeCapabilities(env: CapabilityEnv): Promise<Capabilities> {
  const nav = env.navigator ?? null

  let webgpuAdapter = false
  const gpu = nav?.gpu
  if (gpu !== null && gpu !== undefined) {
    try {
      const adapter = await gpu.requestAdapter()
      webgpuAdapter = adapter !== null && adapter !== undefined
    } catch {
      webgpuAdapter = false // adapter request failed → treated as "no usable adapter" (T2), never throws out
    }
  }

  const deviceMemGB = nav?.deviceMemory ?? null
  const reasons: string[] = []
  if (deviceMemGB !== null && deviceMemGB < MIN_DEVICE_MEM_GB) reasons.push('LOW_DEVICE_MEMORY')
  if (!webgpuAdapter && !env.wasmSimd) reasons.push('NO_WEBGPU_AND_NO_WASM_SIMD') // the webgpu path does not need ORT-wasm SIMD

  const tier: Tier = reasons.length > 0 ? 'T4' : !env.audioDecoder || !env.audioEncoder ? 'T3' : webgpuAdapter ? 'T1' : 'T2'

  return {
    tier,
    webgpuAdapter,
    wasmSimd: env.wasmSimd,
    audioDecoder: env.audioDecoder,
    audioEncoder: env.audioEncoder,
    videoEncoder: env.videoEncoder,
    deviceMemGB,
    online: env.online ?? true,
    reasons,
  }
}

export interface TierSelection {
  engine: EngineKind
  /** ModelId — always a key of the active registry. */
  model: string
  tier: Tier
  /** T1 → `'webgpu'`, otherwise `'wasm'` (workers only ever see a Device). */
  device: Device
}

export interface TierSelectorOptions {
  /** User model override (FR-03.3) — must be a key of the active registry. */
  userModel?: string
  /** Registry override (DI for tests); defaults to `MODEL_REGISTRY`. */
  registry?: Record<string, ModelSpec>
  /** Device-memory gate threshold in GB for `minDeviceMemGB` models (FR-03.3); default 16. */
  largeModelMinDeviceMemGB?: number
}

/**
 * FR-03.3: per-spike tier defaults (`TIER_DEFAULT_MODEL`), overridable by user
 * model choice, with the device-memory gate for `minDeviceMemGB` rows.
 * Throws on T4 (blocked state — nothing selectable, so zero downloads can be
 * attempted), on an unknown override id, and when the memory gate blocks the
 * selection. `deviceMemGB === null` never gates.
 */
export function tierSelector(caps: Capabilities, opts: TierSelectorOptions = {}): TierSelection {
  if (caps.tier === 'T4') {
    throw new Error(`tierSelector: BLOCKED (T4) — reasons: ${caps.reasons.join(',') || 'UNSPECIFIED'}`)
  }

  const registry = opts.registry ?? MODEL_REGISTRY
  const id = opts.userModel ?? TIER_DEFAULT_MODEL[caps.tier]
  const spec: ModelSpec | undefined = registry[id]
  if (spec === undefined) {
    throw new Error(`tierSelector: UNKNOWN_MODEL '${id}' is not a key of the active registry`)
  }

  if (spec.minDeviceMemGB !== undefined) {
    const requiredGB = Math.max(spec.minDeviceMemGB, opts.largeModelMinDeviceMemGB ?? DEFAULT_LARGE_MODEL_MIN_MEM_GB)
    if (caps.deviceMemGB !== null && caps.deviceMemGB < requiredGB) {
      throw new Error(`tierSelector: MEMORY gate — '${id}' requires >= ${requiredGB} GB device memory, have ${caps.deviceMemGB}`)
    }
  }

  const device: Device = caps.tier === 'T1' ? 'webgpu' : 'wasm'
  return { engine: spec.engine, model: id, tier: caps.tier, device }
}
