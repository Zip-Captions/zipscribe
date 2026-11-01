---
status: pending
phase: mvp
discipline: frontend
depends_on: [unit-102-editor-core-playback, unit-103-timeline, local-transcribe-engine/unit-06-speaker-diarization, local-transcribe-engine/unit-07-caption-import]
workflow: tdd
mode: AHOTL
---

# Unit 104: Transcript Editor (virtualized sidebar)

## Description

Subtitles tab: virtualized block list with speaker chips, timecodes, click-word-to-seek, inline word editing that preserves timing, split/merge affordances, **search + replace** (competitor gap), speaker rename/reassign/filter UI over engine-1/06 pure APIs, beta badge + confidence dimming, streaming skeleton rows during transcription. Satisfies orig. US-2.1 / FR-2.1.1–2.1.3.

## User Stories

**US-2.1.1** (orig. FR-2.1.1) As an editor of long videos, the transcript stays fluid.
- *Given* 10 000 blocks, *when* scrolling at wheel-speed (Playwright `mouse.wheel` trace), *then* ≥ 55 FPS and DOM row count ≤ 3× viewport rows (virtualization bound assertion, `@tanstack/react-virtual` dynamic sizes).

**US-2.1.2** (orig. FR-2.1.2) As an editor, clicking any word seeks there.
- *Given* any word token, *when* clicked, *then* `arbitrator.seek(word.start)` ≤ 1 frame later and block enters selection; row auto-scroll never fights manual scroll during edit (scroll intent detection).

**US-2.1.3** (orig. FR-2.1.3) As an editor, fixing spelling never breaks timing.
- *Given* double-click word → contenteditable, *when* typing/Enter, *then* `block-edit-text` commits with **unchanged** word times (golden); `Shift+Enter` inserts manual line break (CapCut convention); `Esc` reverts; blur auto-commits.
- *Given* pasted multi-line text, *when* committed, *then* sanitized (no HTML), line breaks → manual-break tokens.

**US-2.1.6** As an editor, I find and fix systematic errors fast (gap both competitors lack).
- *Given* `⌘F` → query, *when* searching (debounced 120 ms), *then* matches highlight across all blocks (index over lowercased text), `F3/Shift+F3` cycles with viewport jump; *given* replace field + `Replace all`, *when* applied, *then* one `replace-text` command = one undo step; case-sensitive + whole-word options.

**US-2.1.7** As a podcast editor, I work the speaker layer (engine-1/06 in UI).
- *Given* any block, *when* speaker chip clicked, *then* popover: rename (global, "Apply to all N blocks" default + "this block only" secondary), recolor (palette), merge-with-speaker, reassign mode (paint selected word range to speaker — calls `reassign`), *given* filter menu, *when* speaker hidden, *then* transcript + timeline hide their blocks (view-only; data intact); *given* `speakerSource:'auto-beta'`, *when* rendered, *then* "Beta" badge + tooltip explaining manual review encouraged; mutations flip badge to `manual` (domain invariant 5).

## Functional Requirements

- **FR-104.1** Row = speaker chip + timecode (`TimecodeInput` on select, our timing-input gap-filler) + text + confidence dot; ARIA label per `knowledge/conventions.md`.
- **FR-104.2** Virtualization: dynamic-size mode, overscan 6, `scrollToIndex` on seek/active-block; measurement cache invalidated by font-load + style change events.
- **FR-104.3** Active-block following: rAF-throttled, `block:'nearest'`, paused while user scrolls/edits (30 s or scroll-intent resume).
- **FR-104.4** Editing commits exclusively via command registry (conventions rule); contenteditable sanitized; IME-safe (composition events don't dispatch mid-composition).
- **FR-104.5** Search index rebuilt lazily on block-version bump; highlight via text-range spans (no HTML injection).
- **FR-104.6** Streaming mode: `job:segments` appends skeleton rows with shimmer beyond frontier (from `jobs` store); user edits during streaming land in committed region only.
- **FR-104.7** Delete + close gap (unit-105 binds `Shift+Delete`): `block-delete-close-gap` removes the block and extends its neighbours to meet at the gap midpoint; media is never cut and later blocks never shift (domain invariant 9). True ripple with media cuts = seed.
- **FR-104.8** Imported-caption tools (engine: `local-transcribe-engine/unit-07`): QC "Issues (n)" filter + per-row issue dots + `⌘'`/`⌘⇧'` navigation; "Align to audio" toolbar action (progress, cancel, % aligned result toast); "Shift / stretch timing…" dialog (offset or two-point sync, preview before apply); "Re-flow captions" action; dotted underline on words with `timing:'estimated'`.
- **FR-104.9** Caption-file drop onto an open project opens the import dialog (`knowledge/design.md` § Bring-your-own captions) — replace source vs add as translation, report before confirm; one undo step.

## Completion Criteria

- [ ] **CC-104.1** 10k-block: ≥ 55 FPS scroll + row-count bound (chromium trace)
- [ ] **CC-104.2** Click-word-seek ≤ 1 frame; auto-scroll never moves viewport during edit (tested)
- [ ] **CC-104.3** Edit-preserves-timing goldens incl. paste sanitize + IME composition test
- [ ] **CC-104.4** Search/replace: match count + replace-all single-undo + F3 cycling (property test random corpora)
- [ ] **CC-104.5** Speaker ops: rename/recolor/merge/reassign/filter — each one undo step, badge transitions correct
- [ ] **CC-104.6** axe: 0 critical on populated transcript; all rows reachable by keyboard
- [ ] **CC-104.7** Imported-caption flow e2e (mocked worker for align): drop `vendor.srt` on a project → report → confirm → QC issues listed → fix one via jump → shift timing +0.5 s → align → estimated underlines disappear on aligned words; each step one undo
- [ ] **CC-104.8** Close-gap delete: neighbours meet at gap midpoint; later blocks' times unchanged
- [ ] **CC-104.9** All gates green

## Risks

- Dynamic row measurement w/ webfont late-load → re-measure on `document.fonts.ready` + style-change bus (tested with slow-font throttle).

## Docs to consult

- docs-mcp `@tanstack/react-virtual` (dynamic sizes) · knowledge/design.md (interaction specs) · CapCut transcript-editing doc (design § Sources)
