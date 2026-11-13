// unit-105 AUDIT — adversarial counterexample suite, chord lifecycle and
// suppression bypasses (test-adversary, fresh-session re-derivation from
// .ai-dlc/caption-studio-ui/unit-105-command-system.md US-2.3.1/US-2.3.2,
// knowledge/design.md § Keyboard shortcuts rules, .agent/REVIEW.md
// always-check 1/11). ADDITIVE ONLY: src/** untouched, frozen suites untouched.
// Attacks the gaps the frozen dispatch-suppression suite leaves open: Z+C
// simultaneous hold (frozen rule: Z wins), modifier pressed AFTER the letter,
// window blur during a hold, keyup while focus moved, defaultPrevented events,
// 'z' typed INTO an input never arming the prefix, held-Z + input focus
// suppression, contenteditable="false" / <select> isEditing probes, and the
// both-gates precedence attack (editable nested INSIDE the timeline region).
// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mountWorkbench } from '../../workbench/helpers/mount'
import { isEditing, registerCommandHandler } from '@ui/commands/registry'
import { chordToKeydownEvents, fireKey } from '../helpers/key-event'
import type { KeyEventInit } from '../helpers/key-event'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

interface Spies {
  read: (id: string) => number
  dispose: () => void
}

/** Counting handlers for the ids under attack (last-wins over any mounted
 *  panel handler — same doctrine as the frozen dispatch-suppression spies). */
