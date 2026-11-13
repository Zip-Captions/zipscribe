// unit-105 AUDIT — adversarial counterexample suite, useEditorCommands handler
// wiring + the ⌘/ overlay (test-adversary). Harness mirrors the PRODUCTION
// composition (Workbench.tsx): useCommands bridge + useEditorCommands +
// Workbench-owned overlay mount (registerCommandHandler('view.shortcuts-overlay'…)
// → <ShortcutsOverlay onClose>) — never the vacuous no-app mount (a deselect
// without a mounted handler could never fail). Attacks: no-selection delete,
// select-all on an empty project, ⌘Z on an empty history, handler last-wins on
// double mount / no-revive after unsubscribe, unmount-then-dispatch, ⌘/
// idempotence, the US-2.3.3 × US-2.3.1 Esc interaction (overlay consumes Esc —
// selection must SURVIVE), filter typing owns Delete/Escape, Tab trap with the
// filter focused, opener-removed-before-Esc, multi-chord rows (per-unique-id),
// aria on the frozen testid node, and a SECURITY-03 canary sweep (REVIEW #1).
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { useCommands } from '@ui/commands/useCommands'
import { useEditorCommands } from '@ui/commands/useEditorCommands'
import { ShortcutsOverlay } from '@ui/commands/ShortcutsOverlay'
import { registerCommandHandler } from '@ui/commands/registry'
import { createSettingsStore } from '@state/settings'
import { createFakeSettingsStorage } from '../../workbench/helpers/fake-engine'
import { createTestApp } from '../../editor/helpers/editor-app'
import { sampleProject } from '../../editor/helpers/fixture-project'
import { createRedactionSpy } from '../../../../src/test-support/redaction'
import { chordToKeydownEvents, fireKey } from '../helpers/key-event'
import type { KeyEventInit } from '../helpers/key-event'
import type { EditorApp } from '@state/history'
import type { SettingsStore } from '@state/settings'
import type { CommandPlatform } from '@ui/commands/keyspec'
import type { Project } from '@engine/model@102'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

/** Mirrors Workbench's overlay ownership (Workbench.tsx:500 + :640) — the
 *  frozen seam contract: the Workbench mounts the overlay when
 *  view.shortcuts-overlay dispatches; onClose closes it. */
function Harness(props: { app: EditorApp; settings: SettingsStore; onSave: () => void; platform: CommandPlatform }): ReactElement {
  useCommands(props.settings)
  useEditorCommands(props.app, { onSave: props.onSave, platform: props.platform })
  const [open, setOpen] = useState(false)
  useEffect(() => registerCommandHandler('view.shortcuts-overlay', () => setOpen(true)), [])
  return open ? <ShortcutsOverlay onClose={() => setOpen(false)} platform={props.platform} /> : <span data-testid="overlay-slot" />
}

/** A second, independent useEditorCommands mount (double-mount probe target). */
function EditorHookMount(props: { app: EditorApp; onSave: () => void; platform: CommandPlatform }): null {
  useEditorCommands(props.app, { onSave: props.onSave, platform: props.platform })
  return null
}

interface Mounted {
  app: EditorApp
  onSave: ReturnType<typeof vi.fn>
  unmount: () => void
}

async function mountHarness(options: { project?: Project; platform?: CommandPlatform } = {}): Promise<Mounted> {
  const t = createTestApp({ project: options.project ?? sampleProject() })
  // Baseline normalization (orchestrator adjudication precedent, transport-
  // arbitrator.test.tsx): setup dispatches must never count as steps.
  t.app.history.clear()
  const { storage } = createFakeSettingsStorage()
  const settings = await createSettingsStore({ storage })
  const onSave = vi.fn()
  const view = render(<Harness app={t.app} settings={settings} onSave={onSave} platform={options.platform ?? 'windows'} />)
  const active = document.activeElement as HTMLElement | null
  act(() => {
    active?.blur()
  })
  return {
    app: t.app,
    onSave,
    unmount: () => {
      view.unmount()
      t.app.dispose()
    },
  }
}

function down(init: KeyEventInit): KeyboardEvent {
  let event!: KeyboardEvent
  act(() => {
    event = fireKey(window, init)
  })
  return event
}

function up(init: KeyEventInit): void {
  act(() => {
    fireKey(window, init, 'keyup')
  })
}

function simulateChord(keys: string): void {
  const events = chordToKeydownEvents(keys)
  for (const init of events) down(init)
  for (const init of events) up(init)
}

function blocksOf(app: EditorApp): readonly { id: string }[] {
  return (app.project.getState().project as Project).blocks
}

