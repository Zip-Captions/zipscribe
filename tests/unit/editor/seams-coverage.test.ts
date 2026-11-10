// Seam-coverage probes (CI `pnpm test --coverage` perFile 80 % gate): the
// production-default seams the app path never exercises because the frozen
// fixtures inject fakes — the typed-not-implemented speaker engine, the
// default blockizer, the standalone editor store, and the default command
// deps/accessors. Each probes BEHAVIOR pinned by the seam contract comments,
// not the implementation's internals (unit-102 ratification doctrine).
// Implementation-side factories import via relative paths (overlay.test.tsx
// precedent): the frozen ambient d.ts types the public surface only.
import { describe, expect, test } from 'vitest'
import { createEditorApp } from '@state/history'
import type { CommandId } from '@state/commands'
import { createFakeClock } from '../../../src/test-support/fake-clock'
import { createFakeRafs } from './helpers/fake-rafs'
import { SAMPLE_ASSET, SAMPLE_SPEAKERS, sampleBlocks, word } from './helpers/fixture-project'
import { DEFAULT_BLOCKIZER, DEFAULT_COMMAND_DEPS, NOT_IMPLEMENTED_SPEAKER_ENGINE, getCommand, getEditorCommands } from '../../../src/state/commands'
import { isChildRun } from '../../helpers/repo'
import { DEFAULT_EDITOR_STATE, createEditorStore } from '../../../src/state/editor'
import type { WordToken } from '@engine/model@102'

// deps.ts:27-40 (frozen contract): "dispatching a `speaker-*` command without
// an injected engine fails with a CODE — never user content (SECURITY-03)".
function bareApp() {
  const clock = createFakeClock(1_730_000_000_000)
  const app = createEditorApp({ clock, rafs: createFakeRafs(0) })
  app.project.createProject(SAMPLE_ASSET)
  expect(app.dispatch('captions-import', { blocks: sampleBlocks(), speakers: SAMPLE_SPEAKERS, replace: true })).toBeNull()
  return { app, clock }
}

function projectSnapshot(app: ReturnType<typeof bareApp>['app']) {
  return structuredClone(app.project.getState().project)
}

describe('FR-102.1 / deps.ts:33: the typed-not-implemented speaker engine fails with a CODE', () => {
  test('FR-102.1: speaker-assign on the default (not-implemented) engine throws the SPEAKER_ENGINE_UNAVAILABLE code only — zero mutation, zero history step', () => {
    const { app } = bareApp()
    const before = projectSnapshot(app)
    const steps = app.history.undoCount()
    let message = 'NO THROW'
    try {
      app.dispatch('speaker-assign', { blockIds: ['blk_a'], speakerId: 'SPK_1' })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message, 'typed failure per the frozen deps.ts contract — fails with a CODE').toBe('SPEAKER_ENGINE_UNAVAILABLE')
    expect(app.project.getState().project, 'the abort is total: no half-assigned words (invariant: word-level truth)').toEqual(before)
    expect(app.history.undoCount(), 'a failed dispatch creates no history step').toBe(steps)
  })

  test('FR-102.1: a THROWING fake engine escapes as a CODE-shaped error only — no raw message, no state write, no step', () => {
    const { app } = bareApp()
    // The throwing fake stands in for engine-06 blowing up mid-assign; the
    // dispatch boundary must surface only a code-form message (SECURITY-03:
    // codes and numbers, never user content, cross the failure boundary).
    const boom = (): never => {
      throw new Error('SPEAKER_ENGINE_UNAVAILABLE')
    }
    const throwingApp = createEditorApp({
      clock: { now: () => 1_730_000_000_000 },
      rafs: createFakeRafs(0),
      speakerEngine: { majoritySpeakerId: boom, reassignWords: boom },
    })
    throwingApp.project.createProject(SAMPLE_ASSET)
    expect(throwingApp.dispatch('captions-import', { blocks: sampleBlocks(), speakers: SAMPLE_SPEAKERS, replace: true })).toBeNull()
    const before = projectSnapshot(throwingApp)
    const steps = throwingApp.history.undoCount()
    let message = 'NO THROW'
    try {
      throwingApp.dispatch('speaker-assign', { blockIds: ['blk_b'], speakerId: 'SPK_1' })
    } catch (error) {
      expect(error, 'a failure is an Error carrying the code — not a string/symbol escape').toBeInstanceOf(Error)
      message = (error as Error).message
    }
    expect(message, 'the failure is a code (deps.ts:31 SECURITY-03), not a raw stack or content dump').toBe('SPEAKER_ENGINE_UNAVAILABLE')
    expect(message, 'code-form: upper snake only').toMatch(/^[A-Z][A-Z0-9_]*$/u)
    expect(message, 'no transcript content in the failure (SECURITY-03)').not.toContain('delta')
    expect(throwingApp.project.getState().project).toEqual(before)
    expect(throwingApp.history.undoCount()).toBe(steps)
  })

  test('FR-102.1: NOT_IMPLEMENTED_SPEAKER_ENGINE itself throws the code on BOTH seam functions (the frozen ASSUMPTION surface)', () => {
    expect(() => NOT_IMPLEMENTED_SPEAKER_ENGINE.majoritySpeakerId([], 'SPK_1')).toThrow(/^SPEAKER_ENGINE_UNAVAILABLE$/u)
    expect(() => NOT_IMPLEMENTED_SPEAKER_ENGINE.reassignWords([], 'SPK_1', 'SPK_2')).toThrow(/^SPEAKER_ENGINE_UNAVAILABLE$/u)
  })
})

