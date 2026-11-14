// ADVERSARY (unit-106): counterexample regression suite over
// `src/state/services/persistence.ts` — surviving behaviors pinned as AUDIT
// tests, confirmed violations left FAILING with a `[VIOLATION]` marker for the
// fixer (the unit's own suites stay untouched; new files only).
//
// Coverage (CC-106.1/.3/.5/.6 + FR-106.3/.7/.8, SECURITY-03):
//  * canary through import/export/quota/probe-rejection error paths — CODES
//    only, never fingerprint names, project names, file names or block text
//    in any error/console channel;
//  * saveNow hammer (manual+hidden+idle interleaved) through the injected
//    put-proxy failure: last-completed-wins, no torn row, queue never stale,
//    not-saved latch clears only on success; double-attach / attach-switch
//    leaves no stale-snapshot write and no armed debounce;
//  * migration-chain honest refusals (missing chain step, non-advancing step),
//    future-row duplicate byte-preservation, import never overwrites, delete
//    of a readOnly row purges all three stores;
//  * storage edges: saveBlobLimitBytes = 0 honored (??, never ||), two
//    services racing cacheMediaBlob on one DB never exceed the limit;
//  * FR-106.8 / contract-drift source scans: no hashing/decoding tokens, no
//    protocol-type restatement in the new ports, no console logging in the
//    persistence module.
//
// KNOWN-FAILING (findings, fixer's to address — see the unit report):
//  AUDIT-106.20 / .21 relinkMedia crashes (TypeError) on a malformed stored
//    or probed fingerprint instead of returning the coded outcome vocabulary.
//  AUDIT-106.22 a rejecting requestPersist turns a COMPLETED write into
//    'failed' + DB_WRITE_FAILED (the row is stored, the UI is told otherwise).
//  AUDIT-106.23 a throwing injected peaks/panelState source rejects saveNow,
//    hangs every queued save promise and leaves the save state stuck 'saving'.
//  AUDIT-106.24 renameProject re-serializes a FUTURE-schema row with the v1
//    canonicalizer (silent 3-decimal renumbering) where saveNow refuses.
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createPersistenceService, MIGRATIONS } from '@state/services/persistence'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import { REPO_ROOT } from '../../helpers/repo'
import { cannedFingerprint, createFakePersistenceDeps, makeFile, rawRow, rawRows, rawPut } from '../editor/helpers/fake-persistence'
import type { FakePersistenceBundle } from '../editor/helpers/fake-persistence'
import type { MediaFingerprint, PanelState, PersistenceService, Project } from '@state/services/persistence'
import type { EditorStore } from '@state/generated/contract-types'

const PANEL: PanelState = {
  activeTab: 'media',
  collapsed: {},
  panelSizes: { sidebar: 320, timeline: 160 },
  theme: 'dark',
  transcribe: { language: 'en', modelId: null, diarize: false },
  lastPlayhead: 0,
  selection: null,
}

function baseProject(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: 'Adversary project',
    schemaVersion: 1,
    asset: { id: 'ASSET_A', name: 'speech-2min.mp4', kind: 'audio', container: '', audioCodec: null, videoCodec: null, duration: 0, width: 0, height: 0, fps: 0, fingerprint: cannedFingerprint() },
    blocks: [],
    captionOrigin: 'none',
    translations: [],
    speakers: [],
    speakerSource: 'none',
    language: null,
    modelId: null,
    style: { fontFamily: 'Inter', fontWeight: 400, fontSizePct: 8, textTransform: 'none', color: '#e8eaed', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 2, backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center', maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false },
    outputAspect: 'source',
    transcription: 'none',
    updatedAt: 1_730_000_000_000,
    ...overrides,
  }
}

interface AppLike {
  project: { getState(): { project: Project | null }; subscribe(cb: () => void): () => void }
  editor: EditorStore
  mutate: (next: Project) => void
}

