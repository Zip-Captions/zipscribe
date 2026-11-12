// unit-104 AUDIT — adversarial regression suite (test-adversary, fresh-session
// re-derivation from the CONTRACT, not the existing suites). Sources of truth:
// .ai-dlc/caption-studio-ui/unit-104-transcript-editor.md (US-2.1.x, FR-104.x,
// CC-104.x), .ai-dlc/knowledge/domain.md invariants 1–12, src/state/CONTRACT.md
// § Commands — unit-104 EXTENDS (4 rows), .agent/REVIEW.md always-check.
// ADDITIVE ONLY: src/** byte-identical; existing tests untouched.
//
// Speaker-engine boundary probes inject the PRODUCTION seam default
// (DEFAULT_COMMAND_DEPS.speakerEngine → src/engine/diarize/assign.ts verbatim):
// the frozen createFakeSpeakerEngine does not carry the @104 members, so the
// real `>=` split semantics must be proven through the COMMAND surface here.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../../editor/helpers/editor-app'
import { block, word } from '../../editor/helpers/fixture-project'
import { createProbingEngine, createFakeModelCache } from '../../workbench/helpers/fake-engine'
import { createJobsStore } from '@state/jobs'
import { DEFAULT_COMMAND_DEPS, deriveBlockText } from '@state/commands'
import { serializeProject } from '@state/services/serialize'
import { findMatches } from '@ui/transcript/match-index'
import { getTranscriptPanel } from '@ui/transcript/bridge-seam'
import { dispatchCommand } from '@ui/commands/registry'
import { createRedactionSpy, CANARY_MARKER } from '../../../../src/test-support/redaction'
import { alignBlocks, searchBlocks, transcriptBlocks, transcriptProject } from '../helpers/transcript-fixture'
import { installDomStubs } from '../helpers/dom-stubs'
import { CaptionImportDialog } from '@ui/transcript/CaptionImportDialog'
import { RetimeDialog } from '@ui/transcript/RetimeDialog'
import { Transcript } from '@ui/transcript/Transcript'
import type { CaptionImportPort } from '@state/services/caption-import'
import type { CaptionBlock, Project } from '@engine/model'
import type { EditorApp } from '@state/history'
import type { ImportReport } from '@engine/captions/import'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

/** Production-wired app: the REAL engine-06 pure functions behind the seam. */
function prodApp(project: Project) {
  return createTestApp({ project, speakerEngine: DEFAULT_COMMAND_DEPS.speakerEngine })
}

function projectOf(app: EditorApp): Project {
  return app.project.getState().project as Project
}

const auditProject = (blocks: CaptionBlock[]): Project => transcriptProject(blocks)

let dom: ReturnType<typeof installDomStubs> | null = null
let redaction = createRedactionSpy()

afterEach(() => {
  cleanup()
  dom?.restore()
  dom = null
  redaction.restore()
  redaction = createRedactionSpy()
})

async function settleDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
}

// ── CATEGORY 1 · BOUNDARY VALUES ─────────────────────────────────────────────

describe('AUDIT boundary: speaker-split `>=` cut-time boundary (CONTRACT @104 row; engine splitSpeaker)', () => {
  test('CC-104.5 AUDIT: word starting EXACTLY at `at` moves to the new speaker (>=, not >), one undo step, undo byte-exact', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = prodApp(auditProject([block('blk_1', 0, 3, 'SPK_1', [word('before', 0, 1.0, { speakerId: 'SPK_1' }), word('boundary', 2.0, 2.5, { speakerId: 'SPK_1' })])]))
    const before = serializeProject(projectOf(t.app))
    expect(t.app.dispatch('speaker-split', { speakerId: 'SPK_1', at: 2.0 })).toBeNull()
    const words = projectOf(t.app).blocks[0]!.words
    expect(words[0]!.speakerId, 'word starting before at stays').toBe('SPK_1')
    expect(words[1]!.speakerId, 'word starting exactly at at MOVES (start >= at)').toBe('SPK_3')
    expect(t.app.history.undoCount(), 'ONE undo step').toBe(1)
    t.app.history.undo()
    expect(serializeProject(projectOf(t.app)), 'undo restores byte-exactly').toBe(before)
  })

  test('AUDIT: split with no matching words still appends the speaker (contract: words with start >= at move; append unconditional) and undo is byte-exact', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = prodApp(auditProject([block('blk_1', 0, 1, 'SPK_1', [word('solo', 0, 1.0, { speakerId: 'SPK_1' })])]))
    const before = serializeProject(projectOf(t.app))
    expect(t.app.dispatch('speaker-split', { speakerId: 'SPK_1', at: 5 })).toBeNull()
    expect(projectOf(t.app).speakers.length).toBe(3)
    expect(projectOf(t.app).blocks[0]!.words[0]!.speakerId).toBe('SPK_1')
    t.app.history.undo()
    expect(serializeProject(projectOf(t.app))).toBe(before)
  })

  test('AUDIT: un-injected @104 speaker members fail with the CODE SPEAKER_ENGINE_UNAVAILABLE and zero mutation (CONTRACT § speaker-* family)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    const before = serializeProject(projectOf(t.app))
    const steps = t.app.history.undoCount()
    expect(() => t.app.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_2' })).toThrow(/SPEAKER_ENGINE_UNAVAILABLE/)
    expect(() => t.app.dispatch('speaker-split', { speakerId: 'SPK_1', at: 1 })).toThrow(/SPEAKER_ENGINE_UNAVAILABLE/)
    expect(serializeProject(projectOf(t.app)), 'zero mutation on seam failure').toBe(before)
    expect(t.app.history.undoCount()).toBe(steps)
  })
})

