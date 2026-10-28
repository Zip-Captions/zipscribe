---
status: pending
workflow: default
git:
  change_strategy: unit
  auto_merge: true
created: 2026-10-27
announcements: [changelog, release-notes]
passes: []
active_pass: ""
quality_gates:
  - name: lint
    command: pnpm lint
  - name: typecheck
    command: pnpm typecheck
  - name: unit_tests
    command: pnpm test
  - name: bundle_budget
    command: pnpm build && pnpm check-bundle
  - name: e2e
    command: pnpm test:e2e
  - name: criteria
    command: pnpm verify:unit --from-branch
---

# Intent: Caption Translation

## Description

Translate a project's captions into one or more languages **on-device**, using the same approach zip-captions shipped in its v0.5.0 web client: the browser's built-in Translator API (and LanguageDetector API), wrapped in a backend-agnostic `TranslationEngine` and a generation-counted translation session. Each target language is a `TranslationTrack` that shares the source track's timing; users review and edit translations side by side with the source, see which ones are stale after source edits, and export captions per language (sidecars, or burn-in of one chosen language).

## Business Context

- Localizing captions is the next job after captioning (persona "Localizer Lea", `knowledge/product.md`); cloud tools upload the text to translate it — we don't.
- zip-captions already proved the pipeline (`~/Documents/zip-captions-monorepo/aidlc-docs/v1-parity/live-translation-v1-analysis.md`): per-pair translator cache, strict failure semantics, user-gesture downloads, `UnknownError` recovery. We port the design, not the Angular code.
- Platform reality: the Translator API exists only in **Chrome 138+ / Edge 148+ on desktop** and only in a Window (not in workers). Other browsers get honest gating plus imported/manual translation tracks; a model-based fallback is a seed.

## Completion Criteria

- [ ] **CC-I4.1** Mocked Translator API (per-PR): a 200-block English project is translated to French and Spanish; every block has an entry with status `translated` or `failed` (never source text presented as a translation); main thread shows no long task > 50 ms during the run
- [ ] **CC-I4.2** `[RQ]` Real Translator API (Chrome desktop, release qualification): the same flow with en→fr and en→es completes; wall time per 1 000 blocks recorded
- [ ] **CC-I4.3** Side-by-side review: editing a translation sets `edited`; editing/splitting/merging a source block marks the affected translations stale (domain invariant 10); "Retranslate stale" only touches stale entries
- [ ] **CC-I4.4** Per-language export: SRT/VTT/JSON for any track are byte-exact goldens (incl. RTL Arabic); burn-in of a translation track renders its text (block-level highlight, no karaoke)
- [ ] **CC-I4.5** Unsupported browser (webkit project): translation actions are absent with an explanatory note; importing a translation file and manual translation still work
- [ ] **CC-I4.6** `[MANUAL]` After the language pack is downloaded, translation works with the network disabled (manual Chrome check recorded in the unit report — CI can't provision Chrome's packs)
- [ ] **CC-I4.7** SECURITY-03: no caption or translation text in logs/errors (redaction test)

## Units

| Unit | Discipline | Depends on |
|---|---|---|
| unit-301-translation-engine | dev | local-transcribe-engine/unit-01, caption-studio-ui/unit-102 |
| unit-302-translation-workspace | frontend | unit-301, caption-studio-ui/unit-104, styling-and-export/unit-202 |

## Risks

1. **Context loss**: captions split sentences across blocks; translating block-by-block degrades quality. v1 translates per block (zip-captions parity) and measures; sentence-grouped translation with proportional redistribution is a follow-up if review shows it's needed.
2. **API churn**: built-in AI APIs are young (static language list; dynamic pair listing tracked upstream). Everything goes through `availability()`; no hard-coded "supported" claims beyond UI defaults.
3. **Test environment**: Playwright's bundled Chromium may not ship the Translator API or its models → per-PR tests mock the adapter; real-API runs happen in release qualification on a machine with Chrome desktop (`channel:'chrome'`).

## Boundaries

- Translation fallback for Firefox/Safari, per-track retiming, bilingual stacked burn-in, MP4 soft-subtitle tracks: seeds (`knowledge/product.md`).
- Importing a translation file: `local-transcribe-engine/unit-07` (engine) + this intent's UI.