function makeAppLike(initial: Project): AppLike {
  let current: Project = initial
  const listeners = new Set<() => void>()
  return {
    project: {
      getState: () => ({ project: current }),
      subscribe: (cb: () => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
    editor: {} as unknown as EditorStore,
    mutate: (next: Project) => {
      current = next
      for (const listener of [...listeners]) listener()
    },
  }
}

async function openService(bundle: FakePersistenceBundle): Promise<PersistenceService> {
  const service = createPersistenceService(bundle.deps)
  service.setPanelStateSource(() => PANEL)
  service.setPeaksSource(() => null)
  await service.open()
  return service
}

function blob(size: number): Blob {
  return new Blob([new Uint8Array(size)])
}

let redaction: ReturnType<typeof createRedactionSpy>
beforeEach(() => {
  redaction = createRedactionSpy()
})
afterEach(() => {
  const verdict = redaction.settle()
  redaction.restore()
  expect(verdict.leaks, 'no canary content reached any console/error channel').toEqual([])
})

// ── SECURITY-03: canary through every persistence error path ────────────────

describe('AUDIT-106 security (CC-106.1/.6, SECURITY-03): codes only, never content', () => {
  test('AUDIT-106.1: canary through import → export → stored row — the row legitimately holds it, every CHANNEL stays clean', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const doc = baseProject('proj_canary', {
      name: `${CANARY_MARKER} cut`,
      asset: { ...baseProject('x').asset, name: `${CANARY_MARKER}.mp4` },
    })
    const id = await service.importProjectFile(JSON.stringify(doc))
    const row = await rawRow<{ project: string; name: string }>(bundle.instrument.raw, 'projects', id)
    expect(row?.project, 'the stored canonical bytes carry the content (storage is allowed)').toContain(CANARY_MARKER)
    expect(await service.exportProjectFile(id), 'export returns the row bytes verbatim').toBe(row?.project)
    expect(bundle.errors, 'a happy path reports no error codes').toEqual([])
  })

  test('AUDIT-106.2: import with a canary file/project name + MALFORMED fingerprint rejects CODE-only (no name, no fragment)', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const doc = baseProject('proj_malformed', {
      name: `keep-${CANARY_MARKER}`,
      asset: { ...baseProject('x').asset, name: `${CANARY_MARKER}.mp4`, fingerprint: { name: CANARY_MARKER, size: 1, durationMs: 1, sampleHashes: 'not-an-array' } as unknown as MediaFingerprint },
    })
    const error = await service.importProjectFile(JSON.stringify(doc)).then(
      () => null,
      (thrown: unknown) => thrown as Error,
    )
    expect(error, 'a malformed fingerprint must reject').not.toBeNull()
    expect(error?.message, 'the message is the CODE only').toMatch(/^[A-Z][A-Z0-9_]*$/)
    expect(error?.message).not.toContain(CANARY_MARKER)
    expect(bundle.errors, 'IMPORT_INVALID surfaced as a code').toContain('IMPORT_INVALID')
  })

  test('AUDIT-106.3: a probe rejection whose Error message carries the canary degrades to {kind:"picker-needed"} — the message never crosses', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    await service.storeMediaHandle('proj_probe', null, cannedFingerprint())
    bundle.queuePicker(makeFile('speech-2min.mp4', 627251))
    bundle.queueProbe(new Error(`probe failed on ${CANARY_MARKER}`))
    const outcome = await service.relinkMedia('proj_probe')
    expect(outcome.kind, 'an unverifiable probe keeps asking — never a blind accept').toBe('picker-needed')
    expect(bundle.errors.every((code) => /^[A-Z][A-Z0-9_]*$/.test(code)), 'onError receives codes only').toBe(true)
  })

  test('AUDIT-106.4: QuotaExceededError mid-save resolves saveNow("failed") — the DOMException (and the canary project) never throws out', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const app = makeAppLike(baseProject('proj_quota', { name: `quota-${CANARY_MARKER}` }))
    service.attachEditor(app)
    bundle.instrument.failPutAt(0)
    app.mutate({ ...baseProject('proj_quota', { name: `quota-${CANARY_MARKER}` }), updatedAt: 1_730_000_000_001 })
    const outcome = await service.saveNow('manual')
    expect(outcome).toBe('failed')
    expect(service.getSaveState()).toMatchObject({ state: 'not-saved', errorCode: 'QUOTA_EXCEEDED' })
    expect(bundle.errors).toEqual(['QUOTA_EXCEEDED'])
  })

  test('AUDIT-106.5: SaveRefused / ZipscribeError surfaces carry the CODE as name+message (no project name, no id)', async () => {
    const bundle = createFakePersistenceDeps()
    await openService(bundle)
    const service = await openService(bundle)
    await rawPut(bundle.instrument.raw, 'projects', { id: 'proj_future', schemaVersion: 2, name: `future ${CANARY_MARKER}`, updatedAt: 1, project: JSON.stringify(baseProject('proj_future')), peaks: null, panelState: null })
    const app = makeAppLike(baseProject('proj_future'))
    service.attachEditor(app)
    app.mutate({ ...baseProject('proj_future', { name: `downgrade ${CANARY_MARKER}` }), updatedAt: 1_730_000_000_002 })
    const outcome = await service.saveNow('manual')
    expect(outcome).toBe('failed')
    expect(service.getSaveState().errorCode).toBe('SCHEMA_FUTURE')
    const reloaded = await service.loadProject('proj_future')
    expect(reloaded?.readOnly, 'the future row still loads read-only').toBe(true)
  })
})

