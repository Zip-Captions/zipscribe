// Command registry — the single keyboard-command surface (design.md § Keyboard
// shortcuts). unit-105 owns the full registry + the table-snapshot test; the
// five bindings below are the unit-101 frozen shell bindings
// (tests/unit/workbench/unit101-api-contract.d.ts § @ui/commands/registry):
// Alt+1/2/3 focus regions, Ctrl+Alt+2/3 Clipchamp-style collapse. Every shell
// binding guards text editing (conventions § UI conventions: shortcuts never
// fire while a text-editing path — the project-name input — has focus).
//
// Components never bind keys themselves (ui/commands/useCommands.ts, unit-105,
// is the only consumer of `dispatchCommand` from the DOM side).

export interface CommandBinding {
  id: string
  /** Normalized chord, e.g. 'Alt+1', 'Ctrl+Alt+2' (design.md shortcut table format). */
  keys: string
  /** Never fire while a text-editing path (project-name input) has focus. */
  when?: 'not-editing'
}

// design.md § Keyboard shortcuts (v1 map) — the complete shell subset
// unit-101 dispatches, PLUS the unit-102 transport subset (slice C):
// Space play/pause, J/L ±5 s (Shift ±10 s), ←/→ ±1 frame, Shift+←/→ ±1 s,
// Y loop toggle, I/O loop in/out from the playhead. Chords match the table.
const SHELL_BINDINGS: readonly CommandBinding[] = [
  { id: 'focus.sidebar', keys: 'Alt+1', when: 'not-editing' },
  { id: 'focus.stage', keys: 'Alt+2', when: 'not-editing' },
  { id: 'focus.timeline', keys: 'Alt+3', when: 'not-editing' },
  { id: 'panels.collapse.sidebar', keys: 'Ctrl+Alt+2', when: 'not-editing' },
  { id: 'panels.collapse.timeline', keys: 'Ctrl+Alt+3', when: 'not-editing' },
  // unit-102 slice C transport bindings (FR-102.5, US-2.2.4 — design.md v1
  // map; unit-105 owns the registry snapshot, the chords here match it).
  { id: 'transport.play-pause', keys: 'Space', when: 'not-editing' },
  { id: 'transport.skip-backward', keys: 'J', when: 'not-editing' },
  { id: 'transport.skip-forward', keys: 'L', when: 'not-editing' },
  { id: 'transport.skip-backward-large', keys: 'Shift+J', when: 'not-editing' },
  { id: 'transport.skip-forward-large', keys: 'Shift+L', when: 'not-editing' },
  { id: 'transport.step-backward', keys: 'ArrowLeft', when: 'not-editing' },
  { id: 'transport.step-forward', keys: 'ArrowRight', when: 'not-editing' },
  { id: 'transport.step-second-backward', keys: 'Shift+ArrowLeft', when: 'not-editing' },
  { id: 'transport.step-second-forward', keys: 'Shift+ArrowRight', when: 'not-editing' },
  { id: 'transport.loop-toggle', keys: 'Y', when: 'not-editing' },
  { id: 'transport.loop-in', keys: 'I', when: 'not-editing' },
  { id: 'transport.loop-out', keys: 'O', when: 'not-editing' },
]

type CommandHandler = () => void

const handlers = new Map<string, CommandHandler>()

export function getCommandBindings(): readonly CommandBinding[] {
  return SHELL_BINDINGS
}

/**
 * Extension beyond the frozen contract (slice-B wiring; unit-105 owns the
 * final registration API): binds the side-effect for a command id. Returns an
 * unsubscribe. Dispatching a known command with no handler is a no-op.
 */
export function registerCommandHandler(id: string, handler: CommandHandler): () => void {
  handlers.set(id, handler)
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id)
  }
}

function isEditing(): boolean {
  // Node (L1) has no DOM — bindings are never "editing" there.
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (active === null) return false
  const element = active as HTMLElement
  return element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
}

/** No-op-safe: unknown ids throw; `when: 'not-editing'` bindings are skipped while editing. */
export function dispatchCommand(id: string): void {
  const binding = SHELL_BINDINGS.find((candidate) => candidate.id === id)
  if (binding === undefined) {
    throw new Error(`unknown command id: ${id}`)
  }
  if (binding.when === 'not-editing' && isEditing()) return
  handlers.get(id)?.()
}
