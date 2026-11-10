// Adverse round (unit-103 adversary, L2, jsdom): the held-letter chord
// tracking + `when: 'timeline-focused'` gate (frozen in
// unit103-api-contract.d.ts lines 31-50 — useCommands "must track held
// letter keys and prefix them into the chord") against the design.md § Keyboard
// shortcuts RULE: "never bound during `contenteditable` focus except
// save/undo/overlay" — enforced by the registry's frozen `isEditing()` text
// editing predicate (unit-101 d.ts: "`when: 'not-editing'` bindings are
// skipped while editing"). `adverse TL.<n>: …`.
//
// The test marked KNOWN VIOLATION is a deliberate failing proof: a Z armed
// OUTSIDE an editing path survives into it (focus transfer, no window blur),
// so Z+ArrowLeft dispatches a block-retime WHILE a text-input has focus —
// a shortcut bound during text-editing focus.
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { dispatchCommand } from '@ui/commands/registry'
import { useCommands } from '@ui/commands/useCommands'
import { createSettingsStore } from '@state/settings'
import type { ReactElement } from 'react'
import { createTestApp } from '../../editor/helpers/editor-app'
import { sampleProject } from '../../editor/helpers/fixture-project'
import { constraintBlocks, timelineBlocks } from '../helpers/timeline-fixture'
import type { SettingsStore } from '@state/settings'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

const SPEC_TIMELINE = '@ui/timeline/Timeline'
const SPEC_RECORDER = '../helpers/canvas-recorder'

function Shell({ settings }: { settings: SettingsStore }): ReactElement {
  useCommands(settings)
  return <div data-testid="adverse-shell" />
}

async function mount(): Promise<{ app: ReturnType<typeof createTestApp>['app'] }> {
  const settings = await createSettingsStore({
    storage: {
      get: async () => null,
      set: async () => undefined,
    },
  })
  const t = createTestApp({ project: sampleProject({ blocks: constraintBlocks() }) })
  const { Timeline } = (await import(/* @vite-ignore */ SPEC_TIMELINE)) as typeof import('@ui/timeline/Timeline')
  const { createCanvasRecorder } = (await import(/* @vite-ignore */ SPEC_RECORDER)) as typeof import('../helpers/canvas-recorder')
  render(
    <>
      <Shell settings={settings} />
      <Timeline app={t.app} rafs={t.rafs} dpr={1} initialSize={{ widthPx: 800, heightPx: 100 }} initialViewport={{ t0: 0, pxPerSec: 100 }} createTarget={() => createCanvasRecorder()} />
    </>,
  )
  return { app: t.app }
}

function outsideRegionInput(): HTMLInputElement {
  const input = document.createElement('input')
  input.dataset['adverse'] = '1'
  document.body.appendChild(input)
  return input
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  window.dispatchEvent(event)
  return event
}

afterEach(() => {
  cleanup()
  for (const el of document.querySelectorAll('input[data-adverse]')) el.remove()
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('adverse TL.chords (CC-103.5): held-letter tracking must not dispatch while text-editing focus', () => {
  test('adverse TL.38: CC-103.5 window blur clears held Z — later arrows never trim (registry must support the chord, blur doctrine)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    app.editor.setSelection({ anchorBlockId: 'blk_mid', focusBlockId: 'blk_mid' })
    expect(app.dispatch('transport-seek', { time: 4 })).toBeNull()
    const root = screen.getByTestId('timeline-root')
    root.focus()
    press('z')
    window.dispatchEvent(new Event('blur')) // window loses focus while Z is down…
    const input = outsideRegionInput()
    input.focus() // …release happens elsewhere, user starts typing
    press('ArrowLeft')
    const blk = app.project.getState().project?.blocks.find((b) => b.id === 'blk_mid')
    expect(blk?.start, 'blur cleared the held letter — no trim-start dispatch').toBe(3.0)
  })

  test('adverse TL.39: CC-103.5 letters typed INSIDE an editing path never arm a chord', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    app.editor.setSelection({ anchorBlockId: 'blk_mid', focusBlockId: 'blk_mid' })
    expect(app.dispatch('transport-seek', { time: 4 })).toBeNull()
    const input = outsideRegionInput()
    input.focus()
    press('z') // typing z…
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'z', bubbles: true }))
    press('ArrowLeft')
    const blk = app.project.getState().project?.blocks.find((b) => b.id === 'blk_mid')
    expect(blk?.start, 'z typed while editing must not arm the trim chord').toBe(3.0)
  })

  test('adverse TL.40: CC-103.5 KNOWN VIOLATION — Z armed outside an editing path leaks INTO it (focus transfer, no blur) and dispatches a retime', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app } = await mount()
    app.editor.setSelection({ anchorBlockId: 'blk_mid', focusBlockId: 'blk_mid' })
    expect(app.dispatch('transport-seek', { time: 4 })).toBeNull()
    document.body.focus()
    press('z') // armed while NOT editing (legitimate)
    const input = outsideRegionInput()
    input.focus() // focus transfers INTO the text-editing path, Z still physically held
    const ev = press('ArrowLeft') // user moves the caret in the input
    const blk = app.project.getState().project?.blocks.find((b) => b.id === 'blk_mid')
    expect(blk?.start, 'design.md § Keyboard shortcuts: never bound during editing focus — trim-start must NOT fire').toBe(3.0)
    expect(ev.defaultPrevented, 'the caret-movement key must not be swallowed while editing').toBe(false)
  })

  test('adverse TL.41: CC-103.5 live region announces the focused block as EXACTLY `${speakerLabel}, ${timecode}, ${text}`', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: sampleProject({ blocks: timelineBlocks() }) })
    const { Timeline } = (await import(/* @vite-ignore */ SPEC_TIMELINE)) as typeof import('@ui/timeline/Timeline')
    const { createCanvasRecorder } = (await import(/* @vite-ignore */ SPEC_RECORDER)) as typeof import('../helpers/canvas-recorder')
    act(() => {
      render(<Timeline app={t.app} rafs={t.rafs} dpr={1} initialSize={{ widthPx: 800, heightPx: 100 }} initialViewport={{ t0: 0, pxPerSec: 100 }} createTarget={() => createCanvasRecorder()} />)
    })
    const root = screen.getByTestId('timeline-root')
    root.focus()
    act(() => {
      dispatchCommand('timeline.focus-next')
    })
    expect(screen.getByTestId('timeline-live').textContent, 'exact frozen announcement (d.ts § timeline-live)').toBe('Speaker 1, 00:00.5, alpha beta gamma')
    act(() => {
      dispatchCommand('timeline.focus-next')
    })
    expect(screen.getByTestId('timeline-live').textContent).toBe('Speaker 2, 00:03.0, delta epsilon zeta')
  })
})
