// The DOM ↔ registry keyboard bridge (design.md § Keyboard shortcuts): the
// ONE place a window keydown is consumed and translated into a
// `dispatchCommand` call. Components never bind keys themselves (conventions
// § UI conventions); the shell installs this once at the app level, so every
// guard (the `not-editing` suppression in registry.ts) applies uniformly.

import { useEffect } from 'react'
import { dispatchCommand, getCommandBindings, registerCommandHandler } from './registry'
import type { SettingsStore } from '../../state/settings'

function chordOf(event: KeyboardEvent): string {
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Meta')
  return [...modifiers, event.key].join('+')
}

function focusRegion(region: 'sidebar' | 'stage' | 'timeline'): void {
  document.querySelector<HTMLElement>(`[data-region="${region}"]`)?.focus()
}

/**
 * Binds the side effects for the unit-101 shell commands (registry ids from
 * the frozen contract) and routes window keydowns through
 * `dispatchCommand`, so the `when: 'not-editing'` guard governs every chord.
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

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat) return
      const chord = chordOf(event)
      const binding = getCommandBindings().find((candidate) => candidate.keys === chord)
      if (binding === undefined) return
      // Table bindings own their chord (design.md: override browser defaults
      // via preventDefault while focus is inside the workbench).
      event.preventDefault()
      dispatchCommand(binding.id)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
  }, [settings])
}
