// CC-106.1/.2/.3/.5/.6 (L1, node + fake-indexeddb): the persistence service —
// the ONE home of IndexedDB calls (FR-106.1). Store trio + key paths + the
// documented EXCLUSION LIST (playing/rate/loop/searchOpen/live playhead mirror
// are UI state, never persisted); save/load byte-equality THROUGH serialize.ts
// only (the stored `project` field is string-equal to `serializeProject`, the
// canonical golden convention survives save→reload→re-save, invariant 8);
// interrupted-transcription reopen (CC-106.2: committed blocks + `partial`
// survive); racing saves last-completed-wins + fail-at-each-step quota
// injection with IDB-transaction atomicity (CC-106.3); migration baseline +
// chain-upgrade + future-schema read-only refusal; LRU blobCache eviction with
// "projects/mediaHandles/JSON never evicted" (CC-106.5); honest storage
// estimate + one-shot persist request (FR-106.7); deferred purge +
// toast-undoable delete across ALL THREE stores; `.zipscribe.json`
// export→import byte-equal round-trip (CC-106.6). SECURITY-03: the whole file
// runs under the redaction spy (canary content flows through every save) and
// malformed imports surface a CODE only. RED until the builder ships
// `src/state/services/persistence.ts` (the dynamic import below is the
// intended missing-module seam).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createEditorApp } from '@state/history'
import { createFakeClock } from '../../../src/test-support/fake-clock'
import { CANARY_MARKER, createRedactionSpy } from '../../../src/test-support/redaction'
import { serializeProject, parseProject } from '@state/services/serialize'
import { createFakeRafs } from '../editor/helpers/fake-rafs'
import { CANNED_PANEL_STATE, CANNED_PEAKS, cannedFingerprint, createFakePersistenceDeps, rawKeyPath, rawPut, rawRow, rawRows, rawStoreNames, waitUntil } from '../editor/helpers/fake-persistence'
import type { FakePersistenceBundle } from '../editor/helpers/fake-persistence'
import type { PanelState, PersistenceService, PeaksLike, Project, ProjectRow } from '../editor/helpers/fake-persistence'


const PERSISTENCE_MODULE = '@state/services/persistence'
type PersistenceModule = typeof import('@state/services/persistence')

async function loadModule(): Promise<PersistenceModule> {
  return (await import(/* @vite-ignore */ PERSISTENCE_MODULE)) as unknown as PersistenceModule
}

const GOLDEN_PATH = fileURLToPath(new URL('../../../fixtures/golden/project-canonical-v1.json', import.meta.url))
const GOLDEN_BYTES = readFileSync(GOLDEN_PATH, 'utf8')

// Local fixtures: the golden project is the serialization convention anchor;
// the sample carries the SECURITY-03 canary block through every save.
// (Placement deviation from conventions § L1 "next to source": RED-by-
// missing-module suites live in the tests tree so the ambient contract d.ts
// — tests/unit/editor/unit106-api-contract.d.ts — is in the typecheck
// program, the established unit-101…104 pattern; the module itself will be
// src/state/services/persistence.ts.)
function sampleProjectLocal(overrides: Partial<Project> = {}): Project {
  const base = structuredClone(parseProject(GOLDEN_BYTES))
  return {
    ...base,
    id: 'proj_106',
    name: 'Sample project',
    schemaVersion: 1,
    transcription: 'complete',
    updatedAt: 1_730_000_000_000,
    blocks: [
      { id: 'blk_a', start: 0.5, end: 2.5, text: 'alpha beta gamma', words: [{ text: 'alpha', start: 0.5, end: 1.2 }, { text: 'beta', start: 1.3, end: 1.9 }, { text: 'gamma', start: 2.0, end: 2.5 }], speakerId: 'SPK_1' },
      { id: 'blk_b', start: 3.0, end: 5.0, text: `${CANARY_MARKER} delta`, words: [{ text: CANARY_MARKER, start: 3.0, end: 4.1, probability: 0.9 }, { text: 'delta', start: 4.2, end: 5.0 }], speakerId: 'SPK_2' },
    ],
    ...overrides,
  }
}

