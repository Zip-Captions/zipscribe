// Unit-106 test-support: the deterministic dependency layer for the
// persistence suites (conventions § Mocks and fakes — shared fakes only, no
// vi.mock of our own modules, no real timers, no network). Builder-owned
// modules are reached only through the ambient `unit106-api-contract.d.ts`
// specifiers; nothing here imports them at runtime (the suites do, and that
// is the intended RED seam).
import { IDBFactory } from 'fake-indexeddb'
import { createFakeClock } from '../../../../src/test-support/fake-clock'
import { serializeProject, parseProject } from '@state/services/serialize'
import type { MediaFingerprint, PanelState, PersistenceDeps, PersistenceErrorCode, PersistenceService, PersistenceTimers, PeaksLike, Project, ProjectRow, RelinkOutcome, SaveState, StorageEstimateView } from '@state/services/persistence'

// ── canned fixtures ──────────────────────────────────────────────────────────

export const CANNED_PEAKS: PeaksLike = {
  bucketSec: 0.1,
  min: new Float32Array([0.1, -0.4, 0]),
  max: new Float32Array([0.3, 0.9, 0.05]),
}

/** FR-106.5 reopen context — pinned values the L2 restore test asserts on. */
export const CANNED_PANEL_STATE: PanelState = {
  activeTab: 'media',
  collapsed: { sidebar: false, timeline: false },
  panelSizes: { sidebar: 320, timeline: 160 },
  theme: 'dark',
  transcribe: { language: 'en', modelId: null, diarize: false },
  lastPlayhead: 42.5,
  selection: { anchorBlockId: 'blk_a', focusBlockId: 'blk_c' },
}

export function cannedFingerprint(overrides: Partial<MediaFingerprint> = {}): MediaFingerprint {
  // Mirrors `SAMPLE_ASSET.fingerprint` (tests/unit/editor/helpers/fixture-project.ts)
  // without importing it — this helper must stay loadable from `src/**` suites.
  const base: MediaFingerprint = { name: 'speech-2min.mp4', size: 627251, durationMs: 121440, sampleHashes: ['h1', 'h2', 'h3'] }
  return { ...structuredClone(base), ...overrides }
}

export function makeFile(name = 'speech-2min.mp4', bytes = 1024, type = 'video/mp4'): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

// ── deterministic timers (no real timers anywhere) ───────────────────────────

export interface FakeTimers extends PersistenceTimers {
  /** Fires every callback due within the next `ms` (virtual), in order; re-entrant scheduling included. */
  advance(ms: number): void
  pendingCount(): number
  readonly virtualNow: number
}

export function createFakeTimers(): FakeTimers {
  interface Entry {
    id: number
    due: number
    cb: () => void
    cancelled: boolean
  }
  let nextId = 1
  let now = 0
  const entries: Entry[] = []
  const timers: FakeTimers = {
    get virtualNow(): number {
      return now
    },
    setTimeout: (cb: () => void, ms: number): number => {
      const id = nextId++
      entries.push({ id, due: now + ms, cb, cancelled: false })
      return id
    },
    clearTimeout: (id: number): void => {
      const hit = entries.find((entry) => entry.id === id)
      if (hit !== undefined) hit.cancelled = true
    },
    advance: (ms: number): void => {
      const target = now + ms
      // Loop: callbacks scheduled BY fired callbacks inside the same window
      // must fire too (debounce chains), in chronological order.
      for (;;) {
        const due = entries.filter((entry) => !entry.cancelled && entry.due <= target).sort((a, b) => a.due - b.due || a.id - b.id)
        const next = due[0]
        if (next === undefined) break
        const index = entries.indexOf(next)
        entries.splice(index, 1)
        now = Math.max(now, next.due)
        next.cb()
      }
      now = target
    },
    pendingCount: (): number => entries.filter((entry) => !entry.cancelled).length,
  }
  return timers
}

// ── visibilitychange source ──────────────────────────────────────────────────

