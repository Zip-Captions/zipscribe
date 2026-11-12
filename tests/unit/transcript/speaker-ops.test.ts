// CC-104.5 (L1) + CC-06.4 (history integration): the speaker popover's
// command surface — every operation is EXACTLY ONE undo step and undo
// restores byte-equal project state (frozen golden
// fixtures/golden/transcript/speaker-ops-initial.json). Rename/recolor/assign
// are the merged unit-102 commands (green regression); `speaker-merge` and
// `speaker-split` are the unit-104 EXTENDS commands (RED — not registered).
// CC-06.4 runs merge/split through the REAL merged engine functions
// (src/engine/diarize/assign.ts) wired through the `SpeakerEngine` seam
// (CONTRACT.md § Commands — unit-104 EXTENDS; mergeSpeakers seam direction is
// (from, into) → assign.mergeSpeakers(project, into, from)).
// No canary content is rendered (synthetic speakerOps corpus).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { majoritySpeakerId, reassignWords, mergeSpeakers, splitSpeaker } from '../../../src/engine/diarize/assign'
import { serializeProject } from '@state/services/serialize'
import { speakerOpsProject } from './helpers/transcript-fixture'
import type { Project, Seconds } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

// cwd-relative (vitest runs at the package root; jsdom suites would get a
// non-file `import.meta.url`) — same loader as editing.test.tsx.
const GOLDEN = readFileSync(join(process.cwd(), 'fixtures/golden/transcript/speaker-ops-initial.json'), 'utf8').trimEnd()

/** The frozen `@104 EXTENDS` seam additions mapped onto the REAL merged
 *  engine (assign.ts merge direction is b→a; payload (from→into) maps to
 *  mergeSpeakers(project, into, from)). */
const realSpeakerEngine = {
  majoritySpeakerId,
  reassignWords,
  mergeSpeakers: (project: Project, from: string, into: string) => mergeSpeakers(project, into, from),
  splitSpeaker: (project: Project, speakerId: string, at: Seconds, newColor: string) => splitSpeaker(project, speakerId, at, newColor),
}

function mount(): ReturnType<typeof createTestApp> {
  return createTestApp({ project: speakerOpsProject(), speakerEngine: realSpeakerEngine })
}

interface Outcome {
  threw: boolean
  reject: { code: string } | null
}

function dispatch(app: EditorApp, id: string, payload?: unknown): Outcome {
  try {
    return { threw: false, reject: (app as unknown as { dispatch(id: string, payload?: unknown): { code: string } | null }).dispatch(id, payload) }
  } catch {
    return { threw: true, reject: null }
  }
}

function project(t: ReturnType<typeof createTestApp>): Project {
  return t.app.project.getState().project as Project
}

