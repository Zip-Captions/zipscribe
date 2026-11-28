// CC-111.2 CC-111.3 (L2, jsdom): the pointer affordances for merge and split —
// the FR-111.2 gap (issue #55: "no pointer path exists for split or merge",
// row buttons are only Speaker options / delete / delete-close-gap).
//
// FR-111.2 CONTRACT POINTS — pinned here, binding on the builder (same style
// as unit-110's `data-row-state` pinning in row-layout-states.test.tsx):
//   • every block row ([data-testid=transcript-row]) exposes, INSIDE the row
//     (row-button family: siblings of [data-testid=transcript-row-delete]),
//     [data-testid=row-merge-next] — a button running the SAME `block-merge`
//     command the keyboard path runs (registry rows timeline.merge /
//     timeline.merge-ctrl, frozen by the [RULING] — this suite never re-binds
//     them) — and [data-testid=row-split-at-playhead], running the same
//     `block-split` command the `S` path runs.
//   • merge on the LAST block: DISABLED, not hidden — aria-disabled="true"
//     (or the disabled attribute) plus a non-empty tooltip (title attribute or
//     an aria-describedby target) whose text names the reason, matching
//     /next|last/iu.
//   • split gating mirrors the `S` gate EXACTLY (controller.ts splitAtPlayhead
//     / block-split reducer: playhead STRICTLY inside (start, end) — the
//     boundaries reject, proven here against the reducer itself).
//   • OPTIONAL context-menu path (spec § Risks: only THIS menu, Esc-close
//     minimal): if a right-click on a row opens a menu, it must carry real
//     role=menu semantics (role=menuitem entries for merge/split) and Esc must
//     close it. No menu opening today simply means the builder chose the
//     button family — this leg then passes as a documented conditional guard
//     (the pinned button contract above is the required half).
//
// RED today, honestly: neither affordance exists in src/ui/transcript/
// Transcript.tsx (row actions are only chip/close-gap/delete), so every
// affordance lookup below throws "not found" → red. The reducer-gate parity
// leg and the conditional menu leg are green-by-construction guards.
// Canary doctrine: transcriptBlocks() rows carry CANARY_MARKER; the redaction
// spy proves SECURITY-03 (no transcript strings in assertions either —
// merge/split results are asserted on ids, counts, times and word counts).
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { transcriptBlocksProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
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

function rowOf(blockId: string): HTMLElement {
  const row = screen.getAllByTestId('transcript-row').find((el) => el.getAttribute('data-block-id') === blockId)
  if (row === undefined) throw new Error(`row ${blockId} not mounted`)
  return row as HTMLElement
}

/** Pinned contract: the affordance lives INSIDE the row element. */
function affordance(blockId: string, testId: string): HTMLElement {
  const row = rowOf(blockId)
  const button = row.querySelector<HTMLElement>(`[data-testid=${testId}]`)
  if (button === null) throw new Error(`[data-testid=${testId}] not found inside row ${blockId} (FR-111.2 pinned contract)`)
  return button
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled')
}

function tooltipOf(element: HTMLElement): string {
  const title = element.getAttribute('title')
  if (title !== null && title.trim() !== '') return title
  const describedBy = element.getAttribute('aria-describedby')
  if (describedBy !== null) {
    const text = describedBy
      .split(/\s+/u)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim()
    if (text !== '') return text
  }
  return ''
}

function blocks(t: TestApp): CaptionBlock[] {
  return (t.app.project.getState().project as { blocks: CaptionBlock[] }).blocks
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

describe('CC-111.2 (L2): merge pointer affordance — pinned row-merge-next contract', () => {
  test('CC-111.2: every row exposes row-merge-next; the LAST row is disabled (not hidden) with a reason tooltip, the others enabled', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      const mergeButtons = screen.getAllByTestId('row-merge-next') as HTMLElement[]
      expect(mergeButtons, 'one merge affordance per row').toHaveLength(3)
      // The row-button family renders them INSIDE their rows (pinned contract).
      for (const [index, blockId] of ['blk_t1', 'blk_t2', 'blk_t3'].entries()) {
        const inside = rowOf(blockId).querySelector('[data-testid=row-merge-next]')
        expect(inside, `row ${blockId} carries its own row-merge-next`).not.toBeNull()
        const button = mergeButtons[index] as HTMLElement
        expect(isDisabled(button), `row ${blockId} merge is ${index === 2 ? 'DISABLED on the last row' : 'enabled on a non-last row'}`).toBe(index === 2)
      }
      const last = affordance('blk_t3', 'row-merge-next')
      expect(isDisabled(last), 'last row: DISABLED, never hidden (FR-111.2)').toBe(true)
      const tooltip = tooltipOf(last)
      expect(tooltip, 'disabled merge carries a tooltip').not.toBe('')
      expect(tooltip, 'the tooltip names the reason (no next block)').toMatch(/next|last/iu)
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })

  test('CC-111.2: clicking row-merge-next runs the SAME block-merge command as the frozen keyboard rows — union timing, left id kept, ONE undo step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      const before = t.app.history.undoCount()
      const button = affordance('blk_t1', 'row-merge-next')
      expect(isDisabled(button), 'blk_t1 has a next block → enabled').toBe(false)
      act(() => {
        fireEvent.click(button)
      })
      const after = blocks(t)
      expect(after, '3 blocks → 2').toHaveLength(2)
      expect(after[0]?.id, 'merged block keeps the LEFT id (block-merge invariant 10)').toBe('blk_t1')
      expect([after[0]?.start, after[0]?.end], 'timing = union of the pair').toEqual([0.5, 5.0])
      expect(after[0]?.words, 'words concatenated (block-merge semantics, asserted as COUNT — SECURITY-03)').toHaveLength(5)
      expect(after[1]?.id, 'the following block is untouched').toBe('blk_t3')
      expect(t.app.history.undoCount(), 'pointer merge = exactly ONE undo step (FR-111.4 rides the same undoable command)').toBe(before + 1)
      act(() => {
        t.app.history.undo()
      })
      expect(blocks(t), 'undo restores the exact pair').toHaveLength(3)
      expect([blocks(t)[1]?.start, blocks(t)[1]?.end]).toEqual([3.0, 5.0])
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })
})