afterEach(() => {
  cleanup()
  const active = document.activeElement as HTMLElement | null
  act(() => {
    active?.blur()
  })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('AUDIT useEditorCommands: degenerate state (no selection, empty project, empty history)', () => {
  test('CC-105.2 AUDIT: timeline.delete with NO selection dispatches NOTHING — no throw, no step, no console.error (Delete and Backspace chords)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { app, unmount } = await mountHarness()
    try {
      expect(app.editor.getState().selection.focusBlockId, 'precondition: nothing selected').toBeNull()
      expect(() => simulateChord('Delete')).not.toThrow()
      expect(() => simulateChord('Backspace')).not.toThrow()
      expect(blocksOf(app).map((b) => b.id), 'no block vanishes without a selection').toEqual(['blk_a', 'blk_b', 'blk_c'])
      expect(app.history.undoCount(), 'a no-op must never leave a history step behind').toBe(0)
      expect(errorSpy, 'a suppressed delete is silent, not logged').not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  test('US-2.3.2 AUDIT: ⌘A on an EMPTY project (blocks: []) is a safe no-op — selection stays null, nothing crashes, no step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, unmount } = await mountHarness({ project: sampleProject({ blocks: [] }) })
    try {
      expect(() => simulateChord('Meta+A')).not.toThrow()
      expect(app.editor.getState().selection, 'select-all over zero blocks cannot invent an anchor').toEqual({ anchorBlockId: null, focusBlockId: null })
      expect(() => simulateChord('Delete')).not.toThrow()
      expect(blocksOf(app)).toHaveLength(0)
      expect(app.history.undoCount()).toBe(0)
    } finally {
      unmount()
    }
  })

  test('CC-105.1 AUDIT: ⌘Z / ⌘Y on an EMPTY history — the handler call is a safe no-crash no-op (no step, no error log)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { app, unmount } = await mountHarness()
    try {
      expect(app.history.undoCount(), 'precondition: history cleared baseline').toBe(0)
      expect(() => simulateChord('Meta+Z')).not.toThrow()
      expect(() => simulateChord('Meta+Y')).not.toThrow()
      expect(app.history.undoCount(), 'empty undo/redo never fabricates a step').toBe(0)
      expect(blocksOf(app).map((b) => b.id), 'project state unchanged').toEqual(['blk_a', 'blk_b', 'blk_c'])
      expect(errorSpy).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
})

describe('AUDIT useEditorCommands: handler lifecycle (last-wins, unsubscribe, no revive)', () => {
  test('CC-105.2 AUDIT: double mount replaces the handler — ONE ⌘S invokes the NEW onSave ONCE; unmounting the second hook removes the handler without reviving the first', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const t = createTestApp({ project: sampleProject() })
    t.app.history.clear()
    const { storage } = createFakeSettingsStorage()
    const settings = await createSettingsStore({ storage })
    const onSaveA = vi.fn()
    const onSaveB = vi.fn()
    const shell = render(<Harness app={t.app} settings={settings} onSave={onSaveA} platform="windows" />)
    const active = document.activeElement as HTMLElement | null
    act(() => {
      active?.blur()
    })
    const second = render(<EditorHookMount app={t.app} onSave={onSaveB} platform="mac" />)
    try {
      simulateChord('Meta+S')
      expect(onSaveB, 'last registration wins — one dispatch, one save call on the NEWEST hook').toHaveBeenCalledTimes(1)
      expect(onSaveA, 'the replaced hook never fires').not.toHaveBeenCalled()
      second.unmount()
      simulateChord('Meta+S')
      expect(onSaveB, 'the current handler unsubscribed on unmount').toHaveBeenCalledTimes(1)
      expect(onSaveA, 'a stale (replaced) handler must never revive').not.toHaveBeenCalled()
    } finally {
      shell.unmount()
      t.app.dispose()
    }
  })

  test('CC-105.2 AUDIT: unmount THEN dispatch — every unit-105 handler is gone (no-op, no throw, no silent mutation even with a selection)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, unmount } = await mountHarness()
    app.editor.setSelection({ anchorBlockId: 'blk_b', focusBlockId: 'blk_b' })
    unmount()
    expect(() => simulateChord('Delete')).not.toThrow()
    expect(() => simulateChord('Meta+A')).not.toThrow()
    expect(() => simulateChord('Meta+Z')).not.toThrow()
    expect(blocksOf(app).map((b) => b.id), 'unsubscribed handlers must not delete').toEqual(['blk_a', 'blk_b', 'blk_c'])
  })
})

describe('AUDIT overlay: idempotence, the Esc interaction (US-2.3.3 × US-2.3.1), typing ownership, focus', () => {
  test('US-2.3.3 AUDIT: ⌘/ while the overlay is already open is idempotent — exactly ONE dialog, still open', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { unmount } = await mountHarness()
    try {
      simulateChord('Meta+/')
      simulateChord('Meta+/')
      simulateChord('Meta+/')
      expect(document.querySelectorAll('[data-testid="shortcuts-overlay"]'), 'no stacked dialogs (setShortcutsOpen(true) is idempotent)').toHaveLength(1)
      expect(document.querySelector('[data-testid="shortcuts-filter"]'), 'the still-open overlay keeps its filter').not.toBeNull()
    } finally {
      unmount()
    }
  })

  test('US-2.3.3 × US-2.3.1 AUDIT: Esc with the overlay open closes it and does NOT also clear the selection (transcript.deselect must not fire)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, unmount } = await mountHarness()
    try {
      app.editor.setSelection({ anchorBlockId: 'blk_a', focusBlockId: 'blk_c' })
      simulateChord('Meta+/')
      const filter = document.querySelector('[data-testid="shortcuts-filter"]') as HTMLElement
      expect(document.activeElement, 'precondition: the overlay owns focus (filter)').toBe(filter)
      let deselects = 0
      const offDeselect = registerCommandHandler('transcript.deselect', () => {
        deselects += 1
      })
      try {
        const esc = down({ key: 'Escape' })
        expect(esc.defaultPrevented, 'the dialog consumed Escape (overlay preventDefault)').toBe(true)
        expect(document.querySelector('[data-testid="shortcuts-overlay"]'), 'Esc closes the overlay').toBeNull()
        expect(deselects, 'US-2.3.3 × US-2.3.1: closing the modal must not silently deselect the blocks underneath').toBe(0)
        expect(app.editor.getState().selection, 'selection SURVIVES the overlay close').toEqual({ anchorBlockId: 'blk_a', focusBlockId: 'blk_c' })
      } finally {
        offDeselect()
      }
      // Positive control: with the overlay CLOSED the same Escape DOES reach
      // the deselect dispatch (proves the spy wiring — the zero above is a
      // real suppression, not a dead spy; the real handler was replaced by
      // this counting spy, so only the COUNT is asserted, per registerCommandHandler
      // last-wins semantics).
      const offSpy = registerCommandHandler('transcript.deselect', () => {
        deselects += 1
      })
      try {
        down({ key: 'Escape' })
        expect(deselects, 'control: closed-overlay Escape dispatches transcript.deselect exactly once').toBe(1)
      } finally {
        offSpy()
      }
    } finally {
      unmount()
    }
  })

  test('CC-105.4 AUDIT: Escape with text in the filter closes the overlay (typing does not disarm Esc)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { unmount } = await mountHarness()
    try {
      simulateChord('Meta+/')
      const filter = document.querySelector('[data-testid="shortcuts-filter"]') as HTMLInputElement
      fireEvent.change(filter, { target: { value: 'zoom' } })
      expect(document.querySelectorAll('[data-testid="shortcuts-row"]').length, 'filter applied').toBeGreaterThanOrEqual(3)
      down({ key: 'Escape' })
      expect(document.querySelector('[data-testid="shortcuts-overlay"]'), 'Esc closes from the filter input too').toBeNull()
    } finally {
      unmount()
    }
  })

  test('CC-105.4 AUDIT: typing Delete INTO the filter must not delete the selected block (editing suppression holds while the dialog is open)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { app, unmount } = await mountHarness()
    try {
      app.editor.setSelection({ anchorBlockId: 'blk_b', focusBlockId: 'blk_b' })
      simulateChord('Meta+/')
      let deletes = 0
      const offDelete = registerCommandHandler('timeline.delete', () => {
        deletes += 1
      })
      try {
        const filter = document.querySelector('[data-testid="shortcuts-filter"]') as HTMLInputElement
        const event = new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
        act(() => {
          filter.dispatchEvent(event)
        })
        expect(deletes, 'the filter owns Delete, not the registry').toBe(0)
        expect(event.defaultPrevented, 'the keystroke reaches the input').toBe(false)
        expect(blocksOf(app).map((b) => b.id), 'block intact').toEqual(['blk_a', 'blk_b', 'blk_c'])
      } finally {
        offDelete()
      }
    } finally {
      unmount()
    }
  })

  test('CC-105.4 AUDIT: Tab with the filter focused stays inside the dialog (single-focusable trap cycles on the filter)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { unmount } = await mountHarness()
    try {
      simulateChord('Meta+/')
      const dialog = document.querySelector('[data-testid="shortcuts-overlay"]') as HTMLElement
      const filter = document.querySelector('[data-testid="shortcuts-filter"]') as HTMLElement
      expect(document.activeElement).toBe(filter)
      for (const shiftKey of [false, true]) {
        down({ key: 'Tab', shiftKey })
        expect(dialog.contains(document.activeElement as Node), 'focus cannot escape the modal on Tab').toBe(true)
      }
    } finally {
      unmount()
    }
  })

  test('CC-105.4 AUDIT: opener removed from the DOM before Esc — close is crash-free, overlay closes, focus lands on a sane node (pinned honest behavior)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { unmount } = await mountHarness()
    try {
      const opener = document.createElement('button')
      document.body.append(opener)
      act(() => {
        opener.focus()
      })
      simulateChord('Meta+/')
      opener.remove()
      expect(() => down({ key: 'Escape' })).not.toThrow()
      expect(document.querySelector('[data-testid="shortcuts-overlay"]'), 'the overlay still closed').toBeNull()
      expect(document.activeElement, 'focus never rests on the removed opener (detached node) — body is the honest fallback').not.toBe(opener)
      expect(document.activeElement, 'measured: detached focus() is ignored, the unmounted dialog returns focus to body').toBe(document.body)
    } finally {
      unmount()
    }
  })
})

