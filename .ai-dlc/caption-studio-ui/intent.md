---
status: pending
workflow: default
created: 2026-10-27
announcements: [changelog, release-notes, blog-draft]
---

# Intent: Caption Studio UI

## Description

The editing workbench: dark dual-pane shell (transcript sidebar ↔ preview + timeline), canonical editor state with ≥ 100-step undo, playback/canvas sync, caption block manipulation with verified Clipchamp/CapCut-derived shortcuts (plus our gap-fillers), speaker editing UI over the beta engine APIs, IndexedDB persistence with autosave. Consumes Intent 1 only through the worker protocol + domain types — the UI must be fully buildable and tested against a mock worker before Intent 1 finishes (contract-first).

Maps to Epic 2 (US 2.1–2.2) of the original brief + shortcuts/persistence requirements; UX decisions grounded in `knowledge/design.md` (verified competitor research).

## Business Context

- Editor UX is where we beat both competitors on their documented gaps: transcript search, merge shortcut, numeric timing inputs, loop region, speaker reassignment UX.
- The store + command layer is the integration surface for Intent 3 (styling/export) — its shape is a cross-unit contract defined in unit-102 and frozen there.

## Completion Criteria

- [ ] E2E (chromium, mocked fast worker): import fixture → transcribe → edit text/split/merge/retime → autosave → reload → state restored byte-equal (golden project JSON)
- [ ] 10 000-block project: transcript scrolls ≥ 55 FPS (rAF frame-drop assertion) and timeline drag input latency < 16 ms p95
- [ ] 100% of command-registry actions keyboard-reachable per `knowledge/design.md` shortcut table (registry snapshot test) + `⌘/` overlay lists them
- [ ] Undo/redo ≥ 100 steps across every command type (property test: random command sequences → undo-to-empty)
- [ ] Playhead ↔ active-word highlight ↔ transcript auto-scroll synced within 33 ms (2 frames) during playback and seeks
- [ ] axe scan: 0 critical violations on main views; keyboard-only walkthrough test passes (import→export-without-mouse, mocked worker)
- [ ] All gates incl. `pnpm test:e2e` green

## Units

| Unit | Discipline | Depends on |
|---|---|---|
| unit-101-workbench-shell | frontend | local-transcribe-engine/unit-01 |
| unit-102-editor-core-playback | frontend | unit-101 |
| unit-103-timeline | frontend | unit-102, local-transcribe-engine/unit-04 |
| unit-104-transcript-editor | frontend | unit-102, unit-103 (selection parity), local-transcribe-engine/unit-06 |
| unit-105-command-system | frontend | unit-102, unit-103, unit-104 |
| unit-106-persistence | frontend | unit-102, local-transcribe-engine/unit-04 |

## Risks

- Sync arbitrage between `<video>` time, rAF loop, and worker progress is the classic jank source → single `SyncArbitrator` (unit-102) owns clock; components only subscribe.
- contenteditable + undo history interactions are bug magnets → editing commits through commands only; blur/commit normalized; property-tested.
- Virtualization + measurement (block heights vary with wrapped text) → `@tanstack/react-virtual` dynamic-size mode tested at 10k scale in CI (jsdom perf budget generous; real 60 FPS asserted in Playwright chromium).

## Boundaries

- Styling UI + canvas overlay rendering: Intent 3 (shell reserves the Style tab + overlay layer).
- Burn-in/export UI: Intent 3 (Export button stub dispatches to store service interface defined here).
- Model manager UI chrome: unit-101 provides slot; tier chip reads `jobs` store.
