// Unit-105 FROZEN API CONTRACT — test-author-owned ambient module declarations
// (unit101/102/103/104 `@NN` doctrine, adapted: this file stays a SCRIPT so
// the not-yet-existing modules are ambient `declare module` blocks; the
// ADDITIVE surface on the already-existing `@ui/commands/registry` lives in
// the module-file sidecar tests/unit/commands/unit105-registry-augmentation.d.ts
// — the frozen acceptance shape is the two files together).
//
// The unit-105 RED suites (tests/unit/commands/**) type against the
// declarations below while the runtime imports resolve only after the builder
// ships code — tests reach not-yet-existing modules through the variable-
// specifier `loadSeamModule` helper (tests/unit/commands/helpers/seams.ts),
// which throws a clear "unit-105 RED seam" message; tsc never sees a missing
// module (keyboard-live-region.test.tsx `@vite-ignore` precedent).
//
// Ownership: the unit-101 (`@ui/commands/registry` frozen rows), unit-103
// (Registry EXTENDS, both Meta+ and Ctrl+ zoom/merge spellings — adjudication
// 10) and unit-104 (Registry EXTENDS incl. the adjudicated Ctrl+G /
// Ctrl+Shift+G search chords, PR #15 review F1) acceptance shapes stay
// authoritative — this file NEVER re-declares or narrows them. New binding
// ids below must keep those frozen rows satisfied byte-for-byte.
//
// ─────────────────────────────────────────────────────────────────────────────
// FROZEN NEW BINDING IDS (unit-105's choice — stable, consistent with the
// transport.* / timeline.* / transcript.* / focus.* / panels.collapse.*
// families; the brief's edit.* / view.* / translate.* ids are mandated):
//
//   transport.seek-start            'Meta+ArrowLeft' / 'Ctrl+ArrowLeft' / 'Home'   (when: not-editing)
//   transport.seek-end              'Meta+ArrowRight' / 'Ctrl+ArrowRight' / 'End'  (when: not-editing)
//   timeline.delete                 'Delete' / 'Backspace'                          (when: not-editing)
//   timeline.delete-close-gap       'Shift+Delete'                                  (when: not-editing)
//   transport.loop-clear            'Shift+I' / 'Shift+O'                           (when: not-editing)
//   translate.cycle-view            'Meta+Shift+L' / 'Ctrl+Shift+L'                 (when: not-editing)
//   qc.next-issue                   "Ctrl+'"            (ADDS the Ctrl spelling     (when: not-editing)
//                                     to the frozen unit-104 Meta+' row)
//   qc.previous-issue               "Ctrl+Shift+'"      (same, frozen Meta+Shift+')  (when: not-editing)
//   transcript.select-all           'Meta+A' / 'Ctrl+A'                             (when: not-editing)
//   transcript.deselect             'Escape'                                        (when: not-editing)
//   edit.undo                       'Meta+Z' / 'Ctrl+Z'                             (NO gate — always live)
//   edit.redo                       'Meta+Shift+Z' / 'Ctrl+Shift+Z' / 'Meta+Y' / 'Ctrl+Y'  (NO gate)
//   view.save-snapshot              'Meta+S' / 'Ctrl+S'                             (NO gate)
//   view.captions-toggle            'Meta+\' / 'Ctrl+\'                             (when: not-editing)
//   view.shortcuts-overlay          'Meta+/' / 'Ctrl+/'                             (NO gate)
//
// Key-token spelling is the KeyboardEvent.key value, matching the frozen rows
// and useCommands' normalization (letters uppercase, 'Space' for ' ', single
// chars pass through: '\', '/', "'", digits): the brief's "Meta+Backslash" /
// "Meta+Slash" prose freezes as 'Meta+\' and 'Meta+/'. `Meta`/`Ctrl` dual
// spellings follow design.md:73 (⌘ macOS, Ctrl elsewhere) — the snapshot
// parser expands EVERY ⌘ row to both, so every ⌘-row command above registers
// both spellings. The always-live trio (save/undo/overlay — design.md rules:
// "never bound during contenteditable focus EXCEPT save/undo/overlay") carry
// NO `when` gate: the registry gate stays open while editing and useCommands'
// editing suppression (id-prefix/when doctrine, frozen) leaves them flowing.
// translate.cycle-view is NOT always-live (gated not-editing); its unit-302
// handler is intentionally absent — dispatch without a handler is the
// registry's established no-op-for-unmounted behaviour (registry.ts:165
// precedent); the snapshot/overlay rows assert the BINDING exists.
//
// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT EXEMPTIONS — EXACTLY these two design.md rows are owned elsewhere
// (the CC-105.1 snapshot maps every OTHER table row to registry bindings;
// any further drift fails):
//   1. "Confirm/cancel edit" (`Enter` / `Esc`; `Shift+Enter` line break) —
//      owner 'editable': implemented as the contenteditable onKeyDown on the
//      `ui/**/editable/**` allowlist path (src/ui/transcript/editable/
//      BlockEditor.tsx, frozen by unit-104). Not a registry command.
//   2. "Timeline zoom (wheel/pinch)" (`Ctrl + wheel`) — owner 'wheel':
//      pointer device, not a key chord; unit-103's non-passive wheel listener
//      (controller.zoomAtPixel). Never a registry binding (browser page-zoom
//      reservation, design.md note).
//
// ─────────────────────────────────────────────────────────────────────────────
// ERROR CONTRACT (SECURITY-03: codes only, never user/key content): the typed
// errors below are `Error` instances carrying `code` — parse/registration
// failures throw code 'INVALID_SPEC'; browser-reserved chords ('Meta+W',
// 'Meta+T', 'Meta+N', 'Meta+Q', 'Ctrl+Tab') throw 'BROWSER_RESERVED'; dev-mode
// registration conflicts throw 'DUPLICATE_BINDING'. Tests assert `.code` and
// that the message contains nothing beyond the code token.
//
// `data-testid` contract (overlay builder must use exactly these ids):
//   shortcuts-overlay — the dialog root: role="dialog", aria-modal="true",
//                       aria-label "Keyboard shortcuts".
//   shortcuts-filter  — the live filter <input> (narrows rows by label and by
//                       key token, case-insensitive substring).
//   shortcuts-row     — one row per registered command id, attribute
//                       data-command-id="<id>", visible text contains the
//                       command label and the platform-rendered keys.
//   Group headings    — role="heading" level 2 per category: Transport, Edit,
//                       Timeline, Transcript, View (every row renders under
//                       its category heading; empty groups may omit).
//
// FR-105.6 catalog (getCommandCatalog) freezes as: one entry per UNIQUE
// command id; `keys` = every chord registered for that id (the only reading
// consistent with "count equals unique command ids"); stable order; JSON-
// serializable (JSON round-trip deep-equals the input); category ∈
// Transport|Edit|Timeline|Transcript|View.

