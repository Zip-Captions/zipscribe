// CC-106.1 / FR-106.2 + CC-106.3 (L1, node): the autosave predicate and the
// save-state machine on the REAL editor app (`createTestApp()` — frozen
// helpers, real commands, zero helper edits). No save with 0 pending even
// after long idle; no save before 2 s idle; each new change RESETS the
// debounce; never two saves in flight (follow-up runs AFTER completion with
// the LATEST state — CC-106.3 last-completed-wins); `visibilitychange→hidden`
// forces when pending ≥ 1 and no-ops when clean; `manual` forces exactly ONE
// write when dirty and performs NO write ('not-dirty') when clean; the
// save-state sequence idle→dirty→saving→saved with lastSavedAt from the
// injected clock. Timers/document/clock are all injected (conventions §
// Principles 3). RED until the builder ships `@state/services/persistence`
// (dynamic import — the intended missing-module seam; self-skips under the
// gates-scaffold child run, unit-04/06/104 RED precedent).
// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createTestApp } from './helpers/editor-app'
import { CANNED_PANEL_STATE, CANNED_PEAKS, createFakePersistenceDeps, waitUntil } from './helpers/fake-persistence'
import type { FakePersistenceBundle } from './helpers/fake-persistence'
import { serializeProject } from '@state/services/serialize'
import type { PersistenceService } from '@state/services/persistence'
import type { Project } from '@engine/model@102'

const PERSISTENCE_MODULE = '@state/services/persistence'
type PersistenceModule = typeof import('@state/services/persistence')

async function loadModule(): Promise<PersistenceModule> {
  return (await import(/* @vite-ignore */ PERSISTENCE_MODULE)) as unknown as PersistenceModule
}

interface Harness {
  bundle: FakePersistenceBundle
  service: PersistenceService
  app: ReturnType<typeof createTestApp>['app']
  states: string[]
}

async function setup(): Promise<Harness> {
  const bundle = createFakePersistenceDeps()
  const mod = await loadModule()
  const service = mod.createPersistenceService(bundle.deps)
  service.setPanelStateSource(() => CANNED_PANEL_STATE)
  service.setPeaksSource(() => CANNED_PEAKS)
  await service.open()
  const { app } = createTestApp()
  const states: string[] = []
  service.subscribeSaveState(() => states.push(service.getSaveState().state))
  service.attachEditor(app)
  return { bundle, service, app, states }
}

function currentBytes(app: Harness['app']): string {
  return serializeProject(app.project.getState().project as Project)
}

function rename(app: Harness['app'], name: string): void {
  expect(app.dispatch('project-rename', { name })).toBeNull()
}

