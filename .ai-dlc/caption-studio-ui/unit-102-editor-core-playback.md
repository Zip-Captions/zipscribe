---
status: pending
discipline: frontend
depends_on: [unit-101-workbench-shell]
workflow: tdd
mode: HITL   # defines the cross-unit state/command contract Intent 3 builds against; contract freeze
---

# Unit 102: Editor Core — Store, Commands, Playback & Sync

## Description

The heart: zustand slices (`project`, `editor`, `jobs`, `settings`), the **command system** (pure reducers, zundo undo ≥ 100), the **SyncArbitrator** clock owning playhead across `<video>`/rAF/loop-region/seeks, transport controls, and the canvas overlay layer (transparent, sits over `<video>`; Intent 3 fills rendering). All block mutations as commands: `block-split`, `block-merge`, `block-retime`, `block-edit-text`, `block-delete`, `block-delete-close-gap`, `captions-retime-all`, `captions-reflow`, `captions-import`, `speaker-*` (wrapping engine-1/06 pure fns) — every block command also applies the translation-track rules (domain invariant 10, via `engine/translate/track.ts` once unit-301 lands; a no-op stub until then). This unit **freezes the store/contract shape** (documented in `src/state/CONTRACT.md`, generated types).

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
- **FR-102.3** `SyncArbitrator`: owns a `MediaClock` (element clock over `<video>` or `<audio>`; unit-107 adds the decoded clock), exposes `subscribe(cb)`, `seek(t)`, `setLoop([a,b]|null)`, `rate`; single rAF loop with dt-based smoothing; **components never read `currentTime` of any media element directly** (lint rule). Video files the element can't play (`canPlayType` empty or probe play fails) show a coded notice on the stage; editing and transcription still work.
- **FR-102.4** Active word derivation: selector `activeWord(blockId, playhead)` (binary search over word times) — exported, unit-tested boundary cases (gap inside block, exactly-on-boundary).
- **FR-102.5** Transport UI: play/pause button, time displays (`formatTimecode`), loop toggle (`Y`), in/out (`I/O`) from playhead.
- **FR-102.6** Canvas overlay layer: sized to the video content box with letterboxing math (aspect fit, `object-fit` parity) — or, for audio projects, to the 16:9 stage that hosts unit-107's visualizer layer beneath it; rAF-rendered by pluggable `overlayRenderer` (default no-op; Intent 3 supplies caption renderer); pointer-events pass-through.
- **FR-102.7** `CONTRACT.md`: store shape + all command payload types + `SyncArbitrator` interface + `exportService` seam signatures — committed; unit-103/104/105/106 and Intent 3 import types only.
- **FR-102.8** Mock worker harness: deterministic fake engines emitting scripted `MediaEvent`/`AsrEvent`/`DiarizeEvent`/`ExportEvent` streams for all downstream tests (no real inference in CI per-PR), plus a fake `TranslationEngine` for Intent 4.
- **FR-102.9** `state/services/serialize.ts`: canonical project serialization (domain invariant 8) used by autosave, `.zipscribe.json` export and every golden.

## Completion Criteria

- [ ] **CC-102.1** Property test: random command sequences → undo/redo round-trip (≥ 500 cases)
- [ ] **CC-102.2** `SyncArbitrator` unit + Playwright tests: seek ≤ 1 frame, loop wrap ≤ 33 ms, scrub-release resume
- [ ] **CC-102.3** Reducer invalid-payload tests enforce domain invariants 1–4 and 9
- [ ] **CC-102.4** Canonical serializer: key order/number formatting golden; `parse(serialize(p))` deep-equals `p`
- [ ] **CC-102.5** `CONTRACT.md` + generated types committed; no `video.currentTime` reads outside arbitrator (lint)
- [ ] **CC-102.6** ≥ 55 FPS during synthetic 10k-block playback (chromium trace; matches `settings.yml performance_baselines`)
- [ ] **CC-102.7** All gates green

## Risks

- rAF + video clock drift on background tabs → `visibilitychange` resync; test via Playwright.
- Command payloads drifting from contract → contract types generated from single source, checked in CI.

## Docs to consult

- zustand + zundo: https://github.com/pmndrs/zustand · https://github.com/pmndrs/zundo · domain.md invariants
