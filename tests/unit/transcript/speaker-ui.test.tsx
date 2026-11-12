// CC-104.5 (L2) + row a11y contract: speaker UI — the "Beta" badge renders
// exactly while `speakerSource === 'auto-beta'` (invariant 5) and disappears
// on the first manual edit (rename via the merged command → transitions
// correct); the chip button opens the frozen popover (rename "Apply to all" /
// recolor / merge / split / filter); and the speaker filter is VIEW-ONLY —
// `hiddenSpeakerIds` removes rows without touching the project (byte-equal)
// or creating a history step (CC-104.5 "filter one speaker (view-only)").
// Row ARIA (frozen): role=list/listitem, tabindex 0 rows, aria-label
// "<speaker>, <timecode>, <text>". Canary-bearing — spy attached.
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import type { TestApp } from '../editor/helpers/editor-app'
import { serializeProject } from '@state/services/serialize'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { transcriptBlocksProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import type { Project } from '@engine/model@104'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

async function mount(t: TestApp, props: { hiddenSpeakerIds?: readonly string[] } = {}): Promise<void> {
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} hiddenSpeakerIds={props.hiddenSpeakerIds} />)
  })
}

function rowIds(): string[] {
  return (screen.getAllByTestId('transcript-row') as HTMLElement[]).map((el) => el.getAttribute('data-block-id') ?? '')
}

function project(t: TestApp): Project {
  return t.app.project.getState().project as Project
}

let currentDom: ReturnType<typeof installDomStubs> | null = null

afterEach(() => {
  cleanup()
  currentDom?.restore()
  currentDom = null
})

describe('CC-104.5 (L2): speaker UI — rows ARIA · Beta badge lifecycle · popover · view-only filter', () => {
  test('CC-104.5: rows expose the frozen ARIA contract (list/listitem, tabindex, speaker+timecode+text label)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      const root = screen.getByTestId('transcript-root')
      expect(root.getAttribute('role')).toBe('list')
      const rows = screen.getAllByTestId('transcript-row')
      expect(rows.length, 'all three blocks render').toBe(3)
      for (const row of rows) {
        expect(row.getAttribute('role'), 'row semantics').toBe('listitem')
        expect(row.getAttribute('tabindex'), 'rows are keyboard reachable').toBe('0')
      }
      const first = rows[0]!
      expect(first.getAttribute('data-block-id')).toBe('blk_t1')
      expect(first.getAttribute('aria-label'), 'frozen label: speaker, timecode, text').toBe('Speaker 1, 00:00.5, alpha beta gamma')
      const chip = first.querySelector('[data-testid=transcript-row-chip]')
      expect(chip?.tagName, 'speaker chip is a button').toBe('BUTTON')
      const timecode = first.querySelector('[data-testid=transcript-row-timecode]')
      expect(timecode?.getAttribute('tabindex'), 'timecode is focusable').toBe('0')
      expect(redaction.settle().clean).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-104.5: Beta badge renders on auto-beta and disappears on the first manual edit', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      const badge = screen.getByTestId('transcript-beta-badge')
      expect(badge.getAttribute('title'), 'badge tooltip explains manual review').not.toBeNull()
      expect(badge.getAttribute('title')!.length, 'badge carries explanatory tooltip').toBeGreaterThan(0)
      // First manual edit (merged command) transitions speakerSource → badge gone.
      act(() => {
        t.app.dispatch('speaker-rename', { speakerId: 'SPK_1', label: 'Ann' })
      })
      expect(screen.queryByTestId('transcript-beta-badge'), 'badge gone once attribution is manual').toBeNull()
      expect(redaction.settle().clean).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-104.5: the chip opens the speaker popover with rename ("Apply to all") / recolor / merge / split / filter', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      await mount(t)
      const chip = (screen.getAllByTestId('transcript-row-chip') as HTMLElement[])[0]!
      const user = userEvent.setup({ delay: null })
      await user.click(chip)
      const popover = screen.getByTestId('transcript-speaker-popover')
      expect(popover.querySelector('[data-testid=transcript-speaker-rename-input]'), 'rename input').not.toBeNull()
      const apply = popover.querySelector('[data-testid=transcript-speaker-rename-apply]') as HTMLElement | null
      expect(apply, 'rename apply (primary)').not.toBeNull()
      expect(apply!.textContent, 'primary apply says it applies to all occurrences').toContain('Apply to all')
      for (const id of ['transcript-speaker-recolor', 'transcript-speaker-merge', 'transcript-speaker-split', 'transcript-speaker-filter']) {
        expect(popover.querySelector(`[data-testid=${id}]`), `popover exposes ${id}`).not.toBeNull()
      }
      expect(redaction.settle().clean).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-104.5: the speaker filter is VIEW-ONLY — rows hidden, project byte-equal, NO history step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    currentDom = installDomStubs()
    try {
      const t = createTestApp({ project: transcriptBlocksProject() })
      const before = serializeProject(project(t))
      const undoBefore = t.app.history.undoCount()
      await mount(t, { hiddenSpeakerIds: ['SPK_2'] })
      expect(rowIds()).toEqual(['blk_t1', 'blk_t3'])
      expect(screen.queryByText('delta', { selector: '[data-testid=transcript-row-text] *', exact: false }), 'SPK_2 row text absent from the DOM').toBeNull()
      expect(serializeProject(project(t)), 'filtering NEVER mutates the project').toBe(before)
      expect(t.app.history.undoCount(), 'no history step').toBe(undoBefore)
      expect(redaction.settle().clean, ).toBe(true)
      t.app.dispose()
    } finally {
      redaction.restore()
    }
  })
})