export interface FakeDocument {
  readonly stub: Pick<Document, 'addEventListener'>
  /** Sets `hidden` and dispatches the captured visibilitychange listeners. */
  fire(hidden: boolean): void
  visibilityListenerCount(): number
}

export function createFakeDocument(): FakeDocument {
  const raw = {
    hidden: false,
    listeners: new Map<string, (() => void)[]>(),
    addEventListener: (type: string, listener: () => void): void => {
      const list = raw.listeners.get(type) ?? []
      list.push(listener)
      raw.listeners.set(type, list)
    },
  }
  return {
    stub: raw as unknown as Pick<Document, 'addEventListener'>,
    fire: (hidden: boolean): void => {
      raw.hidden = hidden
      for (const listener of raw.listeners.get('visibilitychange') ?? []) listener()
    },
    visibilityListenerCount: (): number => (raw.listeners.get('visibilitychange') ?? []).length,
  }
}

// ── put instrumentation + quota-failure injection ────────────────────────────

export interface FactoryInstrument {
  /** Pass to `deps.indexedDB` — the service under test. */
  readonly instrumented: IDBFactory
  /** Raw twin (no put interception) — for direct row assertions. */
  readonly raw: IDBFactory
  putLog: readonly { store: string }[]
  putCount(): number
  putsTo(store: string): number
  /** Throw `QuotaExceededError` from the (0-based) global n-th `put`. */
  failPutAt(index: number): void
  clearFailures(): void
}

/**
 * Fail-at-each-step injection (CC-106.3): a Proxy over the fake IDBFactory
 * that counts every `IDBObjectStore.put` reaching the implementation (raw or
 * via `idb` — both bottom out at the native store) and can make the n-th one
 * throw a `QuotaExceededError`, mirroring the real quota failure surface.
 */
