// FR-204.4 / CC-204.6 — the Offline models panel (US-204.3, design.md
// § Offline & install). Reached from the header ⋯ menu:
//
// - lists every registry model with its size, per-row "Make available
//   offline" / "Remove" driven by the model cache's `listCached` (unit-03
//   re-verified truth, not a hopeful flag);
// - a total storage estimate from `persistenceDeps.estimateStorage` (the
//   same seam unit-106 uses — e2e mocks it there, the panel renders it raw);
// - "Keep data on this device" → `requestPersist()` → the RAW granted:true/
//   false rendered honestly (design.md § Integrity — "granted: no — the
//   browser may evict cached models", never a fake yes).
//
// Seeding (tests-never-network + "models:fetch warmed the local cache"): on
// mount, models whose directory the local `/.cache/ci-registry.json`
// guarantees are imported from the same-origin mirror, all bytes
// re-hashed before any put (`seedSpecFromMirror`); a production 404 simply
// no-ops. Rows marked `seeding: false` are PROVISION-ONLY (the CI tier
// provisions their mirror bytes for route serving; the confirm-gated panel
// download must still start from zero — the unit-03 gate owner decides).
// Downloads for everything else go through `ensureOffline` (the canonical
// fetch path with the weights mirror).
//
// FR-204.5: `requestPersist()` fires on FIRST "Make available offline" and
// on the explicit button — never on plain page load (register.ts only
// persists on appinstalled).
//
// SECURITY-03: rows render registry ids/sizes and failure CODES only.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { MODEL_REGISTRY } from '../../engine/model/registry'
import type { EngineKind } from '../../engine/model/registry'
import { modelSpecPresence, seedSpecFromMirror } from '../../engine/model/adapters/browser-cache'
import { createModelManager, type AdapterFactory, type ModelManagerEvent } from '../../engine/model/manager'
import type { Capabilities } from '../../engine/model/capability'
import type { ModelCache } from '../../engine/model/cache'
import type { CachedEntry } from '../../engine/model/cache'
import type { PersistenceDeps } from '../../state/services/persistence'

export interface OfflineModelsPanelProps {
  modelCache: ModelCache
  persistenceDeps: PersistenceDeps
  onClose: () => void
}

/** FR-204.5: persist() on the FIRST explicit download, once per session. */
let persistOnFirstDownloadDone = false

/** US-204.3: the panel downloads through unit-03's model manager so the
 *  > 100 MB `model:confirm-required` gate holds the sequence — the manager
 *  is the ONE confirm gate owner (no re-implementation here). This instance
 *  never loads an engine: the adapter factory is a no-op double (download +
 *  verify only), and the capability snapshot only needs to pass the tier
 *  selector (T2 — the download path is device-agnostic). */
const DOWNLOAD_ONLY_CAPABILITIES: Capabilities = { tier: 'T2', webgpuAdapter: false, wasmSimd: true, audioDecoder: true, audioEncoder: true, videoEncoder: true, deviceMemGB: null, online: true, reasons: [] }
const NOOP_ADAPTER: AdapterFactory = () => ({ load: () => Promise.resolve(), invoke: () => Promise.resolve(), unload: () => Promise.resolve() })
const DOWNLOAD_ADAPTERS: Partial<Record<EngineKind, AdapterFactory>> = { 'transformers-whisper': NOOP_ADAPTER, 'sherpa-wasm': NOOP_ADAPTER, 'cactus-whistle': NOOP_ADAPTER }

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

function failureCode(error: unknown): string {
  const code = (error as { error?: { code?: string } }).error?.code
  return code ?? 'CACHE_FAILURE'
}

async function mirrorSeedable(modelCache: ModelCache): Promise<void> {
  try {
    const response = await globalThis.fetch('/.cache/ci-registry.json')
    if (!response.ok) return // production: no mirror — seeding simply no-ops
    const registry = (await response.json()) as { models?: Record<string, { seeding?: unknown }> }
    const seedableDirs = new Set(
      Object.entries(registry.models ?? {})
        .filter(([, row]) => row.seeding !== false)
        .map(([dir]) => dir),
    )
    for (const spec of Object.values(MODEL_REGISTRY)) {
      const dir = spec.id.split('@')[0]?.split('/').at(-1)?.replace(/_/g, '-') ?? ''
      if (!seedableDirs.has(dir)) continue
      if (await modelSpecPresence(spec)) continue
      await seedSpecFromMirror(modelCache, spec)
    }
  } catch {
    // Seeding is an opportunistic import; absence is the normal production
    // state and is not an error the user should ever see.
  }
}

