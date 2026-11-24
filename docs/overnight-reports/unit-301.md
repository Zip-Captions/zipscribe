# Unit report: unit-301-translation-engine

Status: **complete** (CC-301.4 `[MANUAL]` awaiting owner) — PR #24 → squash `30b4f67`, CI run 44434157228 (fixtures-verify + quality + preview-deploy) all green. Branch `ai-dlc/caption-translation/unit-301-translation-engine`.

## Completion criteria

| ID       | level    | passing tests                                  | result                              |
| -------- | -------- | ---------------------------------------------- | ----------------------------------- |
| CC-301.1 | untagged | 47                                             | pass                                |
| CC-301.2 | untagged | 6                                              | pass                                |
| CC-301.3 | untagged | 1 (playwright, e2e/translate/longtask.spec.ts) | pass                                |
| CC-301.4 | MANUAL   | —                                              | **PENDING owner** (checklist below) |
| CC-301.5 | untagged | 5                                              | pass                                |

`[RQ]` items: none. `[DEPLOY]` items: none.

### CC-301.4 `[MANUAL]` checklist — owner, Chrome desktop (≥ 140, built-in Translator enabled)

- [ ] `chrome://settings/language` → translation models available; open the app, add a French track (machine), press Translate on an English project.
- [ ] First run on a downloadable pair fires only from a real click (gesture) and shows progress 0–100; a background attempt returns "downloadable" without downloading (no `NotAllowedError`).
- [ ] Translated entries appear in batches (visible viewport first); entries show machine origin.
- [ ] Kill a run mid-flight (cancel) — stops within ~500 ms, partial results kept, nothing half-delivered.
- [ ] Edit one entry (becomes `edited`, one undo step), edit the block's source text (entry goes stale), "Retranslate stale" re-plans only stale blocks.
- [ ] Offline (DevTools offline after models cached) — pair still works (models cached by Chrome); turning models off surfaces the codes-only failure notice.
- Date / Chrome version / result: ______________________

#### Agent-run record (puppeteer MCP, morning 2026-11-23) — owner sign-off STILL REQUIRED (boxes above left unchecked per `[MANUAL]` doctrine)

Run against `vite preview` production build (`?ziptest=1` sanctioned bridge for project seeding only — NO mocks of the built-in APIs), browser = puppeteer-managed Chrome, `navigator.userAgentData` → **Chromium 158 / macOS** (UA header legacy "Chrome/120.0.0.0" — ignored). en→fr AND en→es both exercised with REAL model packs (browser-downloaded during the session).

| Checklist item                                                       | Result                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| background probe → "downloadable" w/o download, no `NotAllowedError` | **PASS** — `Translator.availability({en→fr/es})` = `downloadable`; picker badges sat at `download` for 60+ s while no gesture fired; two clicks that failed hit-testing (see note) also triggered NO download (negative control) |
| first run only from real click + progress 0–100                      | **PASS** — after the trusted click: `Downloading…` (real pack fetch, ~4 s) → `Translating…`, live region announced `French Translating… 2% … 98% → 100%` → `Complete`                                                            |
| batches, visible-first, machine origin                               | **PASS** — entries applied in viewport order from block 0; all rows `Machine-translated`; output genuine (`"C'est la phrase numéro 0…"`) not scripted                                                                            |
| cancel mid-flight ≤ ~500 ms, partials kept                           | **PASS** — 400-block run cancelled at 48 entries applied: `Cancelled` settled **29 ms** after abort; count frozen at 48 (nothing half-delivered)                                                                                 |
| entry edit → `Edited`; source edit → `Stale`; Retranslate stale      | **PASS** — badges `Edited`/`Stale` render; `Retranslate stale` ran `1/1` (only the stale block re-planned; edited entry text untouched)                                                                                          |
| one undo step (entry edit)                                           | **not UI-testable** — no undo gesture exists in the UI; the one-undo-step contract is store-level and covered by CC-301.1 unit tests. Owner: confirm nothing else was expected in the UI                                         |
| Offline (DevTools offline after cache; models off)                   | **NOT RUN — owner only.** puppeteer MCP exposes no network emulation; both pairs' models are now cached in this Chrome profile, so the offline legs are ready for the owner in DevTools                                          |

