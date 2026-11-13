// CC-105.2 + US-2.3.1/US-2.3.2 (L2, jsdom): context-aware dispatch THROUGH THE
// DOM SEAM — the shell is mounted the way tests/unit/workbench/keyboard.test.tsx
// mounts it (useCommands is the single window-keydown bridge), handlers are
// registry spies (registerCommandHandler — last-wins, so the spy observes every
// dispatch). Coverage: input/contenteditable suppression except the always-live
// save/undo/overlay trio (US-2.3.2), timeline-focused block commands (S,
// Meta/Ctrl+Shift+M, Z+←), the held-letter chord lifecycle (fires EXACTLY once,
// bare letter never fires on keyup, solo Z fires nothing, arrow after release
// = transport step — unit-102 behaviour must not regress), and the US-2.3.1
// exactly-once sweep over EVERY registry binding.
// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mountWorkbench } from '../workbench/helpers/mount'
import { registerCommandHandler, registerSearchOpenReader } from '@ui/commands/registry'
import { fireChord, fireKey, chordToKeydownEvents } from './helpers/key-event'
import type { KeyEventInit } from './helpers/key-event'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

interface BindingRow {
  id: string
  keys: string
  when?: string
}

async function loadRegistry(): Promise<{ getCommandBindings: () => readonly BindingRow[] }> {
  const registry = (await import('@ui/commands/registry')) as unknown as { getCommandBindings: () => readonly BindingRow[] }
  return { getCommandBindings: registry.getCommandBindings }
}

type Spies = Map<string, () => number>

/** Register a counting spy for every binding id (last-wins over any mounted
 *  panel handler) and return the counters. */
function armSpies(ids: readonly string[]): { spies: Spies; dispose: () => void } {
  const counts = new Map<string, number>()
  const unsubs: Array<() => void> = []
  const spies: Spies = new Map()
  for (const id of new Set(ids)) {
    counts.set(id, 0)
    spies.set(id, () => counts.get(id) ?? 0)
    unsubs.push(
      registerCommandHandler(id, () => {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }),
    )
  }
  return {
    spies,
    dispose: () => {
      for (const off of unsubs) off()
    },
  }
}

function press(init: Parameters<typeof fireKey>[1], type: 'keydown' | 'keyup' = 'keydown'): void {
  act(() => {
    fireKey(window, init, type)
  })
}

function pressChord(keys: string, options: { repeat?: boolean } = {}): void {
  act(() => {
    fireChord(keys, window, options)
  })
}

/** Full key lifecycle for a chord: keydowns → keyups (so held-letter state in
 *  the bridge never leaks between chords). `repeatOnly` fires ONLY the final
 *  keydown with repeat=true — the ignored-event probe. */
function simulateChord(keys: string, options: { repeatOnly?: boolean } = {}): void {
  const events = chordToKeydownEvents(keys)
  if (options.repeatOnly === true) {
    const last = events[events.length - 1] as KeyEventInit
    act(() => {
      fireKey(window, { ...last, repeat: true })
    })
    return
  }
  act(() => {
    for (const init of events) fireKey(window, init)
  })
  act(() => {
    for (const init of events) fireKey(window, init, 'keyup')
  })
}

async function mountShell(): Promise<void> {
  await mountWorkbench({ project: {} })
  // Body focus: no editing surface, no region focus.
  const active = document.activeElement as HTMLElement | null
  active?.blur()
}

function typeInto(element: HTMLElement): void {
  act(() => {
    element.focus()
  })
  expect(document.activeElement, 'the input/contenteditable has DOM focus').toBe(element)
}

beforeEach(async () => {
  await mountShell()
})

afterEach(() => {
  cleanup()
  const active = document.activeElement as HTMLElement | null
  active?.blur()
})

