// CC-111.4 (L2, jsdom): undo/redo EXACTNESS across both unit-111 paths — the
// pointer affordances (row-merge-next / row-split-at-playhead) and the command
// seam the frozen keyboard rows (timeline.merge → block-merge, S →
// block-split) ride — restore the EXACT block set (byte-stable deep
// equality: ids, spans, word timing, text) after one undo, and the exact
// merged/split state after redo. ONE undo step per gesture (FR-111.4: no
// parallel state paths — everything is the frozen undoable unit-102 commands;
// the e2e legs in e2e/transcript/merge-journey.spec.ts pin the same
// doctrine on the DOM timecode sequence in the built bundle).
//
// Why this suite exists at L2: the frozen e2e spec's describe title chains its
// ids with an EN DASH ('CC-111.1–CC-111.4: …'), which the credit policy
// (scripts/lib/junit-trust.ts citationsOf — leading ids only) collapses to
// CC-111.1, leaving CC-111.4 with no leading-cited passing case at any level.
// The frozen spec is untouchable (additive-only ruling), so the criteria get
// their honest lowest-level proof HERE, with real assertions on real store
// state — never a planted formality.
// Canary doctrine: transcriptBlocks() rows carry CANARY_MARKER; the redaction
// spy proves SECURITY-03 (assertions are deep structural equality — no
// content strings appear in messages).
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { transcriptBlocksProject } from '../transcript/helpers/transcript-fixture'
import { installDomStubs } from '../transcript/helpers/dom-stubs'
import type { CaptionBlock } from '@engine/model@104'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

let dom: ReturnType<typeof installDomStubs> | null = null

async function mount(t: TestApp): Promise<void> {
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
}

function blocks(t: TestApp): CaptionBlock[] {
  return (t.app.project.getState().project as { blocks: CaptionBlock[] }).blocks
}

/** Byte-stable snapshot of the block set (deep structural copy — SECURITY-03:
 *  compared as a whole, never quoted into an assertion message). */
function snapshot(t: TestApp): CaptionBlock[] {
  return structuredClone(blocks(t))
}

function rowOf(blockId: string): HTMLElement {
  const row = Array.from(document.querySelectorAll<HTMLElement>('[data-testid=transcript-row]')).find((el) => el.getAttribute('data-block-id') === blockId)
  if (row === undefined) throw new Error(`row ${blockId} not mounted`)
  return row
}

function affordance(t: TestApp, blockId: string, testId: string): HTMLElement {
  const button = rowOf(blockId).querySelector<HTMLElement>(`[data-testid=${testId}]`)
  if (button === null) throw new Error(`[data-testid=${testId}] not found inside row ${blockId}`)
  return button
}

function setPlayhead(t: TestApp, seconds: number): void {
  act(() => {
    t.app.editor.setPlayhead(seconds)
    t.rafs.frame(16)
  })
}

afterEach(() => {
  cleanup()
  dom?.restore()
  dom = null
})

describe('CC-111.4 (L2): undo/redo exactness across the pointer paths and the command seam', () => {
  test('CC-111.4: pointer merge — one undo restores the EXACT pair, redo returns to the EXACT merged block', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      const before = snapshot(t)
      const historyBefore = t.app.history.undoCount()
      act(() => {
        fireEvent.click(affordance(t, 'blk_t1', 'row-merge-next'))
      })
      expect(t.app.history.undoCount(), 'pointer merge = exactly ONE undo step').toBe(historyBefore + 1)
      const merged = snapshot(t)
      expect(merged, 'merge landed (prerequisite for the round trip)').toHaveLength(2)
      act(() => {
        t.app.history.undo()
      })
      expect(snapshot(t), 'undo is BYTE-STABLE on the full block set').toEqual(before)
      act(() => {
        t.app.history.redo()
      })
      expect(snapshot(t), 'redo is BYTE-STABLE back to the merged state').toEqual(merged)
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })

  test('CC-111.4: pointer split — one undo restores the EXACT block, redo returns the EXACT halves', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      setPlayhead(t, 1.5)
      const before = snapshot(t)
      const historyBefore = t.app.history.undoCount()
      act(() => {
        fireEvent.click(affordance(t, 'blk_t1', 'row-split-at-playhead'))
      })
      expect(t.app.history.undoCount(), 'pointer split = exactly ONE undo step').toBe(historyBefore + 1)
      const after = snapshot(t)
      expect(after, 'split landed (prerequisite)').toHaveLength(4)
      expect([after[0]?.start, after[0]?.end], 'first half ends exactly at the playhead').toEqual([0.5, 1.5])
      expect([after[1]?.start, after[1]?.end], 'second half starts exactly at the playhead').toEqual([1.5, 2.5])
      act(() => {
        t.app.history.undo()
      })
      expect(snapshot(t), 'undo is BYTE-STABLE on the full block set').toEqual(before)
      act(() => {
        t.app.history.redo()
      })
      expect(snapshot(t), 'redo is BYTE-STABLE back to the split state').toEqual(after)
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })

  test('CC-111.4: command seam (the keyboard rows dispatch block-merge/block-split) — undo/redo round trips are byte-exact', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      // Merge leg — the same `block-merge` payload shape the frozen
      // timeline.merge / timeline.merge-ctrl handlers dispatch.
      const beforeMerge = snapshot(t)
      expect(t.app.dispatch('block-merge', { blockIds: ['blk_t2', 'blk_t3'] }), 'merge accepted').toBeNull()
      const merged = snapshot(t)
      expect(merged, 'two blocks after the seam merge').toHaveLength(2)
      act(() => {
        t.app.history.undo()
      })
      expect(snapshot(t), 'merge undo BYTE-STABLE').toEqual(beforeMerge)
      act(() => {
        t.app.history.redo()
      })
      expect(snapshot(t), 'merge redo BYTE-STABLE').toEqual(merged)
      act(() => {
        t.app.history.undo()
      })
      // Split leg — the same `block-split` payload the `S` path dispatches.
      expect(t.app.dispatch('block-split', { blockId: 'blk_t1', at: 1.5 }), 'split accepted').toBeNull()
      const split = snapshot(t)
      expect(split, 'two parts where one block was').toHaveLength(4)
      act(() => {
        t.app.history.undo()
      })
      expect(snapshot(t), 'split undo BYTE-STABLE').toEqual(beforeMerge)
      act(() => {
        t.app.history.redo()
      })
      expect(snapshot(t), 'split redo BYTE-STABLE').toEqual(split)
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })
})