// ── queue / atomicity / attach hammer ───────────────────────────────────────

describe('AUDIT-106 queue (CC-106.3, FR-106.2): hammering saveNow mid-failure', () => {
  test('AUDIT-106.6: manual+hidden+idle interleaved across a quota failure — last-completed-wins, latch clears only on success, no stale queue', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const app = makeAppLike(baseProject('proj_hammer'))
    service.attachEditor(app)
    app.mutate({ ...baseProject('proj_hammer'), name: 'A', updatedAt: 1 })
    expect(await service.saveNow('manual')).toBe('saved')

    const namedB = { ...baseProject('proj_hammer'), name: 'B', updatedAt: 2 }
    const namedC = { ...baseProject('proj_hammer'), name: 'C', updatedAt: 3 }
    const observed: string[] = []
    service.subscribeSaveState(() => observed.push(service.getSaveState().state))
    bundle.instrument.failPutAt(1)
    app.mutate(namedB)
    const saveB = service.saveNow('manual')
    app.mutate(namedC)
    const saveHidden = service.saveNow('hidden')
    const saveIdle = service.saveNow('idle')
    bundle.doc.fire(true) // the hidden watcher rides the same single follow-up

    expect(await saveB, 'the in-flight save hit the injected quota failure').toBe('failed')
    expect(observed, 'the failure was surfaced as not-saved before the follow-up cleared it').toContain('not-saved')
    expect(await saveHidden).toBe('saved')
    expect(await saveIdle).toBe('saved')
    expect(service.getSaveState().state, 'the latch cleared ONLY on the successful follow-up').toBe('saved')
    const row = await rawRow<{ project: string }>(bundle.instrument.raw, 'projects', 'proj_hammer')
    expect(row?.project, 'final row is the LATEST state (queue carried no stale snapshot)').toContain('"C"')
    expect(await service.saveNow('manual'), 'nothing stale remains queued').toBe('not-dirty')
  })

  test('AUDIT-106.7: a FAILED follow-up still resolves every queued caller (no hang) and a later save recovers', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const app = makeAppLike(baseProject('proj_fu'))
    service.attachEditor(app)
    app.mutate({ ...baseProject('proj_fu'), name: 'one', updatedAt: 1 })
    const first = service.saveNow('manual')
    app.mutate({ ...baseProject('proj_fu'), name: 'two', updatedAt: 2 })
    const queued = service.saveNow('manual')
    bundle.instrument.failPutAt(1) // the follow-up write (put #1) fails
    expect(await first).not.toBe('failed')
    expect(await queued, 'the queued caller settles with the follow-up outcome').toBe('failed')
    bundle.instrument.clearFailures()
    expect(await service.saveNow('manual'), 'the queue is not wedged — the pending work succeeds next').toBe('saved')
    const row = await rawRow<{ project: string }>(bundle.instrument.raw, 'projects', 'proj_fu')
    expect(row?.project).toContain('"two"')
  })

  test('AUDIT-106.8: attach-then-switch clears the pending count AND the armed debounce — the old project never gets a stale-snapshot write', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const app1 = makeAppLike(baseProject('proj_one'))
    const app2 = makeAppLike(baseProject('proj_two'))
    service.attachEditor(app1)
    app1.mutate({ ...baseProject('proj_one'), name: 'dirty', updatedAt: 1 })
    expect(service.getSaveState().state).toBe('dirty')
    service.attachEditor(app2)
    expect(await service.saveNow('manual'), 'clean-on-attach: the new project has zero pending work').toBe('not-dirty')
    bundle.timers.advance(60_000)
    expect(bundle.instrument.putsTo('projects'), 'the old pending change was dropped, the debounce was cleared').toBe(0)
    expect(await service.saveNow('manual')).toBe('not-dirty')
    expect(await rawRow(bundle.instrument.raw, 'projects', 'proj_one'), 'no orphan row for the detached project').toBeUndefined()
  })

  test('AUDIT-106.9: open() twice registers the visibilitychange watcher exactly once; hidden flushes one save', async () => {
    const bundle = createFakePersistenceDeps()
    const service = createPersistenceService(bundle.deps)
    await service.open()
    await service.open()
    expect(bundle.doc.visibilityListenerCount(), 'no duplicate hidden-flush listener per open()').toBe(1)
    const app = makeAppLike(baseProject('proj_hidden'))
    service.attachEditor(app)
    app.mutate({ ...baseProject('proj_hidden'), name: 'hide', updatedAt: 1 })
    bundle.doc.fire(true)
    for (let i = 0; i < 400 && service.getSaveState().state !== 'saved'; i++) await new Promise((r) => setTimeout(r, 0))
    expect(bundle.instrument.putsTo('projects'), 'ONE write for the hidden flush').toBe(1)
  })
})

