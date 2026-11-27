// CC-110.6 (L2, jsdom): Issues-panel posture per issue #52 — raw ASR output
// must NOT flood the first-run view. The engine `checkCaptions` stays frozen
// (its byte-frozen pin is tests/unit/transcript/qc-engine-frozen-anchor.test.ts);
// only the panel DEFAULTS change here:
//
// Contract introduced by this suite (unit-110, binding on the builder):
//   • [data-testid=transcript-issues-toggle] — the expand/collapse control;
//     aria-expanded reflects state; its accessible name (aria-label, else
//     text) includes the TRUE issue count (digits).
//   • [data-testid=transcript-issues] — the list container; while collapsed
//     it carries the `hidden` attribute. Items ([data-testid=transcript-issue])
//     stay COUNTABLE in the DOM while collapsed — the frozen L2 doctrine
//     (tests/unit/transcript/adversarial/unit104-adversarial.test.tsx:654
//     counts items on a raw, never-edited project) forbids unmounting them.
//   • each item carries data-issue-origin="raw" | "edited" ("edited" = its
//     block was edited since transcription — a UI-side fact tracked on
//     `block-edit-text`, never a checkCaptions change). Raw and edited items
//     are visually distinguished: their class lists differ (no style values
//     are asserted here).
//   • FROZEN constraint honored: at least one actionable (edited) item
//     reveals the list without a user toggle — e2e/transcript/import-qc-flow.
//     spec.ts:102 clicks an issue item right after an edit, never expanding.
//   • The "Issues (n)" row-filter chip ([data-testid=transcript-issue-filter],
//     aria-pressed) is unchanged (frozen at import-qc-flow.spec.ts:98).
//
// RED today: the list renders unconditionally (Transcript.tsx :838) with no
// toggle, no hidden posture and no origin attribute — each assertion below is
// red for that honest reason.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { checkCaptions } from '@engine/captions/qc'
import { transcriptProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import { block, word } from '../editor/helpers/fixture-project'
import type { CaptionBlock, Project } from '@engine/model@104'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

/** Raw ASR never edited: two blocks whose text trips CPS_HIGH + LINE_TOO_LONG
 *  (60/55 chars in 1 s; rules cpsMax 20, lineCharsMax 42 — src/engine/captions/
 *  qc.ts DEFAULT_RULES) plus one clean block. Synthetic words only (SECURITY-03). */
function rawAsrBlocks(): CaptionBlock[] {
  return [
    block('blk_r1', 0.5, 1.5, 'SPK_1', [word('q'.repeat(60), 0.5, 1.5)]),
    block('blk_r2', 2, 3, 'SPK_2', [word('z'.repeat(55), 2, 3)]),
    block('blk_ok', 3.6, 4.6, 'SPK_1', [word('fine', 3.6, 4.6)]),
  ]
}

let dom: ReturnType<typeof installDomStubs> | null = null

async function mountTranscript(t: TestApp): Promise<void> {
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
}

function issuesContainer(): HTMLElement {
  return screen.getByTestId('transcript-issues') as HTMLElement
}

function issuesToggle(): HTMLElement {
  return screen.getByTestId('transcript-issues-toggle') as HTMLElement
}

function toggleName(): string {
  const toggle = issuesToggle()
  return toggle.getAttribute('aria-label') ?? toggle.textContent ?? ''
}

function items(): HTMLElement[] {
  return screen.getAllByTestId('transcript-issue') as HTMLElement[]
}

afterEach(() => {
  cleanup()
  dom?.restore()
  dom = null
})

describe('CC-110.6 (L2): Issues panel — collapsed by default with a count badge · de-emphasis of raw-ASR items', () => {
  test('CC-110.6: a fresh (unedited) ASR project shows a collapsed list with the count in the toggle name', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptProject(rawAsrBlocks()) })
      await mountTranscript(t)
      const project = t.app.project.getState().project as Project
      const engineCount = checkCaptions(project).length
      expect(engineCount, 'fixture genuinely trips the frozen QC rules (non-vacuity)').toBeGreaterThanOrEqual(3)

      const toggle = issuesToggle()
      expect(toggle.getAttribute('aria-expanded'), 'collapsed by default — the first-run flood is gone (#52)').toBe('false')
      expect(toggleName(), 'the count badge carries the TRUE issue count').toContain(String(engineCount))
      expect(issuesContainer(), 'collapsed list is hidden').toHaveAttribute('hidden')
      // Frozen L2 doctrine: items stay in the DOM while collapsed (they are
      // hidden, not unmounted) — adversarial/unit104-adversarial.test.tsx:654.
      expect(items().length, 'items remain countable in the DOM while collapsed').toBeGreaterThan(0)
      // The row-filter chip keeps its frozen shape (import-qc-flow.spec.ts:98).
      expect(screen.getByTestId('transcript-issue-filter').textContent, 'frozen Issues (n) chip intact').toContain('Issues')
      t.app.dispose()
    } finally {
      dom?.restore()
      dom = null
    }
  })

  test('CC-110.6: the toggle expands and collapses the list (user-toggleable)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptProject(rawAsrBlocks()) })
      await mountTranscript(t)
      fireEvent.click(issuesToggle())
      expect(issuesToggle().getAttribute('aria-expanded'), 'user toggle expands').toBe('true')
      expect(issuesContainer(), 'expanded list is not hidden').not.toHaveAttribute('hidden')
      expect(items().length, 'expanded list shows the items').toBeGreaterThan(0)
      fireEvent.click(issuesToggle())
      expect(issuesToggle().getAttribute('aria-expanded'), 'user toggle collapses back').toBe('false')
      expect(issuesContainer(), 'collapsed again').toHaveAttribute('hidden')
      t.app.dispose()
    } finally {
      dom?.restore()
      dom = null
    }
  })

  test('CC-110.6: items on blocks edited since transcription are distinguished from raw-ASR items', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    dom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptProject(rawAsrBlocks()) })
      await mountTranscript(t)
      // Edit blk_r1 through the frozen command seam; the QC issue SURVIVES
      // (still 61 chars in 1 s ⇒ CPS_HIGH + LINE_TOO_LONG on an EDITED block).
      act(() => {
        t.app.dispatch('block-edit-text', { blockId: 'blk_r1', text: `${'q'.repeat(60)}!` })
      })
      // Frozen L5 contract (import-qc-flow.spec.ts:102): the actionable item
      // is reachable without the user expanding — the list is revealed.
      expect(issuesToggle().getAttribute('aria-expanded'), 'an edited (actionable) issue reveals the list').toBe('true')
      expect(issuesContainer(), 'revealed list is visible').not.toHaveAttribute('hidden')

      const byBlock = new Map(items().map((el) => [el.getAttribute('data-block-id'), el]))
      const editedItem = byBlock.get('blk_r1')
      const rawItem = byBlock.get('blk_r2')
      expect(editedItem, 'the edited block still carries issues').toBeTruthy()
      expect(rawItem, 'the untouched block still carries raw issues').toBeTruthy()
      expect(editedItem!.getAttribute('data-issue-origin'), 'post-edit item is marked edited').toBe('edited')
      expect(rawItem!.getAttribute('data-issue-origin'), 'unedited item is marked raw').toBe('raw')
      const rawClasses = new Set((rawItem!.className ?? '').split(/\s+/u).filter((c) => c !== ''))
      const editedClasses = new Set((editedItem!.className ?? '').split(/\s+/u).filter((c) => c !== ''))
      const onlyRaw = [...rawClasses].filter((c) => !editedClasses.has(c))
      const onlyEdited = [...editedClasses].filter((c) => !rawClasses.has(c))
      expect(onlyRaw.length + onlyEdited.length, 'raw and edited items are visually distinguished (class-level, styling values never asserted)').toBeGreaterThan(0)
      t.app.dispose()
    } finally {
      dom?.restore()
      dom = null
    }
  })
})