Side finding (real, minor): at an 800×600 viewport the transcript-issue button renders ON TOP of the language picker dropdown and swallows the Add-button click (Playwright hid this with `force:true`; reproduced twice, fixed for the run by raising the dropdown z-index). Backlog seed: z-order/stacking of the picker vs the transcript header at small viewports.

## Gates

lint ✓ | typecheck ✓ | test ✓ (1956 pass, engine cov ≥ thresholds) | build+bundle ✓ (145.3 KB / 350 KB) | e2e ✓ (CC-301.3 spec green locally 1.0 m + CI) | spec-lint ✓ | format ✓ | criteria ✓ (verify:unit 5/5) | qualification re-signed ×3 (each src commit) ✓

## Review history (agentic, per owner directive)

- **R1 CHANGES_REQUESTED** — M1 `code !== undefined` passthrough let raw DOMExceptions (which always carry the legacy numeric `.code`) cross the sanitizing boundary and silently disarmed the retry loop; M2 the 500 ms cancel leg was unfalsifiable (timed the wrong interval); M3 `finally` cleared a shared pending slot unconditionally (race ⇒ duplicate create + instance leaked outside the LRU) and translate claimed user-initiation; M4 production never injected `translationEngineAvailable` (gate dead on non-Chrome) while the two contract comments contradicted each other. Also minors m3 (zh-Hant pass-through), m6 (criterion's 30–300 ms latency profile + transform inside the watch window), m7 (eviction test couldn't fail), nits (attemptsFor copy, sourceHash length-salt).
- **Fixes** `d46c88d` + `1a92b17`: `instanceof TranslationError` passthrough + scripted-DOMException/foreign-code tests; cancel test times abort→settle with engine-call quiescence assertion; per-create pending identity slot + drop-before-set (TDZ-safe against a synchronously throwing hostile `create`) + race regression; composition root injects a boot-cached adapter availability check, comments aligned; `passThroughMatch` honors the script subtag; harness latency 30–90 ms (fast end of the stated envelope = strictest burst pressure) with boot pre-import and ready-flag-after-preload; eviction test rewritten as interleaved probes (proves the 500 cap, FIFO victim order, and retention — the original sequential re-scan was the pathological FIFO pattern, not an oracle).
- **R2 APPROVE** — all majors verified falsifiable (mutation-checked); R2's two minors (TDZ identity slot, ready-flag gating) applied in `1a92b17`.

## Deviations from spec

- `translateError` returns an `Error` subclass (`TranslationError`, message `engine:<CODE>` — codes only) so throw-sites are lint-clean while staying structurally an `EngineError`.
- Two unreachable defensive branches removed from the adapter (background-downloadable throw in `createInstance` — `ensurePair` already returns `'downloadable'`; dead evict break).
- Attempt budget documented as **per block per run** (plan gate keeps persisted-`failed` blocks out at 3; a re-run may retry an under-budget block). Lifetime-3 would need an attempts field on `TranslationEntry` — not added (model is frozen; see Follow-ups).
- e2e mocked-API latency narrowed to 30–90 ms — within CC-301.3's stated 30–300 ms envelope, fast end (max calls/sec ⇒ strictest burst pressure). Reviewer accepted.
- `startHarnessServer` gained `configPath` (default unchanged) instead of duplicating the vite-spawn helper.

## Contract changes (recorded — orchestrator applied before build)

- `EngineErrorCode` + `TRANSLATE_FAILED | PAIR_UNAVAILABLE | DOWNLOAD_FAILED | NOT_ALLOWED` — `.ai-dlc/knowledge/architecture.md`, `src/engine/protocol.ts`, frozen `unit03-api-contract.d.ts` (all EXTENDS, dated).
- Frozen `unit102-api-contract.d.ts` EXTENDS-only: dispatch overloads for the 4 command ids (unit-104 pattern), `EditorAppDeps.translationEngineAvailable?`, `EditorApp.applyWithoutHistory`, `SyncArbitrator.clockTime` (pre-existing drift; first typed consumer is the apply service).

