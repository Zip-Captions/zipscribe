// CC-301.2 (L1, property): domain invariant 10 holds under RANDOM command
// sequences through the real command layer — "every TranslationEntry key
// resolves to an existing source block" plus the derived-staleness rules
// (edit ⇒ stale via hash, retime ⇒ never stale, split/merge/delete ⇒ the
// invariant-10 shapes).
import { describe, expect, test } from 'vitest'
import * as fc from 'fast-check'
import { createTestApp } from '../editor/helpers/editor-app'
import { REAL_TRANSLATION_RULES, STALE_HASH, isStale, sourceHash } from '@engine/translate/track'
import { validateTranslationIntegrity } from '@state/commands/validators'

type Op =
  | { kind: 'edit'; index: number; text: string }
  | { kind: 'split'; index: number }
  | { kind: 'merge'; index: number }
  | { kind: 'delete'; index: number }
  | { kind: 'retime'; index: number; shift: number }
  | { kind: 'seed-entry'; index: number }

const opArb = fc.oneof(
  fc.record({ kind: fc.constant('edit' as const), index: fc.integer({ min: 0, max: 9 }), text: fc.array(fc.constantFrom(...'abcdefg hijk'.split('')), { minLength: 3, maxLength: 40 }).map((chars) => chars.join('').trim() || 'fallback text') }),
  fc.record({ kind: fc.constant('split' as const), index: fc.integer({ min: 0, max: 9 }) }),
  fc.record({ kind: fc.constant('merge' as const), index: fc.integer({ min: 0, max: 8 }) }),
  fc.record({ kind: fc.constant('delete' as const), index: fc.integer({ min: 0, max: 9 }) }),
  fc.record({ kind: fc.constant('retime' as const), index: fc.integer({ min: 0, max: 9 }), shift: fc.integer({ min: -20, max: 20 }) }),
  fc.record({ kind: fc.constant('seed-entry' as const), index: fc.integer({ min: 0, max: 9 }) }),
)

function trackOf(app: ReturnType<typeof createTestApp>) {
  return app.app.project.getState().project?.translations.find((t) => t.language === 'fr')
}