describe('CC-111.3 (L2): split pointer affordance — pinned row-split-at-playhead contract, gating parity with S', () => {
  test('CC-111.3: row-split-at-playhead is enabled iff the playhead is STRICTLY inside the block — the exact `S` gate (boundaries reject, parity proven against the reducer)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      // Playhead 0 — outside every block (first starts at 0.5).
      setPlayhead(t, 0)
      expect(isDisabled(affordance('blk_t1', 'row-split-at-playhead')), 'playhead outside → disabled').toBe(true)
      // Boundaries: the `S` path (controller splitAtPlayhead + block-split
      // reducer) REJECTS at === start and at === end — proven directly on the
      // reducer, then asserted as affordance parity.
      setPlayhead(t, 0.5)
      expect(t.app.dispatch('block-split', { blockId: 'blk_t1', at: 0.5 }), 'reducer gate: at === start rejects (the S gate is strict)').not.toBeNull()
      expect(isDisabled(affordance('blk_t1', 'row-split-at-playhead')), 'affordance parity: disabled at the start boundary').toBe(true)
      setPlayhead(t, 2.5)
      expect(t.app.dispatch('block-split', { blockId: 'blk_t1', at: 2.5 }), 'reducer gate: at === end rejects').not.toBeNull()
      expect(isDisabled(affordance('blk_t1', 'row-split-at-playhead')), 'affordance parity: disabled at the end boundary').toBe(true)
      // Strictly inside → enabled (the reducer accepts at 1.5, both parts non-empty).
      setPlayhead(t, 1.5)
      expect(isDisabled(affordance('blk_t1', 'row-split-at-playhead')), 'playhead inside → enabled').toBe(false)
      expect(isDisabled(affordance('blk_t3', 'row-split-at-playhead')), 'the other rows stay gated out').toBe(true)
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })

  test('CC-111.3: clicking row-split-at-playhead splits at the playhead with EXACT times — two rows where one was', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      setPlayhead(t, 1.5)
      const before = t.app.history.undoCount()
      act(() => {
        fireEvent.click(affordance('blk_t1', 'row-split-at-playhead'))
      })
      const after = blocks(t)
      expect(after, 'one block → two, neighbours untouched').toHaveLength(4)
      expect(after[0]?.id, 'first part keeps the id').toBe('blk_t1')
      expect([after[0]?.start, after[0]?.end], 'first part ends exactly at the playhead').toEqual([0.5, 1.5])
      expect([after[1]?.start, after[1]?.end], 'second part starts exactly at the playhead').toEqual([1.5, 2.5])
      expect(after[1]?.id, 'second part is a NEW id').not.toBe('blk_t1')
      expect(t.app.history.undoCount(), 'pointer split = exactly ONE undo step').toBe(before + 1)
      act(() => {
        t.app.history.undo()
      })
      expect(blocks(t), 'undo restores the single block').toHaveLength(3)
      expect([blocks(t)[0]?.start, blocks(t)[0]?.end]).toEqual([0.5, 2.5])
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })
})

describe('CC-111.2 (L2): optional context-menu path — real menu semantics IF the builder goes context-menu (conditional guard)', () => {
  test('CC-111.2: a row right-click menu (if any) is a real role=menu with merge/split menuitems, Esc-closeable; the button family satisfies the contract without it', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      act(() => {
        fireEvent.contextMenu(rowOf('blk_t1'))
      })
      const menus = Array.from(document.querySelectorAll('[role=menu]'))
      if (menus.length === 0) {
        // Builder chose the pinned button family (FR-111.2 allows either). This
        // leg is the documented conditional guard; the required half is the
        // row-merge-next/row-split-at-playhead contract asserted above.
        expect(screen.getAllByTestId('row-merge-next').length, 'no context menu ⇒ the pinned button affordances must exist').toBeGreaterThan(0)
      } else {
        const menu = menus[0] as HTMLElement
        const items = Array.from(menu.querySelectorAll('[role=menuitem]'))
        expect(items.length, 'a context menu exposes real menuitem semantics').toBeGreaterThan(0)
        const names = items.map((item) => (item.textContent ?? '').trim()).join(' | ')
        expect(names, 'the menu offers merge').toMatch(/merge/iu)
        expect(names, 'the menu offers split').toMatch(/split/iu)
        act(() => {
          fireEvent.keyDown(menu, { key: 'Escape' })
          fireEvent.keyDown(window, { key: 'Escape' })
        })
        expect(document.querySelectorAll('[role=menu]').length, 'Esc closes the menu THIS unit owns (spec § Risks: minimal, scoped here)').toBe(0)
      }
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })
})
