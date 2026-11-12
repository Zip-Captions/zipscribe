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
// unit-104 EXTENDS (frozen in tests/unit/transcript/unit104-api-contract.d.ts
// § Registry EXTENDS): the transcript search/QC bindings with the additive
// `when: 'search-open'` gate (design.md: F3/⌘G fire "with search open").
// Handlers are owned by the mounted Transcript panel (unit-103 Timeline /
// useTransportCommands precedent).
//
// unit-105 EXTENDS (frozen in tests/unit/commands/unit105-api-contract.d.ts +
// unit105-registry-augmentation.d.ts): the complete design-table binding set
// (transport seek/loop-clear, timeline delete/close-gap, transcript select,
// the always-live save/undo/overlay trio WITHOUT a `when` gate, captions
// toggle, shortcuts overlay, translate cycle-view with its unit-302 handler
// intentionally absent — dispatch of an unhandled id is the established
// no-op) plus the registration surface (registerBinding/createRegistry with
// dev-mode conflict detection and the reserved-chord rejection) and the
// FR-105.6 palette/docs catalog. Chord validation goes through
// './keyspec' (single grammar, CC-105.3).
//
// Components never bind keys themselves (ui/commands/useCommands.ts is the
// only consumer of `dispatchCommand` from the DOM side).

import { CommandKeyError, parseKeySpec } from './keyspec'

