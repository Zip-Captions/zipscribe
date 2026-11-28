// CC-110.5 (L2, jsdom) — STRENGTHENING leg (review-r2 F5): the rAF-DEFERRED
// active-row commit. Boundary crossings schedule the expansion commit on the
// NEXT animation frame (CC-110.5's 50 ms doctrine: never a re-layout inside
// the notify task); a second crossing before the frame SUPERSEDES the
// pending value (last-write-wins via `pendingActiveRef` + the
// cancel-then-reschedule in `commitActiveRow`). Soundness here is ASSERTED,
// not assumed: the intermediate row is observed to stay clamped across the
// whole batch (it never commits), the superseded frame is observed CANCELLED,
// and exactly one expansion lands — on the final active row.
//
// The production rAF branch is the code under test: `MODE` is stubbed off
// `test` (the synchronous-commit convenience for the frozen L2 suites) and
// vitest fake timers drive the frame clock. Contract pinned: the same
// data-driven crossings as the L2 CC-110.2 leg (layoutBlocks shape).
// Canary/redaction doctrine per conventions (fixture rows carry CANARY_MARKER).
// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
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

/** Same three-row shape the L2 CC-110.2 leg uses (spans: 0.2–1.2, 5–8, 9–10). */
function layoutBlocks(): CaptionBlock[] {
  const longWords = Array.from({ length: 24 }, (_unused, index) => word(`long${index}`, 5 + index * 0.12, 5.1 + index * 0.12))
  return [
    block('blk_a', 0.2, 1.2, 'SPK_1', [word('alpha', 0.2, 0.7), word('beta', 0.8, 1.2)]),
    block('blk_long', 5, 8, 'SPK_1', longWords),
    block('blk_b', 9, 10, 'SPK_2', [word('gamma', 9, 9.5), word('delta', 9.6, 10)]),
  ]
}

let dom: ReturnType<typeof installDomStubs> | null = null

async function mountTranscript(t: TestApp): Promise<void> {
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
}

function rowState(blockId: string): string | null {
  const row = Array.from(document.querySelectorAll('[data-testid=transcript-row]')).find((el) => el.getAttribute('data-block-id') === blockId)
  if (row === undefined) throw new Error(`row ${blockId} not mounted`)
  return row.getAttribute('data-row-state')
}

afterEach(() => {
  cleanup()
  dom?.restore()
  dom = null
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('CC-110.5 (L2): rAF-deferred active-row commit — crossings inside one frame batch', () => {
  test('CC-110.5: two crossings in one frame batch — the superseded commit is cancelled and only the FINAL row expands (last-write-wins asserted)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spy = createRedactionSpy()
    dom = installDomStubs()
    // Exercise the PRODUCTION deferred branch (the frozen L2 suites rely on
    // the MODE=test synchronous convenience — untouched by this stub).
    vi.stubEnv('MODE', 'development')
    vi.useFakeTimers()
    try {
      const t = createTestApp({ project: transcriptProject(layoutBlocks(), [speaker('SPK_1', 'Speaker 1', '#4c8dff'), speaker('SPK_2', 'Speaker 2', '#ff6b6b')]) })
      await mountTranscript(t)
      act(() => {
        vi.advanceTimersByTime(16) // settle the mount-time commit (playhead 0 → no active span)
      })
      expect(rowState('blk_a'), 'everything clamped at playhead 0').toBe('clamped')
      expect(rowState('blk_long'), 'everything clamped at playhead 0').toBe('clamped')
      const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
      const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')
      rafSpy.mockClear()
      cancelSpy.mockClear()

      // Fast scrub: two boundary crossings INSIDE one frame (before any rAF
      // runs). The notify task must NEVER re-layout (the 50 ms doctrine).
      act(() => {
        t.app.editor.setPlayhead(0.7) // into blk_a
      })
      expect(rowState('blk_a'), 'crossing is DEFERRED — no expansion inside the notify task').toBe('clamped')
      act(() => {
        t.app.editor.setPlayhead(6.5) // into blk_long, same frame batch
      })
      expect(rowState('blk_long'), 'still deferred — both crossings sit uncommitted in the batch').toBe('clamped')
      expect(rowState('blk_a'), 'the superseded intermediate NEVER committed').toBe('clamped')
      expect(cancelSpy, 'the superseded pending commit was cancelled (last-write-wins)').toHaveBeenCalledTimes(1)
      expect(rafSpy, 'each scheduled commit (re)scheduled exactly one frame').toHaveBeenCalledTimes(2)

      // ONE animation frame → EXACTLY ONE expansion commit — the final value.
      act(() => {
        vi.advanceTimersByTime(16)
      })
      expect(rowState('blk_long'), 'the FINAL crossing of the batch lands in one commit').toBe('expanded')
      expect(rowState('blk_a'), 'the intermediate crossing never expanded — last-write-wins').toBe('clamped')
      expect(rowState('blk_b'), 'unrelated rows stay clamped').toBe('clamped')
      const verdict = spy.settle()
      expect(verdict.leaks, 'no transcript content reaches console channels (SECURITY-03)').toEqual([])
      t.app.dispose()
    } finally {
      spy.restore()
    }
  })
})
