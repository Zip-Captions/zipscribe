// CC-110.2 CC-110.3 CC-110.7 (L2, jsdom): the owner-designed row model
// (issue #48) and the speaker-chip suppression (issue #52) at component
// level. jsdom has NO layout engine, so this suite proves the STRUCTURAL
// contract the builder must expose; the GEOMETRY (rows below shift exactly by
// the growth, zero overlap) is proven by e2e/transcript/row-layout.spec.ts
// (L5, DOM rects).
//
// Contract introduced by this suite (unit-110, binding on the builder):
//   • every block row ([data-testid=transcript-row]) exposes
//     data-row-state="clamped" | "expanded".
//       clamped  — single-line clamp + ellipsis (inactive row).
//       expanded — clamp removed, height auto (active: playhead within the
//                  block's time span; OR selected; OR under edit), and the
//                  virtualizer re-measures (measureElement ref already exists).
//   • the speaker chip ([data-testid=transcript-row-chip]) renders only while
//     the PROJECT has ≥ 2 speakers (reactive to speaker add/remove).
//   • the frozen paths stay untouched: word-dblclick → editor (CC-104.3,
//     tests/unit/transcript/editing.test.tsx) and the fixed timecode slot
//     (FR-104.1) — asserted here only as presence, never re-pinned.
//
// RED today: no clamp/expand model exists (transcript.css .ts-row fixed 20 px,
// no data-row-state) and the chip renders unconditionally — every data-row-
// state and chip-suppression assertion below is red for that honest reason.
// Canary doctrine: fixture rows carry CANARY_MARKER (transcriptBlocks); the
// redaction spy proves SECURITY-03.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { transcriptProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import { block, speaker, word } from '../editor/helpers/fixture-project'
import type { CaptionBlock } from '@engine/model@104'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

/** Long block: 24 words ≈ several wrapped lines at the 320 px stub width —
 *  the #48 overflow class of content (synthetic words only, SECURITY-03). */
function layoutBlocks(): CaptionBlock[] {
  const longWords = Array.from({ length: 24 }, (_unused, index) => word(`long${index}`, 5 + index * 0.12, 5.1 + index * 0.12))
  return [
    block('blk_a', 0.2, 1.2, 'SPK_1', [word('alpha', 0.2, 0.7), word('beta', 0.8, 1.2)]),
    block('blk_long', 5, 8, 'SPK_1', longWords),
    block('blk_b', 9, 10, 'SPK_2', [word('gamma', 9, 9.5), word('delta', 9.6, 10)]),
  ]
}

function layoutProject() {
  return transcriptProject(layoutBlocks())
}

let dom: ReturnType<typeof installDomStubs> | null = null

async function mountTranscript(t: TestApp): Promise<void> {
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

function rowState(blockId: string): string | null {
  return rowOf(blockId).getAttribute('data-row-state')
}

afterEach(() => {
  cleanup()
  dom?.restore()
  dom = null
})

describe('CC-110.2 CC-110.3 CC-110.7 (L2): row clamp/expand model · expand-before-edit · single-speaker chip', () => {
  test('CC-110.2: inactive rows clamp; active (playhead in span), selected and editing rows expand; collapse on exit', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spy = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: layoutProject() })
      await mountTranscript(t)
      // Playhead 0: no block spans it (first starts at 0.2) → everything clamped.
      expect(rowState('blk_a'), 'inactive row is clamped').toBe('clamped')
      expect(rowState('blk_long'), 'long inactive row is clamped').toBe('clamped')

      // Playhead inside blk_long's span → ONLY that row expands.
      act(() => {
        t.app.editor.setPlayhead(6.5)
      })
      expect(rowState('blk_long'), 'active row (playhead within its span) expands').toBe('expanded')
      expect(rowState('blk_a'), 'neighbours stay clamped').toBe('clamped')

      // Playhead leaves the span → collapse on exit.
      act(() => {
        t.app.editor.setPlayhead(12)
      })
      expect(rowState('blk_long'), 'row collapses when the playhead leaves').toBe('clamped')

      // Selection expands without any playhead movement.
      act(() => {
        t.app.editor.setSelection({ anchorBlockId: 'blk_long', focusBlockId: 'blk_long' })
      })
      expect(rowState('blk_long'), 'selected row expands').toBe('expanded')
      act(() => {
        t.app.editor.setSelection({ anchorBlockId: null, focusBlockId: null })
      })
      expect(rowState('blk_long'), 'deselected row collapses again').toBe('clamped')
      t.app.dispose()
    } finally {
      spy.restore()
    }
  })

  test('CC-110.3: click-to-edit expands FIRST — the editor never renders inside clipped text', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spy = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: layoutProject() })
      await mountTranscript(t)
      const row = rowOf('blk_long')
      const wordEl = row.querySelector('[data-testid=transcript-word]') as HTMLElement
      expect(rowState('blk_long'), 'row starts clamped').toBe('clamped')

      // Frozen path (CC-104.3): word double-click opens the in-place editor —
      // unchanged. The unit-110 obligation: the row is EXPANDED while editing
      // (editor never lives inside a clipped 20 px box).
      fireEvent.dblClick(wordEl)
      expect(screen.getByTestId('transcript-editor'), 'frozen word-dblclick path opens the editor').toBeTruthy()
      expect(rowState('blk_long'), 'the row under edit is expanded before/while the editor renders').toBe('expanded')
      expect(row.querySelector('[data-testid=transcript-row-timecode]'), 'FR-104.1 fixed timecode slot survives editing').toBeTruthy()

      // Commit through the frozen editor (Enter) → row collapses back.
      const editor = screen.getByTestId('transcript-editor') as HTMLElement
      fireEvent.keyDown(editor, { key: 'Enter' })
      expect(screen.queryByTestId('transcript-editor'), 'editor closed (frozen commit path)').toBeNull()
      expect(rowState('blk_long'), 'row collapses when edit ends').toBe('clamped')
      const verdict = spy.settle()
      expect(verdict.leaks, 'no transcript content reaches console channels (SECURITY-03)').toEqual([])
      t.app.dispose()
    } finally {
      spy.restore()
    }
  })

  test('CC-110.7: the speaker chip is hidden while the project has exactly one speaker and appears at two (reactive)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spy = createRedactionSpy()
    dom = installDomStubs()
    try {
      const singleSpeaker = transcriptProject(layoutBlocks(), [speaker('SPK_1', 'Speaker 1', '#4c8dff')])
      const t = createTestApp({ project: singleSpeaker })
      await mountTranscript(t)
      expect(screen.queryAllByTestId('transcript-row-chip'), 'one-speaker project renders NO chips (#52)').toHaveLength(0)
      // Rows themselves stay intact (the text column keeps the row).
      expect(screen.getAllByTestId('transcript-row'), 'rows still render without chips').toHaveLength(3)

      // Reactive: adding a speaker makes chips appear (no remount).
      act(() => {
        t.app.dispatch('speaker-add', { label: 'Speaker 2', color: '#ff6b6b' })
      })
      const chips = screen.getAllByTestId('transcript-row-chip')
      expect(chips.length, 'chips render once the project has ≥ 2 speakers').toBeGreaterThan(0)
      const verdict = spy.settle()
      expect(verdict.leaks, 'no transcript content reaches console channels (SECURITY-03)').toEqual([])
      t.app.dispose()
    } finally {
      spy.restore()
    }
  })
})