describe('AUDIT boundary: replace-text (CONTRACT @104 replace-text row; domain invariants 2/3)', () => {
  test('VIOLATION invariant 3: replace-all with an empty replacement ERASES the last words but the empty block PERSISTS — block-edit-text treats "" as a delete; the UI Replace field is freely emptyable (US-2.1.6)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject([block('blk_1', 0, 1, 'SPK_1', [word('alpha', 0, 1.0)])]) })
    expect(t.app.dispatch('replace-text', { query: 'alpha', replacement: '' })).toBeNull()
    const blocks = projectOf(t.app).blocks
    // domain.md invariant 3 — "Deleting all words deletes the block (no empty
    // blocks persist)". The sibling frozen command agrees: block-edit-text
    // with text '' DELETES (block-edit-text.ts). The command must not persist
    // what the UI trivially triggers (blank Replace field + Replace all).
    expect(blocks.length, 'no empty block may persist (domain.md invariant 3)').toBe(0)
  })

  test('CC-104.3 AUDIT: partial erase keeps invariant 2 (text == words join) and every word [start,end] unchanged, ONE undo step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject([block('blk_1', 0, 3, 'SPK_1', [word('alpha', 0, 1.0), word('beta', 1.2, 2.0), word('gamma', 2.2, 3.0)])]) })
    const before = projectOf(t.app).blocks[0]!.words.map((w) => ({ start: w.start, end: w.end }))
    expect(t.app.dispatch('replace-text', { query: 'beta', replacement: '' })).toBeNull()
    const block0 = projectOf(t.app).blocks[0]!
    expect(block0.text, 'invariant-2 join stays self-consistent').toBe(deriveBlockText(block0.words))
    const after = block0.words.map((w) => ({ start: w.start, end: w.end }))
    expect(after, 'word timings frozen (CONTRACT row: Word TIMINGS unchanged)').toEqual(before)
    expect(t.app.history.undoCount()).toBe(1)
  })

  test('FR-104.4/US-2.1.3 AUDIT: newline in query OR replacement is rejected (INVALID_PAYLOAD) — a raw \\n must never reach a word token; zero mutation, zero step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    const before = serializeProject(projectOf(t.app))
    const steps = t.app.history.undoCount()
    expect(t.app.dispatch('replace-text', { query: 'a\nb', replacement: 'x' })?.code).toBe('INVALID_PAYLOAD')
    expect(t.app.dispatch('replace-text', { query: 'alpha', replacement: 'x\ny' })?.code).toBe('INVALID_PAYLOAD')
    expect(t.app.dispatch('replace-text', { query: 'alpha', replacement: 'x\r\ny' })?.code).toBe('INVALID_PAYLOAD')
    expect(serializeProject(projectOf(t.app))).toBe(before)
    expect(t.app.history.undoCount()).toBe(steps)
  })

  test('US-2.1.6 AUDIT: zero matches → null, project byte-identical, NO history step (CONTRACT row); empty query rejected', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    const before = serializeProject(projectOf(t.app))
    expect(t.app.dispatch('replace-text', { query: 'zzz-not-present-at-all', replacement: 'x' })).toBeNull()
    expect(t.app.dispatch('replace-text', { query: '', replacement: 'x' })?.code).toBe('INVALID_PAYLOAD')
    expect(serializeProject(projectOf(t.app))).toBe(before)
    expect(t.app.history.undoCount(), 'zero matches never pollutes undo (CC-104.4)').toBe(0)
  })

  test('CC-104.4 AUDIT: match semantics — caseSensitive exact substring, wholeWord token-core equality, regex metacharacters literal', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t1 = createTestApp({ project: auditProject(searchBlocks()) })
    expect(t1.app.dispatch('replace-text', { query: 'beta', replacement: 'X', caseSensitive: true })).toBeNull()
    expect(projectOf(t1.app).blocks[2]!.words[0]!.text, 'exact-case token replaced').toBe('X')
    expect(projectOf(t1.app).blocks[0]!.words[1]!.text, 'differing-case token untouched').toBe('Beta')
    const t2 = createTestApp({ project: auditProject(searchBlocks()) })
    expect(t2.app.dispatch('replace-text', { query: 'beta', replacement: 'Y', wholeWord: true })).toBeNull()
    expect(projectOf(t2.app).blocks[2]!.words[0]!.text).toBe('Y')
    expect(projectOf(t2.app).blocks[2]!.words[1]!.text, 'whole-word: betas excluded').toBe('betas')
    const t3 = createTestApp({ project: auditProject([block('blk_1', 0, 1, 'SPK_1', [word('abc', 0, 1.0)])]) })
    expect(t3.app.dispatch('replace-text', { query: 'a.c', replacement: 'Z' }), 'dot is literal, not a regex wildcard').toBeNull()
    expect(projectOf(t3.app).blocks[0]!.words[0]!.text).toBe('abc')
  })

  test('CC-104.3 AUDIT: UNEQUAL-length replacement keeps every word span byte-identical (CONTRACT row plain words: "Word TIMINGS unchanged")', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject([block('blk_1', 0, 3, 'SPK_1', [word('alpha', 0, 1.0), word('beta', 1.2, 2.0)])]) })
    expect(t.app.dispatch('replace-text', { query: 'beta', replacement: 'extraordinarily-long-token' })).toBeNull()
    const words = projectOf(t.app).blocks[0]!.words
    expect(words.map((w) => [w.start, w.end])).toEqual([
      [0, 1],
      [1.2, 2],
    ])
  })

  test('AUDIT: zero-block guard — replace-text and align accept the empty track as a step-free no-op', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject([]) })
    expect(t.app.dispatch('replace-text', { query: 'x', replacement: 'y' }), 'zero blocks accepted as no-op').toBeNull()
    expect(t.app.history.undoCount()).toBe(0)
    expect(t.app.dispatch('captions-align-apply', { asrWords: [] })).toBeNull()
    expect(t.app.history.undoCount()).toBe(0)
  })
})

