# Unit report: unit-05-transcription-pipeline

Branch `ai-dlc/local-transcribe-engine/unit-05-transcription-pipeline`, base `7f9b5ed` (slice-C2 tip); this is **slice C3** on top of slices A–C2.
Status: **complete** — every gate green on the final head, `corepack pnpm test` exits 0 end-to-end
(77 files, 645 passed / 1 skipped / 1 todo), `corepack pnpm verify:unit --from-branch` **exit 0 —
all 12 untagged/RQ criteria covered, 10 pass + 2 RQ**, lint/typecheck exit 0, build 68.3 KB gzip
(budget 350 KB), `git status` clean on a green run (no record pollution).

## Completion criteria

From `reports/criteria/unit-05-transcription-pipeline.md` (`corepack pnpm verify:unit --from-branch`,
exit 0, "all untagged criteria … covered (12 total)"):

| ID       | level    | passing tests | result                                              |
| -------- | -------- | ------------- | --------------------------------------------------- |
| CC-05.1  | RQ       | 0             | RQ (outside PR pipeline) — qualify suite, see below |
| CC-05.2  | untagged | 1             | pass (playwright `memory` project, `recycle-10min`) |
| CC-05.3  | untagged | 1             | pass (playwright chromium, `longtask.spec.ts`)      |
| CC-05.4  | untagged | 14            | pass                                                |
| CC-05.5  | untagged | 1             | pass (playwright chromium, `tiny-smoke.spec.ts`)    |
| CC-05.6  | RQ       | 0             | RQ (outside PR pipeline) — qualify suite, see below |
| CC-05.7  | untagged | 15            | pass                                                |
| CC-05.8  | untagged | 2             | pass                                                |
| CC-05.9  | untagged | 2             | pass                                                |
| CC-05.10 | untagged | 4             | pass                                                |
| CC-05.11 | untagged | 4             | pass                                                |
| CC-05.12 | untagged | 3             | pass                                                |

`[RQ]` items (CC-05.1 `qualify/asr/memory-gate.test.ts`, CC-05.6 `qualify/asr/golden-wer.test.ts`):
**expected to run at the next release** with `ZIPSCRIBE_QUALIFY_MEASURE=1` (the hour-long heap/GPU
sampling and golden-WER runs are release-flow gates, exactly like unit-02's `[RQ]` rows; default
mode runs deterministic preflights — model-cache presence, registry baselines, sampler
trustworthiness — so the frozen CC-02.5 in-suite `pnpm qualify` leg completes inside its 150 s
spawn budget). Unmeasurable gates record `ok:false` + numeric values `null` + `reason` in
`qualification/unit-05-measurements.json`; no threshold is ever softened and no number is
fabricated. Baselines are READ from `docs/spikes/model-eval-report.json` (wer ratio × 100 =
percentage points per the CC-05.5 adjudication, ledger 2026-11-01T02:45Z, fix `5c432d4`) and
`docs/spikes/gpu-calibration.json` (`passed: true` gate on the sampler).
`[MANUAL]` items: none in this unit. `[DEPLOY]` items: none in this unit.

**CC-05.12 + CC-01.1 mechanism (the honest lever, unit-04 relocated-internals precedent):** the
gates-scaffold child run (`ZIPSCRIBE_CHILD=1`, global `src/engine/**` perFile 85/75) executes
`src/**/*.test.ts` and excludes nothing from asr, so the source-adjacent ADD-only suite
`src/engine/asr/worker-host-internals.test.ts` (5 tests: PCM-broker happy path over the real
`src/workers/pcm-broker.worker.ts` wire format via a `Worker` global stub, broker-error direct-post
fallback, cancel inside the `retireForRecycle` yield (the 360/366 race), foreign-job boundary
poisoning, `job:done` stats relay) took `worker-host.ts` from 74.01 %/64.08 % (pre-existing
under-coverage the slice-targeted runs never exposed) to **100 % lines / 86.61 % branches**.
Zero edits to frozen files.

