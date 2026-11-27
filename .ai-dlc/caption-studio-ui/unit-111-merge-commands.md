---
status: pending
phase: mvp
discipline: frontend
depends_on: [caption-studio-ui/unit-104-transcript-editor, caption-studio-ui/unit-105-command-system]
workflow: default
mode: AHOTL
---

# unit-111-merge-commands — make merge reachable; pointer paths for split & merge (M2)

## Description

Closes #55 (blocker). US-2.3.1/J-02 step 4 cannot complete: `⌘⇧M`/`Ctrl+⇧M` do nothing even
though the command registry binds `timeline.merge`/`timeline.merge-ctrl` (`registry.ts:81-82`,
handlers registered in `src/ui/timeline/Timeline.tsx`) and the shortcuts overlay lists them;
and there is **no pointer path for split or merge** at all (right-click: no menu; row buttons
are only speaker/delete).

**[RULING — orchestrator, plan `docs/ops/overnight-plan-2026-11-27.md`]: additive only.**
Bind the already-documented `⌘⇧M`/`Ctrl+⇧M` merge command (it exists in the registry — do NOT
re-bind, rename or re-`when:` it) and add menu/pointer paths for split & merge. The frozen
CC-104 suites (shortcuts overlay = design.md, word-dblclick path, row ARIA) must pass
**unchanged**; if any frozen assertion makes the addition impossible → BLOCKED (ledger).

## User Stories

**US-111.1** As Creator Casey, I select a block and merge it with the next one — by keyboard
OR by pointing and clicking — and undo/redo restore the exact pair.

- *Given* a fixture project, *when* I click row N (selected) and press `⌘⇧M` (or
  `Ctrl+⇧M`), *then* block N merges into N+1 (text joined with a single space, timing =
  union, speaker preserved per the frozen `block-merge` command semantics) — the merge is
  driven by the REAL key, no `command()` seam.
- *Given* the same selection, *when* I use the row's pointer affordance "Merge with next"
  (menu item or row button — builder picks the design.md-consistent affordance), *then* the
  identical command runs.
- *Given* a merged pair, *when* I ⌘Z then ⇧⌘Z, *then* two rows / one row return exactly
  (existing undo/redo exactness doctrine from J-02).
- *Given* a selected row with the playhead inside it, *when* I use the pointer affordance
  "Split at playhead" (keyboard `S` already works — pointer path is the gap), *then* two
  blocks appear with exact times; undo restores one.

## Functional Requirements

- **FR-111.1** Root-cause first: why the registered `timeline.merge` handler is inert from
  the transcript surface (handler registration scope/focus/selection preconditions — record
  the root cause in the unit report). Fix so the documented key merges the selected block
  with the next from the transcript surface, while every existing behaviour of that
  registration (timeline usage) stays correct.
- **FR-111.2** Pointer paths: split and merge reachable by mouse/touch only (no shortcut
  knowledge required) — row context menu (real `role=menu` semantics, Esc-closable) or
  row action buttons per the existing row-button family style; merge disabled (not hidden)
  with a tooltip when no next block exists; split gated the same way the `S` path gates
  (playhead inside the block).
- **FR-111.3** Keyboard handling stays exclusively in the command registry
  (`ui/commands/useCommands.ts` + `registry.ts` — lint-enforced; no ad-hoc `onKeyDown`).
  The registry rows for merge are frozen by [RULING]; if the inertness is inside the
  handler, fix the handler (`Timeline.tsx` / wiring), not the binding.
- **FR-111.4** Undo/redo exactness: merge/split via any path ride the existing undoable
  commands (`block-merge`, `block-split`) — no parallel state paths; translations
  integrity validation (`validators.ts`) still applies identically.
- **FR-111.5** Frozen suites unchanged: CC-104 overlay content, CC-102 split/merge command
  semantics, keyboard-allowlist lint, J-02-style undo/redo legs. Any need to touch them →
  BLOCKED.

## Technical Specification

L2: row affordance rendering + disabled states + menu semantics (testing-library, user-event).
L5: built-bundle journey — import 12-cue fixture via the already-established transcript-spec
harness, click row, press Meta+Shift+KeyM via `page.keyboard.press`, assert row count +
joined text length/timing (SECURITY-03: lengths/timecodes, no transcript strings in
assertions); same via pointer clicks only; undo/redo round-trip exact via DOM snapshots of
timecodes/counts. Chromium.

## Completion Criteria

- [ ] **CC-111.1** `⌘⇧M` and `Ctrl+⇧M` merge the selected block with the next from the
  transcript surface (L5, real key events) — root cause documented in report
- [ ] **CC-111.2** pointer path merges (menu or button), disabled+tooltip on last row
  (L2 + L5)
- [ ] **CC-111.3** pointer path splits at playhead, same gating as `S` (L2 + L5)
- [ ] **CC-111.4** undo/redo exactness across both paths (row counts + timecode sequence
  byte-stable) — L5
- [ ] **CC-111.5** frozen CC-104 shortcut-overlay suite + keyboard-lint pass UNCHANGED
  (static attestation leg lead-citing `CC-111.5`, unit-303 doctrine)

## Risks

- Focus/`when:` context for the real key from transcript focus → fix at handler scope;
  `S`-path precedent shows transcript-surface dispatch works.
- Context menu vs #62 (dismissal, M6) — reuse whatever dismissal primitive exists or add
  Esc-close minimally HERE for the new menu; broader popover dismissal stays M6 (avoid
  double-fixing: coordinate by keeping #62 work in `ui/shell` popovers, this unit owns only
  its own menu).

## Boundaries

Owns: `src/ui/transcript/**` row affordances/menu, `src/ui/timeline/Timeline.tsx` merge
handler (fix in place), `e2e/transcript/**` + `tests/unit/workbench/**` additions.
Doesn't own: registry key bindings (frozen by [RULING]), `src/state/commands/**` (reused
as-is), engine, row CSS model (unit-110 — sequence AFTER unit-110 merged; rebase required).

## Docs to consult

GitHub #55 (measured repro); `knowledge/design.md` § Keyboard shortcuts + transcript row
actions; `src/ui/timeline/Timeline.tsx`; `src/ui/commands/README`-style comments in
`useCommands.ts`; conventions § UI conventions (keyboard allowlist).
