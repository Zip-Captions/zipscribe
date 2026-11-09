// CC-103.5 (L2, jsdom): the keyboard-operable timeline (FR-103.7, design.md
// § Keyboard shortcuts) — the registry EXTENDS binding table is frozen
// (unit-103 adds exactly these ids/chords; unit-105 owns the full snapshot,
// unit-102 MAJOR-5 pattern), `when: 'timeline-focused'` gates the focus model
// on the region having DOM focus, Enter selects, and the focused block is
// announced in `timeline-live` as `${speakerLabel}, ${timecode}, ${text}`.
// Handlers are owned by the mounted Timeline (frozen in unit103-api-contract).
// No canary content is rendered (synthetic timelineBlocks).
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { dispatchCommand, getCommandBindings } from '@ui/commands/registry'
import { createTestApp } from '../editor/helpers/editor-app'
import { sampleProject } from '../editor/helpers/fixture-project'
import { createCanvasRecorder } from './helpers/canvas-recorder'
import { timelineBlocks } from './helpers/timeline-fixture'

// Variable specifiers keep vite:import-analysis (react-plugin transform) from
// resolving the not-yet-built modules at TRANSFORM time; vitest's module runner
// resolves the alias at runtime — RED now, GREEN when the builder ships them.
const SPEC_VIEWPORT = '@ui/timeline/viewport'
const SPEC_CONTROLLER = '@ui/timeline/controller'
const SPEC_TIMELINE = '@ui/timeline/Timeline'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

// The frozen unit-103 EXTENDS rows (unit103-api-contract.d.ts header).
type BindingRow = { id: string; keys: string; when?: string }

async function mount(): Promise<{ app: ReturnType<typeof createTestApp>['app']; rafs: ReturnType<typeof createTestApp>['rafs'] }> {
  const t = createTestApp({ project: sampleProject({ blocks: timelineBlocks() }) })
  const { Timeline } = (await import(/* @vite-ignore */ SPEC_TIMELINE)) as typeof import('@ui/timeline/Timeline')
  act(() => {
    render(<Timeline app={t.app} rafs={t.rafs} dpr={1} initialSize={{ widthPx: 800, heightPx: 100 }} initialViewport={{ t0: 0, pxPerSec: 100 }} createTarget={() => createCanvasRecorder()} />)
  })
  return { app: t.app, rafs: t.rafs }
}

function blockCount(app: ReturnType<typeof createTestApp>['app']): number {
  return app.project.getState().project?.blocks.length ?? 0
}

