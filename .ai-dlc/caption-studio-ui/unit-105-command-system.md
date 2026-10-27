---
status: pending
discipline: frontend
depends_on: [unit-102-editor-core-playback, unit-103-timeline, unit-104-transcript-editor]
workflow: default
mode: AHOTL
---

# Unit 105: Command System & Shortcuts

## Description

Single command registry binding the `knowledge/design.md` shortcut table to editor commands: key parsing (platform modifiers), context-aware dispatch (suppressed during `contenteditable`/inputs except save/undo/overlay), conflict detection at registration, `⌘/` shortcuts overlay, command palette data (`⌘K` UI is seed; registry ready). Every editor action in Intent 2/3 registers here — no ad-hoc `onKeyDown` (conventions rule).

## User Stories

**US-2.3.1** As a keyboard-first editor, every action has a key and the map matches the docs.
- *Given* the design-table action list, *when* each binding is simulated (`dispatchKeyEvent`), *then* the corresponding command fires exactly once; registry snapshot test equals `knowledge/design.md` table (CI-enforced drift check).
- *Given* macOS vs Windows/Linux, *when* resolving `CmdOrCtrl`, *then* correct modifier reported (unit-tested both platforms).

**US-2.3.2** As an editor mid-typing, the app doesn't hijack my keys.
- *Given* focus in any text input/contenteditable, *when* `S`/`Delete`/arrows, *then* no command fires; *when* `⌘Z`/`⌘S`/`⌘/`, *then* they still fire (save/undo/overlay always live).
- *Given* timeline focused (no text focus), *when* `S`/`M`/`Z+←`, *then* block commands apply to selection.

**US-2.3.3** As a new user, `⌘/` teaches me.
- *Given* anywhere in app, *when* `⌘/`, *then* overlay lists all commands grouped (Transport / Edit / Timeline / Transcript / View) with platform-correct glyphs; Esc closes; search filter within overlay.

## Functional Requirements

- **FR-105.1** Registry: `{ id, keys: KeySpec[], when?: ContextPredicate, run(ctx) }`; registration-time duplicate-binding error (dev) / precedence order (prod: focused-panel scope > global).
- **FR-105.2** KeySpec parser: `CmdOrCtrl`, `Shift`, `Alt`, code vs key (`KeyS` vs `Space`), platform glyphs for overlay (⌘⌥⇧⌃).
- **FR-105.3** Context model: `{ focus: 'body'|'input'|'timeline'|'transcript', selection }` from `editor` slice — predicates pure/testable.
- **FR-105.4** Overlay component (dialog role, focus-trapped, aria-modal), grouped by category, platform glyphs, live filter.
- **FR-105.5** All Intent-2 commands migrated to registry dispatch; any `onKeyDown` outside `commands/` fails lint (rule from conventions).
- **FR-105.6** Registry exposes JSON for future `⌘K` palette + docs generation (seed: palette UI).

## Completion Criteria

- [ ] Registry snapshot test equals design-table (drift = CI fail)
- [ ] Context suppression tests (input focus vs timeline/transcript focus)
- [ ] Platform variant unit tests (mac/win key resolution)
- [ ] Overlay: focus trap, Esc, filter, complete coverage of registered commands (count assertion)
- [ ] Conflict detection unit test (duplicate binding throws in dev mode)
- [ ] All gates green

## Docs to consult

- knowledge/design.md (binding table + rules) · Clipchamp `Ctrl+/` overlay precedent (design § Sources)
