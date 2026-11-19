// FR-301.5 / US-301.3 (L1): the four translation commands through the
// unit-102 command layer — undoable (zundo) user steps; machine results
// applied as JOB OUTPUT (applyWithoutHistory) are NOT undo steps.
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { REAL_TRANSLATION_RULES, applyEntries, sourceHash, staleIds } from '@engine/translate/track'

function appWithTrack(engineAvailable = true) {
  const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES, translationEngineAvailable: () => engineAvailable })
  const blocks = t.app.project.getState().project?.blocks ?? []
  t.app.dispatch('translation-add-track', { language: 'fr', origin: 'machine' })
  t.app.applyWithoutHistory((draft) => {
    if (draft.project === null) return
    const track = draft.project.translations.find((x) => x.language === 'fr')
    if (track !== undefined && blocks[0] !== undefined) {
      track.entries[blocks[0].id] = { text: 'traduit', status: 'translated', sourceHash: sourceHash(blocks[0].text) }
      track.entries[blocks[1]!.id] = { text: '', status: 'translated', sourceHash: 'stale' }
    }
  })
  return t
}

describe('FR-301.5: translation-add-track / remove-track', () => {
  test('FR-301.5: machine track add sets origin+engine; duplicates rejected; invalid tags rejected', () => {
    const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
    expect(t.app.dispatch('translation-add-track', { language: 'fr', origin: 'machine' })).toBeNull()
    const track = t.app.project.getState().project?.translations[0]
    expect(track).toMatchObject({ language: 'fr', origin: 'machine', engine: 'chrome-translator' })
    expect(t.app.dispatch('translation-add-track', { language: 'fr', origin: 'manual' })?.code).toBe('TRANSLATION_TRACK_EXISTS')
    expect(t.app.dispatch('translation-add-track', { language: 'not a tag!', origin: 'manual' })?.code).toBe('INVALID_PAYLOAD')
    expect(t.app.dispatch('translation-add-track', { language: 'zh-Hant', origin: 'manual' })).toBeNull()
  })

  test('US-301.2: machine adds require the engine; manual/imported never do (CC-I4.5)', () => {
    const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES, translationEngineAvailable: () => false })
    expect(t.app.dispatch('translation-add-track', { language: 'fr', origin: 'machine' })?.code).toBe('TRANSLATION_ENGINE_UNAVAILABLE')
    expect(t.app.dispatch('translation-add-track', { language: 'fr', origin: 'manual' })).toBeNull()
    expect(t.app.dispatch('translation-add-track', { language: 'es', origin: 'imported' })).toBeNull()
  })

  test('FR-301.5: remove-track is UNDOABLE (the explicit criterion)', () => {
    const t = appWithTrack()
    const before = structuredClone(t.app.project.getState().project?.translations)
    const stepsBefore = t.app.history.undoCount()
    expect(t.app.dispatch('translation-remove-track', { language: 'fr' })).toBeNull()
    expect(t.app.project.getState().project?.translations).toEqual([])
    expect(t.app.history.undoCount(), 'one undo step').toBe(stepsBefore + 1)
    t.app.history.undo()
    expect(t.app.project.getState().project?.translations, 'undo restores the removed track with entries').toEqual(before)
  })

  test('FR-301.5: remove of an absent track rejects with TRACK_ABSENT', () => {
    const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
    expect(t.app.dispatch('translation-remove-track', { language: 'de' })?.code).toBe('TRANSLATION_TRACK_ABSENT')
  })
})