describe('CC-105.2 / US-2.3.2: input focus suppresses app bindings, never save/undo/overlay', () => {
  test('US-2.3.2: in an <input>, S / Delete / ArrowLeft fire NO command', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['timeline.split', 'timeline.delete', 'transport.step-backward'])
    try {
      const input = document.createElement('input')
      document.body.append(input)
      typeInto(input)
      pressChord('S')
      pressChord('Delete')
      pressChord('ArrowLeft')
      press({ key: 'Backspace' })
      expect(spies.get('timeline.split')?.(), 'S stays the user\'s (split suppressed in an input)').toBe(0)
      expect(spies.get('timeline.delete')?.(), 'Delete deletes a character, not a block').toBe(0)
      expect(spies.get('transport.step-backward')?.(), 'arrows move the caret, not the playhead').toBe(0)
      input.remove()
    } finally {
      dispose()
    }
  })

  test('US-2.3.2: in a contenteditable, S / Delete / ArrowLeft fire NO command', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['timeline.split', 'timeline.delete', 'transport.step-backward'])
    try {
      const editor = document.createElement('div')
      editor.setAttribute('contenteditable', 'true')
      editor.setAttribute('tabindex', '0')
      document.body.append(editor)
      typeInto(editor)
      pressChord('S')
      pressChord('Delete')
      pressChord('ArrowLeft')
      expect(spies.get('timeline.split')?.()).toBe(0)
      expect(spies.get('timeline.delete')?.()).toBe(0)
      expect(spies.get('transport.step-backward')?.()).toBe(0)
      editor.remove()
    } finally {
      dispose()
    }
  })

  test('US-2.3.2: Meta+Z / Meta+S / Meta+/ STILL fire while an input has focus (always live)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['edit.undo', 'view.save-snapshot', 'view.shortcuts-overlay'])
    try {
      const input = document.createElement('input')
      document.body.append(input)
      typeInto(input)
      pressChord('Meta+Z')
      pressChord('Meta+S')
      pressChord('Meta+/')
      expect(spies.get('edit.undo')?.(), '⌘Z is always live (design.md rules)').toBe(1)
      expect(spies.get('view.save-snapshot')?.(), '⌘S is always live').toBe(1)
      expect(spies.get('view.shortcuts-overlay')?.(), '⌘/ is always live').toBe(1)
      input.remove()
    } finally {
      dispose()
    }
  })

  test('CC-105.2: the Windows spellings are equally live (Ctrl+Z / Ctrl+S / Ctrl+/)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['edit.undo', 'view.save-snapshot', 'view.shortcuts-overlay'])
    try {
      const textarea = document.createElement('textarea')
      document.body.append(textarea)
      typeInto(textarea)
      pressChord('Ctrl+Z')
      pressChord('Ctrl+S')
      pressChord('Ctrl+/')
      expect(spies.get('edit.undo')?.()).toBe(1)
      expect(spies.get('view.save-snapshot')?.()).toBe(1)
      expect(spies.get('view.shortcuts-overlay')?.()).toBe(1)
      textarea.remove()
    } finally {
      dispose()
    }
  })
})

describe('CC-105.2 / US-2.3.2: timeline-focused block commands', () => {
  function focusTimeline(): HTMLElement {
    const region = document.querySelector<HTMLElement>('[data-region="timeline"]')
    if (region === null) throw new Error('timeline region missing from the mounted shell')
    act(() => {
      region.focus()
    })
    expect(document.activeElement).toBe(region)
    return region
  }

  test('US-2.3.2: S applies to the selection (timeline focused)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['timeline.split'])
    try {
      focusTimeline()
      pressChord('S')
      expect(spies.get('timeline.split')?.(), 'S fires once with the timeline focused').toBe(1)
    } finally {
      dispose()
    }
  })

  test('US-2.3.2: Meta+Shift+M (mac) and Ctrl+Shift+M (win) each fire once', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['timeline.merge', 'timeline.merge-ctrl'])
    try {
      focusTimeline()
      pressChord('Meta+Shift+M')
      pressChord('Ctrl+Shift+M')
      expect(spies.get('timeline.merge')?.(), 'mac spelling hits timeline.merge once').toBe(1)
      expect(spies.get('timeline.merge-ctrl')?.(), 'windows spelling hits timeline.merge-ctrl once').toBe(1)
    } finally {
      dispose()
    }
  })

  test('US-2.3.2: Z+← fires the held-letter chord (timeline focused)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['timeline.trim-start', 'transport.step-backward'])
    try {
      focusTimeline()
      press({ key: 'z' })
      press({ key: 'ArrowLeft' })
      press({ key: 'z' }, 'keyup')
      expect(spies.get('timeline.trim-start')?.(), 'Z+ArrowLeft trims once').toBe(1)
      expect(spies.get('transport.step-backward')?.(), 'the arrow was consumed by the chord').toBe(0)
    } finally {
      dispose()
    }
  })
})

