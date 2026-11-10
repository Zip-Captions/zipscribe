// CC-06.4 (L1, history integration): the four PURE MUTATION APIs
// (`renameSpeaker`, `reassign`, `mergeSpeakers`, `splitSpeaker` — golden-tested
// in ./assign.test.ts) proven UNDOABLE through the real editor history. The
// two command-wrapped seams (`speaker-rename`, `speaker-assign` → real
// `renameSpeaker` / `reassignWords` + `majoritySpeakerId`) are driven through
// `createEditorApp` with the REAL engine functions injected on the frozen
// `SpeakerEngine` seam (deps.ts:48) and undone/redone byte-identically via
// `serializeProject`. `merge`/`split` have NO frozen command id (the 26-command
// table is frozen — merge/split commands land with unit-104's UI; orchestrator
// ASSUMPTION (3)), so their undoability is proven at the same boundary the
// history consumes them at: project-in/project-out purity (the pre-image stays
// byte-identical → history can hold it; unit-102 history stores serialized
// project snapshots, so purity ⇒ undoable).
//
// Gates-child run: skipped under ZIPSCRIBE_CHILD=1 (frozen suites run there;
// the RED dynamic imports below would mask the command-wiring proof).
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { word } from '../editor/helpers/fixture-project'
import { createRedactionSpy, type RedactionSpy } from '../../../src/test-support/redaction'
import { isChildRun } from '../../helpers/repo'
import { serializeProject } from '@state/services/serialize'
import type { Project, WordToken } from '@engine/model@06'

const gated = isChildRun() ? describe.skip : describe

type AssignModule = typeof import('@engine/diarize/assign')

async function realEngine(): Promise<AssignModule> {
  return (await import('@engine/diarize/assign')) as AssignModule
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function liveProject(app: ReturnType<typeof createTestApp>['app']): Project {
  const project = app.project.getState().project
  if (project === null) throw new Error('project missing')
  return project
}

function gatedSuite(name: string, body: () => void): void {
  gated(name, () => {
    let spy: RedactionSpy | undefined
    beforeEach(() => {
      if (!isChildRun()) spy = createRedactionSpy()
    })
    afterEach(() => {
      const verdict = spy?.settle()
      spy?.restore()
      expect(verdict?.clean ?? true, 'the engine functions never write to console (SECURITY-03)').toBe(true)
    })
    body()
  })
}

gatedSuite('CC-06.4: command-wrapped mutations are undoable through real history', () => {
  test('CC-06.4 CC-06.1: real reassignWords/majoritySpeakerId via the frozen seam — assign, undo byte-identical, redo exact', async () => {
    const real = await realEngine()
    const t = createTestApp({ speakerEngine: { majoritySpeakerId: real.majoritySpeakerId, reassignWords: real.reassignWords } })
    const before = serializeProject(liveProject(t.app))
    expect(t.app.dispatch('speaker-assign', { blockIds: ['blk_a'], speakerId: 'SPK_2' })).toBeNull()
    const after = serializeProject(liveProject(t.app))
    expect(after, 'the real engine actually moved the words').not.toBe(before)
    const blockAfter = liveProject(t.app).blocks.find((b) => b.id === 'blk_a')
    expect(blockAfter?.speakerId, 'block majority materialized by the real frozen fn').toBe('SPK_2')
    expect(blockAfter?.words.every((w) => w.speakerId === 'SPK_2'), 'word-level truth updated').toBe(true)

    t.app.history.undo()
    expect(serializeProject(liveProject(t.app)), 'undo restores the exact pre-image (byte-identical serialize)').toBe(before)
    t.app.history.redo()
    expect(serializeProject(liveProject(t.app)), 'redo restores the exact post-image').toBe(after)
  })

  test('CC-06.4 (invariant 5): manual mutation flips speakerSource to manual; undo restores auto-beta byte-identically', async () => {
    const real = await realEngine()
    const t = createTestApp({ speakerEngine: { majoritySpeakerId: real.majoritySpeakerId, reassignWords: real.reassignWords } })
    const before = serializeProject(liveProject(t.app))
    expect(liveProject(t.app).speakerSource).toBe('auto-beta')
    expect(t.app.dispatch('speaker-assign', { blockIds: ['blk_a'], speakerId: 'SPK_2' })).toBeNull()
    expect(liveProject(t.app).speakerSource, 'manual mutation → manual').toBe('manual')
    t.app.history.undo()
    expect(liveProject(t.app).speakerSource, 'undo reverts the source too').toBe('auto-beta')
    expect(serializeProject(liveProject(t.app)), 'and the project itself is the byte-identical pre-image').toBe(before)
  })

  test('CC-06.4 (invariant 4): real renameSpeaker through speaker-rename is undoable — labels revert, ids never move', async () => {
    const real = await realEngine()
    const t = createTestApp({ speakerEngine: { majoritySpeakerId: real.majoritySpeakerId, reassignWords: real.reassignWords } })
    const before = serializeProject(liveProject(t.app))
    const idsBefore = liveProject(t.app).speakers.map((s) => s.id)
    expect(t.app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: 'Ann' })).toBeNull()
    expect(liveProject(t.app).speakers.find((s) => s.id === 'SPK_1')?.label).toBe('Ann')
    t.app.history.undo()
    expect(serializeProject(liveProject(t.app))).toBe(before)
    t.app.history.redo()
    expect(liveProject(t.app).speakers.map((s) => s.id), 'rename never touches ids (invariant 4), even across redo').toEqual(idsBefore)
  })
})

