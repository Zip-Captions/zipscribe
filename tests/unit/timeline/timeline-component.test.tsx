// CC-103.1/CC-103.2/CC-103.4 (L2, jsdom): the Timeline panel on the real DOM —
// dpr-scaled backing store through the injected `createTarget` seam, the
// frozen testids, pointer drag → ONE `block-retime` with one undo step
// (US-2.2.1 body move), ruler click → seek (FR-103.6), the inspector
// TimecodeInputs (US-2.2.5: millisecond commit, invalid text → aria-invalid
// and NOTHING commits), and rAF-coalesced repaint scheduling (two store
// changes flush ONE frame). All block text synthetic (SECURITY-03) — no
// canary is rendered by these mounts. jsdom has no canvas 2D: the recorder
// double IS the draw target.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { sampleProject } from '../editor/helpers/fixture-project'
import { createCanvasRecorder, type CanvasRecorder } from './helpers/canvas-recorder'
import { timelineBlocks } from './helpers/timeline-fixture'
import type { Project } from '@engine/model@103'

// Variable specifier: vite:import-analysis must not resolve the missing
// module at transform time (vitest resolves the alias at runtime — RED now).
const SPEC_TIMELINE = '@ui/timeline/Timeline'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

// jsdom lacks pointer capture — the drag gesture must not hinge on it.
Element.prototype.setPointerCapture = () => undefined
Element.prototype.releasePointerCapture = () => undefined
Element.prototype.hasPointerCapture = () => true

interface Mounted {
  app: ReturnType<typeof createTestApp>['app']
  rafs: ReturnType<typeof createTestApp>['rafs']
  recorder: CanvasRecorder
  targetCalls: Array<[number, number, number]>
}

async function mount(options: { project?: Project; dpr?: number; size?: { widthPx: number; heightPx: number } } = {}): Promise<Mounted> {
  const t = createTestApp({ project: options.project ?? sampleProject({ blocks: timelineBlocks() }) })
  const { Timeline } = (await import(/* @vite-ignore */ SPEC_TIMELINE)) as typeof import('@ui/timeline/Timeline')
  const recorder = createCanvasRecorder()
  const targetCalls: Array<[number, number, number]> = []
  const createTarget = (widthPx: number, heightPx: number, dpr: number) => {
    targetCalls.push([widthPx, heightPx, dpr])
    return recorder
  }
  act(() => {
    render(
      <Timeline
        app={t.app}
        rafs={t.rafs}
        dpr={options.dpr ?? 1}
        initialSize={options.size ?? { widthPx: 800, heightPx: 100 }}
        initialViewport={{ t0: 0, pxPerSec: 100 }}
        createTarget={createTarget}
      />,
    )
  })
  return { app: t.app, rafs: t.rafs, recorder, targetCalls }
}

function blockById(app: ReturnType<typeof createTestApp>['app'], id: string) {
  const project = app.project.getState().project
  const found = project?.blocks.find((b) => b.id === id)
  if (found === undefined) throw new Error(`missing block ${id}`)
  return found
}

afterEach(() => {
  cleanup()
})

describe('CC-103.1: canvas surface (FR-103.1)', () => {
  test('CC-103.1: dpr scales the backing store through the injected target (800×100 @2 → 1600×200)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { recorder, targetCalls } = await mount({ dpr: 2, size: { widthPx: 800, heightPx: 100 } })
    expect(targetCalls[0], 'the target factory receives the CSS size + dpr').toEqual([800, 100, 2])
    expect(recorder.width, 'backing store width = round(css × dpr)').toBe(1600)
    expect(recorder.height, 'backing store height = round(css × dpr)').toBe(200)
    expect(recorder.transforms().some((t) => t[0] === 2 && t[3] === 2), 'the dpr transform is applied before drawing').toBe(true)
  })

  test('CC-103.1: the panel renders the frozen testids — region, canvas, live region, snap toggle', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    await mount()
    const root = screen.getByTestId('timeline-root')
    expect(root.getAttribute('data-region'), 'unit-101 region nesting').toBe('timeline')
    expect(root.getAttribute('tabindex'), 'FR-103.7: the region is focusable').toBe('0')
    expect(screen.getByTestId('timeline-canvas').tagName, 'ONE canvas (FR-103.1)').toBe('CANVAS')
    const live = screen.getByTestId('timeline-live')
    expect(live.getAttribute('aria-live'), 'polite announcements').toBe('polite')
    const toggle = screen.getByTestId('timeline-snap-toggle')
    expect(toggle.getAttribute('aria-pressed'), 'snap default on').toBe('true')
    act(() => {
      fireEvent.click(toggle)
    })
    expect(toggle.getAttribute('aria-pressed'), 'toggle flips snap').toBe('false')
  })
})

