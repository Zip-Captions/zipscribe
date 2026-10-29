// CC-03.3 (L4) browser harness — test-author-owned and FROZEN.
//
// The Playwright spec (`../model-cache.spec.ts`) loads this page through a
// dedicated vite dev server (vite.harness.config.ts), injects a synthetic
// ModelSpec registry, and drives the manager/cache modules through
// `__zipscribeModelHarness`. Engine SDK glue is injected here as a fake
// EngineAdapter per EngineKind — DI at the manager seam (the task's explicit
// allowance), never mocking the modules under test (registry/cache/manager/
// capability run for real against the real Cache API + real crypto.subtle).
//
// SECURITY-03: the harness never sees transcript text; specs feed seeded
// pseudo-random bytes only.
import { createModelCache, MODEL_CACHE_NAME } from '@engine/model/cache'
import { createModelManager } from '@engine/model/manager'
import type { AdapterFactory, EngineAdapter, ModelManager } from '@engine/model/manager'
import type { ModelCache } from '@engine/model/cache'
import type { Capabilities } from '@engine/model/capability'
import type { EngineKind, ModelSpec } from '@engine/model/registry'
import type { Device, ModelManagerEvent } from '@engine/protocol'

export interface HarnessAdapterRecord {
  loads: { id: string; device: string; fileCount: number }[]
  unloads: number
  invokes: string[]
}

export interface CachedEntryReport {
  id: string
  bytes: number
  offlineReady: boolean
  verifiedAt: number
}

export interface ModelHarness {
  setup(registry: Record<string, ModelSpec>, options?: { tier?: 'T1' | 'T2' | 'T3' }): void
  loadModel(id: string, opts?: { device?: Device; confirmed?: boolean }): Promise<void>
  confirmDownload(id: string): void
  cancelLoad(): void
  unload(): Promise<void>
  getAdapter(id: string): Promise<{ invoke(method: string, payload?: unknown): Promise<unknown> }>
  listCached(): Promise<CachedEntryReport[]>
  ensureOffline(id: string): Promise<void>
  events: ModelManagerEvent[]
  adapters: HarnessAdapterRecord
  cacheName: string
}

function fakeAdapterFactory(record: HarnessAdapterRecord): AdapterFactory {
  return (spec: ModelSpec): EngineAdapter => ({
    load: async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      record.loads.push({ id: spec.id, device: input.device, fileCount: Object.keys(input.files).length })
    },
    invoke: async (method) => {
      record.invokes.push(method)
      return method
    },
    unload: async () => {
      record.unloads += 1
    },
  })
}

function buildHarness(): ModelHarness {
  const events: ModelManagerEvent[] = []
  const adapters: HarnessAdapterRecord = { loads: [], unloads: 0, invokes: [] }
  let manager: ModelManager | undefined
  let cache: ModelCache | undefined

  const need = (): void => {
    if (!manager || !cache) throw new Error('harness.setup() was not called')
  }

  return {
    events,
    adapters,
    cacheName: MODEL_CACHE_NAME,
    setup(registry, options) {
      events.length = 0
      adapters.loads.length = 0
      adapters.unloads = 0
      adapters.invokes.length = 0
      const tier = options?.tier ?? 'T2'
      const caps: Capabilities = {
        tier,
        webgpuAdapter: tier === 'T1',
        wasmSimd: true,
        audioDecoder: true,
        audioEncoder: true,
        videoEncoder: true,
        deviceMemGB: null,
        online: true,
        reasons: [],
      }
      const fetchImpl = (url: string, init?: { signal?: AbortSignal }): Promise<Response> => fetch(url, init)
      cache = createModelCache({ registry, fetchImpl })
      const adapterMap: Partial<Record<EngineKind, AdapterFactory>> = {
        'transformers-whisper': fakeAdapterFactory(adapters),
        'sherpa-wasm': fakeAdapterFactory(adapters),
        'cactus-whistle': fakeAdapterFactory(adapters),
      }
      manager = createModelManager({
        registry,
        fetchImpl,
        cache,
        adapters: adapterMap,
        capabilities: async () => caps,
        emit: (event) => events.push(event),
        online: () => (globalThis as unknown as { navigator?: { onLine?: boolean } }).navigator?.onLine ?? true,
      })
    },
    loadModel: async (id, opts) => {
      need()
      await (manager as ModelManager).loadModel(id, opts)
    },
    confirmDownload: (id) => {
      need()
      ;(manager as ModelManager).confirmDownload(id)
    },
    cancelLoad: () => {
      need()
      ;(manager as ModelManager).cancelLoad()
    },
    unload: async () => {
      need()
      await (manager as ModelManager).unload()
    },
    getAdapter: async (id) => {
      need()
      return (manager as ModelManager).getAdapter(id)
    },
    listCached: async () => {
      need()
      return (cache as ModelCache).listCached()
    },
    ensureOffline: async (id) => {
      need()
      await (cache as ModelCache).ensureOffline(id)
    },
  }
}

const harness = buildHarness()
;(globalThis as unknown as { __zipscribeModelHarness?: ModelHarness }).__zipscribeModelHarness = harness
