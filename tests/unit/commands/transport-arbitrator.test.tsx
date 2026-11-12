// CC-105.1 (L2, jsdom — orchestrator's command/arbitrator seed suite): the
// KEYBOARD-SIMULATED transport semantics pinned in src/state/CONTRACT.md
// § Transport + SyncArbitrator, driven through the DOM seam (useCommands
// bridge + useTransportCommands + the frozen unit-105 useEditorCommands hook)
// on the standard fake-engine harness (createTestApp, fake media clock, fake
// rAFs — tests/unit/editor/helpers, REUSED never re-created). One arbitrator
// play/pause per keypress; seek deltas on the fake clock; close-gap delete
// meets at the adjudicated GAP MIDPOINT (round3((prevEnd+nextStart)/2)) with
// later blocks byte-identical and ONE history step; SECURITY-03 canary spy on.
// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useCommands } from '@ui/commands/useCommands'
import { useTransportCommands } from '@ui/commands/useTransportCommands'
import { createSettingsStore } from '@state/settings'
import { createFakeSettingsStorage } from '../workbench/helpers/fake-engine'
import { createTestApp } from '../editor/helpers/editor-app'
import { block, sampleProject, word } from '../editor/helpers/fixture-project'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { loadSeamModule } from './helpers/seams'
import type { EditorApp } from '@state/history'
import type { SettingsStore } from '@state/settings'
import type { useEditorCommands } from '@ui/commands/useEditorCommands'
import type { CaptionBlock, Project } from '@engine/model@102'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

function Harness(props: { app: EditorApp; settings: SettingsStore; useEditorCommandsHook: typeof useEditorCommands; onSave: () => void }): null {
  useCommands(props.settings)
  useTransportCommands(props.app)
  props.useEditorCommandsHook(props.app, { onSave: props.onSave })
  return null
}

const EXTRA_BLOCK: CaptionBlock = block('blk_d', 9.0, 10.5, 'SPK_2', [word('eta', 9.0, 9.5), word('theta', 9.6, 10.5)])

interface MountedEditor {
  app: EditorApp
  onSave: ReturnType<typeof vi.fn>
  /** The injected fake media clock — call-count assertions (ONE seek/play). */
  mediaClock: ReturnType<typeof createTestApp>['mediaClock']
  dispose: () => void
}

async function mountEditor(): Promise<MountedEditor> {
  const t = createTestApp({ withMediaClock: true, project: sampleProject(), blocks: [EXTRA_BLOCK] })
  const { useEditorCommands: hook } = await loadSeamModule<typeof import('@ui/commands/useEditorCommands')>('@ui/commands/useEditorCommands')
  const { storage } = createFakeSettingsStorage()
  const settings = await createSettingsStore({ storage })
  const onSave = vi.fn()
  render(<Harness app={t.app} settings={settings} useEditorCommandsHook={hook} onSave={onSave} />)
  const active = document.activeElement as HTMLElement | null
  active?.blur()
  return {
    app: t.app,
    onSave,
    mediaClock: t.mediaClock,
    dispose: () => {
      cleanup()
      t.app.dispose()
    },
  }
}

function press(init: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }): void {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

function release(init: { key: string }): void {
  act(() => {
    window.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }))
  })
}

function pressChord(keys: string): void {
  const tokens = keys.split('+')
  const base = tokens[tokens.length - 1] as string
  press({
    key: base.length === 1 ? base.toLowerCase() : base,
    metaKey: tokens.includes('Meta'),
    ctrlKey: tokens.includes('Ctrl'),
    shiftKey: tokens.includes('Shift'),
    altKey: tokens.includes('Alt'),
  })
  release({ key: base.length === 1 ? base.toLowerCase() : base })
}

function blocks(app: EditorApp): CaptionBlock[] {
  return (app.project.getState().project as Project).blocks
}

function seek(app: EditorApp, t: number): void {
  const result = app.dispatch('transport-seek', { time: t })
  if (result !== null) throw new Error(`seek rejected: ${result.code}`)
}

function select(app: EditorApp, blockId: string): void {
  app.editor.setSelection({ anchorBlockId: blockId, focusBlockId: blockId })
}

afterEach(cleanup)