describe('AUDIT boundary: captions-retime-all EXTENDS (two-point scale/anchor; FR-104.8; invariants 1/6/9)', () => {
  test('offset clamp: never negative, never past asset.duration; asset never moves (invariant 9)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    const assetBefore = JSON.stringify(projectOf(t.app).asset)
    expect(t.app.dispatch('captions-retime-all', { offsetSec: -1000 })).toBeNull()
    expect(projectOf(t.app).blocks[0]!.start, 'clamped to 0, never negative').toBe(0)
    expect(Math.min(...projectOf(t.app).blocks.flatMap((b) => [b.start, b.end])), 'no negative time anywhere').toBeGreaterThanOrEqual(0)
    t.app.history.undo()
    expect(t.app.dispatch('captions-retime-all', { offsetSec: 1000 })).toBeNull()
    const blocks = projectOf(t.app).blocks
    expect(blocks[blocks.length - 1]!.end, 'clamped to asset.duration').toBe(projectOf(t.app).asset.duration)
    expect(JSON.stringify(projectOf(t.app).asset), 'media never moves (invariant 9)').toBe(assetBefore)
  })

  test('scale < 0 repaired to the documented monotone collapse (engine retime.ts); start<=end survives; ONE step; asset intact', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    const assetBefore = JSON.stringify(projectOf(t.app).asset)
    expect(t.app.dispatch('captions-retime-all', { offsetSec: 2, scale: -3, anchorSec: 1 })).toBeNull()
    for (const b of projectOf(t.app).blocks) {
      expect(b.end, 'collapse keeps start <= end').toBeGreaterThanOrEqual(b.start)
      for (const w of b.words) expect(w.end).toBeGreaterThanOrEqual(w.start)
    }
    expect(projectOf(t.app).blocks[0]!.start, 'collapse lands on anchor+offset = 3 (round3)').toBe(3)
    expect(t.app.history.undoCount()).toBe(1)
    expect(JSON.stringify(projectOf(t.app).asset)).toBe(assetBefore)
  })

  test('non-finite scale/anchorSec → INVALID_PAYLOAD zero mutation; identity offset (0) → step-free no-op accept', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    const before = serializeProject(projectOf(t.app))
    expect(t.app.dispatch('captions-retime-all', { offsetSec: 0, scale: Number.NaN })?.code).toBe('INVALID_PAYLOAD')
    expect(t.app.dispatch('captions-retime-all', { offsetSec: 0, anchorSec: Number.POSITIVE_INFINITY })?.code).toBe('INVALID_PAYLOAD')
    expect(t.app.dispatch('captions-retime-all', { offsetSec: 0 })).toBeNull()
    expect(serializeProject(projectOf(t.app))).toBe(before)
    expect(t.app.history.undoCount()).toBe(0)
  })
})

describe('AUDIT boundary: close-gap delete (FR-104.7 midpoint; invariant 9)', () => {
  test('round3 midpoint TIE on the .0005 boundary resolves half-up (round3, invariant 6)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    // blk_p [0,0.001] · blk_g [0.0012,0.0014] (deleted) · blk_n [0.002,0.9]:
    // meet = round3((0.001 + 0.002)/2) = round3(0.0015) = 0.002 (Math.round half-up).
    const t = createTestApp({
      project: auditProject([
        block('blk_p', 0, 0.001, 'SPK_1', [word('one', 0, 0.001)]),
        block('blk_g', 0.0012, 0.0014, 'SPK_2', [word('gone', 0.0012, 0.0014)]),
        block('blk_n', 0.002, 0.9, 'SPK_1', [word('two', 0.002, 0.9)]),
      ]),
    })
    expect(t.app.dispatch('block-delete-close-gap', { blockId: 'blk_g' })).toBeNull()
    const [prev, next] = projectOf(t.app).blocks
    expect(prev!.end, 'round3 tie half-up onto the 3-decimal grid').toBe(0.002)
    expect(next!.start, 'neighbours MEET at the midpoint (FR-104.7)').toBe(prev!.end)
  })

  test('edge deletions extend the SINGLE neighbour to the removed block far bound; blocks beyond never shift (invariant 9)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const build = (): CaptionBlock[] => [
      block('blk_1', 1.0, 2.0, 'SPK_1', [word('a', 1.0, 2.0)]),
      block('blk_2', 3.0, 4.0, 'SPK_2', [word('b', 3.0, 4.0)]),
      block('blk_3', 5.0, 6.0, 'SPK_1', [word('c', 5.0, 6.0)]),
    ]
    const first = createTestApp({ project: auditProject(build()) })
    const frozenTail = JSON.stringify(projectOf(first.app).blocks[2])
    expect(first.app.dispatch('block-delete-close-gap', { blockId: 'blk_1' })).toBeNull()
    expect(projectOf(first.app).blocks[0]!.start, 'next.start extends back to removed.start').toBe(1.0)
    expect(JSON.stringify(projectOf(first.app).blocks[1]), 'later blocks byte-identical (invariant 9)').toBe(frozenTail)

    const last = createTestApp({ project: auditProject(build()) })
    const frozenHead = JSON.stringify(projectOf(last.app).blocks[0])
    expect(last.app.dispatch('block-delete-close-gap', { blockId: 'blk_3' })).toBeNull()
    const remaining = projectOf(last.app).blocks
    expect(remaining[1]!.end, 'prev.end extends to removed.end').toBe(6.0)
    expect(JSON.stringify(remaining[0]), 'earlier blocks untouched').toBe(frozenHead)
  })

  test('zero-gap neighbours (gaps of 0 on both sides) still meet at the exact midpoint', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({
      project: auditProject([
        block('blk_p', 0, 1.0, 'SPK_1', [word('a', 0, 1.0)]),
        block('blk_g', 1.0, 1.5, 'SPK_2', [word('b', 1.0, 1.5)]),
        block('blk_n', 1.5, 2.0, 'SPK_1', [word('c', 1.5, 2.0)]),
      ]),
    })
    expect(t.app.dispatch('block-delete-close-gap', { blockId: 'blk_g' })).toBeNull()
    const [prev, next] = projectOf(t.app).blocks
    expect(prev!.end).toBe(1.25)
    expect(next!.start).toBe(1.25)
  })
})

