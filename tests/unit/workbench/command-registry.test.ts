// CC-101.5 (L1, node): keyboard handling is asserted AT THE REGISTRY SEAM —
// the shell's bindings must exist with the exact chords from the design.md
// shortcut table (Focus panels `Alt+1/2/3`, collapse `Ctrl+Alt+2/3`), and
// every shell binding carries the `not-editing` guard (conventions § UI
// conventions: shortcuts "never bound during contenteditable focus except
// save/undo/overlay" — none of those three is a shell binding).
//
// unit-105 owns the registry implementation and its full-table snapshot test;
// unit-101 freezes + verifies only the five bindings its shell dispatches.
import { describe, expect, test } from 'vitest'
import { getCommandBindings } from '@ui/commands/registry'

const SHELL_BINDINGS: { id: string; keys: string }[] = [
  { id: 'focus.sidebar', keys: 'Alt+1' },
  { id: 'focus.stage', keys: 'Alt+2' },
  { id: 'focus.timeline', keys: 'Alt+3' },
  { id: 'panels.collapse.sidebar', keys: 'Ctrl+Alt+2' },
  { id: 'panels.collapse.timeline', keys: 'Ctrl+Alt+3' },
]

describe('CC-101.5: the command registry carries the shell bindings (design.md shortcut table)', () => {
  test('CC-101.5: Alt+1/2/3 focus-region and Ctrl+Alt+2/3 collapse bindings exist with the table chords', () => {
    const bindings = getCommandBindings()
    for (const { id, keys } of SHELL_BINDINGS) {
      const binding = bindings.find((candidate) => candidate.id === id)
      expect(binding, `registry binding "${id}" (FR-2.0.1 / US-2.0.1)`).toBeDefined()
      expect(binding?.keys, `"${id}" chord matches design.md`).toBe(keys)
    }
  })

  test('CC-101.5: every shell binding guards text editing (when: not-editing)', () => {
    const bindings = getCommandBindings()
    for (const { id } of SHELL_BINDINGS) {
      expect(bindings.find((candidate) => candidate.id === id)?.when, `"${id}" is suppressed while the project-name input is edited`).toBe('not-editing')
    }
  })
})