afterEach(() => {
  cleanup()
  document.body.focus?.()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('CC-103.5: the registry EXTENDS binding table (frozen ids/chords)', () => {
  test('CC-103.5: every frozen timeline.* binding is registered with its exact chord and gate', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const rows = getCommandBindings() as readonly BindingRow[]
    const expected: Array<[string, string, string | undefined]> = [
      ['timeline.split', 'S', 'not-editing'],
      ['timeline.merge', 'Meta+Shift+M', 'not-editing'],
      ['timeline.merge-ctrl', 'Ctrl+Shift+M', 'not-editing'],
      ['timeline.zoom-in', 'Meta+=', 'not-editing'],
      ['timeline.zoom-out', 'Meta+-', 'not-editing'],
      ['timeline.zoom-fit', 'Meta+0', 'not-editing'],
      ['timeline.focus-next', 'ArrowRight', 'timeline-focused'],
      ['timeline.focus-prev', 'ArrowLeft', 'timeline-focused'],
      ['timeline.select', 'Enter', 'timeline-focused'],
    ]
    for (const [id, keys, when] of expected) {
      const row = rows.find((r) => r.id === id && r.keys === keys)
      expect(row, `binding ${id} ${keys}`).toBeDefined()
      expect(row?.when, `gate for ${id} ${keys}`).toBe(when)
    }
    // Held-letter trims: two bindings per id (design.md Z+←/→, C+←/→).
    for (const id of ['timeline.trim-start', 'timeline.trim-end']) {
      const held = rows.filter((r) => r.id === id && /^[ZC]\+Arrow(Left|Right)$/.test(r.keys))
      expect(held.length, `${id} has its two held-letter bindings`).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('CC-103.5: focus model + live region (FR-103.7)', () => {
  test('CC-103.5: arrows move block focus ONLY while the region has focus; the focused block is announced', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    // Gate: without region focus the focused-block commands are inert.
    act(() => {
      dispatchCommand('timeline.focus-next')
    })
    expect(screen.getByTestId('timeline-live').textContent, 'gated: nothing announced, nothing focused').toBe('')
    act(() => {
      screen.getByTestId('timeline-root').focus()
    })
    act(() => {
      dispatchCommand('timeline.focus-next')
    })
    expect(screen.getByTestId('timeline-live').textContent, 'exact frozen announcement for the first block').toBe('Speaker 1, 00:00.5, alpha beta gamma')
    act(() => {
      dispatchCommand('timeline.focus-next')
    })
    expect(screen.getByTestId('timeline-live').textContent, 'ArrowRight advances focus').toBe('Speaker 2, 00:03.0, delta epsilon zeta')
    act(() => {
      dispatchCommand('timeline.focus-prev')
    })
    expect(screen.getByTestId('timeline-live').textContent, 'ArrowLeft retreats focus').toBe('Speaker 1, 00:00.5, alpha beta gamma')
    // No wraparound past the first block.
    act(() => {
      dispatchCommand('timeline.focus-prev')
    })
    expect(screen.getByTestId('timeline-live').textContent, 'no wraparound before the first block').toBe('Speaker 1, 00:00.5, alpha beta gamma')
    // Enter selects the focused block.
    act(() => {
      dispatchCommand('timeline.select')
    })
    expect(app.editor.getState().selection, 'Enter selects the focused block').toEqual({ anchorBlockId: 'blk_v1', focusBlockId: 'blk_v1' })
  })

  test('CC-103.5: S splits the focused block at the playhead through the registry', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    expect(blockCount(app)).toBe(5)
    expect(app.dispatch('transport-seek', { time: 1.0 })).toBeNull()
    act(() => {
      screen.getByTestId('timeline-root').focus()
    })
    act(() => {
      dispatchCommand('timeline.focus-next')
      dispatchCommand('timeline.split')
    })
    expect(blockCount(app), 'one block became two').toBe(6)
    const blocks = app.project.getState().project?.blocks ?? []
    const parts = blocks.filter((b) => b.start >= 0.49 && b.end <= 2.51)
    expect(parts.length, 'the two parts cover the original span contiguously').toBe(2)
    expect(parts[0]?.end, 'part 1 ends at the playhead').toBe(1.0)
    expect(parts[1]?.start, 'part 2 starts at the playhead').toBe(1.0)
    expect(parts[0]?.words.length, 'the straddling word went WHOLE to the nearer-midpoint part (1 / 2 words)').toBe(1)
    expect(parts[1]?.words.length).toBe(2)
  })
})

describe('CC-103.5: controller focus model directly (FR-103.7)', () => {
  test('CC-103.5: focusNext/Prev walk the blocks without wraparound; selectFocused sets the selection', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: sampleProject({ blocks: timelineBlocks() }) })
    const { createViewportState } = (await import(/* @vite-ignore */ SPEC_VIEWPORT)) as typeof import('@ui/timeline/viewport')
    const { createTimelineController } = (await import(/* @vite-ignore */ SPEC_CONTROLLER)) as typeof import('@ui/timeline/controller')
    const controller = createTimelineController({ app: t.app, rafs: t.rafs, viewport: createViewportState({ t0: 0, pxPerSec: 100 }), widthPx: 800 })
    expect(controller.focusedBlockId(), 'nothing focused initially').toBeNull()
    const ids: Array<string | null> = []
    for (let i = 0; i < 8; i++) {
      controller.focusNext()
      ids.push(controller.focusedBlockId())
    }
    expect(ids.slice(0, 5), 'arrows walk the whole block list in order').toEqual(['blk_v1', 'blk_v2', 'blk_v3', 'blk_v4', 'blk_v5'])
    expect(ids.slice(5), 'no wraparound past the last block').toEqual(['blk_v5', 'blk_v5', 'blk_v5'])
    controller.focusPrev()
    expect(controller.focusedBlockId()).toBe('blk_v4')
    controller.selectFocused()
    expect(t.app.editor.getState().selection, 'Enter selects the focused block').toEqual({ anchorBlockId: 'blk_v4', focusBlockId: 'blk_v4' })
    controller.dispose()
  })
})