## Dependencies

None outside `settings.yml approved_dependencies`.

## Measurements

- e2e CC-301.3: 1000-block session run, zero `longtask` entries > 50 ms; ~1.0 min wall at the 30–90 ms scripted-latency profile.
- Bundle unchanged at 145.3 KB gzip initial (adapter + session + commands tree ≈ +1 KB over pre-301 — no eager import of the adapter into the initial graph beyond the availability closure).
- Translate coverage (gate, adapter excluded per spec): lines ≥ 85 enforced per file; adapter measured separately at 98.5% stmts / 95.1% branches.

## Follow-ups (seeds for backlog / unit-302)

1. **zundo paused-commit `futureStates`**: undo → machine-batch lands → redo re-applies the pre-undo snapshot (inherits unit-104's coalesce path; ledger CH.4 adjudicated the semantics honest). Unit-302 must cover undo/redo × active-run UX (clear future on machine commit or cancel sessions on history navigation).
2. **Machine-run undo-step shape**: the apply service auto-dispatches `translation-add-track` (1 undo step; asserted at commands.test.ts) — decide at 302 wiring whether the UI pre-adds tracks.
3. **Multi-language runs**: generation is session-global (one active run per session; asserted in session.test.ts). Unit-302 serializes per-target runs or owns one session per target.
4. If a lifetime (not per-run) attempt cap is wanted: persist an `attempts` field on `TranslationEntry` — contract proposal needed.
5. Shared fakes live in test helpers rather than `src/test-support/` (repo-wide conventions gap, pre-existing).
6. FNV-1a sourceHash is now length-salted; collision risk ~2⁻³² per pair — acceptable per FR-301.4, revisit only if the serializer ever needs content-addressing.

## Sign-off evidence run (agent, puppeteer MCP, 2026-11-23) — S1, CC-301.4 remaining offline legs

- who: opencode agent session (browser sign-off runbook `docs/ops/browser-signoff-plan.md`) via puppeteer MCP — browser: **Chrome 158 / macOS (MCP-managed fallback**; no debuggable Chrome on debugPort 9222 for the preferred active-tab target)
- results: **S1 — 6/6 legs PASS**: ONLINE warm-up fr `Complete` 48/48 (`s1-01`, `s1-02`) · SW activated + workbox precache + `zipscribe-wasm` caches (`s1-03`) · offline reload → SW-served shell + **IndexedDB restore blockCount 48** via the real-UI ProjectList reopen path (`s1-04`) · **offline es run → Translating… 1/48→48/48 → `Complete` with the origin dead** (`s1-05`, `s1-06`, `s1-07`) · dispatch audit: resource entries 21→21, `huggingface` 0, **0 new dispatches during the offline run** (`s1-07`) · transcribe popover offline presence: rendered in 101 ms, 5 model rows, no hang (`s1-08`)
- artifacts: `docs/signoff-evidence/2026-11-23/` — `s1-01-languages-fr-online.png` `s1-02-online-fr.json` `s1-03-sw-cache.json` `s1-04-offline-restored-48blocks.png` `s1-04-offline-restore.json` `s1-05-translation-view-es-offline.png` `s1-06-languages-es-complete-offline.png` `s1-07-offline-es-and-dispatch-audit.json` `s1-08-transcribe-popover-offline.png` `.json`
- owner residue (boxes stay **unchecked** — `[MANUAL]` doctrine): DevTools network-offline variant (true offline, not just dead origin); `chrome://settings/language` models-off codes-only notice
- ASSUMPTIONS: dead-origin (preview server killed; curl-verified dead) as the offline proxy — MCP exposes no `context.setOffline`; restore proven through the frozen UI reopen affordance (the bridge `openProject()` is a service-level read that does not load the editor); seed needed one real `block-edit-text` + `saveNow('manual')` to persist (bridge `seedBlocks` = `applyWithoutHistory`, which does not mark dirty); screenshots persisted via a scratch CDP driver (`.night/`) because the MCP screenshot tool returns inline image bytes only and the run model cannot ingest images