## Gates

lint ✓ (exit 0) | typecheck ✓ (3 tsconfigs, exit 0) | test ✓ (`corepack pnpm test` exit 0 — 77
files, 645 passed / 1 skipped / 1 todo; engine/asr dir lines 89.7 %, perFile 85/75 green for every
file incl. worker-host.ts 100 % lines) | build+bundle ✓ (`check-bundle`: initial JS 68.3 KB gzip /
budget 350 KB, 1 chunk) | e2e ✓ (playwright chromium+memory completed inside the verify spawn —
CC-05.2/.3/.5 credited from freshly-written junit) | criteria ✓ (`verify:unit` exit 0, 12/12
covered) | `git status` clean on green (qualification record re-signed at `810dbbf` per the
unit-04 adversary F-2 canonical-tree doctrine).

## Deviations from spec

1. **PCM-broker self-spawn (slices B/C, carried):** `createAsrWorkerHost` spawns the broker itself
   when a `Worker` global exists (no DI seam in the frozen contract); unit-test environments take
   the direct-post path unchanged.
2. **Resume post-filter + silero 576-sample context prefix (slices A/B, carried):** recorded in the
   ledger at the slices that introduced them.
3. **Self-contained qualify suites (C3):** `qualify/asr/**` cannot import `e2e/asr/helpers/*` or
   read `fixtures/**` ground truth — the frozen
   `tests/unit/model-eval/qualify-pipeline-fabrication-adversarial.test.ts` scratch copies exclude
   `e2e/` and `fixtures/`. The harness-server/`assertTinyModelCachePresent` helpers are vendored
   (byte-faithful) into `qualify/asr/helpers/measurement.ts`, and the ground-truth assertion runs
   only in measurement mode.