describe('FR-301.5 / CC-I4.3: entry editing and review', () => {
  test('CC-I4.3: editing a translation sets status edited (undoable, one step)', () => {
    const t = appWithTrack()
    const seed = t.app.project.getState().project
    expect(seed).not.toBeNull()
    const blockId = seed!.blocks[0]!.id
    const stepsBefore = t.app.history.undoCount()
    expect(t.app.dispatch('translation-edit-entry', { language: 'fr', blockId, text: 'ma traduction' })).toBeNull()
    const entry = t.app.project.getState().project?.translations[0]!.entries[blockId]
    expect(entry).toMatchObject({ text: 'ma traduction', status: 'edited' })
    expect(t.app.history.undoCount()).toBe(stepsBefore + 1)
    t.app.history.undo()
    expect(t.app.project.getState().project?.translations[0]!.entries[blockId]?.text).toBe('traduit')
  })

  test('US-301.3: mark-reviewed moves sourceHash to the current text, text unchanged, ONE undo step', () => {
    const t = appWithTrack()
    const seededProject = t.app.project.getState().project
    expect(seededProject).not.toBeNull()
    const staleId = seededProject!.blocks[1]!.id
    expect(staleIds(t.app.project.getState().project!, 'fr')).toContain(staleId)
    const stepsBefore = t.app.history.undoCount()
    expect(t.app.dispatch('translation-mark-reviewed', { language: 'fr', blockId: staleId })).toBeNull()
    const afterReview = t.app.project.getState().project
    expect(afterReview).not.toBeNull()
    const track = afterReview!.translations[0]!
    expect(track.entries[staleId]!.text, 'text untouched').toBe('')
    expect(staleIds(t.app.project.getState().project!, 'fr'), 'left the stale set').not.toContain(staleId)
    expect(t.app.history.undoCount(), 'one undo step').toBe(stepsBefore + 1)
    t.app.history.undo()
    expect(staleIds(t.app.project.getState().project!, 'fr'), 'undo restores staleness').toContain(staleId)
  })

  test('FR-301.5: entry commands reject dangling blocks and absent entries/tracks', () => {
    const t = appWithTrack()
    expect(t.app.dispatch('translation-edit-entry', { language: 'fr', blockId: 'blk_missing', text: 'x' })?.code).toBe('DANGLING_BLOCK_REF')
    const unentered = (t.app.project.getState().project!.blocks ?? []).find((b) => t.app.project.getState().project!.translations[0]!.entries[b.id] === undefined)
    expect(unentered, 'fixture has a block without an entry').toBeDefined()
    expect(t.app.dispatch('translation-edit-entry', { language: 'fr', blockId: unentered!.id, text: 'x' })?.code).toBe('TRANSLATION_ENTRY_ABSENT')
    expect(t.app.dispatch('translation-mark-reviewed', { language: 'de', blockId: 'x' })?.code).toBe('TRANSLATION_TRACK_ABSENT')
  })
})

describe('FR-301.5: machine results are job output — not undo steps', () => {
  test('FR-301.5: applyWithoutHistory mutates the project with ZERO history steps', () => {
    const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
    const blocks = t.app.project.getState().project?.blocks ?? []
    t.app.dispatch('translation-add-track', { language: 'fr', origin: 'machine' })
    const stepsBefore = t.app.history.undoCount()
    const updates = blocks.map((b) => ({ blockId: b.id, entry: { text: `fr:${b.text}`, status: 'translated' as const, sourceHash: sourceHash(b.text) } }))
    t.app.applyWithoutHistory((draft) => {
      if (draft.project !== null) applyEntries(draft.project, 'fr', updates)
    })
    expect(t.app.project.getState().project?.translations[0]!.entries[blocks[0]!.id]?.text).toBe(`fr:${blocks[0]!.text}`)
    expect(t.app.history.undoCount(), 'machine results never join the undo timeline').toBe(stepsBefore)
    // the next UNDOABLE step is the rename — undo must undo the RENAME, not the machine batch
    expect(t.app.dispatch('project-rename', { name: 'renamed after machine run' })).toBeNull()
    expect(t.app.history.undoCount()).toBe(stepsBefore + 1)
    t.app.history.undo()
    expect(t.app.project.getState().project?.name, 'undo rolls back the user step').not.toBe('renamed after machine run')
    expect(t.app.project.getState().project?.translations[0]!.entries[blocks[0]!.id]?.text, 'machine results survive the undo').toBe(`fr:${blocks[0]!.text}`)
  })
})

describe('FR-301.5: the apply service wires session output to the store (job output path)', () => {
  test('FR-301.5: service creates the machine track and applies batched entries without history', async () => {
    const { createTranslationApplyService } = await import('@state/services/translation-apply')
    const { createFakeTranslationEngine } = await import('../editor/helpers/fake-export-port')
    const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
    const engine = createFakeTranslationEngine()
    const service = createTranslationApplyService({ editorApp: t.app, engine, scheduler: async () => undefined })
    const project = t.app.project.getState().project!
    const stats = await service.run(project, 'es', {})
    expect(stats.translated).toBe(project.blocks.length)
    const track = t.app.project.getState().project?.translations.find((x) => x.language === 'es')
    expect(track?.engine).toBe('chrome-translator')
    expect(Object.keys(track?.entries ?? {}).length).toBe(project.blocks.length)
    expect(t.app.history.undoCount(), 'the whole run is zero undo steps').toBe(1) // only the add-track step
  })
})
