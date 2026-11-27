# UX walkthrough stories (agent-executable)

Every story is executed by an agent **against the live rendered app only** — rules in
`ux-review-plan.md`. Steps name controls by the label a user should see; the agent must
verify each against the live DOM and record a **documentation/defect finding** when a named
control is absent, mislabeled, or unreachable (that itself is the finding — never invent a
workaround and continue silently). Content in the runs comes from `fixtures/` samples only
(SECURITY-03 — no owner media, no transcript text in logs; screenshots of placeholder/fixture
content only).

Known-issue map (do not re-file; record as "known"): #48 row overflow · #49 guidance/undiscoverable ·
#50 Start silent-hang · #51 translation unreachable (project.language never set) · #52 Subtitles-tab
crush + QC flood + Speaker-1 spam.

## J-01 Intake — first run to transcript

Goal: a new user drops a video and gets captions.

1. Open the app URL (fresh profile). Expect: a clear starting point — new project / open project /
   choose a file — reachable without guessing.
2. Open **Media** tab → click **Choose file…** → select `fixtures/speech-2min.mp4`. Expect: asset
   appears with duration/codec; Transcribe becomes available.
3. Header **Transcribe** → popover lists models with honest availability; pick
   **whisper-base (int8)** → Start. Expect: popup closes (known: #50 does not close), a visible
   progress state appears, caption rows appear incrementally, completion is announced.
4. Rows render fully readable, no overlap (known: #48), no single-speaker chip spam (known: #52).
   Pass = 1–4 all observed; every deviation captured with screenshot + DOM state.

## J-02 Review & edit

1. Click a caption row → row selects (visible selection state), playhead seeks to it.
2. Double-click a word → inline word editor opens for that word (frozen CC-104.3 path).
3. Change one word, Enter → row updates; autosave indicator moves to saved within ~2 s.
4. Split a block (keyboard shortcut + menu path both), merge back. Expect: undo/redo restores exactly.

## J-03 QC / Issues panel

1. Immediately after J-01: inspect the Issues panel. Expect: **quiet by default** — raw ASR
   lint must not present as a wall of user "issues" (known: #52, 33 at once).
2. Introduce one genuine problem (long line via edit) → the corresponding issue appears.
   Expect: issue list is actionable (click jumps to row), filterable, collapses cleanly.

## J-04 Translation (known blocked by #51)

1. Subtitles tab → Languages section after J-01. Expect per spec: Add language available.
   Actual (known #51): permanently "Transcribe or set a source language…". Record exact DOM.
2. If unblocked later: Add language → Spanish (online) → pack downloads with visible progress →
   offline → edit a row → Re-translate stale → edited row fills.

## J-05 Styling

1. **Style** tab → pick each preset → overlay preview changes distinctly; contrast readable
   (WCAG notes in unit-200 report).
2. Change one style field → persists across reload (autosave) and applies to export.

## J-06 Export

1. Export path → SRT and VTT files download; open both: content matches edited transcript,
   timings sane, stale translations excluded/marked per spec.

## J-07 Persistence & reopen

1. ⌘S → reload the tab (still same address). Expect: project restored with transcript, edits,
   scroll position/context per FR-106.5.
2. Open a **second project** from the list, then back. Expect: no cross-project bleed.

## J-08 Offline operation

1. DevTools Network→Offline, reload. Expect: app shell + projects load (SW); offline chip visible.
2. Model cached → transcription still works offline (or the honest fast-fail when not cached —
   must be one or the other, never a hang).

## J-09 Install & PWA chrome

1. ⋯ menu → **Install app** present; installing yields a standalone window that boots offline
   after one online launch (known: first offline boot race, queue #3 remedy).

## J-10 Speakers / diarization

1. With a diarized fixture (`.night/csa-*` agent fixtures or diarize sample), speaker labels are
   consistent across transcript, timeline lane, and Speakers view; single-speaker projects show
   no per-row chip spam (known #52).

## J-11 Header, status bar, About

1. GPU toggle actually changes inference device (status reflects it).
2. ⋯ → About panel lists models/licenses (unit-205); every menu entry does something real.
3. Status bar communicates current state truthfully (save state, job state, offline).

## J-12 Keyboard & accessibility

1. Tab order reaches every interactive control with a visible focus ring; all shortcuts in the
   help/menu actually work; transcript + panels announce via live regions (AT probe optional).

## Severity rubric

- **blocker** — journey cannot complete (e.g. #50, #51)
- **major** — misleading/broken UX, silent failure, unreadable UI (e.g. #48, #52)
- **minor** — friction, redundant ink, inconsistent labels
- **nit** — copy/polish