describe('AUDIT boundary: retime two-point solve surface (RetimeDialog EXTENDS payload)', () => {
  test('degenerate two-point (equal source times) is refused with a CODE and never dispatched (the RETIME_DEGENERATE branch itself is unreachable — pre-guarded as POINTS_INCOMPLETE)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    dom = installDomStubs()
    render(<RetimeDialog app={t.app} onClose={() => undefined} />)
    fireEvent.click(screen.getByTestId('retime-mode-two-point'))
    fireEvent.change(screen.getByTestId('retime-point-a-from'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('retime-point-a-to'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('retime-point-b-from'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('retime-point-b-to'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('retime-apply'))
    // OBSERVATION: RetimeDialog pre-guards `fromA === fromB` → solution null →
    // the `RETIME_DEGENERATE` (engine TypeError) branch in apply() is dead code;
    // the observable refusal is RETIME_POINTS_INCOMPLETE. Both are codes
    // (SECURITY-03 OK); spec pins "preview before apply", not which code.
    expect(screen.getByTestId('retime-code').textContent).toBe('RETIME_POINTS_INCOMPLETE')
    expect(t.app.history.undoCount(), 'degenerate apply dispatches nothing').toBe(0)
  })
})

// ── CATEGORY 2 · EMPTY / ABSENT / DEGENERATE ────────────────────────────────

describe('AUDIT empty/degenerate: captions-align-apply (CONTRACT @104 row; align.ts frozen guards)', () => {
  test('asrWords [] on evenly-spread words is fully identity → NO history step (step-free equality claim)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const even = [block('blk_e', 0, 3, 'SPK_1', [word('one', 0, 1.0, { timing: 'estimated' }), word('two', 1.0, 2.0, { timing: 'estimated' }), word('three', 2.0, 3.0, { timing: 'estimated' })])]
    const t = createTestApp({ project: auditProject(even) })
    const before = serializeProject(projectOf(t.app))
    expect(t.app.dispatch('captions-align-apply', { asrWords: [] })).toBeNull()
    expect(serializeProject(projectOf(t.app))).toBe(before)
    expect(t.app.history.undoCount()).toBe(0)
  })

  test('asrWords [] on NON-uniform estimated words re-interpolates evenly (frozen engine rule — not identity): text/ids/bounds/timing unchanged, ONE undoable step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    const beforeBytes = serializeProject(projectOf(t.app))
    const before = projectOf(t.app).blocks[0]!
    expect(t.app.dispatch('captions-align-apply', { asrWords: [] })).toBeNull()
    const after = projectOf(t.app).blocks[0]!
    expect(after.text, 'text NEVER changes').toBe(before.text)
    expect(after.id).toBe(before.id)
    expect(after.start).toBe(before.start)
    expect(after.end).toBe(before.end)
    expect(after.words.every((w) => w.timing === 'estimated')).toBe(true)
    expect(after.words[1]!.start, 'unmatched re-interpolated evenly (align.ts frozen rule)').not.toBe(before.words[1]!.start)
    expect(t.app.history.undoCount()).toBe(1)
    t.app.history.undo()
    expect(serializeProject(projectOf(t.app)), 'ONE undo step restores').toBe(beforeBytes)
  })

  test('asrWords garbage-but-well-formed: times beyond block bounds NEVER become aligned times (invariant 1/model bounds); words stay estimated', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    expect(t.app.dispatch('captions-align-apply', { asrWords: [{ text: 'café', start: 200, end: 201 }, { text: 'au', start: -50, end: 300 }, { text: 'lait', start: 2.0, end: 2.4 }] })).toBeNull()
    const blk = projectOf(t.app).blocks[0]!
    expect(blk.words[0]!.timing, 'out-of-bounds match treated UNMATCHED').toBe('estimated')
    expect(blk.words[1]!.timing).toBe('estimated')
    expect(blk.words[2]!.timing, 'in-bounds match aligned').toBe('aligned')
    for (const w of blk.words) {
      expect(w.start, 'no word ever leaves block bounds (invariant 1)').toBeGreaterThanOrEqual(blk.start)
      expect(w.end).toBeLessThanOrEqual(blk.end)
      expect(w.end).toBeGreaterThanOrEqual(w.start)
    }
  })

  test('asr word with end < start is treated unmatched (never a fabricated inverted time); invariant-1 sortedness survives', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    expect(t.app.dispatch('captions-align-apply', { asrWords: [{ text: 'café', start: 1.5, end: 1.2 }, { text: 'au', start: 1.6, end: 1.9 }, { text: 'lait', start: 2.0, end: 2.4 }] })).toBeNull()
    const blk = projectOf(t.app).blocks[0]!
    expect(blk.words[0]!.timing).toBe('estimated')
    for (let i = 0; i < blk.words.length; i++) {
      const w = blk.words[i]!
      expect(w.end).toBeGreaterThanOrEqual(w.start)
      if (i > 0) expect(w.start, 'invariant 1: word[i].end <= word[i+1].start').toBeGreaterThanOrEqual(blk.words[i - 1]!.end)
    }
  })

  test('non-finite asr times rejected structurally (INVALID_PAYLOAD) with zero mutation', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    const before = serializeProject(projectOf(t.app))
    expect(t.app.dispatch('captions-align-apply', { asrWords: [{ text: 'x', start: Number.NaN, end: 1 }] })?.code).toBe('INVALID_PAYLOAD')
    expect(t.app.dispatch('captions-align-apply', { asrWords: [{ text: 'x', start: 0, end: Number.POSITIVE_INFINITY }] })?.code).toBe('INVALID_PAYLOAD')
    expect(serializeProject(projectOf(t.app))).toBe(before)
    expect(t.app.history.undoCount()).toBe(0)
  })

  test('CC-104.7 AUDIT: align apply after a post-job edit never clobbers the edit — unmatched edited word stays edited AND estimated; edit + apply = TWO independent undo steps', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    expect(t.app.dispatch('block-edit-text', { blockId: 'blk_a2', text: 'too more lines now' })).toBeNull()
    expect(t.app.history.undoCount()).toBe(1)
    expect(t.app.dispatch('captions-align-apply', { asrWords: [{ text: 'two', start: 3.6, end: 4.1 }, { text: 'more', start: 4.15, end: 4.5 }, { text: 'lines', start: 4.55, end: 4.8 }, { text: 'now', start: 4.85, end: 5.15 }] })).toBeNull()
    const blk = projectOf(t.app).blocks[1]!
    expect(blk.text, 'text NEVER changes — post-job edit intact').toBe('too more lines now')
    expect(blk.words[0]!.timing, 'edited word unmatched → stays estimated').toBe('estimated')
    expect(blk.words[1]!.timing).toBe('aligned')
    expect(t.app.history.undoCount()).toBe(2)
    t.app.history.undo()
    expect(projectOf(t.app).blocks[1]!.text).toBe('too more lines now')
    // OBSERVATION (frozen unit-102 surface, outside @104 scope): respanWords
    // carries speakerId/probability/breakAfter but NOT `timing`, so a text edit
    // drops the 'estimated' provenance mark (word displays as 'asr'); undo of the
    // apply therefore returns timing undefined, not 'estimated'.
    expect(projectOf(t.app).blocks[1]!.words[1]!.timing, 'undo restores the post-edit state (frozen respanWords drops the timing mark)').toBeUndefined()
  })
})