describe('CC-104.5: every speaker-popover operation is one undo step', () => {
  test('CC-104.5: rename — one step, undo byte-equal (merged command regression)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    expect(before, 'fixture matches the frozen golden').toBe(GOLDEN)
    const undoBefore = t.app.history.undoCount()
    expect(t.app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: 'Ann' })).toBeNull()
    expect(project(t).speakers.find((s) => s.id === 'SPK_1')?.label).toBe('Ann')
    expect(t.app.history.undoCount()).toBe(undoBefore + 1)
    t.app.history.undo()
    expect(serializeProject(project(t))).toBe(before)
    t.app.dispose()
  })

  test('CC-104.5: recolor — one step, undo byte-equal (merged command regression)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    expect(t.app.dispatch('speaker-recolor', { speakerId: 'SPK_2', color: '#00ff00' })).toBeNull()
    expect(project(t).speakers.find((s) => s.id === 'SPK_2')?.color).toBe('#00ff00')
    expect(t.app.history.undoCount()).toBe(undoBefore + 1)
    t.app.history.undo()
    expect(serializeProject(project(t))).toBe(before)
    t.app.dispose()
  })

  test('CC-104.5: reassign (block paint) — one step, words + majority move, undo byte-equal', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    expect(t.app.dispatch('speaker-assign', { blockIds: ['blk_m2'], speakerId: 'SPK_1' })).toBeNull()
    const blk = project(t).blocks.find((b) => b.id === 'blk_m2')!
    expect(blk.speakerId).toBe('SPK_1')
    expect(blk.words.every((w) => (w.speakerId ?? blk.speakerId) === 'SPK_1')).toBe(true)
    expect(t.app.history.undoCount()).toBe(undoBefore + 1)
    t.app.history.undo()
    expect(serializeProject(project(t))).toBe(before)
    t.app.dispose()
  })

  test('CC-104.5 / CC-06.4: speaker-merge — words move, speaker removed, ONE step, undo byte-equal (RED: command not registered)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    const outcome = dispatch(t.app, 'speaker-merge', { from: 'SPK_2', into: 'SPK_1' })
    expect(outcome.threw, "speaker-merge is not registered in the command registry (expected id 'speaker-merge')").toBe(false)
    expect(outcome.reject, `merge rejected (${outcome.reject?.code ?? 'n/a'})`).toBeNull()
    const next = project(t)
    expect(next.speakers.map((s) => s.id)).toEqual(['SPK_1'])
    const m1 = next.blocks.find((b) => b.id === 'blk_m1')!
    const m2 = next.blocks.find((b) => b.id === 'blk_m2')!
    const m3 = next.blocks.find((b) => b.id === 'blk_m3')!
    expect(m1.words.every((w) => (w.speakerId ?? m1.speakerId) === 'SPK_1'), 'blk_m1 words (incl. the SPK_2-tagged one) move').toBe(true)
    expect(m2.words.every((w) => (w.speakerId ?? m2.speakerId) === 'SPK_1'), 'blk_m2 effective words move').toBe(true)
    expect(m1.speakerId).toBe('SPK_1')
    expect(m2.speakerId).toBe('SPK_1')
    expect(m3.speakerId, 'untouched block keeps its speaker').toBe('SPK_1')
    expect(next.speakerSource, 'attribution becomes manual (invariant 5)').toBe('manual')
    expect(t.app.history.undoCount(), 'exactly ONE undo step').toBe(undoBefore + 1)
    t.app.history.undo()
    expect(serializeProject(project(t)), 'undo restores byte-equal state').toBe(before)
    t.app.dispose()
  })

  test('CC-104.5: speaker-merge rejections — self-merge (SPEAKER_MERGE_SELF) and dangling ref, NO step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    const self = dispatch(t.app, 'speaker-merge', { from: 'SPK_1', into: 'SPK_1' })
    expect(self.threw, "speaker-merge is not registered in the command registry (expected id 'speaker-merge')").toBe(false)
    expect(String(self.reject?.code), 'self-merge carries its own reject code').toBe('SPEAKER_MERGE_SELF')
    const dangling = dispatch(t.app, 'speaker-merge', { from: 'SPK_404', into: 'SPK_1' })
    expect(String(dangling.reject?.code)).toBe('DANGLING_SPEAKER_REF')
    expect(serializeProject(project(t)), 'rejected commands changed nothing').toBe(before)
    expect(t.app.history.undoCount(), 'rejected commands create no step').toBe(undoBefore)
    t.app.dispose()
  })

  test('CC-104.5 / CC-06.4: speaker-split — words ≥ at move to a NEW appended speaker, ONE step, undo byte-equal (RED: command not registered)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    const outcome = dispatch(t.app, 'speaker-split', { speakerId: 'SPK_2', at: 3.0, color: '#123456' })
    expect(outcome.threw, "speaker-split is not registered in the command registry (expected id 'speaker-split')").toBe(false)
    expect(outcome.reject, `split rejected (${outcome.reject?.code ?? 'n/a'})`).toBeNull()
    const next = project(t)
    const added = next.speakers[next.speakers.length - 1]!
    expect(next.speakers.length, 'one speaker appended').toBe(3)
    expect(added.id).toBe('SPK_3')
    expect(added.label).toBe('Speaker 3')
    expect(added.color).toBe('#123456')
    const m1 = next.blocks.find((b) => b.id === 'blk_m1')!
    const m2 = next.blocks.find((b) => b.id === 'blk_m2')!
    expect(m1.words.find((w) => w.text === 'taken')?.speakerId, 'word at 0.9 < at stays').toBe('SPK_2')
    expect(m2.words.find((w) => w.text === 'deep')?.speakerId, 'word at 2.5 < at stays').toBe('SPK_2')
    expect(m2.words.find((w) => w.text === 'state')?.speakerId, 'word at 3.3 ≥ at moves to the new speaker').toBe('SPK_3')
    expect(m2.speakerId, 'majority tie keeps the first word order speaker').toBe('SPK_2')
    expect(next.speakerSource).toBe('manual')
    expect(t.app.history.undoCount(), 'exactly ONE undo step').toBe(undoBefore + 1)
    t.app.history.undo()
    expect(serializeProject(project(t)), 'undo restores byte-equal state').toBe(before)
    t.app.dispose()
  })

  test('CC-104.5: speaker-split dangling ref → DANGLING_SPEAKER_REF, NO step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = mount()
    const before = serializeProject(project(t))
    const undoBefore = t.app.history.undoCount()
    const outcome = dispatch(t.app, 'speaker-split', { speakerId: 'SPK_404', at: 1.0 })
    expect(outcome.threw, "speaker-split is not registered in the command registry (expected id 'speaker-split')").toBe(false)
    expect(String(outcome.reject?.code)).toBe('DANGLING_SPEAKER_REF')
    expect(serializeProject(project(t))).toBe(before)
    expect(t.app.history.undoCount()).toBe(undoBefore)
    t.app.dispose()
  })
})
