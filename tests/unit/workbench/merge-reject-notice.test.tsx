// Review round 1, F-1 (L2, jsdom): the coded MERGE-REJECTION notices are the
// anti-#55 guarantee — pre-fix, the timeline.merge handler DISCARDED the
// CommandReject (src/ui/timeline/Timeline.tsx mergeFromSurface /
// reportMergeReject) and the transcript pointer affordance silently no-opped
// on the aria-disabled last row; the whole branch shipped with zero assertions
// on either notice (the reviewer's kill-check: reverting the notice wiring left
// every vitest + transcript e2e green). These legs pin the two notice sites:
//
//   • timeline-live (Timeline.tsx:408 `Merge rejected — <CODE> (<token>)`):
//     the LAST row is selected by a real row click, the REAL documented chord
//     ⌘⇧M is dispatched as a window keydown through useCommands → registry
//     (frozen rows timeline.merge 'Meta+Shift+M' — never re-bound here) →
//     mergeFromSurface. The last block has no timeline-order next, which the
//     surface path genuinely rejects (INVALID_PAYLOAD / 'last-block',
//     Timeline.tsx:429) — the frozen `block-merge` reducer rejects adjacency,
//     dangling ids, missing payload and translation-integrity breaks, NOT
//     speaker mismatch (CH.10 majority-vote re-derives the label), so last-row
//     is the honest reachable rejection from this surface.
//   • transcript-qc-live (Transcript.tsx row-merge-next onClick): clicking the
//     aria-disabled last-row affordance produces the SAME coded notice — no
//     silent no-op from the pointer path either.
//
// Both legs are mutation-honest: reverting reportMergeReject's setAnnounce
// reddens the keyboard leg; deleting the affordance's setQcAnnounce reddens the
// pointer leg (scratch kill-checks, unit report).
// SECURITY-03: assertions are the notice PATTERN plus code/token equality;
// canary-bearing transcriptBlocks render, and the redaction spy + explicit
// absence checks prove no transcript content ever reaches the live regions.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { ReactElement } from 'react'
import { useCommands } from '@ui/commands/useCommands'
import { createSettingsStore } from '@state/settings'
import type { SettingsStore } from '@state/settings'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { CANARY_MARKER, transcriptBlocksProject } from '../transcript/helpers/transcript-fixture'
import { installDomStubs } from '../transcript/helpers/dom-stubs'
import type { CaptionBlock } from '@engine/model@104'

const SPEC_TIMELINE = '@ui/timeline/Timeline'
const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'
const SPEC_RECORDER = '../timeline/helpers/canvas-recorder'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

/** The pinned notice shape (review F-1): CODES and tokens only. */
const NOTICE = /^Merge rejected — [A-Z_]+ \(\S+\)$/u

let dom: ReturnType<typeof installDomStubs> | null = null

function Shell({ settings }: { settings: SettingsStore }): ReactElement {
  useCommands(settings)
  return <div data-testid="notice-shell" />
}

function blocks(t: TestApp): CaptionBlock[] {
  return (t.app.project.getState().project as { blocks: CaptionBlock[] }).blocks
}

function rowOf(blockId: string): HTMLElement {
  const row = screen.getAllByTestId('transcript-row').find((el) => el.getAttribute('data-block-id') === blockId)
  if (row === undefined) throw new Error(`row ${blockId} not mounted`)
  return row as HTMLElement
}

function affordance(blockId: string, testId: string): HTMLElement {
  const button = rowOf(blockId).querySelector<HTMLElement>(`[data-testid=${testId}]`)
  if (button === null) throw new Error(`[data-testid=${testId}] not found inside row ${blockId}`)
  return button
}

/** SECURITY-03 leg of the notice contract: pattern-shaped, and neither the
 *  canary nor any block text/word appears in the announced string. */
function assertCodedNotice(notice: string, t: TestApp): void {
  expect(notice, 'pinned notice shape `Merge rejected — <CODE> (<token>)`').toMatch(NOTICE)
  const lowered = notice.toLowerCase()
  expect(lowered, 'SECURITY-03: canary never reaches the live region').not.toContain(CANARY_MARKER.toLowerCase())
  for (const block of blocks(t)) {
    expect(lowered, 'SECURITY-03: no block text in the notice').not.toContain(block.text.toLowerCase())
    for (const word of block.words) expect(lowered, 'SECURITY-03: no word text in the notice').not.toContain(word.text.toLowerCase())
  }
}