describe('CC-103.2: pointer interactions on the canvas (US-2.2.1, FR-103.6)', () => {
  test('CC-103.2: a body drag on the canvas moves one block with ONE undo step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, rafs, recorder } = await mount()
    // x is canvas-relative (jsdom rects are 0) — blk_v2 spans 300–500 px, body at 350.
    const canvas = screen.getByTestId('timeline-canvas')
    const before = app.history.undoCount()
    act(() => {
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 350, clientY: 90, button: 0, bubbles: true, cancelable: true })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 450, clientY: 90, bubbles: true, cancelable: true })
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 450, clientY: 90, bubbles: true, cancelable: true })
      rafs.frame(16)
    })
    const moved = blockById(app, 'blk_v2')
    expect(moved.end, 'clamped by the 0.05 s adjacency floor against blk_v3').toBe(5.95)
    expect(moved.start, 'duration preserved: 5.95 − 2.0').toBe(3.95)
    expect(blockById(app, 'blk_v3').start, 'neighbour untouched').toBe(6.0)
    expect(app.history.undoCount(), 'exactly one history step for the gesture').toBe(before + 1)
    expect(recorder.ops().length, 'the gesture produced draw activity').toBeGreaterThan(0)
  })

  test('CC-103.2: ruler click seeks (FR-103.6)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    const canvas = screen.getByTestId('timeline-canvas')
    act(() => {
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 700, clientY: 4, button: 0, bubbles: true, cancelable: true })
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 700, clientY: 4, bubbles: true, cancelable: true })
    })
    expect(app.editor.getState().playhead, 'x 700 ÷ 100 pxPerSec = 7.0 s').toBe(7.0)
  })

  test('CC-103.2: inspector TimecodeInput commits a millisecond-precision value (US-2.2.5)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    act(() => {
      app.editor.setSelection({ anchorBlockId: 'blk_v1', focusBlockId: 'blk_v1' })
    })
    const startInput = screen.getByTestId('timeline-input-start') as HTMLInputElement
    expect(startInput.value, 'the strip shows the selected block start through the shared formatTimecode').toBe('00:00.5')
    fireEvent.change(startInput, { target: { value: '00:01.25' } })
    fireEvent.keyDown(startInput, { key: 'Enter', bubbles: true, cancelable: true })
    expect(blockById(app, 'blk_v1').start, 'a millisecond timecode commits EXACTLY (no tenths rounding)').toBe(1.25)
    expect(blockById(app, 'blk_v1').end, 'only the edited bound moves').toBe(2.5)
  })

  test('CC-103.2: invalid timecode shows aria-invalid and commits NOTHING (US-2.2.5)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    act(() => {
      app.editor.setSelection({ anchorBlockId: 'blk_v1', focusBlockId: 'blk_v1' })
    })
    const startInput = screen.getByTestId('timeline-input-start') as HTMLInputElement
    const stepsBefore = app.history.undoCount()
    fireEvent.change(startInput, { target: { value: 'nope' } })
    fireEvent.keyDown(startInput, { key: 'Enter', bubbles: true, cancelable: true })
    fireEvent.blur(startInput)
    expect(startInput.getAttribute('aria-invalid'), 'invalid → aria-invalid="true", never a silent clamp').toBe('true')
    expect(blockById(app, 'blk_v1').start, 'the block is untouched').toBe(0.5)
    expect(app.history.undoCount(), 'no history step from invalid input').toBe(stepsBefore)
  })
})

describe('CC-103.4: repaint scheduling (FR-103.1 rAF coalescing)', () => {
  test('CC-103.4: two store changes flush ONE animation frame', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, rafs, recorder } = await mount()
    while (rafs.pending() > 0) {
      act(() => {
        rafs.frame(16)
      })
    }
    const framesBefore = rafs.framesFlushed()
    act(() => {
      app.dispatch('transport-seek', { time: 2 })
      app.dispatch('transport-seek', { time: 4 })
    })
    expect(rafs.pending(), 'the two changes sit on ONE scheduled frame').toBe(1)
    act(() => {
      rafs.frame(16)
    })
    expect(rafs.framesFlushed(), 'one frame ran').toBe(framesBefore + 1)
    expect(recorder.ops().length, 'that frame drew the new playhead').toBeGreaterThan(0)
  })
})