describe('CC-105.1 (keyboard transport): CONTRACT.md transport semantics through the DOM seam', () => {
  test('CC-105.1: Space toggles play/pause with ONE arbitrator play per keypress, one pause per keypress', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const { app, mediaClock, dispose } = await mountEditor()
    try {
      if (mediaClock === null) throw new Error('media clock missing')
      expect(app.editor.getState().playing, 'starts not playing').toBe(false)
      press({ key: ' ' })
      expect(app.editor.getState().playing, 'Space starts playback').toBe(true)
      expect(mediaClock.playCalls, 'ONE clock play per keypress').toBe(1)
      press({ key: ' ' })
      expect(app.editor.getState().playing, 'Space again pauses').toBe(false)
      expect(mediaClock.pauseCalls, 'ONE clock pause per keypress').toBe(1)
      expect(mediaClock.playCalls, 'no extra play calls').toBe(1)
      expect(app.arbitrator?.playing, 'arbitrator mirrors the last press').toBe(false)
      expect(redaction.settle().clean, 'SECURITY-03: no canary in any output channel').toBe(true)
      dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-105.1: J/L skip ∓5 s and Shift+J/L ∓10 s (fake-clock seek deltas)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, mediaClock, dispose } = await mountEditor()
    try {
      if (mediaClock === null) throw new Error('media clock missing')
      seek(app, 60)
      const seeksBefore = mediaClock.seekCalls
      pressChord('J')
      expect(app.editor.getState().playhead, 'J = −5 s').toBeCloseTo(55, 6)
      pressChord('L')
      expect(app.editor.getState().playhead, 'L = +5 s').toBeCloseTo(60, 6)
      press({ key: 'j', shiftKey: true })
      release({ key: 'j' })
      expect(app.editor.getState().playhead, 'Shift+J = −10 s').toBeCloseTo(50, 6)
      press({ key: 'l', shiftKey: true })
      release({ key: 'l' })
      expect(app.editor.getState().playhead, 'Shift+L = +10 s').toBeCloseTo(60, 6)
      expect(mediaClock.seekCalls - seeksBefore, 'four skips = four element seeks (single-seek rule)').toBe(4)
      dispose()
    } finally {
      dispose()
    }
  })

  test('CC-105.1: ←/→ step ±1/fps from project.asset.fps; Shift+arrows ±1 s', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, dispose } = await mountEditor()
    try {
      expect(app.project.getState().project?.asset.fps, 'fixture is 25 fps').toBe(25)
      seek(app, 10)
      pressChord('ArrowLeft')
      expect(app.editor.getState().playhead, '← = −1/25 s').toBeCloseTo(9.96, 6)
      pressChord('ArrowRight')
      pressChord('ArrowRight')
      expect(app.editor.getState().playhead, '→ = +1/25 s, twice').toBeCloseTo(10.04, 6)
      seek(app, 10)
      press({ key: 'ArrowLeft', shiftKey: true })
      release({ key: 'ArrowLeft' })
      expect(app.editor.getState().playhead, 'Shift+← = −1 s').toBeCloseTo(9, 6)
      dispose()
    } finally {
      dispose()
    }
  })

  test('CC-105.1: Home/End and Meta+ArrowLeft/Meta+ArrowRight seek to 0 / asset.duration (clamped)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, dispose } = await mountEditor()
    try {
      seek(app, 40)
      pressChord('Home')
      expect(app.editor.getState().playhead, 'Home → 0').toBe(0)
      seek(app, 40)
      pressChord('End')
      expect(app.editor.getState().playhead, 'End → duration').toBe(121.44)
      seek(app, 40)
      pressChord('Meta+ArrowLeft')
      expect(app.editor.getState().playhead, '⌘← → 0 (preventDefault vs browser Back)').toBe(0)
      seek(app, 40)
      pressChord('Meta+ArrowRight')
      expect(app.editor.getState().playhead, '⌘→ → duration').toBe(121.44)
      // Windows spellings.
      seek(app, 40)
      pressChord('Ctrl+ArrowLeft')
      expect(app.editor.getState().playhead, 'Ctrl+← → 0').toBe(0)
      dispose()
    } finally {
      dispose()
    }
  })

  test('CC-105.1: I/O set loop in/out from the playhead; Y re-arms the last region; Shift+I/O clear it', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, dispose } = await mountEditor()
    try {
      seek(app, 12)
      pressChord('I')
      expect(app.editor.getState().loop?.[0], 'I sets loop-in from playhead').toBe(12)
      seek(app, 18)
      pressChord('O')
      expect(app.editor.getState().loop?.[1], 'O sets loop-out from playhead').toBe(18)
      pressChord('Y')
      expect(app.editor.getState().loop, 'Y toggles off').toBeNull()
      pressChord('Y')
      expect(app.editor.getState().loop, 'Y re-arms the last region').toEqual([12, 18])
      press({ key: 'i', shiftKey: true })
      release({ key: 'i' })
      expect(app.editor.getState().loop, 'Shift+I clears the loop').toBeNull()
      seek(app, 20)
      pressChord('I')
      seek(app, 24)
      pressChord('O')
      press({ key: 'o', shiftKey: true })
      release({ key: 'o' })
      expect(app.editor.getState().loop, 'Shift+O clears the loop').toBeNull()
      dispose()
    } finally {
      dispose()
    }
  })

  test('CC-105.1: Meta+Z / Meta+Shift+Z / Meta+Y drive history undo/redo once each', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, dispose } = await mountEditor()
    try {
      const before = (blocks(app).find((b) => b.id === 'blk_a') as CaptionBlock).text
      expect(app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'omega revised' })).toBeNull()
      expect(app.editor.getState().selection, 'unchanged').toEqual({ anchorBlockId: null, focusBlockId: null })
      expect(app.history.undoCount(), 'one mutation = one history step').toBe(1)
      pressChord('Meta+Z')
      expect(app.history.undoCount(), '⌘Z = exactly one undo').toBe(0)
      expect((blocks(app).find((b) => b.id === 'blk_a') as CaptionBlock).text, 'reverted').toBe(before)
      pressChord('Meta+Shift+Z')
      expect(app.history.undoCount(), '⌘⇧Z = exactly one redo').toBe(1)
      expect((blocks(app).find((b) => b.id === 'blk_a') as CaptionBlock).text, 'redone').toBe('omega revised')
      pressChord('Meta+Shift+Z')
      pressChord('Meta+Y')
      pressChord('Meta+Z')
      expect(app.history.undoCount(), '⌘Y and further presses stay one-step consistent').toBe(0)
      dispose()
    } finally {
      dispose()
    }
  })

  test('CC-105.1: Meta+A selects all blocks; Escape deselects', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, dispose } = await mountEditor()
    try {
      pressChord('Meta+A')
      expect(app.editor.getState().selection, '⌘A selects every block').toEqual({ anchorBlockId: 'blk_a', focusBlockId: 'blk_d' })
      pressChord('Escape')
      expect(app.editor.getState().selection, 'Escape deselects').toEqual({ anchorBlockId: null, focusBlockId: null })
      dispose()
    } finally {
      dispose()
    }
  })

  test('CC-105.1: Delete runs block-delete on the selected block in ONE history step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const { app, dispose } = await mountEditor()
    try {
      select(app, 'blk_b')
      pressChord('Delete')
      expect(blocks(app).map((b) => b.id), 'blk_b (the canary block) deleted, gap left').toEqual(['blk_a', 'blk_c', 'blk_d'])
      expect((blocks(app).find((b) => b.id === 'blk_a') as CaptionBlock).end, 'gap preserved').toBe(2.5)
      expect(app.history.undoCount(), 'ONE history step').toBe(1)
      pressChord('Backspace')
      // Selection is gone (block deleted) — a stray Backspace must not delete
      // another block silently; exactly one step so far.
      expect(app.history.undoCount(), 'no silent second deletion without a selection').toBe(1)
      expect(redaction.settle().clean, 'SECURITY-03').toBe(true)
      dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-105.1: Shift+Delete closes the gap at the adjudicated MIDPOINT, later blocks byte-identical, ONE step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const { app, dispose } = await mountEditor()
    try {
      const dBefore = JSON.stringify(blocks(app).find((b) => b.id === 'blk_d'))
      select(app, 'blk_b')
      pressChord('Shift+Delete')
      const after = blocks(app)
      expect(after.map((b) => b.id), 'block deleted + gap closed').toEqual(['blk_a', 'blk_c', 'blk_d'])
      const prev = after.find((b) => b.id === 'blk_a') as CaptionBlock
      const next = after.find((b) => b.id === 'blk_c') as CaptionBlock
      const midpoint = Math.round(((2.5 + 6.25) / 2) * 1000) / 1000
      expect(midpoint, 'round3((prevEnd+nextStart)/2) = 4.375').toBe(4.375)
      expect(prev.end, 'previous.end meets the midpoint').toBe(4.375)
      expect(next.start, 'next.start meets the midpoint (neighbours COLLAPSE to meet, not clamp)').toBe(4.375)
      expect(JSON.stringify(after.find((b) => b.id === 'blk_d')), 'later blocks byte-identical (invariant 9)').toBe(dBefore)
      expect(app.history.undoCount(), 'ONE history step').toBe(1)
      expect(redaction.settle().clean, 'SECURITY-03').toBe(true)
      dispose()
    } finally {
      redaction.restore()
    }
  })

  test('CC-105.1: platform both ways — Meta+S (mac) and Ctrl+S (windows) fire the save-injected spy', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, onSave, dispose } = await mountEditor()
    try {
      press({ key: 's', metaKey: true })
      release({ key: 's' })
      expect(onSave, '⌘S fires the injected save').toHaveBeenCalledTimes(1)
      press({ key: 's', ctrlKey: true })
      release({ key: 's' })
      expect(onSave, 'Ctrl+S fires the injected save (Windows spelling)').toHaveBeenCalledTimes(2)
      void app
      dispose()
    } finally {
      dispose()
    }
  })
})
