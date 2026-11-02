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
