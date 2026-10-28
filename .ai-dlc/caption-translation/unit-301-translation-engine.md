---
status: pending
discipline: dev
depends_on: [local-transcribe-engine/unit-01-scaffold-quality-gates, caption-studio-ui/unit-102-editor-core-playback]
workflow: tdd
mode: AHOTL   # design is ported from zip-captions; API is mockable; real-API check is manual
---

# Unit 301: Translation Engine & Session

## Description

Backend-agnostic `TranslationEngine` interface, its Chrome built-in Translator/LanguageDetector adapter, and the `TranslationSession` that fills a project's `TranslationTrack`s — ported from zip-captions v0.5.0 (see `discovery.md`). Plus the pure track-maintenance functions that keep translations consistent with source edits (domain invariant 10) and the commands that expose them to the store.

## User Stories

**US-301.1** As an editor, I add a language and get my captions translated without uploading anything.
- *Given* `availability('en','fr') = 'downloadable'`, *when* `ensurePair('en','fr', {userInitiated:true})` runs inside a user gesture, *then* download progress events (0–100) are emitted and the pair becomes `ready`; *given* `userInitiated:false`, *then* no download starts and status stays `downloadable` (no `NotAllowedError` thrown).
- *Given* a ready pair and 200 source blocks, *when* `session.run(project, 'fr', { visibleIds })`, *then* visible blocks are translated first, every block ends `translated` or `failed`, results arrive as batched `translation:entries` updates, and no main-thread long task > 50 ms occurs (mocked API with realistic latency).
- *Given* the target language changes or the session is cancelled mid-run, *when* in-flight results resolve, *then* they're discarded (generation counter) and the store never shows results from the old run.

**US-301.2** As an editor, failures are visible and recoverable, never disguised.
- *Given* `translate()` rejects for a block, *when* retried, *then* at most 3 attempts are made, after which the entry is `failed`; the failing translator instance is destroyed and rebuilt on the next attempt (`UnknownError` recovery); one aggregated warning per failure run, no text logged.
- *Given* `Translator` is absent (Safari/Firefox/mobile), *when* `engine.isAvailable()`, *then* `{ available:false, reason:'browser' | 'mobile' }` and no translation command is registered as enabled.

**US-301.3** As an editor, translations stay consistent with my source edits.
- *Given* entries for blocks A and B, *when* A is edited, split, or merged with B, *then* invariant 10 holds (property test over random command sequences); *when* A is only retimed, *then* no entry becomes stale.
- *Given* "Mark as reviewed" on a stale entry, *when* applied, *then* its `sourceHash` updates to the current source text and its text is unchanged (one undo step).

**US-301.4** As an editor importing a caption file without language metadata, the language is detected.
- *Given* `LanguageDetector` available, *when* `engine.detectLanguage(sample)`, *then* the top BCP-47 result with confidence is returned; *given* unavailable, *then* `null` (caller asks the user).

## Functional Requirements

- **FR-301.1** `engine/translate/engine.ts`: `interface TranslationEngine { isAvailable(); availability(src, tgt); ensurePair(src, tgt, {userInitiated, onProgress}); translate(src, tgt, text, signal); detectLanguage(text); dispose() }` — shape follows zip-captions ADR-013.
- **FR-301.2** `chrome-translator.ts` (adapter; the only file touching `self.Translator` / `self.LanguageDetector`): per-pair LRU of ≤ 4 instances, pending-create dedupe (user-initiated never joins background), destroy on eviction and on failure, availability mapping per discovery.
- **FR-301.3** `session.ts` + `plan.ts`: per target language; plan = blocks whose entry is missing, stale (when "retranslate stale" requested) or failed with attempts < 3; visible-first order; batches of ≤ 20 blocks with a macrotask yield between batches; text cache `src->tgt:text` (≤ 500); generation counter; `AbortSignal` cancel ≤ 500 ms. Block text sent with `'\n'` replaced by spaces (renderer re-wraps translated text).
- **FR-301.4** Pure track functions (`engine/translate/track.ts`): `applyEntries`, `onSourceEdit/Split/Merge/Delete` (invariant 10), `markReviewed`, `staleIds(project, lang)`, `sourceHash(text)` (fast stable hash; not crypto).
- **FR-301.5** Commands (registered via unit-102's registry): `translation-add-track`, `translation-remove-track`, `translation-edit-entry` (undoable), `translation-mark-reviewed` (undoable). Machine results from a session run are applied as **job output** (like transcription segments), not as undo steps; removing a track is undoable.
- **FR-301.6** Pass-through: when `detectLanguage` (if available) says a block is already in the target language, the entry is set to the source text with status `translated` (flag `passThrough` in the run stats only).
- **FR-301.7** SECURITY-03: text never logged; errors carry codes (`TRANSLATE_FAILED`, `PAIR_UNAVAILABLE`, `DOWNLOAD_FAILED`, `NOT_ALLOWED`) only.

## Technical Specification

- Paths: `src/engine/translate/{engine,chrome-translator,session,plan,track}.ts`. The adapter runs on the main thread (architecture invariant 1 exception); everything else is pure and vitest-covered with a fake engine.
- Types `TranslationTrack`, `TranslationEntry` from `knowledge/architecture.md`.

## Completion Criteria

- [ ] **CC-301.1** Fake-engine tests: availability mapping, user-gesture gating, LRU eviction + destroy, pending dedupe, 3-attempt cap, `UnknownError` rebuild, generation discard, cancel ≤ 500 ms
- [ ] **CC-301.2** Property test: invariant 10 under random edit/split/merge/delete/retime sequences
- [ ] **CC-301.3** Long-task assertion (Playwright, mocked API with 30–300 ms latency): no main-thread task > 50 ms translating 1 000 blocks
- [ ] **CC-301.4** `[MANUAL]` Manual real-API check on Chrome desktop (en→fr, en→es; offline after download) recorded in the unit report with Chrome version
- [ ] **CC-301.5** Redaction test passes; coverage ≥ 85% on `engine/translate/**` (adapter excluded)

## Risks

- Translator throughput is sequential per instance → long projects take minutes; progress + visible-first ordering keep it usable. Measure 1 000-block wall time in the manual check.

## Docs to consult

- docs-mcp `chrome-built-in-ai` → translator-api, language-detection, get-started (user activation)
- zip-captions analysis (path in `discovery.md`), esp. `chrome-translator.service.ts` and `segment-translation-session.ts` sections
