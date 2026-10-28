# Discovery Log: Caption Translation

Research findings with sources. Re-verify time-sensitive items at unit start.

## Prior art: zip-captions v0.5.0 (web client)

Source: `~/Documents/zip-captions-monorepo/aidlc-docs/v1-parity/live-translation-v1-analysis.md` (2026-10-19; v1 baseline `78637386`, tag `v0.5.0-rc.5`, code under `packages/client/src/app/services/translator/`).

| Pattern | What it does | Zipscribe disposition |
|---|---|---|
| `translator-api.adapter.ts` | Thin wrapper over `self.Translator` so tests can mock the global | **Adopt** (`engine/translate/chrome-translator.ts` adapter) |
| Availability state machine | `available/downloadable/downloading/unavailable` → `ready/downloadable/downloading/unavailable/error` | **Adopt** |
| User-gesture downloads | Download only when `userInitiated`; background requests for a downloadable pair return null + status `downloadable` (avoids `NotAllowedError`) | **Adopt** — "Add language" / "Download" buttons start downloads |
| Per-pair LRU translator cache | `Map<"src->tgt", Translator>`, cap 4, destroy on eviction; pending creations deduped; a user-initiated request never joins a background one | **Adopt** |
| `UnknownError` recovery | Chrome translators can enter a permanently broken state; destroy and rebuild the instance | **Adopt** — drop instance on failure, rebuild on next attempt |
| Strict vs lenient | `translateSegmentsStrict` returns null on failure so failures are distinguishable from pass-through | **Adopt strict only** — a failed entry is `status:'failed'`, never source text |
| `SegmentTranslationSession` | Generation counter discards stale in-flight results; ≤ 3 attempts per segment; visible-first ordering; keeps previous target's results during a target switch | **Adopt** (per target language; visible-first = transcript viewport) |
| Per-segment source language + pass-through | Segments already in the target language resolve immediately | **Adopt pass-through** for blocks detected as target language (rare; mixed-language media) |
| 150 ms latest-wins live channel | For interim live captions | **Not needed** (file-based, no interim line) |
| Segment text cache (≤ 500) | Avoid re-translating identical text | **Adopt** (keyed `src->tgt:text`, per session) |
| Logging | One aggregated `console.warn` per failure run, error object only, no caption text | **Adopt** (SECURITY-03) |
| Accuracy disclaimer | Absent in v1; zip-captions V2 ADR-013 requires a non-dismissible "Translation may be inaccurate" notice | **Adopt the V2 requirement** — persistent note in the Languages panel + "Machine-translated" badge |

ADR-013 (zip-captions V2) `TranslationEngine` interface: `isAvailable`, `getSupportedPairs`, `isLanguagePairAvailable`, `downloadLanguagePack`, `translate`, `detectLanguage`, `dispose` — our interface follows its shape so a second backend can be added without touching the session.

## Chrome built-in Translator / LanguageDetector APIs (verified 2026-10-27, docs-mcp `chrome-built-in-ai`)

- Support: Chrome 138+, Edge 148+; **desktop only** (not mobile); not Safari/Firefox. Feature-detect `'Translator' in self`.
- `Translator.availability({sourceLanguage, targetLanguage})` → `'unavailable' | 'downloadable' | 'downloading' | 'available'`. `Translator.create({sourceLanguage, targetLanguage, monitor(m){ m.addEventListener('downloadprogress', e => e.loaded) }})`; `create()` for a non-downloaded pack requires **user activation** (`navigator.userActivation.isActive`). If the download fails, progress events stop and the ready promise rejects.
- `translator.translate(text)` and `translateStreaming(text)`; **translations are processed sequentially** per translator — batch and show progress.
- Language packs are per language, BCP-47 codes. Chrome's documented list (subject to change): ar bg bn cs da de el en es fi fr he hi hr hu id it ja kn ko lt mr nl no pl pt ro ru sk sl sv ta te th tr uk vi zh zh-Hant.
- **Not available in Web Workers**; available to top-level windows and same-origin iframes (cross-origin via `allow="translator"`). → engine adapter runs on the main thread (architecture invariant 1 exception).
- Built-in AI "get started" page lists storage/hardware requirements (≥ 22 GB free on the profile volume, model removed if free space < 10 GB) — **unverified whether these apply to the Translator expert models or only to Gemini Nano APIs**; surface `downloadable`/`unavailable` honestly either way.
- https://developer.chrome.com/docs/ai/translator-api · https://developer.chrome.com/docs/ai/language-detection · https://developer.chrome.com/docs/ai/get-started

## Fallback engines (seed, not v1)

- transformers.js MarianMT/Opus-MT (Helsinki-NLP, CC-BY 4.0) in a worker would cover Firefox/Safari per language pair (~300 MB per pair at fp32, less quantized — measure). NLLB-200 is **CC-BY-NC 4.0** → excluded under product rule 1 (commercial-safe licensing).

## Open questions

- [ ] Does translation keep working offline once packs are downloaded? (expected yes; verify manually on Chrome, record in unit-301 report)
- [ ] Does Playwright's `channel: 'chrome'` on the release-qualification machine expose `Translator` with packs provisionable by the `qualify` run, or is the real-API check manual?
- [ ] Block-level vs sentence-grouped translation quality on the `en-clean` fixtures (spot review of 50 blocks, fr/es) — decides whether sentence grouping becomes a follow-up
