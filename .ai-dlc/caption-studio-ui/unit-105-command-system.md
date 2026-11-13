---
status: done   # merged (PR #16 → 84d349d, 2026-11-13T04:15Z); reviewer R1 APPROVE (0 MAJOR, 2 latent MINOR → follow-ups), CI round-1 scaffold adaptations adjudicated (branch-exists CI context; CC-01.1 child 240s budget), R2 APPROVE all five cited amendments assertion-preserving; adversary AUDIT 41 counterexamples zero violations; BUILD_VERIFIED gates green at 5df746a; CI quality 29m47s
phase: mvp
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
- *Given* timeline focused (no text focus), *when* `S` / `⌘⇧M` / `Z+←`, *then* block commands apply to selection.
- *Given* a held-letter chord (`Z+←`, `C+→`), *when* the letter is held and the arrow pressed, *then* the chord command fires and the bare letter does **not** fire on release; a letter tapped alone does nothing (neither `Z` nor `C` has a solo binding).

**US-2.3.3** As a new user, `⌘/` teaches me.
- *Given* anywhere in app, *when* `⌘/`, *then* overlay lists all commands grouped (Transport / Edit / Timeline / Transcript / View) with platform-correct glyphs; Esc closes; search filter within overlay.

## Functional Requirements

- **FR-105.1** Registry: `{ id, keys: KeySpec[], when?: ContextPredicate, run(ctx) }`; registration-time duplicate-binding error (dev) / precedence order (prod: focused-panel scope > global).
- **FR-105.2** KeySpec parser: `CmdOrCtrl`, `Shift`, `Alt`, held-letter chords (`KeyZ+ArrowLeft`), code vs key (`KeyS` vs `Space` — bind by `code` for letters so non-QWERTY layouts keep positions; overlay shows the layout's actual key via `navigator.keyboard.getLayoutMap()` when available), platform glyphs for overlay (⌘⌥⇧⌃). Bindings for browser-overridable keys call `preventDefault`; browser-reserved keys are rejected at registration.
- **FR-105.3** Context model: `{ focus: 'body'|'input'|'timeline'|'transcript', selection }` from `editor` slice — predicates pure/testable.
- **FR-105.4** Overlay component (dialog role, focus-trapped, aria-modal), grouped by category, platform glyphs, live filter.
- **FR-105.5** All Intent-2 commands migrated to registry dispatch; any `onKeyDown` outside `ui/commands/**` and the conventions allowlist (`ui/**/editable/**`, `TimecodeInput`) fails lint.
- **FR-105.6** Registry exposes JSON for future `⌘K` palette + docs generation (seed: palette UI).

## Completion Criteria

- [ ] **CC-105.1** Registry snapshot test equals design-table (drift = CI fail)
- [ ] **CC-105.2** Context suppression tests (input focus vs timeline/transcript focus)
- [ ] **CC-105.3** Platform variant unit tests (mac/win key resolution)
- [ ] **CC-105.4** Overlay: focus trap, Esc, filter, complete coverage of registered commands (count assertion)
- [ ] **CC-105.5** Conflict detection unit test (duplicate binding throws in dev mode)
- [ ] **CC-105.6** All gates green

## Docs to consult

- knowledge/design.md (binding table + rules) · Clipchamp `Ctrl+/` overlay precedent (design § Sources)

## Merge record (orchestrator)

Status: **MERGED** — PR #16 squash-merged to develop as `84d349d` (2026-11-13T04:15Z); CI green (run 43360971250: quality 29m47s ✓, fixtures-verify ✓, preview-deploy ✓). Test-author RED (2e3e00e — 9 suites + frozen acceptance shape, 52/67 red seam-missing) → builder slices A–D (keyspec/context/conflict/full design-table registry/catalog JSON → useEditorCommands handlers + jsdom contenteditable → ShortcutsOverlay → `@zipscribe/no-keydown-outside-allowlist` ESLint rule) → adversary AUDIT (41 counterexamples, **zero violations**; observations → follow-up seeds) → BUILD_VERIFIED (orchestrator re-ran every gate at `5df746a`: lint · typecheck · format:check · vitest 201/1618 ✓ w/ coverage 95.65/90.46/97.12/98.48 · build+check-bundle 128.4/350 KB · test:e2e 110/22/0 · verify:unit 6/6) → CI round-1 red on two CI-environment assumptions (branch-exists local-ref assumption; CC-01.1 nested child SIGTERM'd by the unit-102-era 90 s budget — measured child 49–50 s idle local, >90 s CI contention): both adjudicated with citations, assertion-preserving (`094ba8e`, `80fbb0a`; plus the three earlier adjudicated amendments `eded577`/`ed3fe2d`/`075f1b1`) → reviewer cap-3 fresh-context rounds (R1 APPROVE @ `5df746a` — 0 MAJOR, 2 latent MINOR → follow-ups, tamper-probes reddened the snapshot oracle both directions; R2 APPROVE @ `80fbb0a` — per-assertion strength table for all five amendments, child measured 49.29 s, no runaway since spawnSync timeout still fails `expect(null).toBe(0)`). Contract: `src/state/**` diff empty — FROZEN surface untouched; keyboard dispatch through `EditorApp.dispatch`/history/`setSelection` only. Boundaries honored: `translate.cycle-view`/`view.captions-toggle` registered handler-less (unit-302 / Intent 3), `⌘S` dispatches with unit-106-owned `onSave` provider. Follow-ups: unknown-`when` fail-open → typed `INVALID_GATE`; dev-default on `import.meta.env.DEV`; spread/createElement onKeyDown lint evasion; first-row-per-id gate pin; `UNKNOWN_COMMAND_ID` code-only message; vitest.config stale-budget comment. Qualification record re-signed `5df746a` (contentHash+startedAt only, last src-touching commit — reviewer recomputed hash match). All evidence in docs/overnight-ledger.md.
