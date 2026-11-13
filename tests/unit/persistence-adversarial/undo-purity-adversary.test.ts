// ADVERSARY (unit-106): UNDO PURITY (REVIEW "Always check" 7, FR-102.2/
// FR-106.2) — the persistence machinery must be history-invisible. On the
// REAL editor app (createTestApp — frozen helpers) an autosave cycle
// (debounce fire, manual + hidden flushes, peaks/panelState source reads),
// a relink attempt, a blob-cache read and the storage estimate must add ZERO
// dispatches and ZERO zundo steps; a single undo then lands exactly on the
// pre-rename state.
// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { createPersistenceService } from '@state/services/persistence'
import { cannedFingerprint, CANNED_PANEL_STATE, CANNED_PEAKS, createFakePersistenceDeps, waitUntil } from '../editor/helpers/fake-persistence'
import type { CommandId, CommandPayloads } from '@state/commands'
import type { Project } from '@engine/model@102'

describe('AUDIT-106 undo purity (FR-102.2, REVIEW-7): machine persistence never touches history', () => {
  test('AUDIT-106.39: autosave cycles, hidden/manual flushes, relink and blob reads add no dispatches and no history steps', async () => {
    const bundle = createFakePersistenceDeps()
    const service = createPersistenceService(bundle.deps)
    service.setPanelStateSource(() => CANNED_PANEL_STATE)
    service.setPeaksSource(() => CANNED_PEAKS)
    await service.open()

    const { app } = createTestApp()
    const dispatches: CommandId[] = []
    const originalDispatch = app.dispatch.bind(app)
    app.dispatch = <Id extends CommandId>(id: Id, payload: CommandPayloads[Id]) => {
      dispatches.push(id)
      return originalDispatch(id, payload)
    }

    service.attachEditor(app)
    const project = app.project.getState().project as Project
    const originalName = project.name
    const projectsPutsBefore = bundle.instrument.putsTo('projects')

    expect(app.dispatch('project-rename', { name: 'User rename' }), 'the user command is accepted').toBeNull()
    expect(app.history.undoCount(), 'exactly ONE user step').toBe(1)
    const stepsAfterUser = app.history.undoCount()
    const dispatchesAfterUser = dispatches.length

    // ── machine activity: everything unit-106 does behind the scenes ──────
    bundle.timers.advance(2_000) // debounce fire (an autosave write)
    await waitUntil('autosave landed', () => service.getSaveState().state === 'saved')
    expect(await service.saveNow('manual'), 'clean ⌘S').toBe('not-dirty')
    bundle.doc.fire(true) // hidden flush (clean → no-op)
    await service.relinkMedia('proj_102') // no stored handle → picker path
    await service.getMediaBlob('proj_102')
    await service.storageEstimate()
    await service.listProjects()
    await service.storeMediaHandle('proj_102', null, cannedFingerprint())
    bundle.timers.advance(60_000) // idle: the debounce stays silent

    expect(dispatches.length, 'no machine path dispatched a command').toBe(dispatchesAfterUser)
    expect(app.history.undoCount(), 'autosave/panelState/relink never push history steps').toBe(stepsAfterUser)
    expect(bundle.instrument.putsTo('projects'), 'exactly the one autosave write landed on the projects store').toBe(projectsPutsBefore + 1)

    app.history.undo()
    expect((app.project.getState().project as Project).name, 'one undo lands on the pre-rename state — no machine states interleaved').toBe(originalName)
  })
})