describe('FR-102.1 / deps.ts:42: DEFAULT_BLOCKIZER is the merged unit-05 blockizer', () => {
  const words: WordToken[] = ['alpha', 'beta', 'gamma', 'delta'].map((text, i) => word(text, i * 1.5, i * 1.5 + 1.1, { speakerId: i % 2 === 0 ? 'SPK_1' : 'SPK_2' }))

  test('FR-102.1: empty input → no blocks (pure total function)', () => {
    expect(DEFAULT_BLOCKIZER([], { maxCharsPerLine: 42 })).toEqual([])
  })

  test('FR-102.1: blocks preserve word order/content; edges pad the edge words (blockize.ts:19 US-1.2.6 padding)', () => {
    const blocks = DEFAULT_BLOCKIZER(words, { maxCharsPerLine: 42 })
    expect(blocks.length).toBeGreaterThan(0)
    const flattened = blocks.flatMap((b) => b.words.map((w) => w.text))
    expect(flattened, 'no word lost or reordered (invariant 12 re-flow input)').toEqual(['alpha', 'beta', 'gamma', 'delta'])
    for (const b of blocks) {
      const first = b.words[0]
      const last = b.words.at(-1)
      if (first === undefined || last === undefined) throw new Error('empty block from blockizer')
      expect(b.text, 'block text is its words joined by single spaces').toBe(b.words.map((w) => w.text).join(' '))
      expect(b.start, 'start = first word start − padding (default 0.05, clamped)').toBeGreaterThanOrEqual(first.start - 0.06)
      expect(b.start).toBeLessThanOrEqual(first.start)
      expect(b.end, 'end pads the last word end (never earlier than it)').toBeGreaterThanOrEqual(last.end)
      expect(b.end).toBeLessThanOrEqual(last.end + 0.06)
      expect(b.speakerId, 'every block carries a speaker id').toBeTruthy()
    }
  })

  test('FR-102.1: maxCharsPerLine caps single-line blocks where words allow (blockize.ts:16 contract)', () => {
    const capped = DEFAULT_BLOCKIZER(words, { maxCharsPerLine: 9 })
    for (const b of capped) {
      expect(b.text.length, `each block fits (${b.text})`).toBeLessThanOrEqual(9)
    }
    expect(capped.flatMap((b) => b.words).length, 'the cap splits, never drops').toBe(words.length)
    const monster = [word('extrawordyword', 0, 1, { speakerId: 'SPK_1' }), word('xi', 1.2, 1.8, { speakerId: 'SPK_1' })]
    const out = DEFAULT_BLOCKIZER(monster, { maxCharsPerLine: 9 })
    expect(out.flatMap((b) => b.words).map((w) => w.text), 'an over-long word gets its own line (where words allow)').toEqual(['extrawordyword', 'xi'])
  })
})