// ── migrations + lifecycle honesty ──────────────────────────────────────────

describe('AUDIT-106 migrations (FR-106.3): honest refusals and byte-preserving copies', () => {
  test('AUDIT-106.10: a row below CURRENT with a MISSING chain step → load null + DB_READ_FAILED code (never a crash, never a half-migration)', async () => {
    expect(MIGRATIONS[0], 'no 0→1 step installed').toBeUndefined()
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    await rawPut(bundle.instrument.raw, 'projects', { id: 'proj_legacy', schemaVersion: 0, name: 'legacy', updatedAt: 1, project: JSON.stringify(baseProject('proj_legacy')), peaks: null, panelState: null })
    expect(await service.loadProject('proj_legacy'), 'unmigratable → null').toBeNull()
    expect(bundle.errors, 'DB_READ_FAILED surfaced as a code').toContain('DB_READ_FAILED')
  })

  test('AUDIT-106.11: a chain step that does not ADVANCE the version is refused (loop guard) — DB_READ_FAILED, null', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    await rawPut(bundle.instrument.raw, 'projects', { id: 'proj_stall', schemaVersion: 0, name: 'stall', updatedAt: 1, project: JSON.stringify(baseProject('proj_stall')), peaks: null, panelState: null })
    MIGRATIONS[0] = (row) => row as { schemaVersion: number }
    try {
      expect(await service.loadProject('proj_stall'), 'a non-advancing step must not spin the chain').toBeNull()
      expect(bundle.errors).toContain('DB_READ_FAILED')
    } finally {
      delete MIGRATIONS[0]
    }
  })

  test('AUDIT-106.12: duplicateProject of a FUTURE-schema row copies it byte-preserving (schemaVersion carried, project string untouched) — never downgraded to the current schema', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const futureBytes = JSON.stringify(baseProject('proj_fdup'))
    await rawPut(bundle.instrument.raw, 'projects', { id: 'proj_fdup', schemaVersion: 2, name: 'Tomorrow', updatedAt: 1, project: futureBytes, peaks: null, panelState: null })
    const copyId = await service.duplicateProject('proj_fdup')
    const copy = await rawRow<{ schemaVersion: number; project: string; name: string }>(bundle.instrument.raw, 'projects', copyId)
    expect(copy?.schemaVersion, 'the copy stays at the FUTURE version (a v1 downgrade of unknown bytes would corrupt it)').toBe(2)
    expect(copy?.project, 'the future project bytes are copied verbatim, never re-serialized').toBe(futureBytes)
    expect(copy?.name).toBe('Tomorrow (copy)')
    const original = await rawRow<{ project: string }>(bundle.instrument.raw, 'projects', 'proj_fdup')
    expect(original?.project, 'the original future row is untouched').toBe(futureBytes)
  })

  test('AUDIT-106.13: importProjectFile NEVER overwrites an existing row — fresh id, the pre-existing bytes untouched', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const bytes = JSON.stringify(baseProject('proj_seed'))
    await rawPut(bundle.instrument.raw, 'projects', { id: 'proj_seed', schemaVersion: 1, name: 'Seed', updatedAt: 1, project: bytes, peaks: null, panelState: null })
    const importedId = await service.importProjectFile(bytes)
    expect(importedId).not.toBe('proj_seed')
    const seeded = await rawRow<{ project: string; updatedAt: number }>(bundle.instrument.raw, 'projects', 'proj_seed')
    expect(seeded?.project, 'the pre-existing row is byte-identical').toBe(bytes)
    expect(seeded?.updatedAt, 'and its updatedAt was not re-stamped').toBe(1)
  })

  test('AUDIT-106.14: deleteProject of a read-only (future-schema) project purges ALL THREE stores — honest destructive purge, not a schema write', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    await rawPut(bundle.instrument.raw, 'projects', { id: 'proj_fdel', schemaVersion: 2, name: 'Tomorrow', updatedAt: 1, project: JSON.stringify(baseProject('proj_fdel')), peaks: null, panelState: null })
    await service.storeMediaHandle('proj_fdel', null, cannedFingerprint())
    await service.cacheMediaBlob('proj_fdel', blob(10))
    const handle = await service.deleteProject('proj_fdel')
    await handle.commit()
    expect(await rawRow(bundle.instrument.raw, 'projects', 'proj_fdel')).toBeUndefined()
    expect(await rawRow(bundle.instrument.raw, 'mediaHandles', 'proj_fdel')).toBeUndefined()
    expect(await rawRow(bundle.instrument.raw, 'blobCache', 'proj_fdel')).toBeUndefined()
  })
})

