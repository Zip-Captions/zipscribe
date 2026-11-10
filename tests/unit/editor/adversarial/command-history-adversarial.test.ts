// ADVERSARY (unit-102, category 1 — command/history hostile probes). Additive
// ONLY: the frozen suites (commands-reducer, undo-redo.property,
// transport-commands, speaker-commands, translations-stub) stay untouched;
// this file probes what they do NOT pin — merge-window/undo-boundary
// interaction, the 151st eviction, branching (zundo futureStates clearing),
// split block-edge rounding, delete-last-block states, merge speaker-majority
// materialization, payload aliasing/frozen-input robustness, and command
// dispatch interleaved with job:segments streaming. Titles:
// `ADVERSE CH.n: <CC/FR-ID or invariant> — <attack>`.
// SECURITY-03: fixtures use the shared content-free vocabularies only.
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../helpers/editor-app'
import { block, sampleProject, word } from '../helpers/fixture-project'
import { createJobsStore } from '@state/jobs'
import { parseProject, serializeProject } from '@state/services/serialize'
import { FakeEnginePort } from '../../workbench/helpers/fake-engine'
import type { Project } from '@engine/model'
import type { RawSegment } from '@engine/protocol@102'

function projectOf(app: ReturnType<typeof createTestApp>['app']): Project {
  const project = app.project.getState().project
  if (project === null) throw new Error('no project')
  return project
}

/** Independent guard for domain invariants 1–3 (never delegates to the reducers). */
function checkTrackInvariants(project: Project, context: string): void {
  let previousEnd = Number.NEGATIVE_INFINITY
  for (const b of project.blocks) {
    expect(b.end > b.start, `${context}: positive duration ${b.id}`).toBe(true)
    expect(b.start >= previousEnd, `${context}: ordered & non-overlapping at ${b.id}`).toBe(true)
    previousEnd = b.end
    expect(b.words.length, `${context}: no empty blocks (invariant 3) at ${b.id}`).toBeGreaterThan(0)
    let previousWordEnd = Number.NEGATIVE_INFINITY
    for (const w of b.words) {
      expect(w.start >= previousWordEnd && w.start <= w.end, `${context}: word order ${b.id}`).toBe(true)
      expect(w.start >= b.start && w.end <= b.end, `${context}: words within bounds ${b.id}`).toBe(true)
      previousWordEnd = w.end
    }
  }
}

function deepFreeze<T>(value: T): T {
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child)
  }
  return value
}

