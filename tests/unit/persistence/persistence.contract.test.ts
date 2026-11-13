// CC-106.4 (L3 contract): the persistence-service behavior contract — save /
// load, blobCache eviction, and the RE-LINK outcome vocabulary — extracted as
// a reusable runner (`describePersistenceContract`) so fakes and the real
// implementation obey the same contract (conventions § L3). Invoked here
// against the fake-indexeddb-backed real service; the CC-106.4 e2e counterpart
// (e2e/persistence/relink-fsa.spec.ts, stubbed FSA) reuses the SAME outcome
// vocabulary: 'silent' | 'picker-needed' | 'mismatch' | 'no-handle'.
//
// Pinned relink semantics (unit106-api-contract.d.ts § pinned decisions):
// stored handle → queryPermission({mode:'read'}) → granted → getFile() →
// deps.probeFingerprint → field-by-field compare (name, size, durationMs,
// sampleHashes elementwise). ALL equal → {kind:'silent', file}. ANY
// difference → {kind:'mismatch', differs:[…]} — NEVER a silent swap, and the
// stored handle/fingerprint row is NEVER overwritten. Permission denied OR
// handle missing → deps.openFilePicker; a PICKED file runs the SAME
// fingerprint contract (validated → 'silent' with the picked file — Firefox
// has no FSA, the picker is its only path); picker cancelled →
// {kind:'picker-needed', file:null}. FR-106.8: the fingerprint is compared,
// never computed here — the probe dep is the only fingerprint source.
//
// RED until the builder ships `src/state/services/persistence.ts` (the
// dynamic import below is the intended missing-module seam; the suite
// self-skips under the gates-scaffold child run).
import { describe, expect, test } from 'vitest'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import { cannedFingerprint, createFakePersistenceDeps, makeFile, waitUntil } from '../editor/helpers/fake-persistence'
import type { PanelState, PersistenceDeps, PersistenceService, PeaksLike, Project, ProjectRow } from '../editor/helpers/fake-persistence'
import type { EditorStore } from '@state/generated/contract-types'
import { serializeProject } from '@state/services/serialize'


const PERSISTENCE_MODULE = '@state/services/persistence'
type PersistenceModule = typeof import('@state/services/persistence')

async function loadModule(): Promise<PersistenceModule> {
  return (await import(/* @vite-ignore */ PERSISTENCE_MODULE)) as unknown as PersistenceModule
}

/** A deterministic canary-bearing project (SECURITY-03: the marker rides
 *  every row the contract writes; the spy proves no leak). */
function minimalProject(): Project {
  return {
    id: 'proj_contract',
    name: 'Contract project',
    schemaVersion: 1,
    asset: {
      id: 'ASSET_C',
      name: 'speech-2min.mp4',
      kind: 'video',
      container: 'mp4',
      audioCodec: 'aac',
      videoCodec: 'avc1',
      duration: 121.44,
      width: 1280,
      height: 720,
      fps: 25,
      fingerprint: cannedFingerprint(),
    },
    blocks: [
      { id: 'blk_a', start: 0.5, end: 2.5, text: 'alpha beta', words: [{ text: 'alpha', start: 0.5, end: 1.2 }, { text: 'beta', start: 1.3, end: 2.5 }], speakerId: 'SPK_1' },
      { id: 'blk_b', start: 3, end: 5, text: `${CANARY_MARKER} delta`, words: [{ text: CANARY_MARKER, start: 3, end: 4.1 }, { text: 'delta', start: 4.2, end: 5 }], speakerId: 'SPK_2' },
    ],
    captionOrigin: 'transcribed',
    translations: [],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }],
    speakerSource: 'auto-beta',
    language: 'en',
    modelId: null,
    style: { fontFamily: 'Inter', fontWeight: 400, fontSizePct: 8, textTransform: 'none', color: '#e8eaed', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 2, backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center', maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false },
    outputAspect: 'source',
    transcription: 'complete',
    updatedAt: 1_730_000_000_000,
  }
}

const PANEL: PanelState = {
  activeTab: 'media',
  collapsed: {},
  panelSizes: { sidebar: 320, timeline: 160 },
  theme: 'dark',
  transcribe: { language: 'en', modelId: null, diarize: false },
  lastPlayhead: 7.5,
  selection: { anchorBlockId: 'blk_a', focusBlockId: 'blk_b' },
}

const PEAKS: PeaksLike = { bucketSec: 0.1, min: new Float32Array([0.2, -0.5]), max: new Float32Array([0.6, 0.9]) }

/** Structural EditorAppLike over a mutable project (the contract runner must
 *  not depend on the editor app — the app side is persistence-autosave.test). */
