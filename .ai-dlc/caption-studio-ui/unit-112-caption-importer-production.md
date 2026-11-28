---
status: in_progress
phase: mvp
discipline: frontend
depends_on: [caption-studio-ui/unit-102-shell-navigation, caption-studio-ui/unit-104-transcript-editor, caption-translation/unit-304-language-plumbing]
workflow: default
mode: AHOTL
---

# unit-112-caption-importer-production — real caption importer on the click path; import language visible & persisted (M3)

## Description

Closes #53, #54. "Choose file…" rejects every caption file with `UNSUPPORTED_CAPTION`
because production intake is wired to the unit-07 **placeholder** importer
(`src/app/ports.ts:71` `createPendingUnit07ImportService()` — `sniff` → always `null`,
installed at `src/app/context.ts:527`). The drag-and-drop path already works because the
Import-captions dialog uses the real engine port
(`createEngineCaptionImportPort()` installed at `src/app/context.ts:592`, parsing via
`src/state/services/caption-import.ts` → dynamic import of `engine/captions/import`). This
unit is **composition wiring + language field** — the engine parser already exists (unit-07)
and stays byte-identical.

Additional measured gaps from #53/#54 (both binding acceptance):
- once media is loaded, **no click control remains** to add a caption file (`Choose file…`
  count drops to 0);
- after a successful import the sidebar stays on the **Media** tab — imported rows invisible;
- the dialog's Language field (`caption-import-language`) is **disabled + permanently
  empty** (`CaptionImportDialog.tsx:226`, `title=CAPTION_IMPORT_LANGUAGE_UNBOUND`) — the
  detected language is neither shown nor settable (US-07.2, US-301.4);
- after import (or after Add-as-translation from a file) the **Languages section still
  shows the empty state** ("Transcribe or set a source language…") while the Export dialog
  correctly lists `source` + `es` tracks — the section contradicts project truth.