// ── storage edges ───────────────────────────────────────────────────────────

describe('AUDIT-106 storage (CC-106.5, FR-106.7): limit edges and concurrent services', () => {
  test('AUDIT-106.15: saveBlobLimitBytes = 0 is HONORED (??-coalesce, never ||) — every cached blob evicts immediately, zero-byte blobs fit', async () => {
    const bundle = createFakePersistenceDeps({ saveBlobLimitBytes: 0 })
    const service = await openService(bundle)
    await service.cacheMediaBlob('p1', blob(100))
    expect(await service.getMediaBlob('p1'), 'a 100-byte blob cannot fit under a zero limit').toBeNull()
    await service.cacheMediaBlob('zero', blob(0))
    expect(await service.getMediaBlob('zero'), 'a zero-byte blob totals 0 ≤ 0 and is kept').not.toBeNull()
    expect((await service.storageEstimate()).blobCacheBytes).toBe(0)
  })

  test('AUDIT-106.16: two services racing cacheMediaBlob on ONE DB never leave the cache over the limit and never half-write a row', async () => {
    const bundle = createFakePersistenceDeps({ saveBlobLimitBytes: 250 })
    const serviceA = await openService(bundle)
    const serviceB = await openService({ ...bundle, deps: { ...bundle.deps, indexedDB: bundle.instrument.raw } })
    await Promise.all([
      serviceA.cacheMediaBlob('p1', blob(100)),
      serviceB.cacheMediaBlob('p2', blob(100)),
      serviceA.cacheMediaBlob('p3', blob(100)),
      serviceB.cacheMediaBlob('p1', blob(100)),
    ])
    const rows = await rawRows<{ projectId: string; bytes: number; blob: Blob }>(bundle.instrument.raw, 'blobCache')
    const total = rows.reduce((sum, row) => sum + row.bytes, 0)
    expect(total, 'eviction is transaction-atomic even across two services').toBeLessThanOrEqual(250)
    for (const row of rows) {
      expect(row.bytes, 'bytes always equals the written blob size (never a partial row)').toBe(100)
      expect(row.blob, 'the blob survived structured clone').toBeDefined()
    }
  })
})