declare module '@ui/commands/keyspec' {
  /** OS family the CmdOrCtrl token resolves for (FR-105.2 / US-2.3.1). */
  export type CommandPlatform = 'mac' | 'windows' | 'linux'

  export type CommandModifier = 'Meta' | 'Ctrl' | 'Alt' | 'Shift'

  /** Frozen parse result: `keys` is the platform-resolved chord in the
   *  frozen order `Meta+Ctrl+Alt+Shift+<key>` (held-letter chords keep the
   *  letter directly before the base key, e.g. 'Z+ArrowLeft'). */
  export interface KeySpec {
    readonly keys: string
    readonly base: string
    readonly modifiers: readonly CommandModifier[]
    /** 'code' when the base token was a KeyboardEvent.code token (KeyS/Slash
     *  — bind by CODE so non-QWERTY layouts keep positions, FR-105.2);
     *  'key' for key tokens (Space, F3, "'", digits, arrows, Enter, Escape). */
    readonly type: 'code' | 'key'
    /** The raw code token when type==='code', else null. */
    readonly code: string | null
    /** Held-letter chord prefix (design.md Z/C trims) when the spec was 'KeyZ+ArrowLeft'-style.
     *  A code-token held prefix ('KeyZ'/'KeyC') normalizes to the bare letter
     *  in `keys`; `type`/`code` describe the BASE (final) token. */
    readonly heldChord: 'Z' | 'C' | null
  }

  /** Throws an Error carrying `code: 'BROWSER_RESERVED'` for Meta+W / Meta+T
   *  / Meta+N / Meta+Q / Ctrl+Tab (message = the code only, SECURITY-03) and
   *  `code: 'INVALID_SPEC'` for unparseable specs. */
  export function parseKeySpec(spec: string, platform: CommandPlatform): KeySpec

  /** Overlay rendering (FR-105.4 glyphs): mac → ⌘ ⌥ ⇧ ⌃ with the key glyph
   *  (e.g. 'Meta+Shift+M' → '⌘⇧M'); windows/linux → 'Ctrl+Shift+M'-style
   *  text. CmdOrCtrl resolves to '⌘' on mac, 'Ctrl' elsewhere. */
  export function overlayLabel(spec: string, platform: CommandPlatform): string

  /** FR-105.2 "overlay shows the layout's actual key via
   *  navigator.keyboard.getLayoutMap() when available" — FEATURE-DETECTED
   *  (must not throw when `navigator.keyboard` is absent, e.g. Firefox/Safari
   *  and every node environment); absent → deterministic fallback label
   *  (KeyS→'S', Digit2→'2', Slash→'/', Backslash→'\\', Quote→"'", Equal→'=',
   *  Minus→'-', Space→' ', named keys pass through). */
  export function actualKeyLabel(codeToken: string): Promise<string>
}

