// Test-only persistence bridge (unit-106 frozen contract § Window
// __zipPersistenceBridge). App.tsx imports this module ONLY when the URL
// query carries `ziptest=1` (lazy import → out of the initial bundle;
// sibling of the unit-101/102/103/104 bridges, which stay installed
// untouched). STRICT gate: nothing installs on import; without the flag this
// module is never loaded. Every method dispatches into the SAME production
// receivers the real UI flows use — the one PersistenceService instance from
// the app context over the REAL IndexedDB. The three dep setters
// (setProbeResult / setEstimate / setPersisted) install replaceable wrappers
// on the service's LIVE deps object — production code reads those members at
// call time, so the swap is honest to the tests and absent from every real
// path (the production defaults stay the media-worker probe and
// `navigator.storage`). SECURITY-03: protocol objects, canonical JSON
// strings, synthetic blocks and diagnostic NUMBERS only — nothing logs
// content; File crosses as { name, size } summaries.

import { getAppContext } from '../../app/context'
import type { MediaFingerprint, ProjectRow } from '../../state/services/persistence'
import type { RelinkOutcome } from '../../state/services/persistence'

/** In-page handle-like (functions cannot cross the evaluate boundary, so
 *  the SPECS build these doubles in the page; they are not structured-
 *  cloneable — the service keeps them session-visible and persists the
 *  fingerprint row only, its pinned double-support fallback). */
interface HandleLike {
  queryPermission(descriptors?: { mode?: string }): Promise<string>
  getFile(): Promise<File>
}

interface FingerprintLike {
  name: string
  size: number
  durationMs: number
  sampleHashes: string[]
}

type BridgeRelinkOutcome =
  | { kind: 'silent'; file: { name: string; size: number } | null }
  | { kind: 'picker-needed'; file: { name: string; size: number } | null }
  | { kind: 'mismatch'; differs: string[] }
  | { kind: 'no-handle' }

interface PersistenceBridge {
  saveNow(reason: 'idle' | 'manual' | 'hidden'): Promise<'saved' | 'not-dirty' | 'failed'>
  getSaveState(): { state: 'idle' | 'dirty' | 'saving' | 'saved' | 'not-saved'; lastSavedAt: number | null; errorCode: string | null }
  listProjects(): Promise<ProjectRow[]>
  openProject(id: string): Promise<{ project: unknown; peaks: unknown; panelState: unknown; readOnly: boolean } | null>
  exportProjectFile(id: string): Promise<string | null>
  importProjectFileJson(json: string): Promise<string>
  relinkMedia(projectId: string): Promise<BridgeRelinkOutcome>
  seedMediaHandle(projectId: string, handleLike: HandleLike, fingerprint: FingerprintLike): Promise<void>
  setProbeResult(fingerprint: FingerprintLike | 'reject'): void
  setEstimate(estimate: { usage: number; quota: number }): void
  setPersisted(persisted: boolean): void
  deleteProject(id: string): Promise<void>
  undoDelete(): Promise<void>
  commitDelete(): Promise<void>
  cacheMediaBlob(projectId: string, sizeBytes: number): Promise<void>
  setInterrupted(keptBlocks: number): void
  ready(): Promise<void>
}

function fileSummary(file: File | null): { name: string; size: number } | null {
  return file === null ? null : { name: file.name, size: file.size }
}

function mapRelinkOutcome(outcome: RelinkOutcome): BridgeRelinkOutcome {
  switch (outcome.kind) {
    case 'silent':
      return { kind: 'silent', file: fileSummary(outcome.file) }
    case 'picker-needed':
      return { kind: 'picker-needed', file: fileSummary(outcome.file) }
    case 'mismatch':
      return { kind: 'mismatch', differs: [...outcome.differs] }
    case 'no-handle':
      return { kind: 'no-handle' }
  }
}

export function installPersistenceBridge(): void {
  const context = getAppContext()
  const service = context.persistence
  const deps = context.persistenceDeps
  let pendingDelete: { id: string; handle: { commit(): Promise<void>; undo(): void } } | null = null

  const bridge: PersistenceBridge = {
    saveNow: (reason) => service.saveNow(reason),
    getSaveState: () => service.getSaveState(),
    listProjects: () => service.listProjects(),
    openProject: async (id) => {
      const loaded = await service.openProject(id)
      if (loaded === null) return null
      return { project: loaded.project, peaks: loaded.peaks, panelState: loaded.panelState, readOnly: loaded.readOnly }
    },
    exportProjectFile: (id) => service.exportProjectFile(id),
    importProjectFileJson: (json) => service.importProjectFile(json),
    relinkMedia: async (projectId) => mapRelinkOutcome(await service.relinkMedia(projectId)),
    seedMediaHandle: (projectId, handleLike, fingerprint) =>
      service.storeMediaHandle(projectId, handleLike as unknown as FileSystemFileHandle, fingerprint as unknown as MediaFingerprint),
    setProbeResult: (fingerprint) => {
      deps.probeFingerprint = () => (fingerprint === 'reject' ? Promise.reject(new Error('PROBE_REJECTED')) : Promise.resolve(structuredClone(fingerprint) as unknown as MediaFingerprint))
    },
    setEstimate: (estimate) => {
      deps.estimateStorage = () => Promise.resolve({ usage: estimate.usage, quota: estimate.quota })
    },
    setPersisted: (persisted) => {
      // Honest wrapper: the storage view's `persisted` flips when the
      // service ACTUALLY asks (first successful save of a new project,
      // FR-106.7) — this only decides what that request answers.
      deps.requestPersist = () => Promise.resolve(persisted)
    },
    deleteProject: async (id) => {
      pendingDelete = { id, handle: await service.deleteProject(id) }
    },
    undoDelete: () => {
      pendingDelete?.handle.undo()
      pendingDelete = null
      return Promise.resolve()
    },
    commitDelete: async () => {
      const pending = pendingDelete
      pendingDelete = null
      await pending?.handle.commit()
    },
    cacheMediaBlob: (projectId, sizeBytes) => service.cacheMediaBlob(projectId, new Blob([new Uint8Array(sizeBytes)])),
    setInterrupted: (keptBlocks) => {
      // Via the app: the loaded row mutates through the composition-root
      // seam (same path the reopen uses) — synthetic blocks + numbers only,
      // and the autosave baseline counts it as one accepted change.
      const current = context.editorApp.project.getState().project
      if (current === null) return
      const next = structuredClone(current)
      next.transcription = 'partial'
      next.blocks = Array.from({ length: Math.max(0, Math.trunc(keptBlocks)) }, (_unused, index) => ({
        id: `blk_ziptest_${String(index)}`,
        start: index,
        end: index + 0.5,
        text: `word${String(index)}`,
        words: [{ text: `word${String(index)}`, start: index, end: index + 0.5, timing: 'estimated' as const }],
        speakerId: 'SPK_ZIPTEST',
      }))
      next.updatedAt = Date.now()
      context.editorApp.project.loadProject?.(next)
    },
    ready: async () => {
      await service.open()
    },
  }
  ;(window as unknown as { __zipPersistenceBridge?: PersistenceBridge }).__zipPersistenceBridge = bridge
}
