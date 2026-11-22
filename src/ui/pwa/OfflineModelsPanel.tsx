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
// no-ops. Downloads for everything else go through `ensureOffline` (the
// canonical fetch path with the weights mirror).
//
// FR-204.5: `requestPersist()` fires on FIRST "Make available offline" and
// on the explicit button — never on plain page load (register.ts only
// persists on appinstalled).
//
// SECURITY-03: rows render registry ids/sizes and failure CODES only.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { MODEL_REGISTRY } from '../../engine/model/registry'
import { modelSpecPresence, seedSpecFromMirror } from '../../engine/model/adapters/browser-cache'
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
    const registry = (await response.json()) as { models?: Record<string, unknown> }
    const dirs = new Set(Object.keys(registry.models ?? {}))
    for (const spec of Object.values(MODEL_REGISTRY)) {
      const dir = spec.id.split('@')[0]?.split('/').at(-1)?.replace(/_/g, '-') ?? ''
      if (!dirs.has(dir)) continue
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
      await modelCache.ensureOffline(id)
      if (!persistOnFirstDownloadDone) {
        persistOnFirstDownloadDone = true
        // FR-204.5: a downloaded model is pointless if the browser can
        // evict it — ask once, honestly (the result renders via the
        // explicit button; this is the same request the panel line shows).
        void persistenceDeps.requestPersist().then(setPersistGranted)
      }
    })
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
        <button type="button" data-testid="offline-models-close" className="ws-button" onClick={onClose}>
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
