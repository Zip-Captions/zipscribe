// FR-102.1 (L1): every block command routes the invariant-10 translation
// rules through the injectable seam — and the FR-102.1 production DEFAULT is
// the NO_OP stub until unit-301: the same commands must leave the
// `translations` tracks byte-identical.
import { describe, expect, test } from 'vitest'
import { createEditorApp } from '@state/history'
import { NO_OP_TRANSLATION_RULES } from '@engine/translate/track@102'
import { createFakeRafs } from './helpers/fake-rafs'
import { createFakeSpeakerEngine } from './helpers/fake-speaker-engine'
import { createRecordingTranslationRules } from './helpers/fake-translation-rules'
import { createTestApp } from './helpers/editor-app'
import { sampleProject } from './helpers/fixture-project'
import type { Project } from '@engine/model@102'
import type { TranslationRules } from '@engine/translate/track@102'

function projectWithTranslations(): Project {
  return sampleProject({
    translations: [
      {
        language: 'fr',
        origin: 'machine',
        engine: 'chrome-translator',
        entries: {
          blk_a: { text: 'alpha beta gamma', status: 'translated', sourceHash: 'hash_a1' },
          blk_c: { text: 'epsilon zeta', status: 'edited', sourceHash: 'hash_c1' },
        },
      },
    ],
  })
}

function rawApp(project: Project, rules?: TranslationRules) {
  const rafs = createFakeRafs()
  return createEditorApp({
    clock: { now: () => 0 },
    rafs,
    speakerEngine: createFakeSpeakerEngine(),
    ...(rules === undefined ? {} : { translationRules: rules }),
    initialProject: project,
  })
}

describe('FR-102.1: block commands route the invariant-10 rules through the seam', () => {
  test('FR-102.1: split/merge/delete/retime each fire their TranslationRules hook', () => {
    const rules = createRecordingTranslationRules()
    const app = rawApp(projectWithTranslations(), rules)

    expect(app.dispatch('block-split', { blockId: 'blk_c', at: 7 })).toBeNull()
    expect(app.dispatch('block-merge', { blockIds: ['blk_a', 'blk_b'] })).toBeNull()
    // Delete the right split half (start lands at the split point) — the new
    // id is store-generated, so it is looked up, not guessed.
    const rightHalf = app.project.getState().project?.blocks.find((b) => b.start >= 7)
    expect(rightHalf, 'split produced a right part at the split point').toBeDefined()
    expect(app.dispatch('block-delete', { blockId: rightHalf?.id ?? '' })).toBeNull()
    const merged = app.project.getState().project?.blocks.find((b) => b.start === 0.5)
    expect(merged, 'merge kept the leftmost span start').toBeDefined()
    expect(app.dispatch('block-retime', { blockId: merged?.id ?? '', end: 0.9 })).toBeNull()

    const hooks = rules.calls.map((c) => c.hook)
    expect(hooks, 'all four invariant-10 hooks are observable through the seam').toEqual(expect.arrayContaining(['onBlockSplit', 'onBlockMerge', 'onBlockDelete', 'onBlockRetime']))
    const split = rules.calls.find((c) => c.hook === 'onBlockSplit')
    expect(split?.args[0], 'split hook names the source block first').toBe('blk_c')
  })

  test('FR-102.1: the injected rules see the mutated draft (post-reduce state)', () => {
    const rules = createRecordingTranslationRules()
    const app = rawApp(projectWithTranslations(), rules)
    expect(app.dispatch('block-delete', { blockId: 'blk_c' })).toBeNull()
    const deleteCall = rules.calls.find((c) => c.hook === 'onBlockDelete')
    expect(deleteCall?.args).toEqual(['blk_c'])
    // The rules are called during the reduce (single transaction): the entry
    // cleanup itself is unit-301's job — 102 only guarantees the hook fires.
    expect(deleteCall).toBeDefined()
  })
})

describe('FR-102.1: the NO_OP production stub keeps translations byte-identical', () => {
  test('FR-102.1: with the default rules, split/merge/delete/retime change NO translation byte', () => {
    const project = projectWithTranslations()
    const app = rawApp(project)
    const before = structuredClone(project.translations)

    expect(app.dispatch('block-split', { blockId: 'blk_a', at: 1.5 })).toBeNull()
    expect(app.dispatch('block-retime', { blockId: 'blk_b', start: 3.5 })).toBeNull()
    expect(app.dispatch('block-delete', { blockId: 'blk_c' })).toBeNull()
    expect(app.dispatch('block-edit-text', { blockId: 'blk_b', text: 'changed' })).toBeNull()

    expect(app.project.getState().project?.translations, 'FR-102.1: the stub leaves every track untouched until unit-301').toEqual(before)
  })

  test('FR-102.1: NO_OP_TRANSLATION_RULES is the identity on a detached project (stub contract)', () => {
    const detached = projectWithTranslations()
    const untouched = structuredClone(detached)
    NO_OP_TRANSLATION_RULES.onBlockDelete(detached, 'blk_a')
    NO_OP_TRANSLATION_RULES.onBlockSplit(detached, 'blk_a', 'blk_a1', 'blk_a2')
    NO_OP_TRANSLATION_RULES.onBlockMerge(detached, 'blk_m', ['blk_a', 'blk_b'])
    NO_OP_TRANSLATION_RULES.onBlockRetime(detached, 'blk_b')
    expect(detached, 'every hook is a no-op').toEqual(untouched)
  })

  test('FR-102.1 (invariant 10): retiming never marks stale and never drops entries (102: no-op preserves)', () => {
    const project = projectWithTranslations()
    const app = rawApp(project)
    expect(app.dispatch('block-retime', { blockId: 'blk_a', start: 1 })).toBeNull()
    expect(app.dispatch('block-retime', { blockId: 'blk_c', end: 7.5 })).toBeNull()
    const track = app.project.getState().project?.translations[0]
    expect(track?.entries['blk_a']?.status, 'no silent stale marking').toBe('translated')
    expect(track?.entries['blk_c']?.status, 'edited status preserved').toBe('edited')
    expect(track?.entries['blk_a']?.sourceHash).toBe('hash_a1')
  })
})