export function OfflineModelsPanel({ modelCache, persistenceDeps, onClose }: OfflineModelsPanelProps): ReactNode {
  const [entries, setEntries] = useState<CachedEntry[] | null>(null)
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [persistGranted, setPersistGranted] = useState<boolean | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<{ model: string; bytes: number } | null>(null)

  const manager = useMemo(
    () =>
      createModelManager({
        cache: modelCache,
        adapters: DOWNLOAD_ADAPTERS,
        capabilities: () => Promise.resolve(DOWNLOAD_ONLY_CAPABILITIES),
        emit: (event: ModelManagerEvent) => {
          if (event.t === 'model:confirm-required') setPendingConfirm({ model: event.model, bytes: event.bytes })
        },
      }),
    [modelCache],
  )
  useEffect(
    () => () => {
      manager.cancelLoad()
    },
    [manager],
  )

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void modelCache.listCached().then((list) => {
        if (!cancelled) setEntries(list)
      })
    }
    void mirrorSeedable(modelCache).then(refresh)
    void persistenceDeps.estimateStorage().then((value) => {
      if (!cancelled) setEstimate(value)
    })
    return () => {
      cancelled = true
    }
  }, [modelCache, persistenceDeps])

  const run = (id: string, action: () => Promise<void>): void => {
    setBusy(id)
    void action()
      .catch((error: unknown) => {
        setCodes((current) => ({ ...current, [id]: failureCode(error) }))
      })
      .finally(() => {
        setBusy(null)
        void modelCache.listCached().then(setEntries)
      })
  }

  const ensure = (id: string): void => {
    run(id, async () => {
      // US-204.3 (unit-204): route through the manager so a > 100 MB model
      // holds at the model:confirm-required gate (zero bytes fetched until
      // "Download and continue") — the unit-03 gate owner, not a re-run of
      // the threshold logic. Under the strict `ziptest=1` harness gate the
      // confirm is auto-accepted (same doctrine as the export harness's
      // save-file-picker suppression — deterministic frozen flows).
      const ziptest = new URLSearchParams(globalThis.window?.location.search ?? '').get('ziptest') === '1'
      await manager.loadModel(id, ziptest ? { confirmed: true } : undefined)
      if (!persistOnFirstDownloadDone) {
        persistOnFirstDownloadDone = true
        // FR-204.5: a downloaded model is pointless if the browser can
        // evict it — ask once, honestly (the result renders via the
        // explicit button; this is the same request the panel line shows).
        void persistenceDeps.requestPersist().then(setPersistGranted)
      }
    })
  }

  const close = (): void => {
    manager.cancelLoad()
    setPendingConfirm(null)
    onClose()
  }

  const remove = (id: string): void => {
    run(id, () => modelCache.removeCached(id))
  }

  const keep = (): void => {
    void persistenceDeps.requestPersist().then(setPersistGranted)
  }

  return (
    <div data-testid="offline-cache-panel" role="dialog" aria-label="Offline models" className="ws-offline-panel">
      <div className="ws-offline-panel-head">
        <h2 className="ws-offline-panel-title">Offline models</h2>
        <button type="button" data-testid="offline-models-close" className="ws-button" onClick={close}>
          Close
        </button>
      </div>
      {entries === null ? (
        <p className="ws-offline-panel-copy">Checking cached models…</p>
      ) : (
        <ul className="ws-offline-model-list">
          {Object.values(MODEL_REGISTRY).map((spec) => {
            const entry = entries.find((candidate) => candidate.id === spec.id)
            const expectedBytes = spec.files.reduce((sum, file) => sum + file.bytes, 0)
            const cached = entry?.offlineReady === true
            return (
              <li key={spec.id} data-testid={`offline-model-row-${spec.id}`} className="ws-offline-model-row">
                <span className="ws-offline-model-id">{spec.id}</span>
                <span className="ws-offline-model-size">{formatBytes(cached && entry !== undefined && entry.bytes > 0 ? entry.bytes : expectedBytes)}</span>
                {codes[spec.id] !== undefined && <span className="ws-offline-model-code">{codes[spec.id]}</span>}
                {cached ? (
                  <button type="button" className="ws-button" disabled={busy === spec.id} onClick={() => remove(spec.id)}>
                    Remove
                  </button>
                ) : (
                  <button type="button" className="ws-button" disabled={busy === spec.id} onClick={() => ensure(spec.id)}>
                    {busy === spec.id ? 'Downloading…' : 'Make available offline'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {pendingConfirm !== null && (
        <div data-testid="model-download-confirm" role="alertdialog" aria-label="Model download confirmation" className="ws-confirm">
          <p className="ws-confirm-copy">
            {pendingConfirm.model} is not cached yet — {Math.round(pendingConfirm.bytes / 1_000_000)} MB downloads on first use.
          </p>
          <button
            type="button"
            data-testid="model-download-confirm-button"
            className="ws-button ws-button-primary"
            onClick={() => {
              manager.confirmDownload(pendingConfirm.model)
              setPendingConfirm(null)
            }}
          >
            Download and continue
          </button>
        </div>
      )}
      <p className="ws-offline-panel-copy">{estimate === null ? 'Storage estimate…' : `Estimated device storage: ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`}</p>
      <div className="ws-offline-persist-row">
        <button type="button" data-testid="keep-data-button" className="ws-button" onClick={keep}>
          Keep data on this device
        </button>
        {persistGranted === true && <span className="ws-offline-persist-result">Storage persistence granted: yes</span>}
        {persistGranted === false && <span className="ws-offline-persist-result">Storage persistence granted: no — the browser may evict cached models</span>}
      </div>
    </div>
  )
}
