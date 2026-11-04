// CC-101.5 (L1, jsdom): dispatch semantics behind the frozen registry seam —
// unknown ids throw, known ids without a handler are a safe no-op, registered
// handlers run, and the `not-editing` guard suppresses shell bindings while a
// text-editing path (the project-name input) has focus (conventions § UI
// conventions). Chord presence itself is asserted by the frozen
// tests/unit/workbench/command-registry.test.ts.
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { dispatchCommand, getCommandBindings, registerCommandHandler } from './registry'

function focusTextInput(): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'text'
  document.body.append(input)
  input.focus()
  return input
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('CC-101.5: command dispatch semantics (registry seam)', () => {
  test('CC-101.5: an unknown command id throws — typos never pass silently', () => {
    expect(() => dispatchCommand('no.such.command')).toThrow(/unknown command id/u)
  })

  test('CC-101.5: a known binding without a registered handler is a no-op', () => {
    expect(getCommandBindings().some((binding) => binding.id === 'focus.stage')).toBe(true)
    expect(() => dispatchCommand('focus.stage')).not.toThrow()
  })

  test('CC-101.5: registered handlers run on dispatch and stop on unsubscribe', () => {
    let calls = 0
    const unsubscribe = registerCommandHandler('panels.collapse.timeline', () => {
      calls += 1
    })
    dispatchCommand('panels.collapse.timeline')
    expect(calls).toBe(1)
    unsubscribe()
    dispatchCommand('panels.collapse.timeline')
    expect(calls).toBe(1)
  })

  test('CC-101.5: not-editing guard — shell commands are skipped while the project-name input is edited', () => {
    let calls = 0
    const unsubscribe = registerCommandHandler('focus.stage', () => {
      calls += 1
    })
    const input = focusTextInput()
    dispatchCommand('focus.stage')
    expect(calls, 'Alt+2 must not steal focus from the inline edit').toBe(0)

    input.remove()
    dispatchCommand('focus.stage')
    expect(calls, 'outside the editing path the binding fires').toBe(1)
    unsubscribe()
  })
})
