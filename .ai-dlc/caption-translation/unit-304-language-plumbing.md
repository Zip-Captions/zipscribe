---
status: in_progress
phase: mvp
discipline: frontend
depends_on: [caption-translation/unit-302-translation-workspace, caption-studio-ui/unit-108-stream-commit, caption-studio-ui/unit-101-workbench-shell, local-transcribe-engine/unit-05-transcription-pipeline]
workflow: default
mode: AHOTL
---

# unit-304-language-plumbing — production `project.language` plumbing (M1)

## Description

Closes #51 (blocker), finishes the Transcribe-popover half of #63. The independent sweep
(2026-11-26) proved the translation journey is user-unreachable: nothing in production ever
sets `project.language`, so `LanguagesSection` (Subtitles tab) is permanently its
"Transcribe or set a source language…" empty state. Existing green e2e was a false signal —
the suites inject the language via the `src/ui/testing/*` bridge (`setProjectLanguage`).

The Transcribe popover already collects a spoken-language choice (`transcribe-language-select`,
`''` = Auto-detect) and the frozen protocol already carries the detected language
(`JobStats.language` on `job:done`; `AsrRequest.language` accepts `null`). This unit is
**state + UI wiring only**:

1. Start with an explicit Language selection sets `project.language` at Start time.
2. Auto-detect (no explicit choice) stores the detected language once the ASR job reports it
   (`job:done` `stats.language`, filtered by jobId exactly as the existing `job:done` handler
   does). An explicit selection is never overwritten by a differing detection.
3. `project.language` rides project persistence (serialize/restore round-trip).
4. While in the popover (#63 ride): model rows render friendly labels (never raw registry ids
   or revision hashes), language options render human names (never bare ISO codes), and the
   default selection is **Auto-detect** (the sweep found `en`/browser-language defaulted).
   If any frozen committed test depends on the current browser-language default or raw-id
   labels, DROP that sub-change, keep the rest, and record the drop in the unit report as a
   follow-up — never edit a frozen test.

