// Adverse round (unit-103 adversary, L2, jsdom): TimecodeInput parsing /
// recovery UX at the extreme strings, and the inspector strip's "invalid
// input NEVER mutates" contract (unit file US-2.2.5, d.ts § TimecodeInput:
// "invalid text shows the error state (`aria-invalid=\"true\"`) and never
// calls onCommit — no silent clamp, recovery UX"). `adverse TL.<n>: …`.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../../editor/helpers/editor-app'
import { sampleProject } from '../../editor/helpers/fixture-project'
import { constraintBlocks } from '../helpers/timeline-fixture'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const SPEC_INPUT = '@ui/editable/TimecodeInput'
const SPEC_TIMELINE = '@ui/timeline/Timeline'
const SPEC_RECORDER = '../helpers/canvas-recorder'

afterEach(() => {
  cleanup()
})

async function mountInput(props: { value: number; fps?: number }): Promise<{ commits: number[]; el: HTMLInputElement }> {
  const { TimecodeInput } = (await import(/* @vite-ignore */ SPEC_INPUT)) as typeof import('@ui/editable/TimecodeInput')
  cleanup()
  const commits: number[] = []
  render(<TimecodeInput value={props.value} label="Start" testId="tc-start" fps={props.fps} onCommit={(t) => commits.push(t)} />)
  const el = screen.getByTestId<HTMLInputElement>('tc-start')
  return { commits, el }
}

describe('adverse TL.timecode (CC-103.5): parse extremes, error state, recovery — no silent clamp, no mutation', () => {
  test('adverse TL.32: CC-103.5 valid millisecond strings commit the exact parsed value (Enter and blur)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const a = await mountInput({ value: 3 })
    fireEvent.change(a.el, { target: { value: '00:12.350' } })
    fireEvent.keyDown(a.el, { key: 'Enter' })
    expect(a.commits).toEqual([12.35])
    const b = await mountInput({ value: 3 })
    fireEvent.change(b.el, { target: { value: '00:00.000' } })
    fireEvent.blur(b.el)
    expect(b.commits, "zero timecode is VALID — '00:00.000' commits 0, never an error state").toEqual([0])
    expect(b.el.getAttribute('aria-invalid'), 'valid value leaves the error state clear').toBeNull()
  })

  test('adverse TL.33: CC-103.5 invalid strings set aria-invalid and NEVER commit (Enter or blur)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    for (const bad of ['-1', 'abc', '00:12,350', '', ' ', 'Infinity', '00:', '1:2:3:4:5']) {
      const r = await mountInput({ value: 3 })
      fireEvent.change(r.el, { target: { value: bad } })
      fireEvent.keyDown(r.el, { key: 'Enter' })
      fireEvent.blur(r.el)
      expect(r.commits, `input ${JSON.stringify(bad)} must never reach onCommit`).toEqual([])
      expect(r.el.getAttribute('aria-invalid'), `input ${JSON.stringify(bad)} shows the error state`).toBe('true')
      cleanup()
    }
  })

  test('adverse TL.34: CC-103.5 out-of-range but parseable values commit RAW (never silently clamped); reducer owns validity', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const r = await mountInput({ value: 3 })
    fireEvent.change(r.el, { target: { value: '99:59.999' } })
    fireEvent.keyDown(r.el, { key: 'Enter' })
    expect(r.commits, 'd.ts § TimecodeInput: no silent clamp — the parsed value reaches onCommit untouched').toEqual([5999.999])
  })

  test('adverse TL.35: CC-103.5 fps mode validates the frame field against fps (MM:SS:FF)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const good = await mountInput({ value: 1, fps: 24 })
    fireEvent.change(good.el, { target: { value: '00:01:12' } })
    fireEvent.keyDown(good.el, { key: 'Enter' })
    expect(good.commits).toEqual([1.5])
    const bad = await mountInput({ value: 1, fps: 24 })
    fireEvent.change(bad.el, { target: { value: '00:01:30' } })
    fireEvent.keyDown(bad.el, { key: 'Enter' })
    expect(bad.commits, 'frames 30 ≥ fps 24 → invalid, no commit').toEqual([])
    expect(bad.el.getAttribute('aria-invalid')).toBe('true')
  })

  test('adverse TL.36: CC-103.5 recovery UX — invalid draft survives external value updates, Escape restores, blur commits nothing until valid', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { TimecodeInput } = (await import(/* @vite-ignore */ SPEC_INPUT)) as typeof import('@ui/editable/TimecodeInput')
    const commits: number[] = []
    const view = render(<TimecodeInput value={3} label="Start" testId="tc-rec" onCommit={(t) => commits.push(t)} />)
    const el = screen.getByTestId<HTMLInputElement>('tc-rec')
    fireEvent.change(el, { target: { value: 'abc' } })
    expect(el.getAttribute('aria-invalid')).toBe('true')
    act(() => {
      view.rerender(<TimecodeInput value={9} label="Start" testId="tc-rec" onCommit={(t) => commits.push(t)} />)
    })
    fireEvent.blur(el)
    expect(commits, 'external value change + blur on an invalid draft still commits NOTHING').toEqual([])
    fireEvent.keyDown(el, { key: 'Escape' })
    expect(el.value, 'Escape restores the formatted committed value').toBe('00:09.0')
    expect(el.getAttribute('aria-invalid')).toBeNull()
  })

  test('adverse TL.37: CC-103.5 inspector integration — invalid input mutates NOTHING; a valid one dispatches exactly the typed time', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: sampleProject({ blocks: constraintBlocks() }) })
    const { Timeline } = (await import(/* @vite-ignore */ SPEC_TIMELINE)) as typeof import('@ui/timeline/Timeline')
    const { createCanvasRecorder } = (await import(/* @vite-ignore */ SPEC_RECORDER)) as typeof import('../helpers/canvas-recorder')
    t.app.editor.setSelection({ anchorBlockId: 'blk_next', focusBlockId: 'blk_next' })
    act(() => {
      render(<Timeline app={t.app} rafs={t.rafs} dpr={1} initialSize={{ widthPx: 800, heightPx: 100 }} initialViewport={{ t0: 0, pxPerSec: 100 }} createTarget={() => createCanvasRecorder()} />)
    })
    const endInput = screen.getByTestId<HTMLInputElement>('timeline-input-end')
    fireEvent.change(endInput, { target: { value: '-1' } })
    fireEvent.blur(endInput)
    const blk = t.app.project.getState().project?.blocks.find((b) => b.id === 'blk_next')
    expect(blk?.end, 'invalid text NEVER mutates (US-2.2.5)').toBe(7)
    expect(endInput.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(endInput, { target: { value: '00:07.500' } })
    fireEvent.keyDown(endInput, { key: 'Enter' })
    const after = t.app.project.getState().project?.blocks.find((b) => b.id === 'blk_next')
    expect(after?.end, 'typed value dispatched through block-retime').toBe(7.5)
    expect(after?.start).toBe(6)
    expect(endInput.getAttribute('aria-invalid'), 'recovery clears the error state').toBeNull()
  })
})
