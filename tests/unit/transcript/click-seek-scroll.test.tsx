// CC-104.2 (L2, jsdom + layout stubs): click-word-to-seek and viewport
// discipline — a click on any word seeks to `word.start` within ≤ 1 rAF
// frame (synchronous command dispatch: asserted BEFORE any frame is driven)
// and the block enters editor selection; the active-block follow-scroll
// moves the viewport when playback/seek targets an off-screen row
// (scrollToIndex align:'nearest'); and the viewport NEVER moves on its own
// once the user has scrolled (scroll-intent pause) or while a row is being
// edited. The two pause tests have a positive control (follow does scroll on
// a fresh mount), so an always-never-scroll stub cannot pass.
// Canary-bearing small corpus — spy attached; bulk suites are synthetic.
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { bulkBlocks, transcriptBlocksProject, transcriptProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

async function mount(t: TestApp): Promise<HTMLElement> {
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
  return screen.getByTestId('transcript-root') as HTMLElement
}

function rowIds(): string[] {
  return (screen.getAllByTestId('transcript-row') as HTMLElement[]).map((el) => el.getAttribute('data-block-id') ?? '')
}

let currentDom: ReturnType<typeof installDomStubs> | null = null

afterEach(() => {
  cleanup()
  currentDom?.restore()
  currentDom = null
})

describe('CC-104.2 (L2): click-word seek · follow-scroll · scroll-intent & edit pause', () => {
  test('CC-104.2: clicking a word seeks to word.start within ≤ 1 frame and selects the block', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      const beta = (screen.getAllByTestId('transcript-word') as HTMLElement[]).find((el) => el.textContent === 'beta')
      expect(beta, 'the target word renders').toBeDefined()
      const user = userEvent.setup({ delay: null })
      // No rAF frame has been driven yet — "within ≤ 1 rAF frame" holds for
      // any frame budget when the seek is already visible here.
      await user.click(beta!)
      expect(t.app.editor.getState().playhead, 'seek within ≤ 1 rAF frame (synchronous command path)').toBe(1.3)
      const selection = t.app.editor.getState().selection
      expect([selection.anchorBlockId, selection.focusBlockId], 'block enters selection').toContain('blk_t1')
      expect(redaction.settle().clean, ).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-104.2 (positive control): seek to an off-screen row drives the follow-scroll', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    currentDom = installDomStubs()
    const t = createTestApp({ project: transcriptProject(bulkBlocks(200)) })
    try {
      const root = await mount(t)
      expect(currentDom.scrollTop(root), 'starts at the top').toBe(0)
      act(() => {
        t.app.dispatch('transport-seek', { time: 150.5 })
      })
      const scrolled = currentDom.scrollTop(root) > 0 || currentDom.scrollProbe.calls > 0
      expect(scrolled, 'the viewport moved toward the targeted row (follow-scroll)').toBe(true)
      expect(rowIds(), 'the targeted row is mounted after the follow').toContain('blk_p150')
      t.app.dispose()
    } finally {
      currentDom?.restore()
    }
  })

  test('CC-104.2: after a USER scroll, a later seek never moves the viewport (scroll-intent pause)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    currentDom = installDomStubs()
    const t = createTestApp({ project: transcriptProject(bulkBlocks(200)) })
    try {
      const root = await mount(t)
      currentDom.userScroll(root, 4800)
      currentDom.scrollProbe.reset()
      act(() => {
        t.app.dispatch('transport-seek', { time: 20.5 })
      })
      expect(currentDom.scrollTop(root), 'viewport stays where the user put it').toBe(4800)
      expect(currentDom.scrollProbe.calls, 'no programmatic scroll after user intent').toBe(0)
      t.app.dispose()
    } finally {
      currentDom?.restore()
    }
  })

  test('CC-104.2: while a row is being edited, a later seek never moves the viewport', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    const t = createTestApp({ project: transcriptProject(bulkBlocks(200)) })
    try {
      const root = await mount(t)
      const user = userEvent.setup({ delay: null })
      const firstWord = (screen.getAllByTestId('transcript-word') as HTMLElement[])[0]
      expect(firstWord, 'rows and words render under the stubs').toBeDefined()
      await user.dblClick(firstWord!)
      expect(screen.getByTestId('transcript-editor'), 'editor open').toBeInTheDocument()
      currentDom.scrollProbe.reset()
      const before = currentDom.scrollTop(root)
      act(() => {
        t.app.dispatch('transport-seek', { time: 150.5 })
      })
      expect(currentDom.scrollProbe.calls, 'auto-scroll never moves the viewport during edit').toBe(0)
      expect(currentDom.scrollTop(root)).toBe(before)
      expect(redaction.settle().clean).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
      currentDom?.restore()
    }
  })
})
