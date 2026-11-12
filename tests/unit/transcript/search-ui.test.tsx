// CC-104.4 (L2): the search bar — opens via the frozen registry binding
// (`transcript.search-open` ⌘F/⌃F, gated not-editing), debounced 120 ms query
// commit, match-count readout (a NUMBER, SECURITY-03 — never the text),
// highlight spans (text-range spans, NEVER innerHTML), F3 cycling through
// `search.next` (gated `search-open` — closed ⇒ dispatch must be inert, open
// ⇒ advances the current match), and Replace-all dispatching `replace-text`
// EXACTLY once ⇒ ONE undo step (US-2.1.6). Canary-bearing (blk_s3) — spy
// attached.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { dispatchCommand, getCommandBindings, registerCommandHandler } from '@ui/commands/registry'
import { createTestApp } from '../editor/helpers/editor-app'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { searchProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import type { Project } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

async function mount(): Promise<{ app: EditorApp; dispose: () => void }> {
  const t = createTestApp({ project: searchProject() })
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
  return { app: t.app, dispose: () => t.app.dispose() }
}

function project(app: EditorApp): Project {
  return app.project.getState().project as Project
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Real-timer settle past the 120 ms debounce (suites not testing the
 *  debounce boundary themselves). */
async function settleDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150))
  })
}

describe('CC-104.4 (L2): search bar — open · debounce · count · match spans · F3 · replace-all', () => {
  test('CC-104.4: transcript.search-open binding opens the bar (searchOpen flips)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      expect(app.editor.getState().searchOpen, 'closed before the command').toBe(false)
      act(() => {
        dispatchCommand('transcript.search-open')
      })
      expect(app.editor.getState().searchOpen).toBe(true)
      expect(screen.getByTestId('transcript-search')).toBeInTheDocument()
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.4: F3/Shift+F3 are inert while search is closed, live while open (gate)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { dispose } = await mount()
      let nextCalls = 0
      const off = registerCommandHandler('search.next', () => (nextCalls += 1))
      try {
        expect(() => dispatchCommand('search.next'), 'closed-gate dispatch must be inert (not throw)').not.toThrow()
        expect(nextCalls, 'gate closed: handler must NOT fire').toBe(0)
        act(() => {
          dispatchCommand('transcript.search-open')
        })
        expect(() => dispatchCommand('search.next')).not.toThrow()
        expect(nextCalls, 'gate open: dispatch reaches the handler').toBe(1)
      } finally {
        off()
      }
      expect(getCommandBindings().some((r) => r.id === 'search.next'), 'binding registered').toBe(true)
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.4: 120 ms debounce, count 4 for "alp", one current-match highlight span per match', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { dispose } = await mount()
      act(() => {
        dispatchCommand('transcript.search-open')
      })
      const input = screen.getByTestId('transcript-search-input') as HTMLInputElement
      vi.useFakeTimers()
      act(() => {
        fireEvent.change(input, { target: { value: 'alp' } })
      })
      act(() => {
        vi.advanceTimersByTime(60)
      })
      expect(screen.queryAllByTestId('transcript-search-match').length, 'not committed before the 120 ms debounce').toBe(0)
      act(() => {
        vi.advanceTimersByTime(60)
      })
      // Oracle: blk_s1 alpha×2 + blk_s2 alphabet×1 + ALPHA×1 = 4 (case-insensitive substring).
      expect(screen.getAllByTestId('transcript-search-match').length, 'committed at 120 ms').toBe(4)
      expect(screen.getByTestId('transcript-search-count').textContent).toBe('4')
      const current = screen.getAllByTestId('transcript-search-match').filter((el) => el.getAttribute('data-current-match') === 'true')
      expect(current.length, 'exactly one current match').toBe(1)
      for (const el of screen.getAllByTestId('transcript-search-match')) {
        expect(el.querySelector('b,i,span[style]'), 'highlights are text-range spans — never markup injection').toBeNull()
      }
      expect(redaction.settle().clean, ).toBe(true)
      dispose()
    } finally {
      vi.useRealTimers()
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.4: F3 advances and Shift+F3 (previous) retreats the current match', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { dispose } = await mount()
      act(() => {
        dispatchCommand('transcript.search-open')
      })
      const input = screen.getByTestId('transcript-search-input') as HTMLInputElement
      act(() => {
        fireEvent.change(input, { target: { value: 'alp' } })
      })
      await settleDebounce()
      expect(screen.getAllByTestId('transcript-search-match').length).toBe(4)
      const currentIndex = () => Number(screen.getAllByTestId('transcript-search-match').find((el) => el.getAttribute('data-current-match') === 'true')?.getAttribute('data-match-index') ?? -1)
      const start = currentIndex()
      expect(start, 'a current match exists').toBeGreaterThanOrEqual(0)
      act(() => {
        dispatchCommand('search.next')
      })
      expect(currentIndex(), 'F3 advances').toBe((start + 1) % 4)
      act(() => {
        dispatchCommand('search.previous')
      })
      expect(currentIndex(), 'Shift+F3 retreats back').toBe(start)
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.4: replace-all dispatches replace-text ONCE — one undo step, matches gone', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      const undoBefore = app.history.undoCount()
      act(() => {
        dispatchCommand('transcript.search-open')
      })
      act(() => {
        fireEvent.change(screen.getByTestId('transcript-search-input'), { target: { value: 'alp' } })
      })
      await settleDebounce()
      expect(screen.getAllByTestId('transcript-search-match').length).toBe(4)
      act(() => {
        fireEvent.change(screen.getByTestId('transcript-search-replace-input'), { target: { value: 'olp' } })
      })
      const before = JSON.stringify(project(app).blocks.map((b) => b.text))
      act(() => {
        fireEvent.click(screen.getByTestId('transcript-replace-all'))
      })
      await settleDebounce()
      expect(screen.queryAllByTestId('transcript-search-match').length, 'matches cleared after replace').toBe(0)
      expect(app.history.undoCount(), 'Replace-all is EXACTLY ONE undo step').toBe(undoBefore + 1)
      expect(JSON.stringify(project(app).blocks.map((b) => b.text)), 'all four matches replaced').not.toBe(before)
      expect(project(app).blocks.find((b) => b.id === 'blk_s1')?.text).toBe('olpha Beta olpha')
      // Verbatim replacement per the frozen L1 oracle (search-replace.property
      // .test.ts replaceInsensitive: out += text.slice(at, found) + replacement
      // — 'ALP' → 'olp' + untouched 'HA'), not case-preserving (orchestrator
      // adjudication 2026-11-12 round 4; L1 replace-text semantics of record).
      expect(project(app).blocks.find((b) => b.id === 'blk_s2')?.text).toBe('olphabet olpHA BETA')
      app.history.undo()
      expect(JSON.stringify(project(app).blocks.map((b) => b.text)), 'one undo restores everything').toBe(before)
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })
})
