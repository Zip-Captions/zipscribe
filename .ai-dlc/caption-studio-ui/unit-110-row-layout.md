---
status: pending
phase: mvp
discipline: frontend
depends_on: [caption-studio-ui/unit-103-timeline, caption-studio-ui/unit-104-transcript-editor, caption-studio-ui/unit-108-stream-commit]
workflow: default
mode: AHOTL
---

# unit-110-row-layout — transcript row model + Subtitles-tab posture (M2)

## Description

Closes the #48 root symptom and the #52 posture (M2 workstream per plan
`docs/ops/overnight-plan-2026-11-27.md`; #52's `checkCaptions` engine behaviour stays
frozen — UI-defaults only per [RULING]).

Independent sweep (2026-11-26, #48/#52 evidence): real content spills 18 px–797 px out of the
fixed 20 px `.ts-row` boxes (`src/ui/transcript/transcript.css:108`), painting over rows
below and the footer; imported rows leave a 64 px text column; TWO transcript panes are
mounted at once (streaming + transcript, `Workbench.tsx:948-966`); the Issues panel floods
the first-run view (20–33 lint items on raw ASR output, no identification) and every row
carries a "Speaker 1" chip in single-speaker projects.

**Owner-designed row model (issue #48 body — binding):**

1. Inactive rows: single-line clamp + ellipsis, compact.
2. Active row (playhead within its time span), selected row, and row under edit: clamp
   removed, height auto → virtualizer re-measures (`measureElement` exists), rows below
   shift by the growth; collapses when the playhead leaves.
3. Expansion happens only on time-boundary crossings (keeps the 50 ms long-task gate);
   editing is never inside clipped text — click-to-edit expands first (preserves the frozen
   CC-104.3 word-dblclick path and FR-104.1 fixed timecode slot).
4. Follow-scroll when the expanded active row reaches the bottom edge during playback:
   implement per design.md nearest-neighbour doctrine or record the decision in the unit
   report (design call, not a blocker).

**#52 posture (UI defaults only; [RULING]):** Issues panel collapsed by default with a count
badge; raw-ASR lint items visually de-emphasised versus post-edit items (distinguishing
"unEdited since transcription" is a UI-side fact — engine `checkCaptions` output untouched,
frozen); per-row speaker chip hidden when the project has a single speaker; **single
transcript surface**: the dual mount (streaming pane + transcript pane) collapses to one
component with an honest streaming state — the exact shape is recorded as a decision in the
unit report.

## User Stories

**US-110.1** As Creator Casey, with 200 real transcribed blocks the list is readable at
1440×900: nothing paints over anything; the row I'm looking at is fully visible.
- *Given* a 200-block fixture project at 1440×900, *when* the transcript renders, *then* zero
  row→row text-rect overlap and zero text outside the row container (DOM-rect assertions).
- *Given* playback crosses into a long-text row, *when* it becomes active, *then* it expands
  to full text and rows below shift exactly by the growth; *when* the playhead leaves, it
  collapses back.
- *Given* I click a clamped row to edit, *when* the editor opens, *then* the row is expanded
  first and the editor never renders inside clipped text.

**US-110.2** As Podcast editor Priya, the first run isn't hostile: issues are a count I can
open, raw-ASR lints are quiet, and I don't get 20× "Speaker 1" chips on a one-voice clip.

## Functional Requirements

- **FR-110.1** `transcript.css`/`Transcript.tsx` implement the row model above; virtualizer
  estimate/measure stays bounded (1000 blocks → bounded mounted rows; existing bound test
  stays green).
- **FR-110.2** Structural perf leg: no main-thread long task > 50 ms attributable to row
  expansion during scripted playback across long rows (existing longtask sampler doctrine;
  CI-tolerant threshold, never absolute wall-clocks < 10 s).
- **FR-110.3** Issues panel: default-collapsed + `aria`-labelled count badge; expand/collapse
  state is user-toggleable (persisted per project where the settings slice already does
  this kind of thing, else session); de-emphasis = muted styling for items whose block has
  not been edited since transcription (UI-tracked), no `checkCaptions` signature/behaviour
  change (frozen).
- **FR-110.4** Speaker chip renders only when the project has ≥ 2 speakers (reactive to
  speaker add/remove).
- **FR-110.5** One transcript surface mounted at a time (streaming state is a mode of it),
  decision + before/after DOM recorded in the unit report.
- **FR-110.6** Frozen suites pass unchanged: CC-101.1 (CLS streaming-scoped), FR-104.1
  (fixed timecode slot), CC-104.x (word-dblclick path, row aria-labels `"<speaker>,
  <timecode>, <text>"`), renderedRows bound. Any frozen assertion that makes the design
  impossible → BLOCKED (ledger), never a test edit.

## Technical Specification

DOM-rect L5 legs on the built bundle via a fixture-loaded project (import
`fixtures/captions/senate-veterans-2min.srt` (200-ish real blocks) or the 12-cue
`en-clean-ref` + generated fill via real import UI only — no bridges beyond those the
existing transcript specs already use; new legs stay bridge-light and state it). L2
component tests for clamp/expand states + Issues default posture. L1 for any pure helpers
(expansion decision fn). Follow `knowledge/design.md` transcript rows section; keep Tailwind
token usage.

## Completion Criteria

- [ ] **CC-110.1** zero row→row text overlap + zero text outside the container at 1440×900
  on the fixture project (DOM-rect L5) — chromium
- [ ] **CC-110.2** expand on active/selected/editing + collapse on exit, rows below shift
  exactly by the growth (L2 + L5)
- [ ] **CC-110.3** click-to-edit expands first; frozen word-dblclick path green unchanged
  (L2/L5)
- [ ] **CC-110.4** bounded virtualization with re-measure at 1000 blocks (L5/L2, existing
  bound + new expansion mix)
- [ ] **CC-110.5** no > 50 ms expansion-attributed long task in the scripted-playback leg
  (structural sampler; CI-tolerant)
- [ ] **CC-110.6** Issues panel default-collapsed + count badge; raw-ASR items de-emphasised
  vs post-edit; toggle restores list — L2/L5 with `checkCaptions` byte-unchanged
- [ ] **CC-110.7** single-speaker chip suppression reactive to speaker count (L2)
- [ ] **CC-110.8** single transcript surface mounted (DOM-count assertion: one transcript
  list; streaming mode keeps rows visible) — L5 + report decision entry

## Risks

- Virtualizer re-measure churn during fast playback → expansion only at boundary crossings
  (design), sampler proves it.
- De-emphasis vs identification (#52 "can't tell identical items apart") — timecode/block-id
  anchors in issue rows are unit-111-adjacent scope; record as follow-up if it grows.

## Boundaries

Owns: `src/ui/transcript/**` (rows, issues panel posture), `transcript.css`, the Workbench
transcript mount, new tests. Doesn't own: `src/engine/captions/**` (QC engine frozen),
`src/state/commands/**` (no new commands), split/merge UI (unit-111), status bar (unit-114).

## Docs to consult

`knowledge/design.md` (transcript rows, Issues panel); GitHub #48 (owner model, verbatim) +
#52; `e2e/transcript/**` + `tests` for frozen row invariants; conventions § UI conventions
(virtualization, ARIA row label).