export function createFactoryInstrument(): FactoryInstrument {
  const raw = new IDBFactory()
  const putLog: { store: string }[] = []
  let failAt: number | null = null

  const wrapStore = (store: IDBObjectStore): IDBObjectStore =>
    new Proxy(store, {
      get: (target, prop, receiver) => {
        if (prop === 'put') {
          return (value: unknown, key?: IDBValidKey): IDBRequest<IDBValidKey> => {
            const index = putLog.length
            putLog.push({ store: target.name })
            if (failAt !== null && index === failAt) {
              failAt = null
              throw new DOMException('quota', 'QuotaExceededError')
            }
            return target.put(value as never, key)
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })

  const wrapTxn = (txn: IDBTransaction): IDBTransaction =>
    new Proxy(txn, {
      get: (target, prop, receiver) => {
        if (prop === 'objectStore') {
          return (name: string): IDBObjectStore => wrapStore(target.objectStore(name))
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })

  const wrapDb = (db: IDBDatabase): IDBDatabase =>
    new Proxy(db, {
      get: (target, prop, receiver) => {
        if (prop === 'transaction') {
          return (...args: Parameters<IDBDatabase['transaction']>): IDBTransaction => wrapTxn(target.transaction(...args))
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })

  const wrapRequest = (request: IDBOpenDBRequest): IDBOpenDBRequest =>
    new Proxy(request, {
      get: (target, prop, receiver) => {
        if (prop === 'result') {
          const result = target.result
          return result === null ? null : wrapDb(result)
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })

  const instrumented = new Proxy(raw, {
    get: (target, prop, receiver) => {
      if (prop === 'open') {
        return (name: string, version?: number | object): IDBOpenDBRequest => wrapRequest(target.open(name, version as number))
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })

  return {
    instrumented,
    raw,
    putLog,
    putCount: () => putLog.length,
    putsTo: (store: string) => putLog.filter((entry) => entry.store === store).length,
    failPutAt: (index: number) => {
      failAt = index
    },
    clearFailures: () => {
      failAt = null
    },
  }
}

// ── raw store access (row-level assertions) ──────────────────────────────────

const DB_NAME = 'zipscribe'

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result)
    request.onerror = (): void => reject(request.error ?? new Error('IDB_READ_FAILED'))
  })
}

async function rawOpen(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME)
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => resolve(request.result)
    request.onerror = (): void => reject(request.error ?? new Error('DB_OPEN_FAILED'))
    request.onblocked = (): void => reject(new Error('DB_BLOCKED'))
  })
}

/**
 * Row-level access for assertions. Call only AFTER `service.open()` — the
 * three stores are created by the service's version-1 upgrade.
 */
export async function rawRow<T>(factory: IDBFactory, store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await rawOpen(factory)
  try {
    return await settle(db.transaction(store, 'readonly').objectStore(store).get(key))
  } finally {
    db.close()
  }
}

export async function rawRows<T>(factory: IDBFactory, store: string): Promise<T[]> {
  const db = await rawOpen(factory)
  try {
    return await settle(db.transaction(store, 'readonly').objectStore(store).getAll())
  } finally {
    db.close()
  }
}

export async function rawPut(factory: IDBFactory, store: string, value: unknown): Promise<void> {
  const db = await rawOpen(factory)
  try {
    const txn = db.transaction(store, 'readwrite')
    settle(txn.objectStore(store).put(value))
    await new Promise<void>((resolve, reject) => {
      txn.oncomplete = (): void => resolve()
      txn.onabort = (): void => reject(txn.error ?? new Error('DB_WRITE_FAILED'))
    })
  } finally {
    db.close()
  }
}

export async function rawDelete(factory: IDBFactory, store: string, key: IDBValidKey): Promise<void> {
  const db = await rawOpen(factory)
  try {
    const txn = db.transaction(store, 'readwrite')
    settle(txn.objectStore(store).delete(key))
    await new Promise<void>((resolve, reject) => {
      txn.oncomplete = (): void => resolve()
      txn.onabort = (): void => reject(txn.error ?? new Error('DB_WRITE_FAILED'))
    })
  } finally {
    db.close()
  }
}

export async function rawStoreNames(factory: IDBFactory): Promise<string[]> {
  const db = await rawOpen(factory)
  try {
    return [...db.objectStoreNames]
  } finally {
    db.close()
  }
}

export async function rawKeyPath(factory: IDBFactory, store: string): Promise<string | undefined> {
  const db = await rawOpen(factory)
  try {
    const keyPath = db.transaction(store, 'readonly').objectStore(store).keyPath
    return typeof keyPath === 'string' ? keyPath : undefined
  } finally {
    db.close()
  }
}

// ── fake clock + deps bundle ─────────────────────────────────────────────────

export interface FakePersistenceBundle {
  deps: PersistenceDeps
  instrument: FactoryInstrument
  clock: ReturnType<typeof createFakeClock>
  timers: FakeTimers
  doc: FakeDocument
  errors: PersistenceErrorCode[]
  readonly requestPersistCalls: number
  readonly estimateStorageCalls: number
  readonly probeCalls: File[]
  readonly pickerCalls: number
  /** Canned probe results, consumed per call; empty → default (matches the sample asset). */
  queueProbe(result: MediaFingerprint | Error): void
  /** Canned `openFilePicker` results, consumed per call; empty → null (cancelled). */
  queuePicker(file: File | null): void
  setEstimate(usage: number, quota: number): void
  setPersistResult(persisted: boolean): void
}

export function createFakePersistenceDeps(overrides: Partial<PersistenceDeps> = {}): FakePersistenceBundle {
  const instrument = createFactoryInstrument()
  const clock = createFakeClock(1_730_000_000_000)
  const timers = createFakeTimers()
  const doc = createFakeDocument()
  const errors: PersistenceErrorCode[] = []
  const probeQueue: (MediaFingerprint | Error)[] = []
  const pickerQueue: (File | null)[] = []
  const probeCalls: File[] = []
  const state = { estimate: { usage: 0, quota: 5 * 1024 * 1024 * 1024 }, persisted: true, requestPersistCalls: 0, estimateStorageCalls: 0, pickerCalls: 0 }

  const deps: PersistenceDeps = {
    indexedDB: instrument.instrumented,
    clock,
    timers,
    document: doc.stub,
    estimateStorage: async () => {
      state.estimateStorageCalls += 1
      return { ...state.estimate }
    },
    requestPersist: async () => {
      state.requestPersistCalls += 1
      return state.persisted
    },
    probeFingerprint: async (file: File) => {
      probeCalls.push(file)
      const canned = probeQueue.shift()
      if (canned instanceof Error) throw canned
      return canned ?? cannedFingerprint({ name: file.name, size: file.size })
    },
    openFilePicker: async () => {
      state.pickerCalls += 1
      return pickerQueue.shift() ?? null
    },
    onError: (code: PersistenceErrorCode) => {
      errors.push(code)
    },
    ...overrides,
  }

  return {
    deps,
    instrument,
    clock,
    timers,
    doc,
    errors,
    get requestPersistCalls(): number {
      return state.requestPersistCalls
    },
    get estimateStorageCalls(): number {
      return state.estimateStorageCalls
    },
    probeCalls,
    get pickerCalls(): number {
      return state.pickerCalls
    },
    queueProbe: (result) => probeQueue.push(result),
    queuePicker: (file) => pickerQueue.push(file),
    setEstimate: (usage, quota) => {
      state.estimate = { usage, quota }
    },
    setPersistResult: (persisted) => {
      state.persisted = persisted
    },
  }
}

/** Drain the event loop until `predicate` holds (fake-indexeddb schedules on
 *  macrotasks). Bounded: failure is an error, never a wall-clock assertion. */
export async function waitUntil(label: string, predicate: () => boolean, rounds = 400): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`waitUntil: "${label}" never held within ${String(rounds)} event-loop rounds`)
}

// ── L2 fake service (ProjectList / SaveStateIndicator seams) ─────────────────

export interface FakePersistenceService extends PersistenceService {
  /** The three stores, in-memory, exposed for seeding + assertions. */
  rows: Map<string, ProjectRow>
  handles: Map<string, { projectId: string; fingerprint: MediaFingerprint }>
  blobs: Map<string, { projectId: string; bytes: number; lastOpened: number }>
  calls: {
    open: number
    listProjects: number
    loadProject: string[]
    openProject: string[]
    createProjectRow: string[]
    duplicateProject: string[]
    deleteProject: string[]
    saveNow: string[]
    relinkMedia: string[]
    storageEstimate: number
  }
  deletions: Map<string, { committed: number; undone: number }>
  setSaveState(next: Partial<SaveState>): void
  setEstimate(estimate: Partial<StorageEstimateView>): void
  setRelinkResult(outcome: RelinkOutcome): void
}

export function makeProjectRow(id: string, project: Project, overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id,
    schemaVersion: 1,
    name: project.name,
    updatedAt: project.updatedAt,
    project: serializeProject(project),
    peaks: null,
    panelState: null,
    ...overrides,
  }
}

/** In-memory stand-in for the persistence service behind the L2 UI seams.
 *  Derives `loadProject`/`openProject` from `rows` (canonical string →
 *  parseProject), so components exercise the same value shapes as production. */
export function createFakePersistenceService(): FakePersistenceService {
  const rows = new Map<string, ProjectRow>()
  const handles = new Map<string, { projectId: string; fingerprint: MediaFingerprint }>()
  const blobs = new Map<string, { projectId: string; bytes: number; lastOpened: number }>()
  const calls: FakePersistenceService['calls'] = {
    open: 0,
    listProjects: 0,
    loadProject: [],
    openProject: [],
    createProjectRow: [],
    duplicateProject: [],
    deleteProject: [],
    saveNow: [],
    relinkMedia: [],
    storageEstimate: 0,
  }
  const deletions = new Map<string, { committed: number; undone: number }>()
  let saveState: SaveState = { state: 'idle', lastSavedAt: null, errorCode: null }
  const saveListeners = new Set<() => void>()
  let estimate: StorageEstimateView = { usage: 0, quota: 5 * 1024 * 1024 * 1024, persisted: true, blobCacheBytes: 0 }
  let relinkResult: RelinkOutcome = { kind: 'no-handle' }
  let touchCounter = 0

  const load = (id: string): { project: Project; peaks: PeaksLike | null; panelState: PanelState | null; readOnly: boolean } | null => {
    const row = rows.get(id)
    if (row === undefined) return null
    return { project: parseProject(row.project), peaks: row.peaks, panelState: row.panelState, readOnly: row.schemaVersion > 1 }
  }

  const service: FakePersistenceService = {
    rows,
    handles,
    blobs,
    calls,
    deletions,
    setSaveState: (next) => {
      saveState = { ...saveState, ...next }
      for (const listener of saveListeners) listener()
    },
    setEstimate: (next) => {
      estimate = { ...estimate, ...next }
    },
    setRelinkResult: (outcome) => {
      relinkResult = outcome
    },
    open: async () => {
      calls.open += 1
    },
    attachEditor: () => undefined,
    setPanelStateSource: () => undefined,
    setPeaksSource: () => undefined,
    saveNow: async (reason) => {
      calls.saveNow.push(reason)
      return 'not-dirty'
    },
    getSaveState: () => saveState,
    subscribeSaveState: (cb) => {
      saveListeners.add(cb)
      return () => saveListeners.delete(cb)
    },
    listProjects: async () => [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    loadProject: async (id) => {
      calls.loadProject.push(id)
      return load(id)
    },
    openProject: async (id) => {
      calls.openProject.push(id)
      const loaded = load(id)
      const blob = blobs.get(id)
      if (blob !== undefined) blob.lastOpened = ++touchCounter
      return loaded
    },
    createProjectRow: async (name) => {
      calls.createProjectRow.push(name)
      return 'proj_created_1'
    },
    duplicateProject: async (id) => {
      calls.duplicateProject.push(id)
      return 'proj_dupe_1'
    },
    deleteProject: async (id) => {
      calls.deleteProject.push(id)
      const tally = deletions.get(id) ?? { committed: 0, undone: 0 }
      deletions.set(id, tally)
      return {
        commit: async () => {
          tally.committed += 1
          rows.delete(id)
          handles.delete(id)
          blobs.delete(id)
        },
        undo: () => {
          tally.undone += 1
        },
      }
    },
    exportProjectFile: async (id) => rows.get(id)?.project ?? null,
    importProjectFile: async (json) => {
      parseProject(json)
      return 'proj_imported_1'
    },
    storeMediaHandle: async (projectId, handle, fingerprint) => {
      void handle
      handles.set(projectId, { projectId, fingerprint })
    },
    getMediaHandle: async (projectId) => {
      const row = handles.get(projectId)
      return row === undefined ? null : { ...row }
    },
    relinkMedia: async (projectId) => {
      calls.relinkMedia.push(projectId)
      return relinkResult
    },
    cacheMediaBlob: async (projectId, blob) => {
      blobs.set(projectId, { projectId, bytes: blob.size, lastOpened: 0 })
    },
    getMediaBlob: async (projectId) => (blobs.has(projectId) ? new Blob([new Uint8Array(blobs.get(projectId)?.bytes ?? 0)]) : null),
    storageEstimate: async () => {
      calls.storageEstimate += 1
      return { ...estimate }
    },
  }
  return service
}

/** A fresh (never opened) factory pair — one per test keeps stores isolated. */
export function freshFactoryPair(): { instrumented: IDBFactory; raw: IDBFactory } {
  const instrument = createFactoryInstrument()
  return { instrumented: instrument.instrumented, raw: instrument.raw }
}

export { serializeProject, parseProject }
export type { MediaFingerprint, PanelState, PersistenceDeps, PersistenceErrorCode, PersistenceService, PersistenceTimers, PeaksLike, Project, ProjectRow, RelinkOutcome, SaveState, StorageEstimateView } from '@state/services/persistence'