// ── FR-106.8 / contract-drift source scans ──────────────────────────────────

describe('AUDIT-106 scans (FR-106.8, contract drift): the main thread stays clean', () => {
  const FORBIDDEN = ['crypto.subtle', 'AudioContext', 'decodeAudioData', 'digest(', 'createMediaElementSource'] as const
  const FILES = ['src/state/services/persistence.ts', 'src/state/services/engine-port.ts', 'src/state/services/export-worker-port.ts', 'src/state/services/intake.ts', 'src/app/context.ts', 'src/ui/testing/persistence-bridge.ts'] as const

  test('AUDIT-106.17: no hashing/decoding API token appears in any unit-106 main-thread module (the probe worker is the only fingerprint source)', () => {
    for (const file of FILES) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8')
      for (const token of FORBIDDEN) {
        expect(source, `${file} must not touch "${token}" on the main thread`).not.toContain(token)
      }
    }
  })

  test('AUDIT-106.18: the new ports import — never restate — the protocol/contract unions; persistence never logs', () => {
    const exportPort = readFileSync(join(REPO_ROOT, 'src/state/services/export-worker-port.ts'), 'utf8')
    for (const restatement of ['interface ExportRequest', 'type ExportRequest', 'interface ExportEvent', 'type ExportEvent', 'interface ExportSettings', 'type ExportSettings']) {
      expect(exportPort, `export-worker-port must not restate ${restatement}`).not.toContain(restatement)
    }
    expect(exportPort, 'protocol types come from engine/protocol').toContain("from '../../engine/protocol'")
    const enginePort = readFileSync(join(REPO_ROOT, 'src/state/services/engine-port.ts'), 'utf8')
    for (const restatement of ['interface MediaFingerprint', 'type MediaFingerprint', 'interface MediaEvent', 'type MediaEvent']) {
      expect(enginePort, `engine-port must not restate ${restatement}`).not.toContain(restatement)
    }
    const persistence = readFileSync(join(REPO_ROOT, 'src/state/services/persistence.ts'), 'utf8')
    for (const restatement of ['interface MediaFingerprint', 'type MediaFingerprint =', 'interface Project ', 'type Project =']) {
      expect(persistence, `persistence must not restate ${restatement} (contract types are imported/re-exported only)`).not.toContain(restatement)
    }
    expect(persistence, 'SECURITY-03: the persistence module never logs').not.toMatch(/console\s*\./u)
  })
})

// ── findings (fail against HEAD 75c22a7 — for the fixer) ────────────────────