describe('US-2.3.2: held-letter chord lifecycle', () => {
  test('US-2.3.2: Z then ArrowLeft fires the chord EXACTLY once; bare Z never fires (no solo binding)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['timeline.trim-start', 'timeline.trim-end', 'transport.step-backward'])
    try {
      press({ key: 'z' })
      expect(spies.get('timeline.trim-start')?.(), 'Z alone arms the prefix but fires NOTHING').toBe(0)
      press({ key: 'ArrowLeft' })
      expect(spies.get('timeline.trim-start')?.(), 'chord fires exactly once').toBe(1)
      press({ key: 'z' }, 'keyup')
      expect(spies.get('timeline.trim-start')?.(), 'keyup of the letter fires nothing further').toBe(1)
      expect(spies.get('timeline.trim-end')?.()).toBe(0)
      expect(spies.get('transport.step-backward')?.(), 'the chord consumed the arrow').toBe(0)
    } finally {
      dispose()
    }
  })

  test('US-2.3.2: arrow AFTER release is the transport step (unit-102 behaviour un-regressed)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { spies, dispose } = armSpies(['timeline.trim-start', 'transport.step-backward'])
    try {
      press({ key: 'z' })
      press({ key: 'ArrowLeft' })
      press({ key: 'z' }, 'keyup')
      expect(spies.get('transport.step-backward')?.(), 'the first arrow went to the chord').toBe(0)
      press({ key: 'ArrowLeft' })
      expect(spies.get('transport.step-backward')?.(), 'after release ← is transport-step again').toBe(1)
    } finally {
      dispose()
    }
  })
})

describe('US-2.3.1: every registry binding fires EXACTLY ONCE per simulated chord', () => {
  test('US-2.3.1: dispatchKeyEvent sweep — one handler call per binding, repeat ignored, unknown chords inert', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { getCommandBindings } = await loadRegistry()
    const bindings = getCommandBindings()
    // The unit-105 rows must exist before the sweep is meaningful (RED core).
    for (const [id, keys] of [
      ['edit.undo', 'Meta+Z'],
      ['view.save-snapshot', 'Ctrl+S'],
      ['view.shortcuts-overlay', 'Meta+/'],
      ['transcript.deselect', 'Escape'],
    ] as const) {
      expect(bindings.some((row) => row.id === id && row.keys === keys), `binding ${id} "${keys}" exists`).toBe(true)
    }
    const { spies, dispose } = armSpies(bindings.map((row) => row.id))
    const offSearch = registerSearchOpenReader(() => true)
    try {
      for (const binding of bindings) {
        // Context per gate: timeline-focused ⇒ region focused; search-open ⇒
        // reader open; otherwise body focus.
        const region = document.querySelector<HTMLElement>('[data-region="timeline"]')
        const active = document.activeElement as HTMLElement | null
        active?.blur()
        if (binding.when === 'timeline-focused') {
          if (region === null) throw new Error('timeline region missing')
          act(() => {
            region.focus()
          })
        }
        // Zero all counters, then simulate the chord's full key lifecycle.
        const counters = new Map<string, number>()
        for (const id of spies.keys()) counters.set(id, spies.get(id)?.() ?? 0)
        simulateChord(binding.keys)
        expect(spies.get(binding.id)?.(), `${binding.id} "${binding.keys}" (when: ${binding.when ?? 'none'}) fires exactly once`).toBe((counters.get(binding.id) ?? 0) + 1)
        // repeat=true must be ignored (no double-fire).
        simulateChord(binding.keys, { repeatOnly: true })
        expect(spies.get(binding.id)?.(), `${binding.id} "${binding.keys}" repeat ignored`).toBe((counters.get(binding.id) ?? 0) + 1)
      }
      // Unknown chord: total silence.
      const before = [...spies.values()].reduce((sum, read) => sum + read(), 0)
      pressChord('F8')
      press({ key: 'F8' })
      press({ key: 'k' })
      const after = [...spies.values()].reduce((sum, read) => sum + read(), 0)
      expect(after, 'unknown chords hit nothing').toBe(before)
    } finally {
      offSearch()
      dispose()
    }
  })
})