const IDLE_PANEL = (): PanelState => ({ ...CANNED_PANEL_STATE, activeTab: 'media' })

async function makeService(bundle: FakePersistenceBundle, peaks: PeaksLike | null = CANNED_PEAKS): Promise<PersistenceService> {
  const mod = await loadModule()
  const service = mod.createPersistenceService(bundle.deps)
  service.setPanelStateSource(IDLE_PANEL)
  service.setPeaksSource(() => peaks)
  await service.open()
  return service
}

/** A second service over the SAME fake DB, bypassing the put interceptor. */
function survivorBundle(bundle: FakePersistenceBundle): FakePersistenceBundle {
  return { ...bundle, deps: { ...bundle.deps, indexedDB: bundle.instrument.raw } }
}

function makeApp(project: Project) {
  return createEditorApp({ clock: createFakeClock(1_730_000_000_000), rafs: createFakeRafs(0), initialProject: project })
}

function blob(size: number): Blob {
  return new Blob([new Uint8Array(size)])
}

function blobIds(rows: { projectId: string }[]): string[] {
  return rows.map((row) => row.projectId).sort()
}

// ── SECURITY-03: the canary flows through every save in this suite ──────────

let redaction: ReturnType<typeof createRedactionSpy>
beforeEach(() => {
  redaction = createRedactionSpy()
})
afterEach(() => {
  const verdict = redaction.settle()
  redaction.restore()
  expect(verdict.leaks, 'no canary content reached any console/error channel').toEqual([])
  expect(verdict.clean).toBe(true)
})

describe('CC-106.1: store trio, canonical byte form, documented exclusion list', () => {
  test('CC-106.1: database `zipscribe` v1 exposes exactly the three stores with their key paths', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    expect(await service.saveNow('manual'), 'clean project: manual performs NO write').toBe('not-dirty')
    expect((await rawStoreNames(bundle.instrument.raw)).sort(), 'exactly the FR-106.1 trio').toEqual(['blobCache', 'mediaHandles', 'projects'])
    expect(await rawKeyPath(bundle.instrument.raw, 'projects'), 'projects keyPath').toBe('id')
    expect(await rawKeyPath(bundle.instrument.raw, 'mediaHandles'), 'mediaHandles keyPath').toBe('projectId')
    expect(await rawKeyPath(bundle.instrument.raw, 'blobCache'), 'blobCache keyPath').toBe('projectId')
  })

  test('CC-106.1: the persistence.ts docblock documents the exclusion list (playing, rate, loop, searchOpen)', async ({ skip }) => {
    // [106-ADJ 1] orchestrator path fix: the module under test lives at
    // src/state/services/persistence.ts (every other access in this suite
    // uses the @state alias; './persistence.ts' resolved next to THIS test
    // → ENOENT). Assertion unchanged — the real source still must document
    // the exclusion list.
    const source = readFileSync(new URL('../../../src/state/services/persistence.ts', import.meta.url), 'utf8')
    for (const excluded of ['playing', 'rate', 'loop', 'searchOpen']) {
      expect(source, `docblock must name the excluded UI state "${excluded}"`).toContain(excluded)
    }
    expect(source.toLowerCase(), 'the docblock documents the exclusion list as such').toMatch(/exclus/)
  })

  test('CC-106.1: the stored `project` field is string-equal to serializeProject output — serialize.ts is the ONLY byte form', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Interview cut 2' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    const row = await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', 'proj_106')
    expect(row, 'row landed').toBeDefined()
    expect(typeof row?.project, 'the CANONICAL STRING, never a re-implementation').toBe('string')
    expect(row?.project, 'byte-equal to serializeProject(state.project)').toBe(serializeProject(app.project.getState().project as Project))
    expect(Object.keys(row ?? {}).sort(), 'row shape is exactly the pinned seven fields').toEqual(['id', 'name', 'panelState', 'peaks', 'project', 'schemaVersion', 'updatedAt'])
  })

  test('CC-106.1: golden convention — canonical bytes are unchanged across save→reload→re-save; peaks + panelState ride along structural-equal (invariant 8)', async ({ skip }) => {
    expect(serializeProject(parseProject(GOLDEN_BYTES)), 'the committed golden is canonical fixed-point (the 102 golden convention)').toBe(GOLDEN_BYTES)

    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Autosaved cut' })).toBeNull()
    bundle.timers.advance(2_000)
    await waitUntil('autosave settled', () => service.getSaveState().state === 'saved')

    const row = await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', 'proj_106')
    const bytes = serializeProject(app.project.getState().project as Project)
    expect(row?.project, 'the autosaved row carries the canonical bytes').toBe(bytes)

    const reloaded = await (await makeService(survivorBundle(bundle))).loadProject('proj_106')
    expect(reloaded, 'reload finds the row').not.toBeNull()
    expect(serializeProject(reloaded?.project as Project), 'parse ∘ serialize is the identity — reload is byte-equal').toBe(bytes)
    expect(reloaded?.peaks, 'peaks structural-equal').toEqual(CANNED_PEAKS)
    expect(reloaded?.panelState, 'panelState structural-equal').toEqual(IDLE_PANEL())
    expect(reloaded?.readOnly, 'current schema loads writable').toBe(false)

    expect(await service.saveNow('manual'), 'reload leaves nothing pending — re-save performs no write').toBe('not-dirty')
  })

  test('CC-106.1: the exclusion list is real — playing/rate/loop/searchOpen changes never persist (not-dirty, zero writes)', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Baseline' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    const putsBefore = bundle.instrument.putsTo('projects')

    app.editor.setPlaying(true)
    app.editor.setRate(2)
    app.editor.setLoop([1, 2])
    app.editor.setSearchOpen(true)
    expect(await service.saveNow('manual'), 'pure UI state is never pending work').toBe('not-dirty')
    expect(bundle.instrument.putsTo('projects'), 'zero extra writes for UI state').toBe(putsBefore)
    const row = await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', 'proj_106')
    const serialized = JSON.stringify(row)
    for (const excluded of ['playing', 'rate', 'loop', 'searchOpen']) {
      expect(serialized, `"${excluded}" never reaches the row`).not.toContain(`"${excluded}"`)
    }
  })

  // [106-ADJ 6] moved into its own CC-106.2-leading describe — the verify
  // credit policy counts only the LEADING citation of the combined
  // "suite > test" title (scripts/lib/criteria-credit.ts), so this test sat
  // under the CC-106.1 suite with zero credit. Body and assertions are
  // byte-identical.
})