**[RULING — orchestrator, plan `docs/ops/overnight-plan-2026-11-27.md` § M3]:** no
`src/engine/**` edits (parser + intake contract frozen; digest-attested). If restoring
behaviour conflicts with a frozen contract, implement the honest state and record a
proposed contract edit under "Contract changes" — never fake. Bad-file toasts use human
copy, codes only in a secondary detail line (#65 acceptance pattern).

## User Stories

**US-112.1** As an editor with an existing caption file, I import it next to my video **by
clicking**, and I see the rows immediately. (US-07.1 + US-109.1)

- *Given* fresh profile, *when* I use "Choose file…" and select
  `fixtures/speech-2min.mp4` **and** `fixtures/captions/en-clean-ref.srt` together (the
  input is `multiple`), *then* media loads AND the caption imports (12 rows) — no
  `UNSUPPORTED_CAPTION`, no dialog-less silent loss.
- *Given* media already loaded, *when* I click a still-visible caption-add control and pick
  the `.srt`, *then* the Import-captions dialog opens (same dialog as DnD) and Import lands
  12 rows.
- *Given* a successful import, *then* the sidebar tab is **Subtitles** (rows visible).
- *Given* a non-caption file (`fixtures/captions/garbage.txt` or `undecodable.bin`),
  *then* a
  human-worded rejection toast/`role=alert` with the code only in a secondary line — never
  silent, never content-bearing (SECURITY-03).

**US-112.2** As an editor, I see what language the imported file is in, and the project
knows it. (US-07.2 + US-301.4)

- *Given* the Import dialog with `en-clean-ref.srt` (no language metadata), *then* the
  Language field shows the **detected** language (evidence-style is allowed: the frozen
  `CaptionsImportPayload` has no language field) and is **not** permanently disabled — an
  explicit user choice is settable.
- *Given* import confirmed with a detected-or-chosen language, *then* `project.language`
  equals it through the frozen command seam (unit-304 doctrine: explicit choice wins over
  detection) and the Languages section shows the source language + Add-language affordance
  — **not** the "Transcribe or set a source language" empty state.
- *Given* an Add-as-translation import for `es` from a file, *then* the Languages section
  lists the `es` track (parity with what the Export dialog already reports).

## Functional Requirements

- **FR-112.1** Replace the placeholder default at the composition root:
  `src/app/context.ts` installs a real `ImportCaptionsService` whose `sniff` uses the
  engine's extension+content sniff and `importCaptions` routes through the existing
  `caption-import.ts` engine port (dynamic import preserved — check-bundle must stay green;
  parse code must NOT enter the initial JS graph). `createPendingUnit07ImportService`
  stays exported (test hook parity with `setCaptionImportOverride`).
- **FR-112.2** Click path end-to-end: `Choose file…` remains available after media loads
  (a caption-add affordance in the Media tab per design.md; same file-input `multiple`
  semantics); successful import focuses/opens the **Subtitles** tab.
- **FR-112.3** Language visibility/persistence per US-112.2 without touching the frozen
  `CaptionsImportPayload`: detection via the unit-304 detection seam
  (`state/jobs.ts` `detectLanguage` on the translation raw engine — Window
  LanguageDetector; yielding-batch rule from conventions applies), explicit selection wins,
  persisted through an existing frozen-legal command path. If NO frozen-legal path can
  carry the value → honest UI + `Contract changes` proposal in the report; never a silent
  fake.
- **FR-112.4** Languages section truthfulness: renders from project tracks
  (`project.language` + `project.translations`), replacing the transcribe-only empty state
  whenever any track exists.
- **FR-112.5** Frozen surfaces unchanged: `src/engine/**` (digest), `src/state/services/intake.ts`
  contract + CC-101.2 never-silent rejection legs, unit-07 golden import tests, unit-101
  DnD path legs, unit-104 dialog report-before-confirm legs (report still renders BEFORE
  confirm). Any required edit → BLOCKED (ledger).

## Technical Specification

L5 (chromium, built bundle, real `<input type=file>` via `setInputFiles` — NO bridge
`command()` seam on intake legs; bridge allowed only where an existing frozen spec already
uses it): both-files chooser; media-then-caption click path (control visible after media);
tab-switch assertion; 12-row transcript count (counts/timecodes only — SECURITY-03);
garbage-file rejection toast shape (human copy + code in secondary line, no content);
Language field non-empty for the `en` fixture + settable (type a value → wins); Languages
section reflects source track after import and the `es` track after Add-as-translation.
L2 (jsdom): caption-add affordance visibility per media state; Languages section branches
(empty vs tracks); dialog Language field enabled-state logic (detected / user-set /
absent-API honest fallback). L1: composition-root test — `createAppContext` (or the
equivalent factory) installs a non-placeholder importer (sniff of a real fixture bytes →
`srt`, not `null`) without any browser-only globals beyond what context.ts already uses.

## Completion Criteria

- [ ] **CC-112.1** multi-select chooser loads media + imports 12-cue caption, no
  `UNSUPPORTED_CAPTION` (L5)
- [ ] **CC-112.2** caption-add control still present after media load; click path opens the
  dialog and imports (L5)
- [ ] **CC-112.3** sidebar lands on Subtitles after successful import (L5)
- [ ] **CC-112.4** garbage file → human-copy rejection, code only secondary, never silent
  (L5 or L2 if the toast is unit-testable there — pick lowest honest level)
- [ ] **CC-112.5** Language field shows detected language (en fixture) and is settable;
  explicit choice wins (L5 + L2)
- [ ] **CC-112.6** after import, `project.language` persists and the Languages section
  shows source (+ `es` after Add-as-translation) — no false empty state (L5)
- [ ] **CC-112.7** frozen attestation: engine digest + intake contract + unit-07 golden +
  DnD-path legs unchanged; sniff/import wiring never pulls parser into initial bundle
  (static/digest leg lead-citing `CC-112.7`)

## Risks

- Window LanguageDetector availability in CI chromium: unit-304 L5 already proves the
  detection seam green there — reuse its sanctioned harness shape; if unavailable in
  webkit, chromium-only leg is acceptable per run config (state it in the spec-test header).
- `project.language` persistence seam for the import path may not exist in frozen-legal
  commands (unit-304 wired it for the **transcribe** path). Explore first (test-author
  characterizes; builder fixes) — fallback = Contract-changes proposal, honest UI meanwhile.
- Media-tab affordance must not disturb unit-102/110 frozen posture legs.
- Multiple-input `setInputFiles([mp4, srt])`: intake ordering (probe async) must not drop
  the caption — if ordering is provably racy by design, two-step click path (CC-112.2)
  remains the acceptance floor and CC-112.1 documents the measurement.

## Boundaries

Owns: `src/app/context.ts` importer wiring, Media-tab affordance in
`src/ui/shell/Workbench.tsx` (+ its css), `CaptionImportDialog.tsx` language field,
Languages section component, `e2e/intake/**` + `tests/unit/app|ui` additions.
Doesn't own: `src/engine/**` (frozen, digest), `src/state/services/intake.ts` contract,
transcript row CSS model (unit-110 merged), merge affordances (unit-111),
`src/state/commands/**` (reuse as-is; new command only via Contract-changes proposal).

## Docs to consult

GitHub #53/#54 (measured repros + evidence dirs); `knowledge/design.md` § Bring-your-own
captions + Media tab asset card; `src/state/services/caption-import.ts` header;
`src/state/services/intake.ts` sniff doctrine; unit-304 spec + report (detection seam,
explicit-wins rule); conventions § Testing strategy + privacy.