describe('AUDIT empty/degenerate: search index over degenerate corpora (match-index pure)', () => {
  test('zero blocks / zero matches / query longer than every token → empty index, no throw', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    expect(findMatches([], 'anything')).toEqual([])
    expect(findMatches([{ id: 'b', words: [] }], 'x')).toEqual([])
    expect(findMatches([{ id: 'b', words: [{ text: 'ab' }] }], 'abcdefghij')).toEqual([])
    expect(findMatches([{ id: 'b', words: [{ text: 'ab' }] }], '')).toEqual([])
  })
})

describe('AUDIT degenerate: captions-import payload (invariants 1–3 validators)', () => {
  test('duplicate ids and zero-word blocks are rejected with a CODE and zero mutation', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    const before = serializeProject(projectOf(t.app))
    const dup = block('blk_dup', 20, 21, 'SPK_1', [word('one', 20, 20.5)])
    expect(t.app.dispatch('captions-import', { blocks: [dup, { ...dup }], replace: false })?.code).toBe('INVALID_PAYLOAD')
    const emptyWords = { ...block('blk_ew', 20, 21, 'SPK_1', [word('x', 20, 20.5)]), words: [], text: '' }
    expect(t.app.dispatch('captions-import', { blocks: [emptyWords], replace: false })?.code).toBe('INVALID_PAYLOAD')
    expect(serializeProject(projectOf(t.app))).toBe(before)
    expect(t.app.history.undoCount()).toBe(0)
  })
})