declare module '@ui/commands/context' {
  /** FR-105.3 — PURE (DOM-free, node env): the context model every `when`
   *  predicate reads. INPUT/TEXTAREA/SELECT or isContentEditable ⇒ 'input';
   *  the timeline region wins over the transcript region; else 'body'. */
  export type CommandFocus = 'body' | 'input' | 'timeline' | 'transcript'

  export interface CommandSelection {
    anchorBlockId: string | null
    focusBlockId: string | null
  }

  export interface ContextInput {
    activeElementTag: string | null
    isContentEditable: boolean
    inTimelineRegion: boolean
    inTranscriptRegion: boolean
    searchOpen: boolean
    hasSelection: boolean
    /** Editor-slice shape — passed through verbatim to the output (null/omitted
     *  or hasSelection=false ⇒ output selection is null). */
    selection?: CommandSelection | null
  }

  export interface CommandContext {
    focus: CommandFocus
    selection: CommandSelection | null
    searchOpen: boolean
  }

  export function resolveContext(input: ContextInput): CommandContext
}

declare module '@ui/commands/useEditorCommands' {
  import type { EditorApp } from '@state/history'
  import type { CommandPlatform } from '@ui/commands/keyspec'

  export interface EditorCommandDeps {
    /** ⌘S/Ctrl+S save hook (FR-102.9 autosave/snapshot path; the L2 suites
     *  inject a spy — the "save-injected spy"). */
    onSave?: () => void
    /** Overlay platform for the ⌘/ overlay (default: userAgent detection). */
    platform?: CommandPlatform
  }

  /** The unit-105 command-handler wiring (useTransportCommands precedent):
   *  registers the handlers for EVERY non-timeline/non-transcript binding id
   *  — transport.seek-start/end, transport.loop-clear, timeline.delete /
   *  delete-close-gap (selection-focus block, ONE history step; close-gap =
   *  the adjudicated gap-MIDPOINT semantics per src/state/CONTRACT.md),
   *  transcript.select-all (selection = all blocks) / deselect, edit.undo /
   *  edit.redo (app.history), view.save-snapshot (onSave), view.captions-
   *  toggle, view.shortcuts-overlay (mounts the overlay),
   *  translate.cycle-view (no handler until unit-302 — dispatch is the
   *  documented no-op). Called by the Workbench next to useCommands. */
  export function useEditorCommands(app: EditorApp | undefined, deps?: EditorCommandDeps): void
}

declare module '@ui/commands/ShortcutsOverlay' {
  import type { ReactElement } from 'react'
  import type { CommandPlatform } from '@ui/commands/keyspec'

  export interface ShortcutsOverlayProps {
    /** Platform override (default: userAgent detection) — drives the glyph
     *  map (FR-105.4 / CC-105.4). */
    platform?: CommandPlatform
    /** Called when the overlay closes (Esc / backdrop). */
    onClose?: () => void
  }

  /** FR-105.4: role=dialog + aria-modal, focus-trapped (Tab/Shift+Tab cycle
   *  inside), Esc closes and restores focus to the opener, live filter by
   *  label AND key token, grouped under the five category headings, one row
   *  per registered command id (count assertion vs getCommandBindings unique
   *  ids). Mounted by the Workbench when view.shortcuts-overlay dispatches. */
  export function ShortcutsOverlay(props: ShortcutsOverlayProps): ReactElement
}

declare module 'scripts/eslint-keyboard.mjs' {
  /** FR-105.5 / CC-105.5 seed (conventions § UI conventions keyboard rule,
   *  reviewer ALWAYS-check 11): the custom ESLint rule the builder adds at
   *  `scripts/eslint-keyboard.mjs`, wired into eslint.config.js for src/**.
   *  messageId frozen: 'outsideAllowlist'. Allowlist: `src/ui/commands/**`,
   *  `src/ui/**\/editable/**`, `src/ui/editable/TimecodeInput.tsx` — the
   *  rule must read `context.filename` (or the path segment) so RuleTester
   *  fixtures discriminate by filename. */
  export interface KeyboardRuleContext {
    report(descriptor: { messageId: string; node: unknown }): void
    getSourceCode(): { getText(): string }
    filename?: string
  }
  export interface KeyboardRuleModule {
    meta?: { type?: string; messages?: Record<string, string>; schema?: unknown }
    create(context: KeyboardRuleContext): Record<string, (node: unknown) => void>
  }
  export const noKeydownOutsideAllowlist: KeyboardRuleModule
  export const plugin: {
    rules: {
      'no-keydown-outside-allowlist': KeyboardRuleModule
    }
  }
}
