// Production seam implementations for the app composition root (unit-101
// wiring, FR-2.0.x). Every member implements a frozen contract shape from
// `tests/unit/workbench/unit101-api-contract.d.ts`; the L2 suites keep their
// own doubles in `tests/unit/workbench/helpers/`. SECURITY-03: nothing here
// logs or derives strings from user content — failures are codes only.

import { createZipscribeModelCache, modelSpecPresence } from '../engine/model/adapters/browser-cache'
import { MODEL_REGISTRY } from '../engine/model/registry'
import { probeCapabilities } from '../engine/model/capability'
import type { Capabilities, CapabilityEnv } from '../engine/model/capability'
import type { ModelId } from '../engine/protocol'
import type { CapabilitySnapshot, ModelCachePort } from '../state/jobs'
import type { SettingsStorage } from '../state/settings'
import type { ImportCaptionsService } from '../state/services/intake'

/**
 * Settings persistence over localStorage — unit-101's stopgap until unit-106
 * ships the IDB adapter over the same async `SettingsStorage` seam. Reads
 * never throw (private mode / disabled storage behave like a first run);
 * writes are best-effort (the settings slice already fire-and-forgets).
 */
export function createLocalStorageSettings(): SettingsStorage {
  return {
    get(key: string): Promise<string | null> {
      try {
        return Promise.resolve(localStorage.getItem(key))
      } catch {
        return Promise.resolve(null)
      }
    },
    set(key: string, value: string): Promise<void> {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Quota/private-mode: persistence retries on the next setter.
      }
      return Promise.resolve()
    },
  }
}

/**
 * Offline-readiness over the FR-03.6 model cache (`zipscribe-models`): only
 * SHA-verified rows count as cached (engine/model/cache re-verifies on read).
 * FR-204.2 EXTENDS: the browser configuration (canonical same-origin keys +
 * weights mirror — `createZipscribeModelCache`) is shared with the ASR
 * worker, and `isOfflineReady` answers the fast-fail preflight with a cheap
 * presence probe.
 */
export function createProductionModelCache(): ModelCachePort {
  const cache = createZipscribeModelCache()
  return {
    listCached(): Promise<ModelId[]> {
      return cache.listCached().then((entries) => entries.filter((entry) => entry.offlineReady).map((entry) => entry.id))
    },
    async isOfflineReady(id: ModelId): Promise<boolean> {
      const spec = MODEL_REGISTRY[id]
      if (spec === undefined) return false
      return modelSpecPresence(spec)
    },
  }
}

/**
 * UNIT-07 SEAM placeholder (unit-07 `engine/captions` is not merged — frozen
 * contract § @state/services/intake): `sniff` reports every file as not a
 * caption we accept, so caption drops surface as `UNSUPPORTED_CAPTION`
 * rejections — never silent ones (CC-101.2). `importCaptions` is unreachable
 * while sniff denies; the code is a fixed constant (SECURITY-03).
 */
export function createPendingUnit07ImportService(): ImportCaptionsService {
  return {
    sniff: () => Promise.resolve(null),
    importCaptions: () => Promise.reject(new Error('unit07_not_merged')),
  }
}

/** Canonical WebAssembly SIMD validation vector (i8x16 opcodes — the
 * emscripten feature-detection module; validate() is the probe, never run). */
const WASM_SIMD_VECTOR = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])

interface NavigatorWithMemory extends Navigator {
  /** Chromium-only, coarse (GB); `undefined` = not exposed → never gates. */
  deviceMemory?: number
  /** WebGPU entry point (not in lib.dom — same shape `CapabilityEnv` expects). */
  gpu?: { requestAdapter(): Promise<unknown> }
}

function environmentFromGlobals(): CapabilityEnv {
  const nav = typeof navigator === 'undefined' ? null : (navigator as NavigatorWithMemory)
  const gpu = nav?.gpu ?? null
  return {
    navigator:
      nav === null
        ? null
        : {
            gpu: gpu === null ? null : { requestAdapter: () => gpu.requestAdapter() },
            deviceMemory: nav.deviceMemory ?? null,
          },
    wasmSimd: typeof WebAssembly !== 'undefined' && WebAssembly.validate(WASM_SIMD_VECTOR),
    audioDecoder: typeof AudioDecoder !== 'undefined',
    audioEncoder: typeof AudioEncoder !== 'undefined',
    videoEncoder: typeof VideoEncoder !== 'undefined',
    online: nav?.onLine ?? true,
  }
}

/** FR-2.0.3: capability → the jobs-store snapshot (tier chip / T4 screen).
 *  `probeCapabilities` never throws out of the adapter (US-1.1.1). */
export async function probeDeviceCapability(): Promise<CapabilitySnapshot> {
  const caps = await probeCapabilities(environmentFromGlobals())
  return { tier: caps.tier, reasons: caps.reasons }
}

/** unit-202 (FR-202.2): the FULL capability record (encoder flags intact) for
 *  the export dialog's burn-in gate. The jobs store keeps the tier-shaped
 *  snapshot only (unit-03 frozen) — the flags ride this separate read. */
export async function probeFullCapability(): Promise<Capabilities> {
  return probeCapabilities(environmentFromGlobals())
}