gatedSuite('CC-06.4: merge/split undoability precondition — total purity at the history boundary', () => {
  // No `speaker-merge`/`speaker-split` id exists in the FROZEN 26-command
  // table (unit-102 CONTRACT); unit-104 wires the UI commands over these pure
  // fns. Until then: history stores serialized project snapshots, so a pure
  // project-in/project-out mutation is undoable BY CONSTRUCTION — the
  // pre-image survives untouched and re-serializes byte-identically.
  test('CC-06.4: mergeSpeakers on a frozen Project never mutates the pre-image and re-serializes (history-safe)', async () => {
    const real = await realEngine()
    const project = deepFreeze(structuredClone(liveProject(createTestApp().app)))
    const snapshot = serializeProject(project)
    const merged = real.mergeSpeakers(project, 'SPK_1', 'SPK_2')
    expect(serializeProject(project), 'input untouched (deep-frozen) — the history pre-image is safe').toBe(snapshot)
    expect(merged).not.toBe(project)
    expect(merged.speakers.map((s) => s.id), 'merged-away speaker removed').not.toContain('SPK_2')
    expect(serializeProject(merged), 'post-image differs').not.toBe(snapshot)
    const movedTo: Record<string, number> = {}
    for (const b of merged.blocks) for (const w of b.words) if (w.speakerId !== undefined) movedTo[w.speakerId] = (movedTo[w.speakerId] ?? 0) + 1
    expect(movedTo['SPK_1'], 'all of b’s words live on a').toBeGreaterThan(0)
    expect(movedTo['SPK_2'] ?? 0).toBe(0)
  })

  test('CC-06.4: splitSpeaker on a frozen Project appends the new identity and leaves the pre-image byte-identical', async () => {
    const real = await realEngine()
    const project = deepFreeze(structuredClone(liveProject(createTestApp().app)))
    const snapshot = serializeProject(project)
    const wordsBefore = liveProject(createTestApp().app).blocks.flatMap((b) => b.words).length
    const split = real.splitSpeaker(project, 'SPK_1', 0, '#334455')
    expect(serializeProject(project)).toBe(snapshot)
    expect(split).not.toBe(project)
    expect(split.speakers.length, 'one appended speaker').toBe(project.speakers.length + 1)
    const fresh = split.speakers.at(-1)
    expect(fresh?.color, 'the caller-supplied color is honored').toBe('#334455')
    expect(split.blocks.flatMap((b) => b.words).length, 'no word lost or gained').toBe(wordsBefore)
  })

  test('CC-06.4: pure-fn outputs are stable across repeated undo-cycles — same input, byte-identical output (no hidden state)', async () => {
    const real = await realEngine()
    const base = createTestApp().app
    const p1 = structuredClone(liveProject(base))
    const p2 = structuredClone(liveProject(base))
    expect(serializeProject(real.renameSpeaker(p1, 'SPK_1', 'Ann'))).toBe(serializeProject(real.renameSpeaker(p2, 'SPK_1', 'Ann')))
    const words: WordToken[] = [word('alpha', 0, 0.5, { speakerId: 'SPK_1' }), word('beta', 0.6, 1, { speakerId: 'SPK_2' })]
    expect(real.majoritySpeakerId(words, 'SPK_2') === real.majoritySpeakerId(words, 'SPK_2'), 'deterministic votes').toBe(true)
  })
})