describe('CC-106.2: interrupted-transcription reopen keeps committed blocks', () => {
  test('CC-106.2: a project saved with transcription `partial` reopens with its committed blocks kept', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal({ transcription: 'partial' }))
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Mid-stream app quit' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')

    const reloaded = await (await makeService(survivorBundle(bundle))).loadProject('proj_106')
    expect(reloaded?.project.transcription, 'the partial state survives the close/reopen cycle').toBe('partial')
    expect(reloaded?.project.blocks.length, 'blocks committed before the unload are kept (engine-1/05 contract)').toBe(2)
  })
})

describe('CC-106.3: racing saves, torn-write injection, migrations', () => {
  test('CC-106.3: two racing autosaves end with the LATEST state — last-completed-wins, the row is never torn', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'First cut' })).toBeNull()
    const saveA = service.saveNow('manual')
    expect(app.dispatch('project-rename', { name: 'Second cut' }), 'a change lands WHILE save A is in flight').toBeNull()
    const saveB = service.saveNow('idle')
    expect(await saveA).not.toBe('failed')
    expect(await saveB).not.toBe('failed')
    const row = await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', 'proj_106')
    expect(row?.project, 'final row = the latest state').toBe(serializeProject(app.project.getState().project as Project))
    expect(parseProject(row?.project as string).name, 'the row parses whole (never torn)').toBe('Second cut')
    expect(bundle.instrument.putsTo('projects'), 'the follow-up ran after completion (never concurrent)').toBeGreaterThanOrEqual(2)
  })

  test('CC-106.3: quota failure on the FIRST write (fail-at-step k=0) → persistent not-saved + QUOTA_EXCEEDED, empty stores', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    bundle.instrument.failPutAt(0)
    expect(app.dispatch('project-rename', { name: 'Never saved' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('failed')
    const state = service.getSaveState()
    expect(state.state).toBe('not-saved')
    expect(state.errorCode).toBe('QUOTA_EXCEEDED')
    expect(bundle.errors).toContain('QUOTA_EXCEEDED')
    const survivor = await makeService(survivorBundle(bundle))
    expect(await survivor.listProjects(), 'the store is untouched — nothing half-written').toEqual([])
  })

  test('CC-106.3: quota failure on a LATER write (fail-at-step k=1) → the row is fully-OLD (IDB txn atomicity), reload on a fresh service agrees', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Good save' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    const goodBytes = serializeProject(app.project.getState().project as Project)

    bundle.instrument.failPutAt(1)
    expect(app.dispatch('project-rename', { name: 'Quota-blocked save' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('failed')
    expect(service.getSaveState().state).toBe('not-saved')

    const survivor = await makeService(survivorBundle(bundle))
    const row = await survivor.loadProject('proj_106')
    expect(row, 'the row is either fully-old or fully-new — here fully-old').not.toBeNull()
    expect(serializeProject(row?.project as Project), 'fully-old: byte-equal to the last good save').toBe(goodBytes)
  })

  test('CC-106.3: not-saved is persistent until a LATER successful save clears it (CC-I2.12 backing)', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    bundle.instrument.failPutAt(0)
    expect(app.dispatch('project-rename', { name: 'Blocked' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('failed')
    expect(service.getSaveState().state).toBe('not-saved')

    bundle.instrument.clearFailures()
    expect(await service.saveNow('manual'), 'the same pending work succeeds once the quota frees').toBe('saved')
    expect(service.getSaveState().state).toBe('saved')
    expect(service.getSaveState().errorCode, 'the error clears only on success').toBeNull()
    expect(service.getSaveState().lastSavedAt).toBe(1_730_000_000_000)
  })

  test('CC-106.3: MIGRATIONS[1] is the exported identity baseline', async ({ skip }) => {
    const mod = await loadModule()
    expect(mod.PERSISTENCE_SCHEMA_VERSION).toBe(1)
    const baseline = mod.MIGRATIONS[1]
    expect(baseline, 'the v1 baseline migration is exported').toBeDefined()
    const row: ProjectRow = { id: 'm', schemaVersion: 1, name: 'n', updatedAt: 1, project: '{}', peaks: null, panelState: null }
    expect(baseline?.(row)).toEqual({ ...row })
  })

  test('CC-106.3: a schemaVersion-0 row upgrades through the MIGRATIONS chain before use', async ({ skip }) => {
    const mod = await loadModule()
    expect(mod.MIGRATIONS[0], 'the test installs the 0→1 step of the chain').toBeUndefined()
    mod.MIGRATIONS[0] = (row) => ({ ...(row as Record<string, unknown>), schemaVersion: 1 })
    try {
      const bundle = createFakePersistenceDeps()
      await makeService(bundle)
      const legacy: ProjectRow = { id: 'proj_106', schemaVersion: 0, name: 'Sample project', updatedAt: 1_600_000_000_000, project: JSON.stringify(sampleProjectLocal()), peaks: null, panelState: null }
      await rawPut(bundle.instrument.raw, 'projects', legacy)
      const loaded = await (await makeService(survivorBundle(bundle))).loadProject('proj_106')
      expect(loaded, 'the chain-upgraded row is usable').not.toBeNull()
      expect(loaded?.readOnly, 'a CHAINED-UP row is writable (only FUTURE versions are read-only)').toBe(false)
      expect(loaded?.project.name).toBe('Sample project')
    } finally {
      delete mod.MIGRATIONS[0]
    }
  })

  test('CC-106.3: a future-schemaVersion row loads readOnly with SCHEMA_FUTURE and any save for it is refused (never written over)', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    await makeService(bundle)
    const futureRow: ProjectRow = { id: 'proj_106', schemaVersion: 2, name: 'From tomorrow', updatedAt: 1, project: JSON.stringify(sampleProjectLocal()), peaks: null, panelState: null }
    await rawPut(bundle.instrument.raw, 'projects', futureRow)
    const service = await makeService(survivorBundle(bundle))

    const loaded = await service.loadProject('proj_106')
    expect(loaded, 'the future row still loads').not.toBeNull()
    expect(loaded?.readOnly, 'future schema loads READ-ONLY').toBe(true)
    expect(bundle.errors, 'SCHEMA_FUTURE surfaced as a code').toContain('SCHEMA_FUTURE')

    const app = makeApp(sampleProjectLocal({ id: 'proj_106' }))
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Downgrade attempt' })).toBeNull()
    expect(await service.saveNow('manual'), 'save for a future-schema project is REFUSED').toBe('failed')
    const after = await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', 'proj_106')
    expect(after?.project, 'the newer row bytes are untouched (never written over)').toBe(futureRow.project)
    expect(after?.schemaVersion, 'schemaVersion stays ahead').toBe(2)
  })
})

describe('CC-106.5 + FR-106.7: blob LRU, storage honesty, lifecycle', () => {
  test('CC-106.5: blobCache evicts LOWEST lastOpened first while over the limit — projects and mediaHandles rows are NEVER evicted (JSON never evicted)', async ({ skip }) => {
    const bundle = createFakePersistenceDeps({ saveBlobLimitBytes: 250 })
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Keep me' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    await service.storeMediaHandle('proj_106', null, cannedFingerprint())

    await service.cacheMediaBlob('p1', blob(100))
    bundle.clock.advance(1_000)
    await service.cacheMediaBlob('p2', blob(100))
    bundle.clock.advance(1_000)
    await service.cacheMediaBlob('p3', blob(100))
    expect(blobIds(await rawRows<{ projectId: string }>(bundle.instrument.raw, 'blobCache')), 'p1 is the lowest lastOpened and goes first').toEqual(['p2', 'p3'])
    expect(await rawRow(bundle.instrument.raw, 'projects', 'proj_106'), 'project JSON NEVER evicted').toBeDefined()
    expect(await rawRow(bundle.instrument.raw, 'mediaHandles', 'proj_106'), 'mediaHandles NEVER evicted').toBeDefined()

    bundle.clock.advance(1_000)
    await service.cacheMediaBlob('p4', blob(100))
    expect(blobIds(await rawRows<{ projectId: string }>(bundle.instrument.raw, 'blobCache')), 'then p2').toEqual(['p3', 'p4'])
  })

  test('CC-106.5: getMediaBlob touches lastOpened — recency changes the eviction order', async ({ skip }) => {
    const bundle = createFakePersistenceDeps({ saveBlobLimitBytes: 250 })
    const service = await makeService(bundle)
    await service.cacheMediaBlob('p1', blob(100))
    bundle.clock.advance(1_000)
    await service.cacheMediaBlob('p2', blob(100))
    bundle.clock.advance(1_000)
    await service.cacheMediaBlob('p3', blob(100)) // evicts p1
    bundle.clock.advance(1_000)
    await service.cacheMediaBlob('p4', blob(100)) // evicts p2
    bundle.clock.advance(1_000)
    expect(await service.getMediaBlob('p3'), 'the cached blob comes back').not.toBeNull()
    bundle.clock.advance(1_000)
    await service.cacheMediaBlob('p5', blob(100)) // total 300 → lowest lastOpened now p4 (p3 was just touched)
    expect(blobIds(await rawRows<{ projectId: string }>(bundle.instrument.raw, 'blobCache')), 'touch rescued p3; p4 paid instead').toEqual(['p3', 'p5'])
  })

  test('FR-106.7: storageEstimate is honest — injected passthrough + cached persisted flag; requestPersist fires exactly ONCE on the first new-project save', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    bundle.setEstimate(123_456, 5 * 1024 * 1024 * 1024)
    bundle.setPersistResult(true)
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(bundle.requestPersistCalls, 'never before a save').toBe(0)
    expect(app.dispatch('project-rename', { name: 'First save' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    expect(bundle.requestPersistCalls, 'first successful save of a NEW project requests persist once').toBe(1)
    expect(app.dispatch('project-rename', { name: 'Second save' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    expect(bundle.requestPersistCalls, 'once per service lifetime — never again').toBe(1)

    const estimate = await service.storageEstimate()
    expect(estimate.usage, 'injected estimate passthrough').toBe(123_456)
    expect(estimate.quota).toBe(5 * 1024 * 1024 * 1024)
    expect(estimate.persisted, 'the honest requestPersist result').toBe(true)
    expect(estimate.blobCacheBytes, 'nothing cached').toBe(0)

    const denied = createFakePersistenceDeps()
    denied.setPersistResult(false)
    const deniedService = await makeService(denied)
    const app2 = makeApp(sampleProjectLocal({ id: 'proj_denied' }))
    deniedService.attachEditor(app2)
    expect(app2.dispatch('project-rename', { name: 'Denied' })).toBeNull()
    expect(await deniedService.saveNow('manual')).toBe('saved')
    expect((await deniedService.storageEstimate()).persisted, 'persist OFF is displayed honestly').toBe(false)
  })

  test('CC-106.5: deleteProject defers the purge — the row REMAINS until commit(); undo cancels it; commit purges ALL THREE stores', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Doomed' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    await service.storeMediaHandle('proj_106', null, cannedFingerprint())
    await service.cacheMediaBlob('proj_106', blob(10))

    const first = await service.deleteProject('proj_106')
    expect(await rawRow(bundle.instrument.raw, 'projects', 'proj_106'), 'row REMAINS before commit (toast-undoable)').toBeDefined()
    first.undo()
    expect(await rawRow(bundle.instrument.raw, 'projects', 'proj_106'), 'undo cancels the purge — row survives').toBeDefined()

    const second = await service.deleteProject('proj_106')
    await second.commit()
    expect(await rawRow(bundle.instrument.raw, 'projects', 'proj_106'), 'commit purges projects').toBeUndefined()
    expect(await rawRow(bundle.instrument.raw, 'mediaHandles', 'proj_106'), 'commit purges mediaHandles').toBeUndefined()
    expect(await rawRow(bundle.instrument.raw, 'blobCache', 'proj_106'), 'commit purges blobCache').toBeUndefined()
    expect(await service.listProjects(), 'the list no longer shows it').toEqual([])
  })

  test('CC-106.5: duplicateProject suffixes " (copy)", fresh id + updatedAt=now, copies project/peaks/panelState + the handle row — the blob cache is NOT copied', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal({ name: 'Cut 1' }))
    service.attachEditor(app)
    // [106-ADJ 2] seeding amended per the pinned save semantics —
    // "manual forces EXACTLY ONE write when dirty and performs NO write when
    // clean" (tests/unit/editor/persistence-autosave.test.ts § manual) and
    // this suite's own clean-project expectations at :114/:168/:185. A fresh
    // attach with no command is CLEAN, so the seed dirties through two real
    // commands that net back to the original bytes (copy name and
    // byte-equality assertions below are unchanged).
    expect(app.dispatch('project-rename', { name: 'Cut 1 · seeded' })).toBeNull()
    expect(app.dispatch('project-rename', { name: 'Cut 1' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    await service.storeMediaHandle('proj_106', null, cannedFingerprint())
    await service.cacheMediaBlob('proj_106', blob(10))

    bundle.clock.advance(9_000)
    const copyId = await service.duplicateProject('proj_106')
    expect(copyId).not.toBe('proj_106')
    const copy = await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', copyId)
    expect(copy?.name, 'name suffixed " (copy)"').toBe('Cut 1 (copy)')
    expect(copy?.updatedAt, 'updatedAt = injected clock now').toBe(1_730_000_009_000)
    const original = await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', 'proj_106')
    expect(copy?.project, 'project copied byte-equal (the canonical string)').toBe(original?.project)
    expect(copy?.peaks, 'peaks copied').toEqual(original?.peaks)
    expect(copy?.panelState, 'panelState copied').toEqual(original?.panelState)
    expect(await rawRow(bundle.instrument.raw, 'mediaHandles', copyId), 'mediaHandles row copied').toBeDefined()
    expect(await rawRow(bundle.instrument.raw, 'blobCache', copyId), 'blobCache NOT copied — the cache refills on demand').toBeUndefined()
  })

  test('CC-106.5: openProject records lastOpened on its blobCache row (touch); listProjects sorts updatedAt DESC', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    // [106-ADJ 3] same adjudication as the duplicateProject seeding — the
    // seed dirties through a command ping-pong netting to the original
    // bytes; sort-order and touch assertions unchanged.
    expect(app.dispatch('project-rename', { name: 'Sample project · seeded' })).toBeNull()
    expect(app.dispatch('project-rename', { name: 'Sample project' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    await service.cacheMediaBlob('proj_106', blob(10))
    const before = await rawRow<{ lastOpened: number }>(bundle.instrument.raw, 'blobCache', 'proj_106')

    await rawPut(bundle.instrument.raw, 'projects', {
      id: 'proj_b',
      schemaVersion: 1,
      name: 'B',
      updatedAt: 1_600_000_000_000,
      project: JSON.stringify(sampleProjectLocal({ id: 'proj_b', name: 'B', updatedAt: 1_600_000_000_000 })),
      peaks: null,
      panelState: null,
    } satisfies ProjectRow)

    bundle.clock.advance(5_000)
    const opened = await service.openProject('proj_106')
    expect(opened, 'openProject returns the loaded project').not.toBeNull()
    const touched = await rawRow<{ lastOpened: number }>(bundle.instrument.raw, 'blobCache', 'proj_106')
    expect(touched?.lastOpened, 'the touch recorded clock.now()').toBe(1_730_000_005_000)
    expect(touched?.lastOpened).not.toBe(before?.lastOpened)

    const listed = await service.listProjects()
    expect(listed.map((row) => row.id), 'updatedAt DESC').toEqual(['proj_106', 'proj_b'])
  })
})

describe('CC-106.6: .zipscribe.json export → import round-trip', () => {
  test('CC-106.6: exportProjectFile returns the canonical project string verbatim; unknown id → null', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Backup me' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    expect(await service.exportProjectFile('proj_106'), 'the file content is the serializeProject output, byte-equal').toBe(serializeProject(app.project.getState().project as Project))
    expect(await service.exportProjectFile('nope'), 'unknown id is null, not a throw').toBeNull()
  })

  test('CC-106.6: export→import→re-export is byte-equal content with a fresh id + updatedAt; the source row is untouched', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    const app = makeApp(sampleProjectLocal())
    service.attachEditor(app)
    expect(app.dispatch('project-rename', { name: 'Shareable' })).toBeNull()
    expect(await service.saveNow('manual')).toBe('saved')
    const exported = (await service.exportProjectFile('proj_106')) as string

    const importedId = await service.importProjectFile(exported)
    expect(importedId).not.toBe('proj_106')
    const reExported = (await service.exportProjectFile(importedId)) as string
    expect(reExported, 'the re-export is canonical fixed-point (serialize ∘ parse identity)').toBe(serializeProject(parseProject(reExported)))

    const original = parseProject(exported)
    const round = parseProject(reExported)
    expect(round.id, 'import assigns a fresh id').not.toBe(original.id)
    expect(round.updatedAt, 'and updatedAt').toBeGreaterThanOrEqual(original.updatedAt)
    expect({ ...round, id: original.id, updatedAt: original.updatedAt }, 'everything else — blocks, translations, fingerprint, style — is content-equal').toEqual(original)
    expect((await rawRow<ProjectRow>(bundle.instrument.raw, 'projects', 'proj_106'))?.project, 'the source row bytes are untouched').toBe(exported)
  })

  test('CC-106.6 / SECURITY-03: malformed import rejects with a CODE-only message + IMPORT_INVALID — never an input fragment', async ({ skip }) => {
    const bundle = createFakePersistenceDeps()
    const service = await makeService(bundle)
    let message = 'NO THROW'
    try {
      await service.importProjectFile('{"name":"LEAKCANARY-9f4c — broken json')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toBe('NO THROW')
    expect(message, 'the error message is a CODE only').toMatch(/^[A-Z][A-Z0-9_]*$/)
    expect(message.includes('LEAKCANARY'), 'no input fragment in the message').toBe(false)
    expect(bundle.errors, 'IMPORT_INVALID surfaced').toContain('IMPORT_INVALID')
  })
})