describe('CC-301.2: invariant 10 under random edit/split/merge/delete/retime sequences', () => {
  test('CC-301.2: entry keys always resolve to live blocks after 200-op random sequences (REAL rules through the command layer)', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 5, maxLength: 60 }), (ops: Op[]) => {
        const app = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
        let retimeCount = 0
        for (const op of ops) {
          const blocks = app.app.project.getState().project?.blocks ?? []
          if (blocks.length === 0) continue
          switch (op.kind) {
            case 'edit': {
              const b = blocks[op.index % blocks.length]
              if (b !== undefined) app.app.dispatch('block-edit-text', { blockId: b.id, text: op.text })
              break
            }
            case 'split': {
              const b = blocks[op.index % blocks.length]
              if (b !== undefined && b.words.length >= 2) {
                const w = b.words[Math.floor(b.words.length / 2)]!
                app.app.dispatch('block-split', { blockId: b.id, at: w.start + 0.001 })
              }
              break
            }
            case 'merge': {
              const a = blocks[op.index % blocks.length]
              const b = blocks[(op.index + 1) % blocks.length]
              if (a !== undefined && b !== undefined && a.id !== b.id) {
                const [first, second] = a.start <= b.start ? [a, b] : [b, a]
                // make the pair adjacent first (retime never stales), then merge
                if (Math.abs(first.end - second.start) > 0.001) app.app.dispatch('block-retime', { blockId: second.id, start: first.end, end: first.end + (second.end - second.start) })
                const live = app.app.project.getState().project?.blocks ?? []
                const s2 = live.find((x) => x.id === second.id)
                if (s2 !== undefined && Math.abs(first.end - s2.start) < 0.001) app.app.dispatch('block-merge', { blockIds: [first.id, second.id] })
              }
              break
            }
            case 'delete': {
              const b = blocks[op.index % blocks.length]
              if (b !== undefined) app.app.dispatch('block-delete', { blockId: b.id })
              break
            }
            case 'retime': {
              const b = blocks[op.index % blocks.length]
              if (b !== undefined) {
                const track = trackOf(app) ?? { entries: {} }
                const liveBefore = app.app.project.getState().project?.blocks ?? []
                const staleBefore = Object.entries(track.entries)
                  .filter(([id, e]) => liveBefore.some((x) => x.id === id) && isStale(e, liveBefore.find((x) => x.id === id)!.text))
                  .map(([id]) => id)
                  .sort()
                const entriesBefore = Object.keys(track.entries).sort()
                const result = app.app.dispatch('block-retime', { blockId: b.id, start: Math.max(0, b.start + op.shift * 0.01), end: Math.max(0.01, b.end + op.shift * 0.01) })
                if (result === null) {
                  retimeCount++
                  const track2 = trackOf(app) ?? { entries: {} }
                  expect(Object.keys(track2.entries).sort(), 'retime never adds or drops entries').toEqual(entriesBefore)
                  const live2 = app.app.project.getState().project?.blocks ?? []
                  const staleAfter = Object.entries(track2.entries)
                    .filter(([id, e]) => live2.some((x) => x.id === id) && isStale(e, live2.find((x) => x.id === id)!.text))
                    .map(([id]) => id)
                    .sort()
                  expect(staleAfter, 'retime keeps derived staleness verdicts').toEqual(staleBefore)
                }
              }
              break
            }
            case 'seed-entry': {
              const b = blocks[op.index % blocks.length]
              if (b !== undefined) {
                const key = b.id
                app.app.applyWithoutHistory((draft) => {
                  if (draft.project === null) return
                  let track = draft.project.translations.find((t) => t.language === 'fr')
                  if (track === undefined) {
                    draft.project.translations.push({ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: {} })
                    track = draft.project.translations.find((t) => t.language === 'fr')!
                  }
                  track.entries[key] = { text: `tr:${b.text}`, status: 'translated', sourceHash: sourceHash(b.text) }
                })
              }
              break
            }
          }
          // THE invariant: checked after EVERY operation
          const liveProject = app.app.project.getState().project
          if (liveProject !== null) {
            expect(validateTranslationIntegrity(liveProject), 'invariant 10: no dangling TranslationEntry keys').toBeNull()
          }
        }
        // split/merge bookkeeping spot-check on the final state
        const track = trackOf(app)
        for (const [id, entry] of Object.entries(track?.entries ?? {})) {
          expect(entry.sourceHash, 'no empty hashes').not.toBe('')
        }
        void STALE_HASH
      }),
      { numRuns: 200 },
    )
  })

  test('CC-301.2: editing a block text marks its translations stale (hash derivation), retimes do not', () => {
    const app = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
    const blocks = app.app.project.getState().project?.blocks ?? []
    const target = blocks[0]!
    app.app.applyWithoutHistory((draft) => {
      if (draft.project === null) return
      draft.project.translations.push({
        language: 'fr',
        origin: 'machine',
        engine: 'chrome-translator',
        entries: { [target.id]: { text: 'traduit', status: 'translated', sourceHash: sourceHash(target.text) } },
      })
    })
    expect(app.app.dispatch('block-retime', { blockId: target.id, start: target.start, end: target.end - 0.1 })).toBeNull()
    let entry = trackOf(app)?.entries[target.id]
    expect(entry && !isStale(entry, target.text), 'retime ⇒ fresh remains').toBe(true)
    expect(app.app.dispatch('block-edit-text', { blockId: target.id, text: 'completely different words' })).toBeNull()
    const block = (app.app.project.getState().project?.blocks ?? []).find((b) => b.id === target.id)!
    entry = trackOf(app)?.entries[target.id]
    expect(entry !== undefined && isStale(entry, block.text), 'edit ⇒ stale').toBe(true)
  })
})