describe('AUDIT-106 findings (CONFIRMED violations — failing by design until fixed)', () => {
  test('AUDIT-106.20 [VIOLATION]: relinkMedia on a malformed STORED fingerprint must return the coded outcome vocabulary, never throw', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    await service.storeMediaHandle('proj_bad', null, { name: 'a.mp4', size: 10, durationMs: 100, sampleHashes: undefined } as unknown as MediaFingerprint)
    bundle.queuePicker(makeFile('a.mp4', 10))
    const outcome = await service.relinkMedia('proj_bad').catch((thrown: unknown) => {
      throw new Error(`relinkMedia THREW ${(thrown as Error).name}: the contract is Promise<RelinkOutcome>, a defined outcome from the pinned vocabulary (persistence.ts:814-837 compares an unvalidated stored fingerprint)`)
    })
    expect(['silent', 'picker-needed', 'mismatch', 'no-handle'], 'a defined outcome even when the stored row is corrupt').toContain(outcome.kind)
  })

  test('AUDIT-106.21 [VIOLATION]: relinkMedia on a malformed PROBE result must return the coded outcome vocabulary, never throw', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    await service.storeMediaHandle('proj_bad2', null, cannedFingerprint())
    bundle.queuePicker(makeFile('speech-2min.mp4', 627251))
    bundle.queueProbe({ name: 'speech-2min.mp4', size: 627251, durationMs: 121440 } as unknown as MediaFingerprint)
    const outcome = await service.relinkMedia('proj_bad2').catch((thrown: unknown) => {
      throw new Error(`relinkMedia THREW ${(thrown as Error).name}: a probe result missing sampleHashes crashes the elementwise compare (persistence.ts:828-833) instead of failing to validate → picker-needed`)
    })
    expect(outcome.kind, 'an unusable probe result can only keep asking').not.toBe('silent')
  })

  test('AUDIT-106.22 [VIOLATION]: a rejecting requestPersist must NOT turn a completed save into failed/DB_WRITE_FAILED (FR-106.7 — never a blocking prompt)', async () => {
    const bundle = createFakePersistenceDeps({ requestPersist: () => Promise.reject(new Error('storage persist rejected')) })
    const service = await openService(bundle)
    const app = makeAppLike(baseProject('proj_persist'))
    service.attachEditor(app)
    app.mutate({ ...baseProject('proj_persist'), name: 'Persist me', updatedAt: 1_730_000_000_001 })
    const outcome = await service.saveNow('manual')
    const row = await rawRow(bundle.instrument.raw, 'projects', 'proj_persist')
    expect(row, 'the write itself landed').toBeDefined()
    expect(outcome, 'the save outcome must report the SUCCESSFUL write; the persist request is orthogonal (persistence.ts:562-565 awaits it inside the save try)')
      .toBe('saved')
    expect(service.getSaveState().state).toBe('saved')
    expect(bundle.errors, 'a persist rejection is not a DB_WRITE_FAILED').not.toContain('DB_WRITE_FAILED')
  })

  test('AUDIT-106.23 [VIOLATION]: a throwing injected peaks source must not reject saveNow, hang queued saves, or leave the state stuck "saving"', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const app = makeAppLike(baseProject('proj_source'))
    service.attachEditor(app)
    let boom = false
    service.setPeaksSource(() => {
      if (boom) throw new Error('injected source exploded')
      return null
    })
    app.mutate({ ...baseProject('proj_source'), name: 'first', updatedAt: 1 })
    const saveA = service.saveNow('manual')
    boom = true
    app.mutate({ ...baseProject('proj_source'), name: 'second', updatedAt: 2 })
    const saveB = service.saveNow('idle')
    const settle = async (promise: Promise<string>, label: string): Promise<string> =>
      await Promise.race([promise, new Promise<string>((resolve) => setTimeout(() => resolve(`${label}:HANG`), 300))])
    const resultA = await settle(saveA.then((r) => `resolved:${r}`, (thrown: unknown) => `rejected:${(thrown as Error).message}`), 'saveA')
    const resultB = await settle(saveB.then((r) => `resolved:${r}`, (thrown: unknown) => `rejected:${(thrown as Error).message}`), 'saveB')
    expect(resultA, 'saveNow returns Promise<SaveOutcome> — a row-build source failure must be classified as a failed save (persistence.ts:546-555 builds the row OUTSIDE the try, persistence.ts:586-589 splices waiters then lets the follow-up throw)')
      .toBe('resolved:failed')
    expect(resultB, 'queued callers must settle with the follow-up outcome, never hang').toBe('resolved:failed')
    expect(service.getSaveState().state, 'the save-state machine must leave "saving" — not-saved with a code').not.toBe('saving')
  })

  test('AUDIT-106.24 [VIOLATION]: renameProject must refuse a FUTURE-schema row (SCHEMA_FUTURE) like saveNow does — it must not re-serialize unknown bytes through the v1 canonicalizer', async () => {
    const bundle = createFakePersistenceDeps()
    const service = await openService(bundle)
    const futureBytes = JSON.stringify(baseProject('proj_frename'))
    await rawPut(bundle.instrument.raw, 'projects', { id: 'proj_frename', schemaVersion: 2, name: 'Tomorrow', updatedAt: 1, project: futureBytes, peaks: null, panelState: null })
    const rejected = await service
      .renameProject?.('proj_frename', 'Renamed from below')
      .then(() => false, () => true)
    const row = await rawRow<{ project: string; name: string }>(bundle.instrument.raw, 'projects', 'proj_frename')
    expect(rejected, 'renaming a future-schema row must reject with a CODE (writeProjectRow has the guard; renameProject — persistence.ts:729-738 — bypasses it and re-runs the v1 serializer over future bytes, silently applying 3-decimal rounding)').toBe(true)
    expect(row?.project, 'the newer row bytes must be untouched').toBe(futureBytes)
  })
})
