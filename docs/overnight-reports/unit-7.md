# Unit report: unit-07-caption-import

Branch `ai-dlc/local-transcribe-engine/unit-07-caption-import`, base `f07f389` (frozen suites fully green); this is **slice D of 4** on top of slices A–C. Engine code (`src/engine/captions/**`) is byte-untouched by slice D; the only tree changes are the vitest.config.ts child-exclusion retirement and the qualification re-sign.
Status: **partial** — every slice-D work item executed; all gates green except two honest criteria rows referred to the orchestrator for adjudication (CC-07.3 frozen-e2e model constraint, CC-07.7 missing credit trail). Nothing was weakened, deleted or mocked away (AGENTS.md § When you're stuck).

## Completion criteria

From `reports/criteria/unit-07-caption-import.md` (`node scripts/verify-criteria.ts unit --from-branch`, authoritative second attempt — the first attempt's vitest spawn died with status null before writing any report, infra-only flake, evidence `.night/verify-unit.log`; exit 1, see BLOCKERS):

| ID      | level    | passing tests | result                                                                                              |
| ------- | -------- | ------------- | --------------------------------------------------------------------------------------------------- |
| CC-07.1 | untagged | 46            | pass                                                                                                 |
| CC-07.2 | untagged | 5             | pass                                                                                                 |
| CC-07.3 | untagged | 0             | **FAIL (BLOCKER 1)** — playwright-backed by `e2e/captions/align-mae.spec.ts`, honest vacuity failure |
| CC-07.4 | untagged | 18            | pass                                                                                                 |
| CC-07.5 | untagged | 26            | pass                                                                                                 |
| CC-07.6 | untagged | 5             | pass                                                                                                 |
| CC-07.7 | untagged | 0             | **FAIL (BLOCKER 2)** — no test TITLE cites the ID (frozen-suite gap); coverage itself passes          |

`[RQ]` items: none in this unit. `[MANUAL]` items: none. `[DEPLOY]` items: none.

## Gates

- lint ✓ `corepack pnpm lint` exit 0 (`eslint .`)
- typecheck ✓ `corepack pnpm typecheck` exit 0 (tsc ×3: tsconfig, tsconfig.node, tsconfig.eval)
- test ✓ `corepack pnpm test` exit 0 — **105 files, 875 passed / 1 skipped / 1 todo** (206.4 s); `git status --porcelain --untracked-files=all` **EMPTY** after the run post-re-sign (in-suite CC-02.5 qualify leg is a byte-identical no-op against the committed record)
- build + bundle ✓ `corepack pnpm build && corepack pnpm check-bundle` exit 0 — **initial JS 68.3 KB gzip / budget 350 KB** (1 chunk)
- e2e ✗(1 honest) `corepack pnpm test:e2e` full — **83 passed / 1 failed / 21 skipped (24.5 m)**, zero flake (0 passed-on-retry). Legs: `longtask.spec.ts` **24.4 m** (perf-fixture path — `fixtures/audio-120min.mp4` present, no regeneration needed), `memory/recycle-10min` **8.1 m**, `memory/decode-memory` (CC-04.9) **33.1 s**, `tiny-smoke` (CC-05.5) **33.4 s**, `align-mae` (CC-07.3) **33.3 s FAIL** (the only failure). The 21 skipped are the default-off webkit project (FR-1.0.4).
- verify:unit ✗(honest) exit 1 — five criteria pass (table above), CC-07.3/CC-07.7 FAIL per BLOCKERS. Note the run also logs `e2e evidence rejected — playwright exited 1 — zero e2e credit` (unit-02 spawn doctrine: a failing playwright run's junit credits nothing).
- qualification ✓ re-signed at head via the canonical flow (`node scripts/qualify.ts` on a tree matching HEAD, 8/8 RQ pass): diff is exactly `contentHash` `f36a8b68…` → `404a3247…` + hash-derived `startedAt`; `results[]`/`manual[]`/`machine` **byte-identical** (deep JSON compare). `node scripts/qualification-check.ts` exit 0 ACCEPT.
- frozen-diff guard ✓ `git diff f07f389..HEAD -- tests e2e fixtures src/engine/captions` **EMPTY**; the only files in `f07f389..HEAD` are `vitest.config.ts` (child-exclusion retirement, comment-sanctioned) and `qualification/0.0.0-spike.json` (canonical re-sign).
- servers: no orphan vite/playwright/chromium processes after every run (pgrep + lsof 4310–4319 checks).

## Deviations from spec

None. (Slice D changed no engine code; the child-exclusion retirement is the action the config comment itself prescribes at green, unit-04 audio precedent.)

## Contract changes

None — verified: `src/engine/model.ts`, `src/engine/protocol.ts` and the frozen `tests/unit/captions/unit07-api-contract.d.ts` are byte-untouched since `f07f389`; the aligner implements the contract's pinned normalizeToken/LCS rule verbatim (self-check below confirms behaviour, not just tests).

## Dependencies

None (no additions to `settings.yml` approved_dependencies; no new packages).

## Measurements

- **e2e align-mae (CC-07.3) measured:** decodedSeconds 119.552; `asrWordCount` **24**; `captionBlockCount` 12; `captionWordCount` = `report.wordsTotal` = **72**; `alignedWordCount` **0**; `report.alignedRatio` **0.000**; MAE **not computable — aligned set empty** (limit would be spike `wordTimingMAEms` 14719.5 ms × 1.5 = 22 079.3 ms, `docs/spikes/model-eval-report.json` rows[whisper-tiny_timestamped,T2], read never invented); counters modelHost 8, blocked []; leg 33.3 s.
- **Aligner self-check (`.night/probe-aligner.mts`, engine-level, independent of the model):** perfect ASR words (ground truth fed as ASR input) → alignedRatio **1.000**, MAE **0.000 ms** over 72 words; 24× `'[Music]'` tokens (unit-05 sentinel) → alignedRatio **0.000** — reproduces the e2e exactly. The aligner is sound; the vacuity is pinned-T2 model output on the interim sine-formant corpus.
- **QC incremental (CC-07.5 budget):** 1-block change in 10 000 blocks — op median **0.003 ms**, p95 **0.007 ms** (full 10 000-block pass median 1.5 ms; spec limit 5 ms). Frozen test asserts ≤ 5 ms × CI headroom.
- **Coverage (CC-07.7 substance, scoped nested run exit 0):** `src/engine/captions/**` 15 files — lines **99.84 %**, branches **93.42 %**; per-file minimums lines 98.43 % (`parse/ttml.ts`), branches 75.0 % (`parse/shared.ts`, at the gate) — clears perFile 85/75.
- **Bundle:** initial JS 68.3 KB gzip (budget 350 KB).
- **gates-scaffold child:** 7/7 green in 44.5 s with the captions suites now inside the child.

## Follow-ups

- **test-author (one new file, precedents `tests/unit/audio/media-coverage.test.ts:30` / `tests/unit/model/model-coverage.test.ts:32`):** add `tests/unit/captions/captions-coverage.test.ts` — nested `vitest run tests/unit/captions src/engine/captions --coverage.include='src/engine/captions/**'` with thresholds lines 85 / branches 75 / perFile, titled `CC-07.7: …`. This is the missing credit trail for BLOCKER 2; the gate it would assert already measures green (99.84 / 93.42, exit 0).
- **orchestrator adjudication, CC-07.3:** unit-05 CC-05.5 precedent class (ledger 2026-11-02T00:35Z: the pinned `whisper-tiny_timestamped` emits `[Music]`-class output on the sine-formant corpus — spike sentinel `wordTimingMAEms` 14 719.5 / `mae: 33984`). Options: vendor the real corpus (AWAITING-OWNER, unit-02 doctrine) or adjudicate the non-vacuity threshold; the spec itself declares the corpus interim and the check intentional.
- verify:unit's vitest spawn returned null status on the first attempt (not reproducible; the identical command passes standalone in 206 s — `.night/vprobe/`). Watch for a spawn/env flake in `scripts/verify-criteria.ts` `run()`.
- `retime.test.ts:108` comment arithmetic (noted at slice B, comment-only) — cosmetic.

## Golden changes (conventions § Goldens)

Three goldens re-derived per the pinned rule + one helper + two harness adjudications — all test-side, engine code byte-untouched; each orchestrator-adjudicated with independent verification:

1. **3 goldens re-derived (ledger 2026-11-03T02:05Z, executed c15d59f):** `two-line.srt` expected `breakAfter` moved `'one'`→`'two'` (token FOLLOWED BY `\n` per the pinned contract rule; invariant-2 join agrees with the golden's own text); `overlap-zero-empty.srt` + `sample.zipscribe.json` expected word boundaries re-derived from the pinned `max(1,codePointCount)+pause` rule (hand-arithmetic errors: `'cue'` priced 4 code points, is 3 ×3; `'Structured'` 9, is 10) — blk values now 0.938/1.688/2.25 (Σ16), 4/4.5 (Σ12), 0.556/0.778 (Σ18), 2.962/3.269 (Σ13); `fixtures/harness/manifest.json` 3 sha256 rows refreshed with real hashes. Justification: **pinned-rule consistency (the contract is the authority; the other 15/18 goldens already byte-agreed), NOT implementation-following**; derivation reproduced independently in `.night/` scratch.
2. **1 helper (ledger 2026-11-03T01:20Z):** `qc.test.ts` local `blockWithText` helper — capture the split separator and set `breakAfter:true` on tokens originally followed by `\n` (the `/\s+/` split destroyed line identity, making LINE_TOO_LONG/TOO_MANY_LINES unsatisfiable). Assertions untouched; shared `project-support.ts` untouched.
3. **2 harness adjudications:** (a) `roundtrip.property.test.ts` (ledger 2026-11-03T00:40Z) — fast-check 4.10.2 evaluates async predicates only via `asyncProperty`/awaited `assert`; generator, seeds, numRuns 200 and all assertions unchanged. (b) `errors.test.ts` `cue()` helper (ledger 2026-11-03T02:25Z, executed f07f389) — VTT cues joined with a blank line (`'\n'`→`'\n\n'`): W3C WebVTT cuetext state was absorbing cue 2's timestamp line as cue 1 continuation text (1 parsed cue ≠ expected CUE_UNMATCHED 2); engine is spec-conformant, the harness string was the defect; assertion unchanged. (Same-entry sibling fix, for completeness: `estimate-timing.test.ts:31` 1.05→1.2 per the pinned weight rule, adjudicated 2026-11-03T01:20Z; `import.test.ts` IEEE-754-unsatisfiable `=== 0.1` → `toBeCloseTo(0.1, 3)`, adjudicated 2026-11-03T02:05Z.)

## BLOCKERS (referred to orchestrator — evidence, nothing weakened)

1. **CC-07.3 (`e2e/captions/align-mae.spec.ts` non-vacuity, `alignedRatio > 0`)** — measured: 24 ASR word tokens across 119.55 s of audio, none normalized-token-equal to any of the 72 reference words (LCS 0); `alignedWordCount` 0, `alignedRatio` 0; MAE undefined over the empty aligned set (threshold 22 079.3 ms never reached). Aligner exonerated at engine level (perfect-ASR self-check ratio 1.000 / MAE 0.000 ms; `[Music]`-garbage self-check reproduces ratio 0). Precedent: unit-05 CC-05.5 adjudication (ledger 2026-11-02T00:35Z — same model, same pinned revision, same sine-formant corpus family, `[Music]` sentinel, spike `wordTimingMAEms` 14 719.5 in `docs/spikes/model-eval-report.json`). Left failing per brief; no assertion touched.
2. **CC-07.7 (coverage ≥ 85 % `engine/captions/**`) — credit trail absent, substance green.** No test title in the frozen suite (or any committed suite) cites CC-07.7 — the frozen suites reference it only in file-header comments; the unit-03/04 precedent gate files (`model-coverage.test.ts`/`media-coverage.test.ts`, which carry the titled gate) were never authored for captions by the test-author round, and creating them under `tests/unit/captions/` is prohibited slice-D-wide by the frozen-diff guard (`git diff f07f389..HEAD -- tests …` must stay EMPTY). The measurement the gate would assert already passes (scoped nested run exit 0; 99.84 %/93.42 %, perFile min 98.43/75.0). Fix = one test-author commit (see Follow-ups); deliberately not self-admitted here.