describe('AUDIT degenerate: speaker-merge self/dangling + id stability (CC-104.5; invariants 4/5)', () => {
  test('from === into → SPEAKER_MERGE_SELF; unknown id → DANGLING_SPEAKER_REF; both zero mutation AND zero step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = prodApp(auditProject(transcriptBlocks()))
    const before = serializeProject(projectOf(t.app))
    expect(t.app.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_1' })?.code).toBe('SPEAKER_MERGE_SELF')
    expect(t.app.dispatch('speaker-merge', { from: 'SPK_NOPE', into: 'SPK_1' })?.code).toBe('DANGLING_SPEAKER_REF')
    expect(t.app.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_NOPE' })?.code).toBe('DANGLING_SPEAKER_REF')
    expect(serializeProject(projectOf(t.app))).toBe(before)
    expect(t.app.history.undoCount()).toBe(0)
  })

  test('merge into last remaining speaker → split it → undo → re-merge: byte-stable ids (invariant 4 durable ids)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = prodApp(auditProject(transcriptBlocks()))
    expect(t.app.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_2' })).toBeNull()
    const mergedBytes = serializeProject(projectOf(t.app))
    expect(projectOf(t.app).speakers.map((s) => s.id)).toEqual(['SPK_2'])
    // Split the last remaining speaker: every word >= 0 moves to a new APPENDED
    // speaker; the next-free SPK_<n> re-uses the freed number (engine rule).
    expect(t.app.dispatch('speaker-split', { speakerId: 'SPK_2', at: 0 })).toBeNull()
    expect(projectOf(t.app).speakers.length).toBe(2)
    t.app.history.undo()
    expect(serializeProject(projectOf(t.app)), 'undo of split is byte-exact').toBe(mergedBytes)
    t.app.history.undo()
    expect(t.app.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_2' })).toBeNull()
    expect(serializeProject(projectOf(t.app)), 're-merge byte-identical (id stability)').toBe(mergedBytes)
  })

  test('US-2.1.7/invariant 5: any speaker mutation flips speakerSource auto-beta → manual; replace-text never flips it', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = prodApp(auditProject(transcriptBlocks()))
    expect(projectOf(t.app).speakerSource).toBe('auto-beta')
    expect(t.app.dispatch('replace-text', { query: 'alpha', replacement: 'omega' })).toBeNull()
    expect(projectOf(t.app).speakerSource, 'replace-text touches no speaker data (CONTRACT row)').toBe('auto-beta')
    expect(t.app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: 'Ann' })).toBeNull()
    expect(projectOf(t.app).speakerSource).toBe('manual')
  })
})

// ── CATEGORY 3 · STATEFUL INTERLEAVINGS / ORDER (L2) ────────────────────────

function mountTranscript(t: ReturnType<typeof createTestApp>, jobs?: ReturnType<typeof createJobsStore>, hiddenSpeakerIds?: readonly string[]) {
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} jobs={jobs} heightPx={480} hiddenSpeakerIds={hiddenSpeakerIds} />)
  })
}

