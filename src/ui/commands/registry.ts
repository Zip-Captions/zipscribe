// Command registry — the single keyboard-command surface (design.md § Keyboard
// shortcuts). unit-105 owns the full registry + the table-snapshot test; the
// five bindings below are the unit-101 frozen shell bindings
// (tests/unit/workbench/unit101-api-contract.d.ts § @ui/commands/registry):
// Alt+1/2/3 focus regions, Ctrl+Alt+2/3 Clipchamp-style collapse. Every shell
// binding guards text editing (conventions § UI conventions: shortcuts never
// fire while a text-editing path — the project-name input — has focus).
//
// unit-103 EXTENDS (frozen in tests/unit/timeline/unit103-api-contract.d.ts §
// Registry EXTENDS): the timeline bindings with their exact frozen ids/chords,
// plus the `when: 'timeline-focused'` gate — the frozen EXTENSION of the
// `when?: 'not-editing'` field, checked BEFORE the global transport arrows so
// FR-103.7's focus model wins while the timeline region has focus. Handlers
// are owned by the mounted Timeline panel (unit-102 MAJOR-5 /
// useTransportCommands precedent); unit-105 owns the full-table snapshot.
//
// Components never bind keys themselves (ui/commands/useCommands.ts is the
// only consumer of `dispatchCommand` from the DOM side).

export interface CommandBinding {
  id: string
  /** Normalized chord, e.g. 'Alt+1', 'Ctrl+Alt+2', 'Z+ArrowLeft' (design.md shortcut table format). */
  keys: string
  /** Gate: never fire while a text-editing path (project-name input) has focus; or (unit-103) only while the timeline region has DOM focus. */
  when?: 'not-editing' | 'timeline-focused'
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

// unit-103 frozen EXTENDS table (ids/chords byte-exact per
// unit103-api-contract.d.ts; design.md § Keyboard shortcuts — the Z/C held-
// letter chords are Clipchamp-verified and useCommands tracks the held
// prefix). trim-start/trim-end carry NO gate (frozen rows list none); the
// focus model rows gate on the timeline region having DOM focus and are
// resolved BEFORE the transport arrows (useCommands priority + this gate).
const TIMELINE_BINDINGS: readonly CommandBinding[] = [
  { id: 'timeline.split', keys: 'S', when: 'not-editing' },
  { id: 'timeline.merge', keys: 'Meta+Shift+M', when: 'not-editing' },
  { id: 'timeline.merge-ctrl', keys: 'Ctrl+Shift+M', when: 'not-editing' },
  { id: 'timeline.trim-start', keys: 'Z+ArrowLeft' },
  { id: 'timeline.trim-start', keys: 'Z+ArrowRight' },
  { id: 'timeline.trim-end', keys: 'C+ArrowLeft' },
  { id: 'timeline.trim-end', keys: 'C+ArrowRight' },
  { id: 'timeline.zoom-in', keys: 'Meta+=', when: 'not-editing' },
  { id: 'timeline.zoom-in', keys: 'Ctrl+=', when: 'not-editing' },
  { id: 'timeline.zoom-out', keys: 'Meta+-', when: 'not-editing' },
  { id: 'timeline.zoom-out', keys: 'Ctrl+-', when: 'not-editing' },
  { id: 'timeline.zoom-fit', keys: 'Meta+0', when: 'not-editing' },
  { id: 'timeline.zoom-fit', keys: 'Ctrl+0', when: 'not-editing' },
  { id: 'timeline.focus-next', keys: 'ArrowRight', when: 'timeline-focused' },
  { id: 'timeline.focus-prev', keys: 'ArrowLeft', when: 'timeline-focused' },
  { id: 'timeline.select', keys: 'Enter', when: 'timeline-focused' },
]

const ALL_BINDINGS: readonly CommandBinding[] = [...SHELL_BINDINGS, ...TIMELINE_BINDINGS]

type CommandHandler = () => void

const handlers = new Map<string, CommandHandler>()

export function getCommandBindings(): readonly CommandBinding[] {
  return ALL_BINDINGS
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

/** Node (L1) has no DOM — no editing, no focused region there. */
export function isEditing(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (active === null) return false
  const element = active as HTMLElement
  return element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
}

/** The unit-103 gate: DOM focus is inside a `data-region="timeline"` element (the timeline panel root or anything it nests). */
export function isTimelineFocused(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (active === null) return false
  return active.closest('[data-region="timeline"]') !== null
}

/** No-op-safe: unknown ids throw; gated bindings are skipped while their gate is closed. */
export function dispatchCommand(id: string): void {
  const binding = ALL_BINDINGS.find((candidate) => candidate.id === id)
  if (binding === undefined) {
    throw new Error(`unknown command id: ${id}`)
  }
  if (binding.when === 'not-editing' && isEditing()) return
  if (binding.when === 'timeline-focused' && !isTimelineFocused()) return
  handlers.get(id)?.()
}