4. **`scripts/verify-criteria.ts` playwright spawn budget 20 → 60 min (`e1b6218`):** unit-05's
   frozen e2e specs (`e2e/asr/longtask.spec.ts` 35 min timeout, `recycle-10min` 25 min) cannot fit
   the chromium+memory sweep in 20 min; the spawn was killed and every playwright-cited criterion
   (CC-05.2/.3/.5) went to zero — the unit exit gate was unreachable. The budget is a builder-owned
   tool constant (not pinned by any frozen verify-criteria suite); raising it strengthens evidence
   rather than loosening any assertion. The qualify doctrine ("reference-hardware gates belong in
   `qualify`") is untouched. CI-runner timing headroom is a Follow-up.
5. **Measurement-mode test-skip form:** vitest 4 has no Playwright-style conditional-skip signature,
   so the hour-long tests use the options form `{ skip: !MEASURE, timeout }`; default mode lists
   them as skipped (visible in `vitest list`, 4 rows).

## Contract changes

None proposed to `architecture.md` types beyond what already landed and was adjudicated:
`job:done` `stats.language` relay feeds the `job:done` project update (slices B/C), and the
CC-05.5 baseline-unit fix (spike `wer` ratio → percentage points) — ledger 2026-11-01T02:45Z,
fix `5c432d4`. The CC-05.5 interim sine-formant corpus remains **AWAITING-OWNER** (re-baseline
queued in Follow-ups).

## Dependencies

None outside `settings.yml` approved sets (`fast-check ^4.10.2` was already a devDependency).

## Measurements

- **CC-05.3 (e2e, C2):** per-epoch main-thread deep clone of the 460 MB bulk PCM measured
  149–252 ms → **0–42 ms** with the broker transfer path; **0 long tasks > 50 ms** attributable to
  engine code across a 1504 s (25 min) transcription window.
- **CC-05.2 (e2e, C2):** 10-min run recycled 41 epochs (40 recycles) at the spike-derived cadence
  (ceiling 1 498 911 512 B / per-window growth 2 207 528 B → 169 windows); heap sampler plateau
  **≈ 42 MB** above baseline (gate ≤ 50 MB), blocks identical to an unrecycled run.
- **CC-05.5 (e2e, C2):** tiny wasm model end-to-end **WER 100 vs cap 105** (spike baseline + 5).
- **Bundle:** initial JS **68.3 KB gzip** (budget 350 KB).
- **Qualify (C3, default mode):** 8 unit-05 preflight tests + unit-02's suite — 24 passed /
  4 skipped in ≈ 1.8 s (inside the frozen 150 s runner budget). Scratch measurement-mode smoke of
  the GPU path: T1 `whisper-base_timestamped` webgpu run — 48 words, modelHost 8, blocked [], GPU
  helper pid sampled at ≈ 113 MB via the calibrated sampler.
- **Coverage:** `worker-host.ts` 100 % lines / 86.61 % branches (was 74.01 / 64.08); `src/engine/**`
  perFile 85/75 green across parent and child runs.
- **verify:unit:** playwright chromium+memory completed inside the new 60 min window (measured
  ≈ 20 min wall on reference hardware).

## Follow-ups

- PCM-broker watchdog: a `clone` request whose reply never arrives hangs the epoch post (the ready
  handshake has the 5 s timeout, `clone` does not) — add a per-request timeout + direct-post
  fallback in a backlog unit.
- `verify:unit` CI timing: 60 min spawn budget vs 2-core CI slowdown for `longtask` + media sweep —
  measure on the first PR CI run; if it dies, the longtask/memory legs join the `qualify` release
  flow (doctrine already written into `scripts/verify-criteria.ts`).
- CC-05.5 re-baseline onto the real corpus once the sine-formant adjudication lands
  (**AWAITING-OWNER**); golden-WER qualify suite re-signs its thresholds from the same spike row.
- `scripts/qualify.ts` `RQ_IDS` still freezes `CC-02.*` (frozen runner contract); release flow
  should merge `qualification/unit-05-measurements.json` rows into the qualification artifact.
- Qualification-record re-signing when `src/**` changes should become an explicit release step
  (the canonical-tree write policy does the work; the re-sign at `810dbbf` shows the manual path).
- PCM broker: respawn + retry-once before failing the run on a slow (> 500 ms watchdog) `clone`
  reply (review round 1, finding 5 — recorded, not implemented; the F4 watchdog currently marks
  the broker dead and falls back, but a served-slow broker still costs the epoch its fast path).
- Stream-path PCM held chunks + merged copy ≈ 2× peak vs the CC-05.1 `[RQ]` < 1 GB gate —
  release-qualify the streaming path with explicit VAD-segment release / chunk-ref drops before
  the measurement (review round 1, finding 6 — recorded, not implemented).

## Adversary round (AUDIT_CLEAN record — orchestrator-appended per process.md Step 1.8)

Test-adversary (fresh context, post-implementation) filed 5 failing regression tests
(commit `11cbb14`, `src/engine/asr/{blockize,worker-host}.adversarial.test.ts`) plus
~25 surviving edge-case tests. One in-build fix cycle (`4adc0ab`) resolved:

- **F2 FIXED** — recycle on the last window racing `job:done` handed a terminated worker
  to the next run (warm adoption of doomed worker now impossible; dead warm respawns).
- **F3 FIXED** — GPU_OOM mid-recycle orphaned a live model-loading worker (every retire
  path now terminates every epoch it created; FR-05.3).
- **F4 FIXED** — PCM broker dying after owning the buffer hung the recycle forever
  (clone watchdog + `markBrokerDead` make the direct-post fallback reachable).

- **F1 REBUTTED — 2 tests remain FAILING, referred to the review loop for adjudication.**
  `blockize.adversarial.test.ts` cases at :91/93 and :96–107 are unsatisfiable against
  `knowledge/domain.md` invariant 2 (block.text equality keeps every non-final breakAfter
  word's `'\n'`) and US-1.2.6 "never mid-word" (a 60-char atomic word cannot yield a
  ≤ 42-char line without mid-word split). The fix cycle enforces both bounds for every
  block where a word-boundary split exists (test-1 input → 3 blocks ≤ 2 lines; atomic-word
  overflow is acknowledged unrepairable residue). Evidence: the two tests' own headers
  quote the very clauses that make them contradictory. Reviewer to adjudicate per
  process.md (rebuttal with invariant citation counts as handled; if accepted, the tests
  are corrected by a test-author round, never silently deleted).

## Review round 1 (actor: fix — independent review, PR #8)

Six findings; dispositions per the review (test edits below are EXPLICITLY REQUIRED by the
reviewer's adjudication, not unilateral softening):

- **F1 FIXED (`9a46df3`)** — stale `qualification/0.0.0-spike.json` contentHash
  (committed `517f55b1…` ≠ recomputed `bcffad13…` at head `629c65e`: the `810dbbf` re-sign
  predated the adversary `src/**` commits `11cbb14`/`4adc0ab`). Re-signed via the same
  canonical-tree flow as `810dbbf` (`node scripts/qualify.ts` on a tree matching HEAD):
  `contentHash` `1f5ed0c0…` + hash-derived `startedAt` only — `results[]`/`manual[]`/`machine`
  byte-identical (diff is exactly those two lines; no measurement changed).
  `node scripts/qualification-check.ts` exit 0; `pnpm test` leaves `git status` clean.
- **F2 FIXED (`5cc2005`)** — the two red F1 adversarial tests corrected per the reviewer's
  accepted rebuttal (never deleted), quoting the adjudication: _"Test 2 (60-char line):
  unsatisfiable — the 60-char word is atomic (words never split by block operations;
  US-1.2.6 never-mid-word) so every blockization leaves a ≥60-char line; the test's premise
  that splitting before the second word satisfies the bound is false. Test 1 (5×breakAfter in
  one block): unsatisfiable as written — toHaveLength(1) + domain invariant 2 (each non-final
  breakAfter keeps its \n) forces 5 lines against the ≤2-line assertion on the same block;
  shipped code already produces 3 blocks ≤2 lines (compliant)."_ New assertions: test 1 pins
  EVERY block ≤ maxLines and ≤ the char bound, all intra-block manual `'\n'` joins preserved
  (block-final breaks vacuous per `blockText`), full word coverage, and the 3-block output;
  test 2 documents the unbreakable-word residue — atomic word intact (never mid-word split),
  every OTHER line ≤ 42 — with the invariant 2 / US-1.2.6 citation in the test.
- **F3 FIXED (`5cc2005`)** — `asr-worker-glue.adversarial.test.ts` now asserts the EXACT
  `job:done` guard key set `{repeatedNgramDropped, shortSpeechDropped, maxTokensFlagged}`
  (protocol.ts `GuardStats`) and drives one guard trigger end-to-end through the real worker
  (repeated-ngram window → `repeatedNgramDropped: 1`, others 0, window's `job:segments`
  dropped), pinning the `asr.worker.ts:254-269` relay key remap that a key-drop previously
  survived.
- **F4 FIXED (`bf23f0b`)** — `worker-host.ts` header comment claimed recycle termination is
  synchronous inside the `job:segments` handler; reality (post-F2-fix) is a
  `setTimeout(0)` yield in `retireForRecycle` before `terminate()`, with late-commit safety
  coming from the `commitSegments` dedupe (`:467-479`). Header comment updated to match; the
  identical false claim in the `commitSegments` call-site comment (same mechanism, same
  finding) corrected alongside.
- **F5 RECORDED** (this report, Follow-ups) — broker respawn + retry-once before failing the
  run on a slow (> 500 ms) clone reply.
- **F6 RECORDED** (this report, Follow-ups) — stream-path PCM held chunks + merged copy
  ≈ 2× peak vs the CC-05.1 `[RQ]` < 1 GB gate; stream VAD/release refs before release
  qualification.