describe('AUDIT interleavings: CC-104.4/US-2.1.6 search + replace against live state (L2)', () => {
  test('undo WHILE the search panel stays open: indices re-derive from the restored blocks — no ghost highlights, current match re-clamps', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(searchBlocks()) })
    mountTranscript(t)
    act(() => {
      dispatchCommand('transcript.search-open')
    })
    fireEvent.change(screen.getByTestId('transcript-search-input'), { target: { value: 'alp' } })
    await settleDebounce()
    expect(screen.getAllByTestId('transcript-search-match')).toHaveLength(4)
    fireEvent.click(screen.getByTestId('transcript-replace-all'))
    expect(screen.queryAllByTestId('transcript-search-match')).toHaveLength(0)
    expect(t.app.history.undoCount()).toBe(1)
    act(() => {
      t.app.history.undo()
    })
    expect(screen.getAllByTestId('transcript-search-match'), 'highlights re-derive after undo (FR-104.5 block-version bump)').toHaveLength(4)
    expect(screen.getAllByTestId('transcript-search-match').filter((el) => el.getAttribute('data-current-match') === 'true')).toHaveLength(1)
    expect(t.app.history.undoCount()).toBe(0)
  })

  test('two F3 cycles racing the 120 ms debounce re-index: stale index is inert (no crash, no wrong-scroll), then cycles correctly', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(searchBlocks()) })
    mountTranscript(t)
    act(() => {
      dispatchCommand('transcript.search-open')
    })
    fireEvent.change(screen.getByTestId('transcript-search-input'), { target: { value: 'beta' } })
    // BEFORE the debounce commits, F3 hits the (empty) index — must be inert.
    act(() => {
      dispatchCommand('search.next')
      dispatchCommand('search.next')
    })
    expect(screen.getByTestId('transcript-search-count').textContent).toBe('0')
    await settleDebounce()
    expect(screen.getByTestId('transcript-search-count').textContent).toBe('4')
    expect(screen.getAllByTestId('transcript-search-match').filter((el) => el.getAttribute('data-current-match') === 'true')).toHaveLength(1)
    act(() => {
      dispatchCommand('search.next')
    })
    const current = screen.getAllByTestId('transcript-search-match').filter((el) => el.getAttribute('data-current-match') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]!.getAttribute('data-match-index')).toBe('1')
  })

  test('FR-104.6 replace-all WHILE streaming: commits land in the committed region only; skeleton rows beyond the frontier are unaffected and cost no history step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    const engine = createProbingEngine()
    const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
    mountTranscript(t, jobs)
    act(() => {
      jobs.startTranscribe({ language: 'en', modelId: 'whisper-base_timestamped@608c49e6', diarize: false, mode: 'replace' })
    })
    const jobId = jobs.getState().running!.jobId
    act(() => {
      engine.emitAsr({
        t: 'job:segments',
        jobId,
        segments: [
          { start: 10.0, end: 11.0, text: 'stream one', words: [word('stream', 10, 10.5), word('one', 10.5, 11)] },
          { start: 12.0, end: 13.0, text: 'stream two', words: [word('stream', 12, 12.5), word('two', 12.5, 13)] },
        ],
      })
    })
    const skeletonBefore = screen.getAllByTestId('transcript-skeleton-row').length
    expect(skeletonBefore).toBeGreaterThanOrEqual(2)
    act(() => {
      dispatchCommand('transcript.search-open')
    })
    fireEvent.change(screen.getByTestId('transcript-search-input'), { target: { value: 'alpha' } })
    fireEvent.change(screen.getByTestId('transcript-search-replace-input'), { target: { value: 'OMEGA' } })
    await settleDebounce()
    fireEvent.click(screen.getByTestId('transcript-replace-all'))
    expect(projectOf(t.app).blocks[0]!.words[0]!.text, 'committed block edited').toBe('OMEGA')
    expect(t.app.history.undoCount(), 'exactly ONE step from the replace').toBe(1)
    expect(screen.getAllByTestId('transcript-skeleton-row')).toHaveLength(skeletonBefore)
    expect(projectOf(t.app).blocks, 'segments never entered the committed track').toHaveLength(3)
  })

  test('CC-104.7 AUDIT (panel wiring): align job completing AFTER a user edit applies through the panel without clobbering the edit — ONE undo step for the apply', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    const engine = createProbingEngine()
    const jobs = createJobsStore({ engine, modelCache: createFakeModelCache() })
    mountTranscript(t, jobs)
    fireEvent.click(screen.getByTestId('transcript-align-audio'))
    const running = jobs.getState().running
    expect(running?.kind, 'align job started through the frozen jobs pipeline').toBe('align')
    const twoWord = screen.getAllByTestId('transcript-word').find((el) => el.textContent === 'two')!
    fireEvent.doubleClick(twoWord)
    const editor = screen.getByTestId('transcript-editor')
    editor.textContent = 'too more lines now'
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(t.app.history.undoCount(), 'edit is its own step').toBe(1)
    act(() => {
      engine.emitAsr({
        t: 'job:segments',
        jobId: running!.jobId,
        segments: [{ start: 3.5, end: 5.2, text: 'two more lines now', words: [word('two', 3.6, 4.1), word('more', 4.15, 4.5), word('lines', 4.55, 4.8), word('now', 4.85, 5.15)] }],
      })
      engine.emitAsr({ t: 'job:done', jobId: running!.jobId })
    })
    const blk = projectOf(t.app).blocks[1]!
    expect(blk.text, 'panel apply NEVER clobbers the post-job edit').toBe('too more lines now')
    expect(blk.words[0]!.timing).toBe('estimated')
    expect(blk.words[1]!.timing).toBe('aligned')
    expect(t.app.history.undoCount(), 'edit + apply = two steps (apply alone is ONE)').toBe(2)
    act(() => {
      t.app.history.undo()
    })
    expect(projectOf(t.app).blocks[1]!.text, 'undoing the apply keeps the edit').toBe('too more lines now')
    expect(projectOf(t.app).blocks[1]!.words[1]!.timing, 'undo restores the post-edit state (frozen respanWords drops the timing mark)').toBeUndefined()
  })
})

describe('AUDIT interleavings: FR-104.4 IME composition ordering (L2)', () => {
  test('compositionstart → Enter is swallowed (nothing dispatches mid-composition); blur after compositionEnd auto-commits EXACTLY once', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    mountTranscript(t)
    const target = screen.getAllByTestId('transcript-word').find((el) => el.textContent === 'beta')!
    fireEvent.doubleClick(target)
    const editor = screen.getByTestId('transcript-editor')
    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(t.app.history.undoCount(), 'no dispatch while the IME reports isComposing (FR-104.4)').toBe(0)
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(t.app.history.undoCount(), 'Enter still swallowed until compositionEnd').toBe(0)
    fireEvent.compositionEnd(editor)
    fireEvent.blur(editor)
    expect(t.app.history.undoCount(), 'blur auto-commit fires EXACTLY once (US-2.1.3)').toBe(1)
  })

  test('compositionend delivered AFTER the editor unmounted is inert — no half-committed command, no throw', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    mountTranscript(t)
    const target = screen.getAllByTestId('transcript-word').find((el) => el.textContent === 'beta')!
    fireEvent.doubleClick(target)
    const editor = screen.getByTestId('transcript-editor')
    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Escape' })
    // FR-104.4: mid-composition keystrokes belong to the IME — Escape (like
    // Enter) is swallowed while composing, so the editor is still mounted.
    expect(screen.getByTestId('transcript-editor'), 'Esc belongs to the IME mid-composition').toBeTruthy()
    expect(t.app.history.undoCount(), 'no dispatch on Esc mid-composition').toBe(0)
    fireEvent.compositionEnd(editor)
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.queryByTestId('transcript-editor'), 'Esc reverts and unmounts after compositionEnd (US-2.1.3)').toBeNull()
    // A late/duplicate compositionend on the detached element must be inert.
    expect(() => fireEvent.compositionEnd(editor)).not.toThrow()
    expect(t.app.history.undoCount(), 'Esc reverted with NO dispatch (US-2.1.3)').toBe(0)
  })
})

