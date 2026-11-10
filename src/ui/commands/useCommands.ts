// The DOM ↔ registry keyboard bridge (design.md § Keyboard shortcuts): the
// ONE place a window keydown is consumed and translated into a
// `dispatchCommand` call. Components never bind keys themselves (conventions
// § UI conventions); the shell installs this once at the app level, so every
// guard (the `not-editing` / `timeline-focused` suppression in registry.ts)
// applies uniformly.
//
// unit-103 EXTENDS (frozen in tests/unit/timeline/unit103-api-contract.d.ts):
//  * held-letter chords — Z/C are tracked on keydown/keyup and prefix the
//    arrow keys into 'Z+ArrowLeft'-style chords (design.md: "held-letter
//    chord; registry must support it" — Clipchamp trim keys);
//  * `when: 'timeline-focused'` bindings are resolved BEFORE the global
//    transport arrows while the timeline region has DOM focus (FR-103.7);
//  * modifier order normalized to `Meta+Ctrl+Alt+Shift+…` — the design.md /
//    frozen-binding spelling ('Meta+Shift+M', 'Ctrl+Shift+M', 'Ctrl+Alt+2').

import { useEffect } from 'react'
import { dispatchCommand, getCommandBindings, isEditing, isTimelineFocused, registerCommandHandler } from './registry'
import type { CommandBinding } from './registry'
import type { SettingsStore } from '../../state/settings'

/** The letters that prefix arrow-key chords while held (design.md Z/C trim). */
const HELD_LETTERS: ReadonlySet<string> = new Set(['Z', 'C'])

function keyNameOf(event: KeyboardEvent): string {
  // design.md writes the play/pause chord as `Space` (DOM key ' ') and letter
  // keys canonically uppercase (`J`, `Y` — DOM key is the typed case); named
  // keys (`ArrowLeft`) keep their DOM spelling.
  return event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key
}

function chordOf(event: KeyboardEvent, heldLetters: ReadonlySet<string>): string {
  const key = keyNameOf(event)
  // Held-letter prefix only for the arrow keys, Z winning over C.
  let base = key
  if (event.key.startsWith('Arrow')) {
    const letter = heldLetters.has('Z') ? 'Z' : heldLetters.has('C') ? 'C' : null
    if (letter !== null) base = `${letter}+${key}`
  }
  const modifiers: string[] = []
  if (event.metaKey) modifiers.push('Meta')
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  return [...modifiers, base].join('+')
}

/** Frozen-chord spelling is Meta,Ctrl,Alt,Shift — gate rows win over globals ONLY while their gate is open. */
function resolveBinding(chord: string): CommandBinding | undefined {
  const candidates = getCommandBindings().filter((candidate) => candidate.keys === chord)
  const gateActive = isTimelineFocused()
  if (gateActive) {
    const gated = candidates.find((candidate) => candidate.when === 'timeline-focused')
    if (gated !== undefined) return gated
  }
  return candidates.find((candidate) => candidate.when !== 'timeline-focused')
}

function focusRegion(region: 'sidebar' | 'stage' | 'timeline'): void {
  document.querySelector<HTMLElement>(`[data-region="${region}"]`)?.focus()
}

/**
 * Binds the side effects for the unit-101 shell commands (registry ids from
 * the frozen contract) and routes window keydowns through
 * `dispatchCommand`, so the `when` gates govern every chord.
 */
export function useCommands(settings: SettingsStore): void {
  useEffect(() => {
    const unsubscribes = [
      registerCommandHandler('focus.sidebar', () => {
        focusRegion('sidebar')
      }),
      registerCommandHandler('focus.stage', () => {
        focusRegion('stage')
      }),
      registerCommandHandler('focus.timeline', () => {
        focusRegion('timeline')
      }),
      registerCommandHandler('panels.collapse.sidebar', () => {
        settings.toggleCollapsed('sidebar')
      }),
      registerCommandHandler('panels.collapse.timeline', () => {
        settings.toggleCollapsed('timeline')
      }),
    ]

    const heldLetters = new Set<string>()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      const letter = event.key.length === 1 && /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : null
      // Typing a letter INTO a text-editing path never arms a chord prefix
      // (conventions § UI conventions: shortcuts never bind while editing).
      if (letter !== null && !isEditing()) {
        if (HELD_LETTERS.has(letter)) heldLetters.add(letter)
        else heldLetters.delete(letter)
      }
      const binding = resolveBinding(chordOf(event, heldLetters))
      if (binding === undefined) return
      // design.md § Keyboard shortcuts: timeline bindings are NEVER bound while
      // a text-editing path has focus (save/undo/overlay are not timeline.* —
      // they keep flowing through the registry `when` gates). The doctrine is
      // enforced HERE, at the dispatch layer, so the frozen binding table keeps
      // its exact when-fields; the key (and its caret/typing default) is left
      // to the editing surface.
      if (isEditing() && binding.id.startsWith('timeline.')) return
      // Table bindings own their chord (design.md: override browser defaults
      // via preventDefault while focus is inside the workbench).
      event.preventDefault()
      dispatchCommand(binding.id)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key.length === 1) heldLetters.delete(event.key.toUpperCase())
    }

    const onBlur = (): void => {
      heldLetters.clear()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [settings])
}
