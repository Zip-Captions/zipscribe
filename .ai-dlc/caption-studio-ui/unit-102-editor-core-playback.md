---
status: pending
discipline: frontend
depends_on: [unit-101-workbench-shell]
workflow: tdd
mode: HITL   # defines the cross-unit state/command contract Intent 3 builds against; contract freeze
---

# Unit 102: Editor Core — Store, Commands, Playback & Sync

## Description

The heart: zustand slices (`project`, `editor`, `jobs`, `settings`), the **command system** (pure reducers, zundo undo ≥ 100), the **SyncArbitrator** clock owning playhead across `<video>`/rAF/loop-region/seeks, transport controls, and the canvas overlay layer (transparent, sits over `<video>`; Intent 3 fills rendering). All block mutations as commands: `block-split`, `block-merge`, `block-retime`, `block-edit-text`, `block-delete`, `ripple-delete`, `speaker-*` (wrapping engine-1/06 pure fns). This unit **freezes the store/contract shape** (documented in `src/state/CONTRACT.md`, generated types).

## User Stories

**US-2.1.4** As an editor, every mutation is undoable and replayable.
- *Given* a random sequence of N registered commands (property test, N ≤ 200), *when* undo×N then redo×N, *then* project state returns to start and to final respectively; history depth ≥ 100 with merge-window collapsing (consecutive text edits within 1 s coalesce into one step).

**US-2.1.5** As a user, playback position is one truth.
- *Given* play, *when* `requestAnimationFrame` samples, *then* `editor.playhead` advances via `SyncArbitrator` from the media element clock; after a seek, playhead updates ≤ 1 frame; during loop region, wrap ± 33 ms (Playwright measure).
- *Given* scrub while playing, *when* release, *then* playback resumes at scrub position (no double-seek).

**US-2.2.4** As a user, transport works from anywhere.
- *Given* focus anywhere outside text inputs, *when* `Space`, `J`, `L`, `←/→`, `Shift+←/→`, *then* play/pause, ±5/10 s, ±1 frame, ±1 s (bindings via registry in unit-105; behaviors tested here directly).

## Functional Requirements

- **FR-102.1** Slices + selectors per `knowledge/conventions.md`; `project.blocks` sorted-array invariant (domain invariants 1–2) enforced in reducer, tested with invalid payloads rejected.
- **FR-102.2** Command registry: `{ id, reduce(state,payload), inverse? }`; zundo config `limit:150, jumpable:false`; `undoable:false` for `editor` UI-only fields.
- **FR-102.3** `SyncArbitrator`: owns media element, exposes `subscribe(cb)`, `seek(t)`, `setLoop([a,b]|null)`, `rate`; single rAF loop with dt-based smoothing; **components never read `video.currentTime` directly** (lint rule).
- **FR-102.4** Active word derivation: selector `activeWord(blockId, playhead)` (binary search over word times) — exported, unit-tested boundary cases (gap inside block, exactly-on-boundary).
- **FR-102.5** Transport UI: play/pause button, time displays (`formatTimecode`), loop toggle (`Y`), in/out (`I/O`) from playhead.
- **FR-102.6** Canvas overlay layer: sized to video content box with letterboxing math (aspect fit, `object-fit` parity), rAF-rendered by pluggable `overlayRenderer` (default no-op; Intent 3 supplies caption renderer); pointer-events pass-through.
- **FR-102.7** `CONTRACT.md`: store shape + all command payload types + `SyncArbitrator` interface + `exportService` seam signatures — committed; unit-103/104/105/106 and Intent 3 import types only.
- **FR-102.8** Mock worker harness: deterministic fake engine emitting scripted `EngineEvent` streams for all downstream tests (no real inference in CI per-PR).

## Completion Criteria

- [ ] Property test: random command sequences → undo/redo round-trip (≥ 500 cases)
- [ ] `SyncArbitrator` unit + Playwright tests: seek ≤ 1 frame, loop wrap ≤ 33 ms, scrub-release resume
- [ ] Reducer invalid-payload tests enforce domain invariants 1–4
- [ ] `CONTRACT.md` + generated types committed; no `video.currentTime` reads outside arbitrator (lint)
- [ ] 25 FPS minimum during synthetic 10k-block playback (chromium trace)
- [ ] All gates green

## Risks

- rAF + video clock drift on background tabs → `visibilitychange` resync; test via Playwright.
- Command payloads drifting from contract → contract types generated from single source, checked in CI.

## Docs to consult

- zustand + zundo: https://github.com/pmndrs/zustand · https://github.com/pmndrs/zundo · domain.md invariants
