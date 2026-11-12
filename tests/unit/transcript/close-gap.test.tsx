// CC-104.8 (L1 + L2): close-gap deletion — deleting a block collapses the
// gap to the MIDPOINT of the neighbours (frozen criterion: `previous.end =
// next.start = round3((prevEnd + nextStart) / 2)` = 2.652 for
// prev.end 2.101 / next.start 3.202), ONE undo step, everything after the
// deletion byte-identical; and the row carries the frozen
// `[data-testid=transcript-close-gap]` button affordance (the Shift+Delete
// BINDING is unit-105, FR-104.7). Canary-bearing suite (blk_tail) — spy
// attached.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { serializeProject } from '@state/services/serialize'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { GAP_MIDPOINT, GAP_NEXT_SURVIVOR_START, GAP_PREV_END, gapProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import type { Project } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

function project(app: EditorApp): Project {
  return app.project.getState().project as Project
}

afterEach(cleanup)

describe('CC-104.8: close-gap deletes to the midpoint (L1)', () => {
  test('CC-104.8: block-delete-close-gap collapses neighbours to round3((prevEnd+nextStart)/2), ONE step, untouched blocks byte-identical', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    try {
      const t = createTestApp({ project: gapProject() })
      const before = serializeProject(project(t.app))
      const undoBefore = t.app.history.undoCount()
      expect(t.app.dispatch('block-delete-close-gap', { blockId: 'blk_g' })).toBeNull()
      const next = project(t.app)
      expect(next.blocks.map((b) => b.id)).toEqual(['blk_p', 'blk_n', 'blk_tail'])
      const prev = next.blocks.find((b) => b.id === 'blk_p')!
      const nx = next.blocks.find((b) => b.id === 'blk_n')!
      expect(prev.end, `previous.end collapses to the MIDPOINT ${GAP_MIDPOINT} (frozen CC-104.8) — committed impl collapses to next.start`).toBe(GAP_MIDPOINT)
      expect(nx.start, `next.start collapses to the MIDPOINT ${GAP_MIDPOINT} (frozen CC-104.8)`).toBe(GAP_MIDPOINT)
      expect(GAP_MIDPOINT, 'midpoint oracle sanity').toBe(Math.round(((GAP_PREV_END + GAP_NEXT_SURVIVOR_START) / 2) * 1000) / 1000)
      const tail = next.blocks.find((b) => b.id === 'blk_tail')!
      expect(tail.start, 'later blocks byte-identical').toBe(7)
      expect(tail.end, 'later blocks byte-identical').toBe(8)
      expect(t.app.history.undoCount()).toBe(undoBefore + 1)
      t.app.history.undo()
      expect(serializeProject(project(t.app)), 'undo restores byte-equal state').toBe(before)
      t.app.dispose()
      expect(redaction.settle().clean, ).toBe(true)
    } finally {
      redaction.restore()
    }
  })
})

describe('CC-104.8 (L2): the row-level close-gap affordance', () => {
  test('CC-104.8: clicking transcript-close-gap on a row deletes the block through the command (one step)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const t = createTestApp({ project: gapProject() })
      const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
      act(() => {
        render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
      })
      const gapRow = (screen.getAllByTestId('transcript-row') as HTMLElement[]).find((el) => el.getAttribute('data-block-id') === 'blk_g')
      expect(gapRow, 'the gap row is rendered').toBeDefined()
      const button = gapRow!.querySelector('[data-testid=transcript-close-gap]')
      expect(button, 'row exposes the close-gap affordance').not.toBeNull()
      const before = serializeProject(project(t.app))
      const undoBefore = t.app.history.undoCount()
      act(() => {
        fireEvent.click(button!)
      })
      expect(project(t.app).blocks.map((b) => b.id)).toEqual(['blk_p', 'blk_n', 'blk_tail'])
      expect(project(t.app).blocks.find((b) => b.id === 'blk_p')?.end).toBe(GAP_MIDPOINT)
      expect(t.app.history.undoCount(), 'exactly ONE undo step').toBe(undoBefore + 1)
      t.app.history.undo()
      expect(serializeProject(project(t.app))).toBe(before)
      expect(redaction.settle().clean, ).toBe(true)
      t.app.dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })
})