function armSpies(ids: readonly string[]): Spies {
  const counts = new Map<string, number>()
  const unsubs: Array<() => void> = []
  for (const id of new Set(ids)) {
    counts.set(id, 0)
    unsubs.push(
      registerCommandHandler(id, () => {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }),
    )
  }
  return {
    read: (id) => counts.get(id) ?? 0,
    dispose: () => {
      for (const off of unsubs) off()
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

/** Full lifecycle of a registry chord: keydowns then keyups (held-letter
 *  state in the bridge never leaks between chords). */
function simulateChord(keys: string): void {
  const events = chordToKeydownEvents(keys)
  down(events[0] as KeyEventInit)
  for (const init of events.slice(1)) down(init)
  for (const init of events) up(init)
}

function focusElement(element: HTMLElement): void {
  act(() => {
    element.focus()
  })
  expect(document.activeElement, 'the element has DOM focus').toBe(element)
}

function blurActive(): void {
  const active = document.activeElement as HTMLElement | null
  act(() => {
    active?.blur()
  })
}

beforeEach(async () => {
  await mountWorkbench({ project: {} })
  blurActive()
})

afterEach(() => {
  cleanup()
  blurActive()
  document.body.replaceChildren()
})

describe('AUDIT chord lifecycle: simultaneous holds, late modifiers, blur, focus moves', () => {
  test('CC-105.2 AUDIT: Z+C held simultaneously — Z wins over C on the arrow; releasing Z re-arms C (held-set semantics)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.trim-start', 'timeline.trim-end', 'transport.step-backward', 'transport.step-forward'])
    try {
      down({ key: 'z' })
      down({ key: 'c' })
      const arrow = down({ key: 'ArrowLeft' })
      expect(spies.read('timeline.trim-start'), 'Z wins over C: the chord is Z+ArrowLeft').toBe(1)
      expect(spies.read('timeline.trim-end'), 'C+ArrowLeft never fires while Z is held').toBe(0)
      expect(spies.read('transport.step-backward'), 'the chord consumed the arrow').toBe(0)
      expect(arrow.defaultPrevented, 'the bridge owns the chord keystroke').toBe(true)
      up({ key: 'z' })
      down({ key: 'ArrowRight' })
      expect(spies.read('timeline.trim-end'), 'C is still held after Z released → C+ArrowRight trims end').toBe(1)
      expect(spies.read('transport.step-forward'), 'the still-held C keeps owning the arrow').toBe(0)
      up({ key: 'c' })
      down({ key: 'ArrowRight' })
      expect(spies.read('transport.step-forward'), 'both released → plain transport step').toBe(1)
    } finally {
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: modifier pressed AFTER the letter — Shift+arrow while Z is held matches NO binding (no trim, no 1-second step)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.trim-start', 'transport.step-backward', 'transport.step-second-backward'])
    try {
      down({ key: 'z' })
      down({ key: 'Shift' })
      const arrow = down({ key: 'ArrowLeft', shiftKey: true })
      expect(spies.read('timeline.trim-start'), 'Shift+Z+ArrowLeft is not the frozen Z+← chord').toBe(0)
      expect(spies.read('transport.step-second-backward'), 'the chord also does not silently degrade to Shift+← (that would trim-then-seek the user never asked for)').toBe(0)
      expect(spies.read('transport.step-backward')).toBe(0)
      expect(arrow.defaultPrevented, 'an unmatched chord leaves the keystroke alone').toBe(false)
      up({ key: 'Shift' })
      up({ key: 'z' })
      down({ key: 'ArrowLeft', shiftKey: true })
      expect(spies.read('transport.step-second-backward'), 'control: released Z → Shift+← is the 1-second step').toBe(1)
    } finally {
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: window blur during a hold clears the prefix — the next arrow is the plain transport step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.trim-start', 'transport.step-backward'])
    try {
      down({ key: 'z' })
      act(() => {
        window.dispatchEvent(new Event('blur'))
      })
      down({ key: 'ArrowLeft' })
      expect(spies.read('timeline.trim-start'), 'the blur dropped the held Z (window blur handler)').toBe(0)
      expect(spies.read('transport.step-backward'), 'arrow after blur = plain transport step').toBe(1)
    } finally {
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: keyup delivered while focus moved to an input still clears the held letter (window listener, bubbles)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.trim-start', 'transport.step-backward'])
    try {
      down({ key: 'z' })
      const input = document.createElement('input')
      document.body.append(input)
      focusElement(input)
      act(() => {
        fireKey(input, { key: 'z' }, 'keyup')
      })
      blurActive()
      down({ key: 'ArrowLeft' })
      expect(spies.read('timeline.trim-start'), 'the letter released (keyup bubbled to the bridge) → no trim').toBe(0)
      expect(spies.read('transport.step-backward'), 'arrow after release = transport step').toBe(1)
    } finally {
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: a defaultPrevented keydown is never re-dispatched as a command (positive control in the same test)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['transport.skip-backward'])
    const swallower = document.createElement('div')
    document.body.append(swallower)
    const eat = (event: Event): void => {
      event.preventDefault()
    }
    swallower.addEventListener('keydown', eat)
    try {
      act(() => {
        fireKey(swallower, { key: 'j' })
      })
      expect(spies.read('transport.skip-backward'), 'a keydown already consumed upstream is ignored by the bridge').toBe(0)
      down({ key: 'j' })
      expect(spies.read('transport.skip-backward'), 'control: the same key unrepressed fires once').toBe(1)
    } finally {
      swallower.removeEventListener('keydown', eat)
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: typing z INTO an input never arms the chord prefix — a later arrow is the plain transport step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.trim-start', 'transport.step-backward'])
    try {
      const input = document.createElement('input')
      document.body.append(input)
      focusElement(input)
      down({ key: 'z' })
      down({ key: 'z' })
      blurActive()
      down({ key: 'ArrowLeft' })
      expect(spies.read('timeline.trim-start'), 'typing z is typing, not chord arming (conventions § UI conventions)').toBe(0)
      expect(spies.read('transport.step-backward'), 'the arrow reaches transport untouched').toBe(1)
    } finally {
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: Z held → focus an input → arrow is suppressed by BOTH the chord gate and editing — no trim, no preventDefault (caret preserved)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.trim-start', 'transport.step-backward'])
    try {
      down({ key: 'z' })
      const input = document.createElement('input')
      document.body.append(input)
      focusElement(input)
      let arrow!: KeyboardEvent
      act(() => {
        arrow = fireKey(input, { key: 'ArrowLeft' })
      })
      expect(arrow.defaultPrevented, 'the editing surface keeps the keystroke (registry would dispatch the UNGATED trim row)').toBe(false)
      expect(spies.read('timeline.trim-start'), 'timeline.* is suppressed while editing even though the row carries no gate').toBe(0)
      expect(spies.read('transport.step-backward')).toBe(0)
      up({ key: 'z' })
    } finally {
      spies.dispose()
    }
  })
})

describe('AUDIT suppression bypasses: contenteditable=false, <select>, editable inside the timeline region', () => {
  test('CC-105.2 AUDIT: isEditing() direct — contenteditable="false" is NOT editing, <select> IS (registry attribute check contract)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const plain = document.createElement('div')
    plain.setAttribute('contenteditable', 'false')
    plain.setAttribute('tabindex', '0')
    document.body.append(plain)
    focusElement(plain)
    expect(isEditing(), 'contenteditable="false" → false (the !== null && !== "false" check)').toBe(false)
    const select = document.createElement('select')
    select.append(document.createElement('option'))
    document.body.append(select)
    focusElement(select)
    expect(isEditing(), 'a focused <select> is an editing path').toBe(true)
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.setAttribute('tabindex', '0')
    document.body.append(editor)
    focusElement(editor)
    expect(isEditing(), 'contenteditable="true" → true').toBe(true)
  })

  test('CC-105.2 AUDIT: contenteditable="false" focused is not an editing surface — S splits and Delete deletes (attribute check, not just tag)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.split', 'timeline.delete'])
    try {
      const block = document.createElement('div')
      block.setAttribute('contenteditable', 'false')
      block.setAttribute('tabindex', '0')
      document.body.append(block)
      focusElement(block)
      simulateChord('S')
      expect(spies.read('timeline.split'), 'a non-editable contenteditable="false" does not suppress bindings').toBe(1)
      simulateChord('Delete')
      expect(spies.read('timeline.delete'), 'Delete acts on the selection, not the "editing" surface').toBe(1)
      const editor = document.createElement('div')
      editor.setAttribute('contenteditable', 'true')
      editor.setAttribute('tabindex', '0')
      document.body.append(editor)
      focusElement(editor)
      simulateChord('S')
      expect(spies.read('timeline.split'), 'control: a real contenteditable still suppresses S').toBe(1)
    } finally {
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: <select> focused — Delete/Backspace must not delete a block and J does not skip', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.delete', 'transport.skip-backward'])
    try {
      const select = document.createElement('select')
      for (const label of ['one', 'two']) {
        const option = document.createElement('option')
        option.textContent = label
        select.append(option)
      }
      document.body.append(select)
      focusElement(select)
      simulateChord('Delete')
      simulateChord('Backspace')
      expect(spies.read('timeline.delete'), 'select typeahead owns Delete/Backspace, not block delete').toBe(0)
      simulateChord('J')
      expect(spies.read('transport.skip-backward'), 'letters type the select, they do not skip').toBe(0)
    } finally {
      spies.dispose()
    }
  })

  test('CC-105.2 AUDIT: editable nested INSIDE the timeline region — both gates apply (S must not split, arrows keep the caret)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const spies = armSpies(['timeline.split', 'timeline.focus-prev', 'timeline.select', 'transport.step-backward'])
    try {
      const region = document.querySelector<HTMLElement>('[data-region="timeline"]')
      if (region === null) throw new Error('timeline region missing from the mounted shell')
      const editor = document.createElement('div')
      editor.setAttribute('contenteditable', 'true')
      editor.setAttribute('tabindex', '0')
      region.append(editor)
      focusElement(editor)
      simulateChord('S')
      expect(spies.read('timeline.split'), 'timeline-focused AND editing → S types, never splits (precedence attack)').toBe(0)
      const arrow = down({ key: 'ArrowLeft' })
      expect(spies.read('timeline.focus-prev'), 'the gated timeline row does not steal the caret').toBe(0)
      expect(spies.read('transport.step-backward'), 'nor does the transport row').toBe(0)
      expect(arrow.defaultPrevented, 'the caret stays with the editor').toBe(false)
      simulateChord('Enter')
      expect(spies.read('timeline.select'), 'Enter confirms the edit, it does not toggle selection').toBe(0)
    } finally {
      spies.dispose()
    }
  })
})