describe('FR-106.2 (CC-106.1): the autosave predicate — pendingCount ≥ 1 ∧ idle 2 s ∧ not in-flight', () => {
  test('CC-106.1: no autosave with 0 pending even after long idle (no phantom writes)', async ({ skip }) => {
    const { bundle, service } = await setup()
    bundle.timers.advance(60_000)
    expect(bundle.instrument.putsTo('projects'), 'idle with nothing pending writes NOTHING').toBe(0)
    expect(bundle.timers.pendingCount(), 'not even a scheduled timer').toBe(0)
    expect(await service.saveNow('idle')).toBe('not-dirty')
  })

  test('CC-106.1: the save fires at 2 s idle — not before (debounce)', async ({ skip }) => {
    const { bundle, service, app } = await setup()
    rename(app, 'Two second cut')
    bundle.timers.advance(1_999)
    expect(bundle.instrument.putsTo('projects'), '1.999 s idle is NOT idle enough').toBe(0)
    expect(service.getSaveState().state, 'pending changes are visible as dirty').toBe('dirty')
    bundle.timers.advance(1)
    await waitUntil('autosave landed', () => service.getSaveState().state === 'saved')
    expect(bundle.instrument.putsTo('projects'), 'exactly one write at 2 s idle').toBe(1)
    const loaded = await service.loadProject('proj_102')
    expect(serializeProject(loaded?.project as Project), 'the written row is the current state').toBe(currentBytes(app))
  })

  test('CC-106.1: each new change RESETS the 2 s debounce', async ({ skip }) => {
    const { bundle, service, app } = await setup()
    rename(app, 'Rapid edit 1')
    bundle.timers.advance(1_500)
    rename(app, 'Rapid edit 2')
    bundle.timers.advance(1_500)
    expect(bundle.instrument.putsTo('projects'), 'idle restarted at the second change — 1.5 s since the last one').toBe(0)
    bundle.timers.advance(500)
    await waitUntil('debounce settled', () => service.getSaveState().state === 'saved')
    expect(bundle.instrument.putsTo('projects'), 'one write carrying the LATEST state').toBe(1)
    const loaded = await service.loadProject('proj_102')
    expect(loaded?.project.name).toBe('Rapid edit 2')
  })

  test('CC-106.1: visibilitychange→hidden forces an immediate save when pending; nothing when clean', async ({ skip }) => {
    const { bundle, service, app } = await setup()
    expect(bundle.doc.visibilityListenerCount(), 'the hidden watcher is registered via deps.document').toBeGreaterThan(0)

    bundle.doc.fire(true)
    expect(await service.saveNow('idle'), 'hidden with nothing pending is a no-op').toBe('not-dirty')
    expect(bundle.instrument.putsTo('projects')).toBe(0)

    rename(app, 'Hide-time work')
    bundle.doc.fire(true)
    await waitUntil('hidden force-landed', () => service.getSaveState().state === 'saved')
    expect(bundle.instrument.putsTo('projects'), 'hidden forces WITHOUT waiting for the debounce').toBe(1)

    bundle.doc.fire(true)
    expect(bundle.instrument.putsTo('projects'), 'hidden again with nothing pending writes nothing').toBe(1)
  })

  test('CC-106.1: manual save forces EXACTLY ONE write when dirty and performs NO write when clean', async ({ skip }) => {
    const { bundle, service, app } = await setup()
    expect(await service.saveNow('manual'), 'clean ⌘S is not-dirty — no write').toBe('not-dirty')
    expect(bundle.instrument.putsTo('projects')).toBe(0)

    rename(app, 'Command-S save')
    expect(await service.saveNow('manual'), 'manual forces regardless of the idle window').toBe('saved')
    expect(bundle.instrument.putsTo('projects'), 'exactly one write').toBe(1)
    expect(await service.saveNow('manual'), 'a second clean ⌘S writes nothing').toBe('not-dirty')
    expect(bundle.instrument.putsTo('projects')).toBe(1)
  })

  test('CC-106.1: save-state transitions idle→dirty→saving→saved with lastSavedAt from the injected clock', async ({ skip }) => {
    const { bundle, service, app, states } = await setup()
    expect(service.getSaveState().state, 'fresh attach is idle, nothing pending').toBe('idle')
    rename(app, 'Tracked transitions')
    expect(service.getSaveState().state).toBe('dirty')
    bundle.timers.advance(2_000)
    await waitUntil('saved', () => service.getSaveState().state === 'saved')
    expect(service.getSaveState().lastSavedAt, 'lastSavedAt = deps.clock.now()').toBe(1_730_000_000_000)
    expect(service.getSaveState().errorCode).toBeNull()
    expect(states, 'the subscriber saw dirty → … → saved, ending on saved').toEqual(expect.arrayContaining(['dirty', 'saving', 'saved']))
    expect(states.at(-1)).toBe('saved')
    const idxDirty = states.indexOf('dirty')
    const idxSaving = states.indexOf('saving')
    expect(idxSaving, 'saving is announced AFTER the change marked it dirty').toBeGreaterThan(idxDirty)
  })
})

describe('CC-106.3: concurrency — never a second save in flight; follow-up with the latest state', () => {
  test('CC-106.3: a save started while another is in flight queues; the follow-up carries the LATEST state (last-completed-wins)', async ({ skip }) => {
    const { bundle, service, app } = await setup()
    rename(app, 'In flight')
    const saveA = service.saveNow('manual')
    expect(service.getSaveState().state, 'the in-flight save is visible as saving').toBe('saving')
    rename(app, 'Landed mid-flight')
    const saveB = service.saveNow('idle')
    expect(await saveA).not.toBe('failed')
    expect(await saveB).not.toBe('failed')
    expect(service.getSaveState().state).toBe('saved')
    const loaded = await service.loadProject('proj_102')
    expect(serializeProject(loaded?.project as Project), 'final row = latest state').toBe(currentBytes(app))
    expect(loaded?.project.name).toBe('Landed mid-flight')
    expect(bundle.instrument.putsTo('projects'), 'first + exactly one follow-up (never a torn concurrent write)').toBeGreaterThanOrEqual(2)
  })
})