describe('AUDIT interleavings: speaker filter, QC cursor, dialog cancels (L2)', () => {
  test('CC-104.5 filter hiding ALL speakers: zero rows rendered, project reference byte-identical, undo not polluted', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    const before = serializeProject(projectOf(t.app))
    mountTranscript(t, undefined, ['SPK_1', 'SPK_2'])
    expect(screen.queryAllByTestId('transcript-row')).toHaveLength(0)
    expect(serializeProject(projectOf(t.app)), 'view-only: data intact').toBe(before)
    expect(t.app.history.undoCount(), 'filtering never creates a history step').toBe(0)
  })

  test("⌘' navigation with the issue list emptied mid-flight: cursor is a safe no-op, no crash, no stray dispatch", async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const long = 'w'.repeat(60)
    const t = createTestApp({
      project: auditProject([
        block('blk_long', 0, 1.0, 'SPK_1', [word(long, 0, 1.0)]),
        block('blk_ok', 2.0, 3.0, 'SPK_2', [word('ok', 2.0, 3.0)]),
      ]),
    })
    mountTranscript(t)
    expect(screen.getAllByTestId('transcript-issue').length, 'LINE_TOO_LONG issue derived').toBeGreaterThan(0)
    act(() => {
      dispatchCommand('qc.next-issue')
    })
    expect(t.app.editor.getState().selection.anchorBlockId).toBe('blk_long')
    const selectionAfterJump = t.app.editor.getState().selection
    act(() => {
      t.app.dispatch('block-edit-text', { blockId: 'blk_long', text: 'short' })
    })
    expect(screen.queryAllByTestId('transcript-issue')).toHaveLength(0)
    expect(() => {
      act(() => {
        dispatchCommand('qc.next-issue')
        dispatchCommand('qc.previous-issue')
      })
    }).not.toThrow()
    expect(t.app.editor.getState().selection, 'emptied list: cursor is a safe no-op').toEqual(selectionAfterJump)
  })

  test('dialog cancel paths NEVER dispatch (RetimeDialog + CaptionImportDialog): zero history steps', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(alignBlocks()) })
    render(<RetimeDialog app={t.app} onClose={() => undefined} />)
    fireEvent.change(screen.getByTestId('retime-offset'), { target: { value: '0.5' } })
    fireEvent.click(screen.getByTestId('retime-cancel'))
    expect(t.app.history.undoCount()).toBe(0)
    expect(projectOf(t.app).blocks[0]!.start).toBe(alignBlocks()[0]!.start)
    cleanup()

    const report: ImportReport = { format: 'srt', encoding: 'utf-8', cues: 1, blocks: 1, detectedLanguage: 'en', adjustments: [] }
    const port: CaptionImportPort = {
      async analyze() {
        return { report, blocks: [block('blk-1', 0, 1, 'SPK_1', [word('imported', 0, 1.0)])], speakers: [] }
      },
    }
    const t2 = createTestApp({ project: auditProject(transcriptBlocks()) })
    const file = new File([new TextEncoder().encode('1\n00:00:00,000 --> 00:00:01,000\nimported\n')], 'x.srt', { type: 'text/plain' })
    await act(async () => {
      render(<CaptionImportDialog file={file} port={port} app={t2.app} onClose={() => undefined} />)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.click(screen.getByTestId('caption-import-cancel'))
    expect(t2.app.history.undoCount(), 'Cancel dispatches nothing (FR-104.9)').toBe(0)
    expect(projectOf(t2.app).blocks).toHaveLength(3)
  })
})

// ── SECURITY-03 sweep (REVIEW always-check #1) ───────────────────────────────

describe('AUDIT SECURITY-03: canary through replace-text / search / align / QC / retime and the bridge', () => {
  test('no transcript content reaches console/error surfaces; bridge read() and the match index carry numbers/ids only', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    const t = createTestApp({ project: auditProject(transcriptBlocks()) })
    mountTranscript(t)
    act(() => {
      dispatchCommand('transcript.search-open')
    })
    fireEvent.change(screen.getByTestId('transcript-search-input'), { target: { value: CANARY_MARKER.slice(0, 12) } })
    fireEvent.change(screen.getByTestId('transcript-search-replace-input'), { target: { value: 'x' } })
    await settleDebounce()
    fireEvent.click(screen.getByTestId('transcript-replace-all'))
    expect(t.app.dispatch('captions-align-apply', { asrWords: [{ text: CANARY_MARKER, start: 3.0, end: 4.0 }] })).toBeNull()
    act(() => {
      t.app.dispatch('captions-retime-all', { offsetSec: 0.125 })
    })
    const handle = getTranscriptPanel()
    expect(handle, 'panel registered its bridge handle').not.toBeNull()
    const bridgeJson = JSON.stringify(handle!.read())
    expect(bridgeJson.includes(CANARY_MARKER), 'bridge never carries transcript content').toBe(false)
    const indexJson = JSON.stringify(findMatches(projectOf(t.app).blocks, 'zipscribe', {}))
    expect(indexJson.includes(CANARY_MARKER), 'match index never carries word text').toBe(false)
    const reject = t.app.dispatch('replace-text', { query: CANARY_MARKER, replacement: 'x\ny' })
    expect(reject?.code, 'rejections carry codes, never content').toBe('INVALID_PAYLOAD')
    expect(JSON.stringify(reject).includes(CANARY_MARKER)).toBe(false)
    const verdict = redaction.settle()
    expect(verdict.leaks, 'SECURITY-03: zero content in console surfaces').toEqual([])
    expect(verdict.clean).toBe(true)
  })
})
