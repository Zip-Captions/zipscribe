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