export interface CommandBinding {
  id: string
  /** Normalized chord, e.g. 'Alt+1', 'Ctrl+Alt+2', 'Z+ArrowLeft' (design.md shortcut table format). */
  keys: string
  /** Gate: never fire while a text-editing path (project-name input) has focus; (unit-103) only while the timeline region has DOM focus; (unit-104) only while the transcript search is open (design.md "with search open"). */
  when?: 'not-editing' | 'timeline-focused' | 'search-open'
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

// unit-104 frozen EXTENDS table (ids/chords/gates byte-exact per
// tests/unit/transcript/unit104-api-contract.d.ts § Registry EXTENDS;
// src/state/CONTRACT.md § binding EXTENSION; design.md § Keyboard shortcuts
// rows ⌘F, F3/⌘G/⌘⇧G "with search open", ⌘'/⌘⇧'). The quote chords carry
// the KeyboardEvent.key token "'" written Meta+' / Meta+Shift+' (useCommands
// passes single-char keys through uppercased, which is identity for "'").
// `Shift+Delete` (close-gap delete) stays unit-105 (FR-104.7).
const UNIT_104_BINDINGS: readonly CommandBinding[] = [
  { id: 'transcript.search-open', keys: 'Meta+F', when: 'not-editing' },
  { id: 'transcript.search-open', keys: 'Ctrl+F', when: 'not-editing' },
  { id: 'search.next', keys: 'F3', when: 'search-open' },
  { id: 'search.next', keys: 'Meta+G', when: 'search-open' },
  { id: 'search.next', keys: 'Ctrl+G', when: 'search-open' },
  { id: 'search.previous', keys: 'Shift+F3', when: 'search-open' },
  { id: 'search.previous', keys: 'Meta+Shift+G', when: 'search-open' },
  { id: 'search.previous', keys: 'Ctrl+Shift+G', when: 'search-open' },
  { id: 'qc.next-issue', keys: "Meta+'", when: 'not-editing' },
  { id: 'qc.previous-issue', keys: "Meta+Shift+'", when: 'not-editing' },
]

// unit-105 design-table completion (frozen rows in
// unit105-api-contract.d.ts; CC-105.1 snapshot). The always-live trio
// (edit.undo/edit.redo/view.save-snapshot/view.shortcuts-overlay — design.md
// "never bound during contenteditable focus EXCEPT save/undo/overlay")
// carries NO `when` gate; everything else gates as the table freezes.
// translate.cycle-view's handler arrives with unit-302 (no-op dispatch
// precedent, registry.ts dispatchCommand). The qc rows ADD the Ctrl
// spellings to the frozen unit-104 Meta+' rows.
const UNIT_105_BINDINGS: readonly CommandBinding[] = [
  { id: 'transport.seek-start', keys: 'Meta+ArrowLeft', when: 'not-editing' },
  { id: 'transport.seek-start', keys: 'Ctrl+ArrowLeft', when: 'not-editing' },
  { id: 'transport.seek-start', keys: 'Home', when: 'not-editing' },
  { id: 'transport.seek-end', keys: 'Meta+ArrowRight', when: 'not-editing' },
  { id: 'transport.seek-end', keys: 'Ctrl+ArrowRight', when: 'not-editing' },
  { id: 'transport.seek-end', keys: 'End', when: 'not-editing' },
  { id: 'transport.loop-clear', keys: 'Shift+I', when: 'not-editing' },
  { id: 'transport.loop-clear', keys: 'Shift+O', when: 'not-editing' },
  { id: 'timeline.delete', keys: 'Delete', when: 'not-editing' },
  { id: 'timeline.delete', keys: 'Backspace', when: 'not-editing' },
  { id: 'timeline.delete-close-gap', keys: 'Shift+Delete', when: 'not-editing' },
  { id: 'transcript.select-all', keys: 'Meta+A', when: 'not-editing' },
  { id: 'transcript.select-all', keys: 'Ctrl+A', when: 'not-editing' },
  { id: 'transcript.deselect', keys: 'Escape', when: 'not-editing' },
  { id: 'edit.undo', keys: 'Meta+Z' },
  { id: 'edit.undo', keys: 'Ctrl+Z' },
  { id: 'edit.redo', keys: 'Meta+Shift+Z' },
  { id: 'edit.redo', keys: 'Ctrl+Shift+Z' },
  { id: 'edit.redo', keys: 'Meta+Y' },
  { id: 'edit.redo', keys: 'Ctrl+Y' },
  { id: 'view.save-snapshot', keys: 'Meta+S' },
  { id: 'view.save-snapshot', keys: 'Ctrl+S' },
  { id: 'view.captions-toggle', keys: 'Meta+\\', when: 'not-editing' },
  { id: 'view.captions-toggle', keys: 'Ctrl+\\', when: 'not-editing' },
  { id: 'view.shortcuts-overlay', keys: 'Meta+/' },
  { id: 'view.shortcuts-overlay', keys: 'Ctrl+/' },
  { id: 'translate.cycle-view', keys: 'Meta+Shift+L', when: 'not-editing' },
  { id: 'translate.cycle-view', keys: 'Ctrl+Shift+L', when: 'not-editing' },
  { id: 'qc.next-issue', keys: "Ctrl+'", when: 'not-editing' },
  { id: 'qc.previous-issue', keys: "Ctrl+Shift+'", when: 'not-editing' },
]

const ALL_BINDINGS: readonly CommandBinding[] = [...SHELL_BINDINGS, ...TIMELINE_BINDINGS, ...UNIT_104_BINDINGS, ...UNIT_105_BINDINGS]

type CommandHandler = () => void

const handlers = new Map<string, CommandHandler>()

type BindingRecord = { id: string; keys: string; when?: string }

type BindingScope = 'global' | 'panel'

interface RuntimeEntry {
  readonly binding: CommandBinding
  readonly scope: BindingScope
}

const runtimeEntries: RuntimeEntry[] = []

const WHEN_VALUES: ReadonlySet<string> = new Set(['not-editing', 'timeline-focused', 'search-open'])

function toCommandBinding(binding: BindingRecord): CommandBinding {
  const when = binding.when !== undefined && WHEN_VALUES.has(binding.when) ? (binding.when as CommandBinding['when']) : undefined
  return when === undefined ? { id: binding.id, keys: binding.keys } : { id: binding.id, keys: binding.keys, when }
}

function assertChordRegistrable(keys: string): void {
  // Reserved detection is platform-qualified (a CmdOrCtrl row resolves to the
  // macOS-reserved ⌘ form on mac) — reject when either resolution is reserved.
  for (const platform of ['mac', 'windows'] as const) parseKeySpec(keys, platform)
}

interface ScopeEntry {
  readonly binding: BindingRecord
  readonly scope: BindingScope
}

function hasConflict(entries: readonly ScopeEntry[], binding: BindingRecord, scope: BindingScope): boolean {
  return entries.some((entry) => (entry.binding.id === binding.id && entry.binding.keys === binding.keys) || (entry.binding.id !== binding.id && entry.binding.keys === binding.keys && entry.scope === scope))
}

function frozenAsEntries(): ScopeEntry[] {
  return ALL_BINDINGS.map((binding) => ({ binding, scope: 'global' as const }))
}

export function getCommandBindings(): readonly CommandBinding[] {
  return runtimeEntries.length === 0 ? ALL_BINDINGS : [...ALL_BINDINGS, ...runtimeEntries.map((entry) => entry.binding)]
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

// The unit-104 `search-open` gate: the truth is `editor.searchOpen`, which
// lives in the app store the registry cannot see — the mounted Transcript
// panel registers the reader here (registerCommandHandler precedent: an
// extension beyond the frozen contract, unit-105 owns the final API). No
// reader mounted ⇒ the gate is CLOSED (the F3/⌘G rows are inert without a
// transcript panel, and no handler would exist anyway).
let searchOpenReader: (() => boolean) | null = null

export function registerSearchOpenReader(read: () => boolean): () => void {
  const previous = searchOpenReader
  searchOpenReader = read
  return () => {
    if (searchOpenReader === read) searchOpenReader = previous
  }
}

export function isSearchOpen(): boolean {
  return searchOpenReader !== null && searchOpenReader()
}

/** No-op-safe: unknown ids throw; gated bindings are skipped while their gate is closed. */
export function dispatchCommand(id: string): void {
  const binding = getCommandBindings().find((candidate) => candidate.id === id)
  if (binding === undefined) {
    throw new Error(`unknown command id: ${id}`)
  }
  if (binding.when === 'not-editing' && isEditing()) return
  if (binding.when === 'timeline-focused' && !isTimelineFocused()) return
  if (binding.when === 'search-open' && !isSearchOpen()) return
  handlers.get(id)?.()
}

interface RegisterOptions {
  dev?: boolean
  scope?: BindingScope
}

/** FR-105.1 registration-time API (frozen in unit105-registry-augmentation.d.ts).
 *  Dev mode rejects (id, keys) duplicates and same-scope duplicate chords with
 *  the typed DUPLICATE_BINDING code; browser-reserved chords are rejected in
 *  every mode (BROWSER_RESERVED); prod relies on the resolver precedence
 *  (focused-panel scope > global, gated rows before ungated). */
export function registerBinding(binding: BindingRecord, options?: RegisterOptions): void {
  assertChordRegistrable(binding.keys)
  const scope: BindingScope = options?.scope ?? 'global'
  const dev = options?.dev ?? true
  if (dev && hasConflict([...frozenAsEntries(), ...runtimeEntries], binding, scope)) throw new CommandKeyError('DUPLICATE_BINDING')
  runtimeEntries.push({ binding: toCommandBinding(binding), scope })
}

interface ResolveContext {
  timelineFocused?: boolean
  searchOpen?: boolean
  editing?: boolean
}

function gateOpen(when: string | undefined, ctx: { timelineFocused: boolean; searchOpen: boolean; editing: boolean }): boolean {
  if (when === 'timeline-focused') return ctx.timelineFocused
  if (when === 'search-open') return ctx.searchOpen
  if (when === 'not-editing') return !ctx.editing
  return true
}

// Frozen resolver precedence (unit105-registry-augmentation.d.ts):
// focused-panel scope > global, then open-gate timeline-focused > open-gate
// search-open > not-editing (while not editing) > ungated.
function precedenceRank(entry: { binding: BindingRecord; scope: BindingScope }): number {
  const scopeRank = entry.scope === 'panel' ? 0 : 10
  const when = entry.binding.when
  const gateRank = when === 'timeline-focused' ? 0 : when === 'search-open' ? 1 : when === 'not-editing' ? 2 : 3
  return scopeRank + gateRank
}

/** Isolated registry instance for the conflict/precedence suites — no
 *  global-registry state (CC-105.5, L1). */
export function createRegistry(options?: { dev?: boolean }) {
  const dev = options?.dev ?? true
  const entries: { binding: BindingRecord; scope: BindingScope }[] = []
  return {
    register(binding: BindingRecord, registerOptions?: { scope?: BindingScope }): void {
      assertChordRegistrable(binding.keys)
      const scope: BindingScope = registerOptions?.scope ?? 'global'
      if (dev && hasConflict(entries, binding, scope)) throw new CommandKeyError('DUPLICATE_BINDING')
      entries.push({ binding: { ...binding }, scope })
    },
    bindings(): readonly BindingRecord[] {
      return entries.map((entry) => ({ ...entry.binding }))
    },
    resolve(keys: string, ctx?: ResolveContext): BindingRecord | undefined {
      const open = { timelineFocused: ctx?.timelineFocused ?? false, searchOpen: ctx?.searchOpen ?? false, editing: ctx?.editing ?? false }
      const candidates = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.binding.keys === keys && gateOpen(entry.binding.when, open))
      candidates.sort((a, b) => precedenceRank(a.entry) - precedenceRank(b.entry) || a.index - b.index)
      const first = candidates[0]
      return first === undefined ? undefined : { ...first.entry.binding }
    },
  }
}

interface CatalogEntry {
  id: string
  label: string
  keys: readonly string[]
  when?: string
  category: 'Transport' | 'Edit' | 'Timeline' | 'Transcript' | 'View'
}

type CatalogMeta = { label: string; category: CatalogEntry['category'] }

const CATALOG_META: Readonly<Record<string, CatalogMeta>> = {
  'transport.play-pause': { label: 'Play / pause', category: 'Transport' },
  'transport.skip-backward': { label: 'Seek backward 5 s', category: 'Transport' },
  'transport.skip-forward': { label: 'Seek forward 5 s', category: 'Transport' },
  'transport.skip-backward-large': { label: 'Seek backward 10 s', category: 'Transport' },
  'transport.skip-forward-large': { label: 'Seek forward 10 s', category: 'Transport' },
  'transport.step-backward': { label: 'Playhead back 1 frame', category: 'Transport' },
  'transport.step-forward': { label: 'Playhead forward 1 frame', category: 'Transport' },
  'transport.step-second-backward': { label: 'Playhead back 1 s', category: 'Transport' },
  'transport.step-second-forward': { label: 'Playhead forward 1 s', category: 'Transport' },
  'transport.seek-start': { label: 'Go to start', category: 'Transport' },
  'transport.seek-end': { label: 'Go to end', category: 'Transport' },
  'transport.loop-toggle': { label: 'Loop region on/off', category: 'Transport' },
  'transport.loop-in': { label: 'Set loop in from playhead', category: 'Transport' },
  'transport.loop-out': { label: 'Set loop out from playhead', category: 'Transport' },
  'transport.loop-clear': { label: 'Clear loop region', category: 'Transport' },
  'timeline.split': { label: 'Split caption block at playhead', category: 'Timeline' },
  'timeline.merge': { label: 'Merge selected with next block', category: 'Timeline' },
  'timeline.merge-ctrl': { label: 'Merge selected with next block (Ctrl)', category: 'Timeline' },
  'timeline.delete': { label: 'Delete selected block', category: 'Timeline' },
  'timeline.delete-close-gap': { label: 'Delete selected block and close gap', category: 'Timeline' },
  'timeline.trim-start': { label: 'Trim block start to playhead', category: 'Timeline' },
  'timeline.trim-end': { label: 'Trim block end to playhead', category: 'Timeline' },
  'timeline.zoom-in': { label: 'Timeline zoom in', category: 'Timeline' },
  'timeline.zoom-out': { label: 'Timeline zoom out', category: 'Timeline' },
  'timeline.zoom-fit': { label: 'Timeline zoom fit', category: 'Timeline' },
  'timeline.focus-next': { label: 'Move block focus to next', category: 'Timeline' },
  'timeline.focus-prev': { label: 'Move block focus to previous', category: 'Timeline' },
  'timeline.select': { label: 'Toggle block selection', category: 'Timeline' },
  'search.next': { label: 'Next search match', category: 'Transcript' },
  'search.previous': { label: 'Previous search match', category: 'Transcript' },
  'transcript.search-open': { label: 'Find in transcript', category: 'Transcript' },
  'transcript.select-all': { label: 'Select all blocks', category: 'Transcript' },
  'transcript.deselect': { label: 'Deselect', category: 'Transcript' },
  'qc.next-issue': { label: 'Next QC issue', category: 'Transcript' },
  'qc.previous-issue': { label: 'Previous QC issue', category: 'Transcript' },
  'edit.undo': { label: 'Undo', category: 'Edit' },
  'edit.redo': { label: 'Redo', category: 'Edit' },
  'view.save-snapshot': { label: 'Save snapshot', category: 'View' },
  'view.captions-toggle': { label: 'Toggle caption visibility', category: 'View' },
  'view.shortcuts-overlay': { label: 'Shortcuts overlay', category: 'View' },
  'focus.sidebar': { label: 'Focus sidebar', category: 'View' },
  'focus.stage': { label: 'Focus stage', category: 'View' },
  'focus.timeline': { label: 'Focus timeline', category: 'View' },
  'panels.collapse.sidebar': { label: 'Collapse sidebar', category: 'View' },
  'panels.collapse.timeline': { label: 'Collapse timeline', category: 'View' },
  'translate.cycle-view': { label: 'Cycle transcript view', category: 'View' },
}

function defaultCatalogMeta(id: string): CatalogMeta {
  if (id.startsWith('transport.')) return { label: id, category: 'Transport' }
  if (id.startsWith('edit.')) return { label: id, category: 'Edit' }
  if (id.startsWith('timeline.')) return { label: id, category: 'Timeline' }
  if (id.startsWith('transcript.') || id.startsWith('search.') || id.startsWith('qc.')) return { label: id, category: 'Transcript' }
  return { label: id, category: 'View' }
}

/** FR-105.6: palette/docs JSON — one entry per unique command id in
 *  registration order, every registered chord under `keys`,
 *  JSON-serializable. */
export function getCommandCatalog(): readonly CatalogEntry[] {
  const byId = new Map<string, CatalogEntry & { keys: string[] }>()
  const ordered: (CatalogEntry & { keys: string[] })[] = []
  for (const binding of getCommandBindings()) {
    let entry = byId.get(binding.id)
    if (entry === undefined) {
      const meta = CATALOG_META[binding.id] ?? defaultCatalogMeta(binding.id)
      entry = { id: binding.id, label: meta.label, keys: [], category: meta.category }
      if (binding.when !== undefined) entry.when = binding.when
      byId.set(binding.id, entry)
      ordered.push(entry)
    }
    if (!entry.keys.includes(binding.keys)) entry.keys.push(binding.keys)
  }
  return ordered
}
