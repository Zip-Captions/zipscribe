---
status: completed   # re-closed 2026-11-25: unit-109 (local-media intake picker) merged 1a1bfb1 (verify:unit 5/5); verify:intent caption-studio-ui exit 0 on develop (chain 2026-11-25, reports/criteria). Original closure: units 101–108, PR #21 → 058b4c8.
workflow: default
created: 2026-10-27
announcements: [changelog, release-notes, blog-draft]
---

# Intent: Caption Studio UI

## Description

The editing workbench for video **and audio** projects (audio gets decoded playback when needed and a live spectrum visualizer on the stage): dark dual-pane shell (transcript sidebar ↔ preview + timeline), canonical editor state with ≥ 100-step undo, playback/canvas sync, caption block manipulation with verified Clipchamp/CapCut-derived shortcuts (plus our gap-fillers), speaker editing UI over the beta engine APIs, bring-your-own-captions import with QC issues, align-to-audio and retime tools, IndexedDB persistence with autosave. Consumes Intent 1 only through the worker protocol + domain types — the UI must be fully buildable and tested against a mock worker before Intent 1 finishes (contract-first).

Maps to Epic 2 (US 2.1–2.2) of the original brief + shortcuts/persistence requirements; UX decisions grounded in `knowledge/design.md` (verified competitor research).

## Business Context

- Editor UX is where we beat both competitors on their documented gaps: transcript search, merge shortcut, numeric timing inputs, loop region, speaker reassignment UX.
- The store + command layer is the integration surface for Intent 3 (styling/export) — its shape is a cross-unit contract defined in unit-102 and frozen there.

## Completion Criteria

- [ ] **CC-I2.1** E2E (chromium, mocked fast worker): import fixture → transcribe → edit text/split/merge/retime → autosave → reload → state restored byte-equal (golden project JSON)
- [x] **CC-I2.2** E2E: media + third-party `vendor.vtt` → import report → QC fixes → shift timing → align (mocked) → autosave → reload byte-equal
- [ ] **CC-I2.3** E2E audio project: `speech-2spk-2min.m4a` → visualizer renders while playing → transcribe + diarize (mocked) → edit → export dialog offers sidecars only (no burn-in in the DOM) → autosave → reload byte-equal; repeated for one fallback-path file (`fmt-30s.aiff`) with decoded playback
- [x] **CC-I2.4** 10 000-block project: transcript scrolls ≥ 55 FPS (rAF frame-drop assertion) and timeline drag input latency < 16 ms p95
- [x] **CC-I2.5** 100% of command-registry actions keyboard-reachable per `knowledge/design.md` shortcut table (registry snapshot test) + `⌘/` overlay lists them
- [x] **CC-I2.6** Undo/redo ≥ 100 steps across every command type (property test: random command sequences → undo-to-empty)
- [x] **CC-I2.7** Playhead ↔ active-word highlight ↔ transcript auto-scroll synced within 33 ms (2 frames) during playback and seeks
- [x] **CC-I2.8** axe scan: 0 critical violations on main views; keyboard-only walkthrough test passes (import→export-without-mouse, mocked worker)
- [x] **CC-I2.9** All gates incl. `pnpm test:e2e` green

### Completion status (orchestrator, 2026-11-17)

9/12 criteria CREDITED by `verify:intent caption-studio-ui` (I2.2/I2.4/I2.5/I2.6/I2.7/
I2.8/I2.9/I2.10/I2.12 — see reports/criteria/caption-studio-ui.md; PRs #19 + #20, CI green;
PR #20 moved citations to the JUnit-title head per the unit-106 lesson — citationsOf reads
only `describe > test` head). BLOCKED — single root
cause [107-ADJ 24]: the streaming transcribe→blocks commit is unimplemented
(`src/state/jobs.ts` `startTranscribe` posts `placeholderPcm` — "Follow-up: real stream
plumbing"), so CC-I2.1, CC-I2.3 and CC-I2.11 are skipped-with-reason in the intent
suite (a Transcript-level commit was built and correctly rejected by the frozen unit-104
FR-104.6 skeleton contract — reverted). These need a stream-plumbing unit (proposed
unit-108: PCM stream wiring, frontier-aware commit, job-error StatusBar notice). The
export-dialog leg of CC-I2.3 additionally waits on styling-and-export/unit-202
([107-ADJ 23]).

### Completion status (orchestrator, 2026-11-18) — CLOSED

**12/12** untagged criteria CREDITED by `verify:intent caption-studio-ui` (exit 0,
"all untagged criteria of intent.md covered (12 total)"; table + counts in
`reports/criteria/caption-studio-ui.md`). The [107-ADJ 24] root cause is resolved by
unit-108 (PR #21 → `058b4c8`): progress-frontier stream-commit service
(`src/state/services/transcribe-commit.ts`), real PCM decode tee in `jobs.ts`, coded
job-error StatusBar — intent legs CC-I2.1, CC-I2.3 (aiff round-trip leg) and CC-I2.11
un-skipped and green (CC-108.7 cited). All units 101–108 `status: done`.
Carried, intentional: the export-dialog leg of CC-I2.3 stays skipped-with-reason until
styling-and-export/unit-202 ([107-ADJ 23] — that leg's proof belongs to intent 4's
suite); `[MANUAL]`/`[RQ]` unit-tier items are recorded per unit report.

### Failure cases
- [x] **CC-I2.10** Invalid edit payloads (overlapping retime, empty text on last word, unknown speaker) are rejected by reducers with no state change and no history entry
- [ ] **CC-I2.11** Engine `job:error` mid-transcription leaves committed blocks editable and shows a one-line coded notice (no modal, no data loss)
- [x] **CC-I2.12** IndexedDB write failure (quota) surfaces a persistent "not saved" indicator; edits stay in memory and retry on next idle

## Units

| Unit | Discipline | Depends on |
|---|---|---|
| unit-101-workbench-shell | frontend | local-transcribe-engine/unit-01 |
| unit-102-editor-core-playback | frontend | unit-101 |
| unit-103-timeline | frontend | unit-102, local-transcribe-engine/unit-04 |
| unit-104-transcript-editor | frontend | unit-102, unit-103 (selection parity), local-transcribe-engine/unit-06, local-transcribe-engine/unit-07 |
| unit-105-command-system | frontend | unit-102, unit-103, unit-104 |
| unit-106-persistence | frontend | unit-102, local-transcribe-engine/unit-04 |
| unit-107-audio-preview | frontend | unit-102, local-transcribe-engine/unit-04 |
| unit-108-stream-commit | frontend | unit-105, unit-106, local-transcribe-engine/unit-05 |
| unit-109-media-intake-picker | frontend | unit-101, unit-104, unit-106 |

## Risks

- Sync arbitrage between `<video>` time, rAF loop, and worker progress is the classic jank source → single `SyncArbitrator` (unit-102) owns clock; components only subscribe.
- contenteditable + undo history interactions are bug magnets → editing commits through commands only; blur/commit normalized; property-tested.
- Virtualization + measurement (block heights vary with wrapped text) → `@tanstack/react-virtual` dynamic-size mode tested at 10k scale in CI (jsdom perf budget generous; real ≥ 55 FPS asserted in Playwright chromium).

## Boundaries

- Styling UI + canvas overlay rendering: Intent 3 (shell reserves the Style tab + overlay layer).
- Burn-in/export UI: Intent 3 (Export button stub dispatches to store service interface defined here).
- Model manager UI chrome: unit-101 provides slot; tier chip reads `jobs` store.
- Service worker, install, "Offline models" panel: Intent 3 unit-204 (unit-101 reserves the header `⋯` menu and the offline chip slot).