function makeAppLike(initial: Project): { appLike: { project: { getState(): { project: Project | null }; subscribe(cb: () => void): () => void }; editor: EditorStore }; mutate: (p: Project) => void } {
  let current: Project = initial
  const listeners = new Set<() => void>()
  return {
    appLike: {
      project: {
        getState: () => ({ project: current }),
        subscribe: (cb: () => void) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
      },
      editor: {} as unknown as EditorStore,
    },
    mutate: (p: Project) => {
      current = p
      for (const listener of listeners) listener()
    },
  }
}

/** In-page handle double built to the FileSystemFileHandle surface the
 *  service is allowed to touch: queryPermission({mode:'read'}) + getFile(). */
function fakeHandle(granted: boolean, file: File, permissionLog: unknown[]): FileSystemFileHandle {
  return {
    queryPermission: async (descriptors?: { mode?: string }): Promise<PermissionState> => {
      permissionLog.push(descriptors)
      return granted ? 'granted' : 'denied'
    },
    getFile: async (): Promise<File> => file,
  } as unknown as FileSystemFileHandle
}

export function describePersistenceContract(name: string, makeService: (deps: PersistenceDeps) => Promise<PersistenceService>): void {
  describe(`persistence contract (${name})`, () => {
    test('CC-106.1: save→load round-trips project/peaks/panelState through the canonical string', async ({ skip }) => {
      const spy = createRedactionSpy()
      try {
        const bundle = createFakePersistenceDeps()
        const service = await makeService(bundle.deps)
        const { appLike, mutate } = makeAppLike(minimalProject())
        service.setPanelStateSource(() => PANEL)
        service.setPeaksSource(() => PEAKS)
        service.attachEditor(appLike)
        mutate({ ...minimalProject(), name: 'Contract rename' })
        expect(await service.saveNow('manual')).toBe('saved')
        const loaded = await service.loadProject('proj_contract')
        expect(loaded?.project.name).toBe('Contract rename')
        expect(serializeProject(loaded?.project as Project), 'byte form is the serialize.ts output').toBe(serializeProject({ ...minimalProject(), name: 'Contract rename' }))
        expect(loaded?.peaks).toEqual(PEAKS)
        expect(loaded?.panelState).toEqual(PANEL)
        expect(loaded?.readOnly).toBe(false)
        expect(spy.settle().clean, 'no canary leak through the contract round-trip').toBe(true)
      } finally {
        spy.restore()
      }
    })

    test('CC-106.5: eviction evicts ONLY blobCache rows, lowest lastOpened first; projects/mediaHandles survive', async ({ skip }) => {
      const bundle = createFakePersistenceDeps({ saveBlobLimitBytes: 250 })
      const service = await makeService(bundle.deps)
      await service.storeMediaHandle('proj_contract', null, cannedFingerprint())
      const bytes = (n: number): Blob => new Blob([new Uint8Array(n)])
      await service.cacheMediaBlob('a', bytes(100))
      bundle.clock.advance(1_000)
      await service.cacheMediaBlob('b', bytes(100))
      bundle.clock.advance(1_000)
      await service.cacheMediaBlob('c', bytes(100)) // 300 > 250 → evict 'a'
      const cached = (await service.listProjects()).map((row) => row.id)
      expect(cached, 'the projects store is untouched by eviction').toEqual([])
      const survivors = ['b', 'c']
      for (const id of survivors) {
        expect(await service.getMediaBlob(id), `${id} survived`).not.toBeNull()
      }
      expect(await service.getMediaBlob('a'), 'the LOWEST lastOpened was evicted').toBeNull()
      expect(await service.getMediaHandle('proj_contract'), 'mediaHandles is never evicted').not.toBeNull()
    })

    test('CC-106.4: silent handle restore — granted + matching fingerprint → {kind:"silent"}, picker untouched, stored row intact', async ({ skip }) => {
      const bundle = createFakePersistenceDeps()
      const service = await makeService(bundle.deps)
      const stored = cannedFingerprint()
      const file = makeFile(stored.name, stored.size)
      const permissionLog: unknown[] = []
      await service.storeMediaHandle('proj_x', fakeHandle(true, file, permissionLog), stored)
      bundle.queueProbe(stored)

      const outcome = await service.relinkMedia('proj_x')
      expect(outcome.kind, 'the silent path').toBe('silent')
      if (outcome.kind !== 'silent') return
      expect(outcome.file.name, 'the restored file carries the media name').toBe(stored.name)
      expect(bundle.pickerCalls, 'NO file chooser on the silent path').toBe(0)
      expect(permissionLog, 'the permission probe used the read mode descriptor').toContainEqual({ mode: 'read' })
      const row = await service.getMediaHandle('proj_x')
      expect(row?.fingerprint, 'the stored fingerprint is untouched').toEqual(stored)
    })

    test('CC-106.4: permission-denied falls back to the picker; a validated picked file is {kind:"silent"} with that file (Firefox path)', async ({ skip }) => {
      const bundle = createFakePersistenceDeps()
      const service = await makeService(bundle.deps)
      const stored = cannedFingerprint()
      const permissionLog: unknown[] = []
      await service.storeMediaHandle('proj_y', fakeHandle(false, makeFile('stale.mp4', 1), permissionLog), stored)
      const picked = makeFile(stored.name, stored.size)
      bundle.queuePicker(picked)
      bundle.queueProbe(stored)

      const outcome = await service.relinkMedia('proj_y')
      expect(bundle.pickerCalls, 'denied permission went through the picker fallback').toBe(1)
      expect(outcome.kind, 'picker file validated against the stored fingerprint → silent').toBe('silent')
      if (outcome.kind !== 'silent') return
      expect(outcome.file.name).toBe(stored.name)
      expect(permissionLog.length, 'the stored handle was probed first').toBe(1)
      const row = await service.getMediaHandle('proj_y')
      expect(row?.fingerprint, 'a successful relink never corrupts the stored fingerprint').toEqual(stored)
    })

    test('CC-106.4: fingerprint mismatch lists the differing fields and NEVER overwrites the stored handle/fingerprint', async ({ skip }) => {
      const bundle = createFakePersistenceDeps()
      const service = await makeService(bundle.deps)
      const stored = cannedFingerprint()
      const permissionLog: unknown[] = []
      await service.storeMediaHandle('proj_z', fakeHandle(true, makeFile(stored.name, stored.size), permissionLog), stored)
      bundle.queueProbe(cannedFingerprint({ size: stored.size + 1, sampleHashes: [stored.sampleHashes[0] ?? 'h1', 'drifted', stored.sampleHashes[2] ?? 'h3'] }))

      const outcome = await service.relinkMedia('proj_z')
      expect(outcome.kind).toBe('mismatch')
      if (outcome.kind !== 'mismatch') return
      expect([...outcome.differs].sort(), 'field-by-field compare: size + sampleHashes differ').toEqual(['sampleHashes', 'size'])
      expect(bundle.pickerCalls, 'a mismatch is a decision point, not a silent swap').toBe(0)
      const row = await service.getMediaHandle('proj_z')
      expect(row?.fingerprint, 'the stored fingerprint is NEVER overwritten on mismatch (keep-or-replace is the CALLER\'s decision)').toEqual(stored)
    })

    test('CC-106.4: no handle + cancelled picker → {kind:"picker-needed", file:null}', async ({ skip }) => {
      const bundle = createFakePersistenceDeps()
      const service = await makeService(bundle.deps)
      await service.storeMediaHandle('proj_w', null, cannedFingerprint())
      bundle.queuePicker(null)

      const outcome = await service.relinkMedia('proj_w')
      expect(outcome.kind, 'missing handle routes to the picker; cancel keeps asking').toBe('picker-needed')
      if (outcome.kind !== 'picker-needed') return
      expect(outcome.file).toBeNull()
      expect(bundle.pickerCalls).toBe(1)
    })

    test('CC-106.4: no stored row at all → a defined outcome from the pinned vocabulary (never a throw)', async ({ skip }) => {
      const bundle = createFakePersistenceDeps()
      const service = await makeService(bundle.deps)
      const outcome = await service.relinkMedia('ghost')
      expect(['no-handle', 'picker-needed']).toContain(outcome.kind)
    })
  })
}

describe('CC-106.4 (L3): the real persistence service obeys the service contract', () => {
  describePersistenceContract('fake-indexeddb real service', async (deps) => {
    const mod = await loadModule()
    const service = mod.createPersistenceService(deps)
    await service.open()
    return service
  })

  test('CC-106.1: listProjects sorts updatedAt DESC through the contract surface too', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const mod = await loadModule()
    const service = mod.createPersistenceService(bundle.deps)
    await service.open()
    const { appLike, mutate } = makeAppLike(minimalProject())
    service.attachEditor(appLike)
    mutate({ ...minimalProject(), name: 'Older', updatedAt: 1_600_000_000_000 })
    expect(await service.saveNow('manual')).toBe('saved')
    await waitUntil('row landed', () => service.getSaveState().state === 'saved')
    const rows = await service.listProjects()
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.every((row: ProjectRow, index: number, all: ProjectRow[]) => index === 0 || all[index - 1]!.updatedAt >= row.updatedAt), 'DESC by updatedAt').toBe(true)
  })
})