describe('AUDIT overlay: rows, glyphs, aria (frozen testid contract)', () => {
  test('CC-105.4 AUDIT: multi-chord commands render ONE row per unique id with ALL chords displayed (edit.redo: 4 chords → 1 row, 4 labels)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const view = render(<ShortcutsOverlay platform="mac" />)
    try {
      const redoRows = view.container.querySelectorAll('[data-testid="shortcuts-row"][data-command-id="edit.redo"]')
      expect(redoRows, 'one row per unique command id (not one per chord)').toHaveLength(1)
      const text = redoRows[0]?.textContent ?? ''
      for (const label of ['⌘⇧Z', '⌃⇧Z', '⌘Y', '⌃Y']) {
        expect(text, `every registered chord is displayed (all-chords reading, not first+count)`).toContain(label)
      }
      const selectAll = view.container.querySelector('[data-testid="shortcuts-row"][data-command-id="transcript.select-all"]')?.textContent ?? ''
      expect(selectAll, 'the Meta+ AND Ctrl spellings both show').toContain('⌘A')
      expect(selectAll).toContain('⌃A')
    } finally {
      view.unmount()
    }
  })

  test('CC-105.4 AUDIT: role/aria-modal/aria-label all live on the SAME node as the frozen testid shortcuts-overlay', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const view = render(<ShortcutsOverlay platform="windows" />)
    try {
      const dialog = view.container.querySelector('[data-testid="shortcuts-overlay"]')
      expect(dialog, 'frozen testid exists').not.toBeNull()
      expect(dialog?.getAttribute('role'), 'role=dialog on the testid node').toBe('dialog')
      expect(dialog?.getAttribute('aria-modal'), 'aria-modal on the SAME node').toBe('true')
      expect(dialog?.getAttribute('aria-label'), 'accessible name').toBe('Keyboard shortcuts')
    } finally {
      view.unmount()
    }
  })
})

