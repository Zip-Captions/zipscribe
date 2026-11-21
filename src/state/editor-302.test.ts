// FR-302.2 (L1): the `editor` slice owns the transcript view mode —
// 'source' | 'translation' | 'split' plus `activeLanguage` (UI-only, NEVER a
// history step: zundo partialize keeps {project} only, FR-102.2). The ⌘⇧L
// cycle order is design.md's: source → translation → side-by-side → source.
import { describe, expect, test } from 'vitest'
import { createEditorStore } from '@state/editor'

describe('FR-302.2: editor slice transcript view mode', () => {
  test('FR-302.2: defaults are source view with no active language', () => {
    const store = createEditorStore()
    expect(store.getState().viewMode).toBe('source')
    expect(store.getState().activeLanguage).toBeNull()
  })

  test('FR-302.2: setViewMode/setActiveLanguage are independent UI-only writes', () => {
    const store = createEditorStore()
    store.setViewMode('split')
    store.setActiveLanguage('fr')
    expect(store.getState().viewMode).toBe('split')
    expect(store.getState().activeLanguage).toBe('fr')
    store.setActiveLanguage(null)
    expect(store.getState().activeLanguage).toBeNull()
    // the frozen members are untouched by the extension
    store.setPlayhead(1.5)
    expect(store.getState().playhead).toBe(1.5)
  })

  test('FR-302.2: cycleViewMode follows source → translation → split → source', () => {
    const store = createEditorStore()
    store.cycleViewMode()
    expect(store.getState().viewMode).toBe('translation')
    store.cycleViewMode()
    expect(store.getState().viewMode).toBe('split')
    store.cycleViewMode()
    expect(store.getState().viewMode).toBe('source')
  })

  test('FR-302.2: cycleViewMode picks the first candidate language when none is active', () => {
    const store = createEditorStore()
    // no candidates ⇒ translation view but no language forced (empty track set)
    store.cycleViewMode(undefined)
    expect(store.getState().viewMode).toBe('translation')
    expect(store.getState().activeLanguage).toBeNull()
    store.setViewMode('source')
    store.setActiveLanguage(null)
    // entering translation WITH candidates adopts the first
    store.cycleViewMode(['fr', 'es'])
    expect(store.getState().viewMode).toBe('translation')
    expect(store.getState().activeLanguage).toBe('fr')
    // a remembered language survives the next cycle
    store.cycleViewMode(['fr', 'es'])
    expect(store.getState().viewMode).toBe('split')
    expect(store.getState().activeLanguage).toBe('fr')
    // a removed track's language is replaced by the first candidate
    store.setViewMode('source')
    store.cycleViewMode(['es'])
    expect(store.getState().viewMode).toBe('translation')
    expect(store.getState().activeLanguage).toBe('es')
  })
})
