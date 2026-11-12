// CC-104.7 (L1): the `captions-align-apply` command (CONTRACT.md § Commands —
// unit-104 EXTENDS) — the whole apply is ONE undo step and the frozen
// `alignCaptionsToWords` semantics hold through the store: matched words
// (normalizeToken equality, inside block bounds) copy the ASR times and get
// timing 'aligned'; unmatched re-interpolate evenly between aligned
// neighbours and stay 'estimated'; text/count/bounds/ids NEVER change
// (US-07.3). RED: the command id is not registered.
// No canary content (synthetic align corpus).
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { serializeProject } from '@state/services/serialize'
import { ALIGN_ASR_WORDS, ALIGN_EXPECTED_MID_TIMES, alignProject } from './helpers/transcript-fixture'
import type { Project } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

function mount(): ReturnType<typeof createTestApp> {
  return createTestApp({ project: alignProject() })
}

function dispatch(app: EditorApp, id: string, payload?: unknown): { threw: boolean; reject: { code: string } | null } {
  try {
    return { threw: false, reject: (app as unknown as { dispatch(id: string, payload?: unknown): { code: string } | null }).dispatch(id, payload) }
  } catch {
    return { threw: true, reject: null }
  }
}

function project(t: ReturnType<typeof createTestApp>): Project {
  return t.app.project.getState().project as Project
}

describe('CC-104.7: captions-align-apply (one undo step · aligned/estimated · content frozen)', () => {
  test('CC-104.7: scripted ASR words align matches, re-interpolate the rest, ONE step, undo byte-equal', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    const outcome = dispatch(t.app, 'captions-align-apply', { asrWords: [...ALIGN_ASR_WORDS] })
    expect(outcome.threw, "captions-align-apply is not registered in the command registry (expected id 'captions-align-apply')").toBe(false)
    expect(outcome.reject, `align rejected (${outcome.reject?.code ?? 'n/a'})`).toBeNull()

    const next = project(t)
    const a1 = next.blocks.find((b) => b.id === 'blk_a1')!
    const a2 = next.blocks.find((b) => b.id === 'blk_a2')!

    expect(a1.words.map((w) => w.timing)).toEqual(['aligned', 'aligned', 'aligned'])
    expect(a1.words.map((w) => [w.start, w.end])).toEqual([
      [0.6, 1.1],
      [1.25, 1.8],
      [2.05, 2.45],
    ])
    expect(a2.words[0]!.timing).toBe('aligned')
    expect([a2.words[0]!.start, a2.words[0]!.end]).toEqual([3.6, 4.1])
    expect(a2.words[1]!.timing).toBe('estimated')
    expect([a2.words[1]!.start, a2.words[1]!.end]).toEqual([ALIGN_EXPECTED_MID_TIMES[0]!.start, ALIGN_EXPECTED_MID_TIMES[0]!.end])
    expect(a2.words[2]!.timing).toBe('estimated')
    expect([a2.words[2]!.start, a2.words[2]!.end]).toEqual([ALIGN_EXPECTED_MID_TIMES[1]!.start, ALIGN_EXPECTED_MID_TIMES[1]!.end])
    expect(a2.words[3]!.timing).toBe('aligned')
    expect([a2.words[3]!.start, a2.words[3]!.end]).toEqual([4.5, 4.9])

    // US-07.3: text / count / bounds / ids NEVER change.
    expect(next.blocks.map((b) => b.id)).toEqual(['blk_a1', 'blk_a2'])
    expect(a1.text).toBe('café au lait')
    expect(a2.text).toBe('two more lines now')
    expect([a1.start, a1.end]).toEqual([0.5, 2.5])
    expect([a2.start, a2.end]).toEqual([3.5, 5.2])

    expect(t.app.history.undoCount(), 'the WHOLE apply is ONE undo step').toBe(undoBefore + 1)
    t.app.history.undo()
    expect(serializeProject(project(t)), 'undo restores byte-equal state').toBe(before)
    t.app.dispose()
  })

  test('CC-104.7: ASR matches timed outside block bounds stay unmatched (estimated, re-interpolated)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const outcome = dispatch(t.app, 'captions-align-apply', { asrWords: [{ text: 'two', start: 100, end: 101 }] })
    expect(outcome.threw, "captions-align-apply is not registered in the command registry (expected id 'captions-align-apply')").toBe(false)
    expect(outcome.reject).toBeNull()
    const next = project(t)
    const a1 = next.blocks.find((b) => b.id === 'blk_a1')!
    const a2 = next.blocks.find((b) => b.id === 'blk_a2')!
    expect(a1.words.every((w) => w.timing === 'estimated'), 'no fabricated aligned words').toBe(true)
    expect(a1.words.map((w) => w.start)).toEqual([0.5, 1.167, 1.833])
    expect(a1.words.map((w) => w.end)).toEqual([1.167, 1.833, 2.5])
    expect(a2.words.every((w) => w.timing === 'estimated')).toBe(true)
    t.app.dispose()
  })
})