**[RULING — orchestrator, plan docs/ops/overnight-plan-2026-11-27.md] No engine contract
change.** `src/engine/protocol.ts` and `src/engine/model.ts` must stay byte-identical to the
branch point; any need to touch them is a BLOCKED condition → ledger, not an edit. Persistence
of language follows the existing job-output doctrine: `EditorApp.applyWithoutHistory`
(the same seam the transcribe commit uses), NOT a new undoable command — undo-chain surprise
rules (M6/#66 ruling) forbid import/job artifacts entering the undo stack.

## User Stories

**US-304.1** As Creator Casey, after transcribing I can add a translation language without
any developer trick — the Languages section opens up because the app recorded what I spoke.

- *Given* a fresh app with media, *when* I pick Language "Spanish" in the Transcribe popover
  and Start, *then* `project.language` is `es` immediately (job output seam), and after the
  job completes the Subtitles tab Languages section shows the Add-language control — all
  driven by real clicks, no test bridge (L5 leg, CC-304.4; L1 legs CC-304.1).
- *Given* I leave the default Auto-detect, *when* the ASR job completes reporting detected
  `en` in `job:done` stats, *then* `project.language` becomes `en` without any user action
  (CC-304.2).
- *Given* I explicitly chose `fr` but the engine detects `en`, *when* the job completes,
  *then* `project.language` stays `fr` (explicit choice wins; CC-304.2).

**US-304.2** As Journalist Jonas, the transcribe popover speaks human: named models, named
languages, honest Auto-detect default (#63).

## Functional Requirements

- **FR-304.1** Wiring lives at the existing seams: `src/state/jobs.ts` (Start-time set +
  `job:done` set via the injected editor-app seam, mirroring `transcribe-commit`'s
  job-output pattern) and `src/ui/shell/TranscribePopover.tsx` (labels + Auto-detect default).
  No new worker protocol members, no engine edits.
- **FR-304.2** Bridge ban: the new L5 spec file (`e2e/intent/caption-translation-language-plumbing.spec.ts`)
  contains zero references to `__zip` bridge identifiers or `src/ui/testing` — enforced by a
  static self-parse attestation leg (own file text, repo `citationsOf`-era doctrine from
  unit-205/303). It drives: real `setInputFiles` file-chooser intake of
  `fixtures/speech-2min.mp4`; real popover clicks (language select, Start, download-confirm
  button); real ASR worker with the registry `tiny` model served from `.cache/models` via the
  established e2e model route (device `wasm`, chromium; `@real`-flow precedent from
  `e2e/integration/**`); scripted built-in Translator via the sanctioned `addInitScript`
  inject seam only (unit-301/302 shape — that is an API injection, not state injection).
  Assertions are DOM locators only (row counts, control presence, accessible names, badges).
- **FR-304.3** The Languages journey asserts, in order: before transcription the section shows
  the empty-state paragraph; after an Auto-detect job completes it does NOT (Add-language
  control present); clicking Add language → Spanish renders the `es` track row with the
  Machine-translated badge, with the mocked Translator filling entries. All via clicks.
- **FR-304.4** Existing translation suites keep their bridge usage untouched
  (`e2e/intent/caption-translation.spec.ts`, `e2e/translate/**` must not be edited).
- **FR-304.5** SECURITY-03: no transcript/fixture caption text in logs, artifacts or assertion
  messages — counts, codes, lengths, language tags only.

## Technical Specification

L1 vitest beside source: extend/derive from the `src/state/jobs.test.ts` harness (fake engine
posts scripted `job:done` with `stats.language`, per the frozen protocol shapes). L2
`TranscribePopover` component tests for labels/default. No store internals asserted — public
store state + DOM only. Model cache/registry untouched. `pnpm models:fetch` is a pre-test
setup step (tiny + VAD present); the L5 leg blocks all network per harness doctrine.

## Completion Criteria

- [ ] **CC-304.1** Start with explicit Language sets `project.language` at Start (before any
  done event) through the job-output seam — L1/L2 tests
- [ ] **CC-304.2** Auto-detect persists the detected language from `job:done` `stats.language`
  (jobId-filtered; foreign/late events ignored); explicit selection not overwritten by a
  differing detection — L1 tests
- [ ] **CC-304.3** `project.language` survives the persistence round-trip (serialize →
  IndexedDB restore → same value) — L1 test
- [ ] **CC-304.4** bridge-banned L5 journey green: intake by real file chooser → Auto-detect
  transcribe on real tiny worker (fixture media, `.cache/models` route) → Languages section
  reachable → Add language → Spanish → track row appears (Machine-translated badge) — DOM
  only; plus the static no-`__zip`-identifier attestation leg (unit-205 J4b gates-anchor
  doctrine, lead-cites `CC-304.4`)
- [ ] **CC-304.5** popover labels (#63): friendly model labels (no raw id/hash substrings),
  human language names, Auto-detect is the default selection; if a frozen committed test
  pins the old default/labels, that sub-change is dropped and recorded — frozen tests
  untouched — L2 tests
- [ ] **CC-304.6** `src/engine/protocol.ts` + `src/engine/model.ts` byte-identical to the
  branch point AND `pnpm test:e2e -- e2e/intent e2e/translate` fully green with those specs
  unedited — anchored by a static blob-attestation leg lead-citing `CC-304.6` (unit-303
  CC-303.4 tiered CI-robust doctrine)

## Risks

- Real-worker L5 leg CPU variance → generous per-test timeouts (never lower an assertion),
  tiny model only, 2-min fixture; reuse the integration model-route helpers.
- #63 default-flip vs frozen FR-2.0.6 request assertions → pre-checked drop path documented
  above; builder records which sub-change shipped.

## Boundaries

Owns: `src/state/jobs.ts` (language plumbing only), `src/ui/shell/TranscribePopover.tsx`,
`src/ui/translate/LanguagesSection.tsx` (label/reachability surface if needed — no behaviour
rework), new L5 spec file + its spec-local helpers, new `src/ui/language-labels.ts` (or
co-located map), L1/L2 test files, shared fake-engine extension in `src/test-support/`
(additive). Doesn't own: `src/engine/**`, `src/engine/protocol.ts`/`model.ts` (frozen),
`e2e/intent/caption-translation.spec.ts`, `e2e/translate/**`, offline-model availability
(unit-206), status-bar truth (unit-114), caption-import language (#54 → unit-112).

## Docs to consult

`e2e/intent/caption-studio-ui.spec.ts` + `caption-translation.spec.ts` (harness doctrine);
`src/state/transcribe-commit.ts` (job-output seam precedent); unit-302 LanguagesSection;
docs-mcp `chrome-built-in-ai` (Translator inject shape); `knowledge/conventions.md` §
Testing strategy + § UI conventions; `knowledge/product.md` § Roadmap addendum (M1).