async function settingsStore(): Promise<SettingsStore> {
  return createSettingsStore({ storage: { get: async () => null, set: async () => undefined } })
}

async function mountWorkbench(t: TestApp, settings: SettingsStore): Promise<void> {
  const { Timeline } = (await import(/* @vite-ignore */ SPEC_TIMELINE)) as typeof import('@ui/timeline/Timeline')
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  const { createCanvasRecorder } = (await import(/* @vite-ignore */ SPEC_RECORDER)) as typeof import('../timeline/helpers/canvas-recorder')
  act(() => {
    render(
      <>
        <Shell settings={settings} />
        <Timeline app={t.app} rafs={t.rafs} dpr={1} initialSize={{ widthPx: 800, heightPx: 100 }} initialViewport={{ t0: 0, pxPerSec: 100 }} createTarget={() => createCanvasRecorder()} />
        <Transcript app={t.app} rafs={t.rafs} heightPx={480} />
      </>,
    )
  })
}

async function mountTranscript(t: TestApp): Promise<void> {
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
}

afterEach(() => {
  cleanup()
  dom?.restore()
  dom = null
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('CC-111.1 (L2): keyboard merge rejection is never silent again — the coded notice lands in timeline-live (#55 anti-inertness guarantee)', () => {
  test('CC-111.1: last-row ⌘⇧M (real keydown through the registry) rejects and timeline-live shows `Merge rejected — <CODE> (<token>)` — nothing mutates, codes only (SECURITY-03)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const settings = await settingsStore()
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mountWorkbench(t, settings)
      expect(screen.getByTestId('timeline-live').textContent, 'precondition: nothing announced before the chord').toBe('')
      const undoBefore = t.app.history.undoCount()
      // The #55 repro verbatim: a transcript row click selects ONE block
      // (anchor === focus), then the documented chord fires.
      act(() => {
        fireEvent.click(rowOf('blk_t3'))
      })
      expect(t.app.editor.getState().selection, 'precondition: the LAST row is selected').toEqual({ anchorBlockId: 'blk_t3', focusBlockId: 'blk_t3' })
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))
      })
      const notice = screen.getByTestId('timeline-live').textContent ?? ''
      assertCodedNotice(notice, t)
      expect(notice, 'the frozen last-block rejection (Timeline.tsx mergeFromSurface → reportMergeReject)').toBe('Merge rejected — INVALID_PAYLOAD (last-block)')
      expect(blocks(t), 'the rejection really rejected — all three blocks intact').toHaveLength(3)
      expect(t.app.history.undoCount(), 'a rejection dispatches nothing undoable').toBe(undoBefore)
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })
})

describe('CC-111.2 (L2): the aria-disabled last-row merge is not a silent no-op — the pointer path announces the same coded notice', () => {
  test('CC-111.2: clicking the aria-disabled last-row row-merge-next shows the same coded notice in transcript-qc-live and merges nothing', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mountTranscript(t)
      const last = affordance('blk_t3', 'row-merge-next')
      expect(last.getAttribute('aria-disabled'), 'precondition: the LAST row merge is aria-disabled, not hidden').toBe('true')
      const undoBefore = t.app.history.undoCount()
      act(() => {
        fireEvent.click(last)
      })
      const notice = screen.getByTestId('transcript-qc-live').textContent ?? ''
      assertCodedNotice(notice, t)
      expect(notice, 'the pointer path announces the SAME coded rejection as the keyboard path').toBe('Merge rejected — INVALID_PAYLOAD (last-block)')
      expect(blocks(t), 'the rejection really rejected — all three blocks intact').toHaveLength(3)
      expect(t.app.history.undoCount(), 'the pointer no-op dispatches nothing undoable').toBe(undoBefore)
      expect(redaction.settle().clean, 'SECURITY-03: canary never logged').toBe(true)
    } finally {
      redaction.restore()
    }
  })
})