describe('AUDIT SECURITY-03 (REVIEW always-check 1): canary through every keyboard interaction', () => {
  test('SECURITY-03 AUDIT: canary transcript through select-all, overlay open/close, delete, undo, Z-chord and save — zero marker in any console/error channel', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const { app, onSave, unmount } = await mountHarness()
    try {
      simulateChord('Meta+A')
      expect(app.editor.getState().selection.anchorBlockId, 'canary block is IN the selection').toBe('blk_a')
      simulateChord('Meta+/')
      down({ key: 'Escape' })
      app.editor.setSelection({ anchorBlockId: 'blk_b', focusBlockId: 'blk_b' })
      simulateChord('Delete')
      expect(app.history.undoCount(), 'the canary block deletion was a real step').toBe(1)
      simulateChord('Meta+Z')
      expect(app.history.undoCount(), 'undo restored it').toBe(0)
      down({ key: 'z' })
      down({ key: 'ArrowLeft' })
      up({ key: 'z' })
      up({ key: 'ArrowLeft' })
      simulateChord('Meta+S')
      expect(onSave, 'save chord flowed').toHaveBeenCalledTimes(1)
      const verdict = redaction.settle()
      expect(verdict.leaks, 'SECURITY-03: transcript content never reached console/error surfaces').toEqual([])
      expect(verdict.clean).toBe(true)
    } finally {
      redaction.restore()
      unmount()
    }
  })
})