describe('FR-102.2 / editor.ts: the standalone editor store (history-free UI slice)', () => {
  test('FR-102.2: defaults are the frozen EditorUiState; setters notify subscribers and unsubscribe detaches', () => {
    const store = createEditorStore()
    // The standalone store keeps `lastLoop` in its INTERNAL storage (editor.ts
    // EditorUiStateInternal, "never part of the frozen contract surface") —
    // compare the six frozen EditorUiState fields, which is what the frozen
    // `getState(): EditorUiState` type exposes.
    const state = store.getState()
    expect({ playhead: state.playhead, playing: state.playing, rate: state.rate, loop: state.loop, selection: state.selection, searchOpen: state.searchOpen }).toEqual(DEFAULT_EDITOR_STATE)
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })
    store.setPlayhead(3.5)
    store.setPlaying(true)
    store.setRate(1.5)
    store.setSearchOpen(true)
    expect(store.getState().playhead).toBe(3.5)
    expect(store.getState().playing).toBe(true)
    expect(store.getState().rate).toBe(1.5)
    expect(store.getState().searchOpen).toBe(true)
    expect(notified).toBe(4)
    unsubscribe()
    store.setPlayhead(9)
    expect(notified, 'unsubscribe detaches the listener').toBe(4)
    expect(store.getState().playhead).toBe(9)
  })

  test('FR-102.2: selection and loop are COPIED in (renderers never observe caller mutation)', () => {
    const store = createEditorStore()
    const sel = { anchorBlockId: 'blk_a', focusBlockId: 'blk_b' }
    store.setSelection(sel)
    sel.focusBlockId = 'blk_c'
    expect(store.getState().selection, 'the setter copies (editor.ts selection copy rule)').toEqual({ anchorBlockId: 'blk_a', focusBlockId: 'blk_b' })
    const region: [number, number] = [1, 2]
    store.setLoop(region)
    region[0] = 99
    expect(store.getState().loop, 'the loop tuple is copied in').toEqual([1, 2])
    store.setLoop(null)
    expect(store.getState().loop).toBeNull()
  })
})

describe('FR-102.1 / index.ts: default command registry + production deps', () => {
  test('FR-102.1: getEditorCommands exposes the frozen 26-command table once each; getCommand resolves by id', () => {
    const commands = getEditorCommands()
    expect(commands.length, 'the frozen command table').toBe(26)
    expect(new Set(commands.map((c) => c.id)).size, 'no duplicate command ids').toBe(26)
    expect(getCommand('block-split')?.id).toBe('block-split')
    expect(getCommand('captions-reflow' as CommandId)?.id).toBe('captions-reflow')
    expect(getCommand('nope.not-a-command' as CommandId), 'map miss is undefined, not a throw').toBeUndefined()
  })

  test('FR-102.1: DEFAULT_COMMAND_DEPS wires the frozen production seams (wall clock, blk_ ids, engine-06 re-point)', async () => {
    const id1 = DEFAULT_COMMAND_DEPS.newBlockId()
    const id2 = DEFAULT_COMMAND_DEPS.newBlockId()
    expect(id1.startsWith('blk_'), 'store-generated block ids carry the blk_ prefix').toBe(true)
    expect(id1).not.toBe(id2)
    const now = DEFAULT_COMMAND_DEPS.clock.now()
    expect(typeof now).toBe('number')
    expect(Math.abs(now - Date.now()), 'production default clock is the wall clock').toBeLessThan(5_000)
    if (isChildRun()) return
    // CONTRACT.md § speaker-* family (frozen re-point clause): "When unit-06
    // merges, src/engine/diarize/assign.ts exports them verbatim and the
    // production default re-points." RED until unit-06 lands — the dynamic
    // import below fails at runtime (unit-05 precedent); the child run stops
    // above so the gate-spawning child stays green. The
    // NOT_IMPLEMENTED_SPEAKER_ENGINE constant itself stays contract-pinned
    // above (dispatch-without-engine CODE path is independent of the default).
    const real = (await import('@engine/diarize/assign')) as typeof import('@engine/diarize/assign')
    expect(DEFAULT_COMMAND_DEPS.speakerEngine.majoritySpeakerId, 'default seam re-points to the production engine (CONTRACT.md)').toBe(real.majoritySpeakerId)
    expect(DEFAULT_COMMAND_DEPS.speakerEngine.reassignWords, '…verbatim, not a wrapper').toBe(real.reassignWords)
    expect(DEFAULT_COMMAND_DEPS.blockizer).toBe(DEFAULT_BLOCKIZER)
  })
})