describe('ADVERSE CH (unit-102 adversary): command/history hostile probes', () => {
  test('ADVERSE CH.1: US-2.1.4 — merge chain surviving an undo boundary leaves the next text edit unrecoverable', () => {
    const t = createTestApp()
    const textOf = (): string => projectOf(t.app).blocks.find((b) => b.id === 'blk_a')?.text ?? ''

    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'one two' })).toBeNull()
    t.clock.advance(500)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'three four' })).toBeNull()
    expect(t.app.history.undoCount(), 'two edits inside the 1 s window form ONE step').toBe(1)

    t.app.history.undo()
    expect(textOf(), 'the coalesced step reverts all edits').toBe('alpha beta gamma')

    // The chain must be dead: this edit lands AFTER an undo point, so it
    // cannot merge into the (already undone) coalesced step. Any accepted,
    // user-visible mutation must be recoverable (US-2.1.4).
    t.clock.advance(100)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'five six' })).toBeNull()
    const finalText = textOf()
    expect(finalText).toBe('five six')

    t.app.history.redo()
    expect(textOf(), 'redo must restore the final state — an edit after an undo boundary may not be orphaned').toBe(finalText)
  })

  test('ADVERSE CH.2: US-2.1.4 — coalescing window boundaries: 999 ms coalesces, exactly 1000 ms separates, chained sub-second gaps keep collapsing', () => {
    const t = createTestApp()
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'e1' })).toBeNull()
    t.clock.advance(999)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'e2' })).toBeNull()
    expect(t.app.history.undoCount(), '999 ms gap coalesces').toBe(1)
    t.clock.advance(1000) // exactly 1000 ms after the LAST accepted edit (the window is measured from it)
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'e3' })).toBeNull()
    expect(t.app.history.undoCount(), 'exactly 1000 ms separates (exclusive upper bound)').toBe(2)

    const t2 = createTestApp()
    expect(t2.app.dispatch('block-edit-text', { blockId: 'blk_b', text: 'c1' })).toBeNull()
    t2.clock.advance(999)
    expect(t2.app.dispatch('block-edit-text', { blockId: 'blk_b', text: 'c2' })).toBeNull()
    t2.clock.advance(999)
    expect(t2.app.dispatch('block-edit-text', { blockId: 'blk_b', text: 'c3' })).toBeNull()
    t2.clock.advance(999)
    expect(t2.app.dispatch('block-edit-text', { blockId: 'blk_b', text: 'c4' })).toBeNull()
    expect(t2.app.history.undoCount(), 'consecutive edits each < 1 s apart chain into ONE step').toBe(1)
  })

  test('ADVERSE CH.3: FR-102.2 — the 151st command evicts ONLY the oldest retained past state', () => {
    const t = createTestApp()
    for (let i = 0; i < 151; i++) {
      expect(t.app.dispatch('project-rename', { name: `renamed${String(i)}` })).toBeNull()
    }
    const afterFirst = structuredClone(projectOf(t.app))
    afterFirst.name = 'renamed0'
    expect(t.app.history.undoCount(), 'the limit caps the past at exactly 150').toBe(150)

    t.app.history.undo(150)
    expect(projectOf(t.app), 'undo×150 lands on the state after the FIRST command (only the oldest evicted)').toEqual(afterFirst)
    t.app.history.redo(150)
    expect(projectOf(t.app).name, 'redo×150 reaches the newest state').toBe('renamed150')
  })

  test('ADVERSE CH.4: US-2.1.4 / FR-102.2 — branching: a new command after undo kills the redo branch (zundo semantics, jumpable:false)', () => {
    const t = createTestApp()
    expect(t.app.dispatch('project-rename', { name: 'r1' })).toBeNull()
    expect(t.app.dispatch('project-rename', { name: 'r2' })).toBeNull()
    t.app.history.undo()
    expect(projectOf(t.app).name).toBe('r1')

    expect(t.app.dispatch('project-rename', { name: 'r3' })).toBeNull()
    t.app.history.redo()
    expect(projectOf(t.app).name, 'the abandoned redo branch must not resurrect r2').toBe('r3')
    expect(() => t.app.history.redoCount()).not.toThrow() // frozen void surface

    t.app.history.undo()
    expect(projectOf(t.app).name, 'the surviving branch undoes cleanly').toBe('r1')
    t.app.history.undo()
    expect(projectOf(t.app).name, 'and only the pre-branch state sits beneath').toBe('Sample project')
  })

  test('ADVERSE CH.5: FR-102.2 — mid-play scrub/selection/loop/rate churn creates no undo steps and undo never moves the playhead', () => {
    const t = createTestApp({ withMediaClock: true })
    expect(t.app.dispatch('project-rename', { name: 'renamed-ch5' })).toBeNull()
    expect(t.app.dispatch('transport-play', undefined)).toBeNull()
    t.frame(16)
    if (t.app.arbitrator === null) throw new Error('arbitrator missing')
    t.app.arbitrator.seek(30)
    t.app.editor.setSelection({ anchorBlockId: 'blk_a', focusBlockId: 'blk_c' })
    t.app.editor.setLoop([1, 2])
    t.app.editor.setRate(1.5)
    t.app.editor.setSearchOpen(true)
    expect(t.app.history.undoCount(), 'UI-only churn (scrub included) adds no step').toBe(1)

    t.app.history.undo()
    expect(projectOf(t.app).name, 'undo reverts the project').toBe('Sample project')
    expect(t.app.editor.getState().playhead, 'undo never moves the playhead').toBe(30)
    expect(t.app.editor.getState().selection.anchorBlockId).toBe('blk_a')
    expect(t.app.editor.getState().loop).toEqual([1, 2])
    expect(t.app.editor.getState().rate).toBe(1.5)
  })

  test('ADVERSE CH.6: CC-102.3 — block-edge splits never produce zero-length halves or empty parts', () => {
    const t = createTestApp()
    const before = structuredClone(projectOf(t.app))
    const edgeCodes: string[] = []
    // blk_b@3.05: the straddler goes WHOLE to the nearer-midpoint RIGHT part
    // (US-2.2.2, ledger adjudication (8)) leaving the LEFT part wordless —
    // the genuine empty-part attack under the current rule.
    for (const [blockId, at] of [['blk_a', 0.5], ['blk_a', 2.5], ['blk_a', 0.5001], ['blk_a', 2.4999], ['blk_b', 3.05]] as const) {
      const rejection = t.app.dispatch('block-split', { blockId, at })
      expect(rejection, `split ${blockId} at ${String(at)} must reject`).not.toBeNull()
      edgeCodes.push(rejection?.code ?? '')
    }
    expect(edgeCodes.every((c) => c === 'INVALID_PAYLOAD' || c === 'SPLIT_EMPTY_PART'), 'edge attacks reject as edge/empty-part codes').toBe(true)
    expect(projectOf(t.app), 'zero mutation across every rejected edge split').toEqual(before)
    expect(t.app.history.undoCount()).toBe(0)

    // word-boundary and inter-word-gap splits are legitimate; splits inside
    // the FIRST word (0.7/1.0) too — the straddler alpha goes WHOLE to the
    // nearer-midpoint LEFT part (US-2.2.2; they rejected only under the
    // retired all-straddlers-right choice, ledger adjudication (8c)):
    for (const at of [0.7, 1.0, 1.2, 1.95]) {
      const tt = createTestApp()
      expect(tt.app.dispatch('block-split', { blockId: 'blk_a', at })).toBeNull()
      const blocks = projectOf(tt.app).blocks
      expect(blocks.length).toBe(4)
      expect(blocks[0]?.end).toBe(at)
      expect(blocks[1]?.start).toBe(at)
      checkTrackInvariants(projectOf(tt.app), `split at ${String(at)}`)
    }
    // splitting INSIDE the last word: the straddler goes whole to the RIGHT, start clamped
    const t2 = createTestApp()
    expect(t2.app.dispatch('block-split', { blockId: 'blk_a', at: 2.49 })).toBeNull()
    const second = projectOf(t2.app).blocks[1]
    expect(second?.start).toBe(2.49)
    expect(second?.words[0]?.start, 'straddling word clamped, never split').toBe(2.49)
    checkTrackInvariants(projectOf(t2.app), 'split inside last word')
  })

  test('ADVERSE CH.7: CC-102.3 — block-retime guards inverted, zero-length, NaN, infinite and out-of-media ranges', () => {
    const t = createTestApp()
    const before = structuredClone(projectOf(t.app))
    const cases: ReadonlyArray<readonly [Partial<{ blockId: string; start: number; end: number }>, string]> = [
      [{ blockId: 'blk_a', start: 3, end: 3 }, 'DURATION_NON_POSITIVE'],
      [{ blockId: 'blk_a', start: 3, end: 2 }, 'DURATION_NON_POSITIVE'],
      [{ blockId: 'blk_a', start: Number.NaN, end: 2 }, 'INVALID_PAYLOAD'],
      [{ blockId: 'blk_a', start: 0, end: Number.NaN }, 'INVALID_PAYLOAD'],
      [{ blockId: 'blk_a', start: Number.NEGATIVE_INFINITY, end: 2 }, 'INVALID_PAYLOAD'],
      [{ blockId: 'blk_a', start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY }, 'INVALID_PAYLOAD'],
      [{ blockId: 'blk_a', start: -1 }, 'OUT_OF_MEDIA'],
      [{ blockId: 'blk_c', end: 121.441 }, 'OUT_OF_MEDIA'],
    ]
    for (const [payload, code] of cases) {
      const rejection = t.app.dispatch('block-retime', { blockId: 'blk_a', ...payload })
      expect(rejection?.code, `retime ${JSON.stringify(payload)}`).toBe(code)
    }
    expect(projectOf(t.app), 'every rejected retime leaves the project byte-identical').toEqual(before)
    expect(t.app.history.undoCount(), 'no history step for rejected commands').toBe(0)
  })

  test('ADVERSE CH.8: CC-102.4 / invariant 8 — retime with { start: -0 } must not leave a negative zero that the canonical round-trip cannot represent', () => {
    const t = createTestApp()
    expect(t.app.dispatch('block-retime', { blockId: 'blk_a', start: -0 })).toBeNull()
    const p = projectOf(t.app)

    // The reducer's OUTGOING guarantee (CC-102.4 + invariant 6): times it
    // writes are canonical numbers, so `parse(serialize(p))` deep-equals p.
    // The -0 < 0 media guard admits the payload; nothing downstream may break
    // because of it.
    const roundTrip = parseProject(serializeProject(p))
    expect(roundTrip, 'parse(serialize(p)) deep-equals p for every reducer-reachable project (invariant 8)').toEqual(p)
  })

  test('ADVERSE CH.9: CC-102.3 / invariant 3 — delete-last-block states stay valid and undoable', () => {
    const single = (): Project => sampleProject({ blocks: [block('blk_solo', 1, 2, 'SPK_1', [word('solo', 1, 2)])] })

    const t1 = createTestApp({ project: single() })
    expect(t1.app.dispatch('block-delete', { blockId: 'blk_solo' })).toBeNull()
    expect(projectOf(t1.app).blocks, 'deleting the last block empties the track').toEqual([])
    expect(t1.app.project.hasBlocks()).toBe(false)
    t1.app.history.undo()
    expect(projectOf(t1.app).blocks.length, 'undo restores the sole block').toBe(1)

    const t2 = createTestApp({ project: single() })
    expect(t2.app.dispatch('block-edit-text', { blockId: 'blk_solo', text: '' })).toBeNull()
    expect(projectOf(t2.app).blocks, 'empty text deletes the last block (invariant 3)').toEqual([])
    t2.app.history.undo()
    expect(projectOf(t2.app).blocks.length).toBe(1)

    const t3 = createTestApp({ project: single() })
    const assetBefore = structuredClone(projectOf(t3.app).asset)
    expect(t3.app.dispatch('block-delete-close-gap', { blockId: 'blk_solo' })).toBeNull()
    expect(projectOf(t3.app).blocks, 'close-gap on the only block: nothing to extend, no crash').toEqual([])
    expect(projectOf(t3.app).asset, 'media never moves (invariant 9)').toEqual(assetBefore)
    t3.app.history.undo()
    expect(projectOf(t3.app).blocks.length).toBe(1)
  })

  test('ADVERSE CH.10: domain model § Speaker assignment — merge across a gap must materialize block.speakerId by word majority, not keep the left block label', () => {
    const wideWords = ['p1', 'p2', 'p3', 'p4', 'p5'].map((text, i) => word(text, 12 + i * 0.8, 12 + i * 0.8 + 0.6, { speakerId: 'SPK_2' }))
    const t = createTestApp({
      project: sampleProject({
        blocks: [block('blk_x', 10, 11, 'SPK_1', [word('one', 10, 11, { speakerId: 'SPK_1' })]), block('blk_y', 12, 16, 'SPK_2', wideWords)],
      }),
    })
    expect(t.app.dispatch('block-merge', { blockIds: ['blk_x', 'blk_y'] }), 'merging array-adjacent blocks across a time gap is allowed (span = union)').toBeNull()
    const merged = projectOf(t.app).blocks[0]
    expect(merged?.words.length, 'words concatenated').toBe(6)
    expect(merged?.speakerId, 'block.speakerId = majority of word.speakerId (5× SPK_2 vs 1× SPK_1)').toBe('SPK_2')
  })

  test('ADVERSE CH.11: CC-102.3 — frozen payloads dispatch cleanly and caller-side payload mutation after dispatch never reaches the store', () => {
    const t = createTestApp()
    const importBlocks = [block('imp_freeze', 40, 41, 'SPK_1', [word('froze', 40, 41)])]
    const payload = deepFreeze({ blocks: importBlocks, speakers: [], replace: false as const })
    expect(t.app.dispatch('captions-import', payload), 'reducers never write the payload').toBeNull()

    const afterImport = structuredClone(projectOf(t.app))
    // Caller reuses (and mutates) the payload objects after the accepted dispatch.
    try {
      const mutableBlock = importBlocks[0] as { text: string; words: { text: string }[] } | undefined
      if (mutableBlock !== undefined) {
        mutableBlock.text = 'MUTATED'
        mutableBlock.words[0]!.text = 'MUTATED'
      }
      ;(payload.blocks as unknown as { push?(...args: unknown[]): number }).push?.(block('imp_late', 50, 51, 'SPK_1', [word('late', 50, 51)]))
    } catch {
      // immer deep-freezes what reached the store — a frozen payload mutation
      // throwing is acceptable, mutating the store is not.
    }
    expect(projectOf(t.app), 'the stored project is immutable against post-dispatch caller mutation').toEqual(afterImport)

    // A frozen initialProject must be safe too (the app deep-clones at composition).
    const t2 = createTestApp({ project: deepFreeze(sampleProject()) })
    expect(t2.app.dispatch('project-rename', { name: 'frozen-boot' })).toBeNull()
    expect(projectOf(t2.app).name).toBe('frozen-boot')
  })

  test('ADVERSE CH.12: US-2.1.4 / CC-102.1 — command dispatch and undo/redo interleaved with job:segments streaming hold invariants 1–2 and keep segments sorted', () => {
    const engine = new FakeEnginePort()
    const jobs = createJobsStore({ engine, modelCache: { listCached: async () => [] } })
    const t = createTestApp()

    jobs.startTranscribe({ language: 'en', modelId: 'whisper-base_timestamped@608c49e6', diarize: false, mode: 'replace' })
    const transcribe = engine.asrRequests.find((r) => r.t === 'transcribe')
    if (transcribe === undefined || transcribe.t !== 'transcribe') throw new Error('transcribe not posted')
    const jobId = transcribe.jobId

    const seg = (start: number, end: number): RawSegment => ({ start, end, text: 'aa', words: [word('aa', start, end)] })
    const before = structuredClone(projectOf(t.app))

    engine.emitAsr({ t: 'job:segments', jobId, segments: [seg(9, 10), seg(4, 5)] })
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'stream one' })).toBeNull()
    engine.emitAsr({ t: 'job:segments', jobId, segments: [seg(1, 2), seg(6, 7)] })
    expect(t.app.dispatch('block-retime', { blockId: 'blk_b', end: 4.5 })).toBeNull()
    t.app.history.undo()
    engine.emitAsr({ t: 'job:segments', jobId, segments: [seg(11, 12)] })
    t.app.history.redo()
    engine.emitAsr({ t: 'job:segments', jobId: 'J_STALE', segments: [seg(0.1, 0.2)] })

    expect(jobs.getState().segments.map((s) => s.start), 'accumulated segments sorted by start; foreign-jobId flush dropped').toEqual([1, 4, 6, 9, 11])
    checkTrackInvariants(projectOf(t.app), 'job streaming interleaving')
    expect(projectOf(t.app), 'the two accepted commands are visible').not.toEqual(before)
    t.app.history.undo(2)
    expect(projectOf(t.app), 'streaming never touched the project — undo×2 (every accepted command) returns to pre-stream').toEqual(before)
  })
})
