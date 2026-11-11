# Unit report: unit-06-speaker-diarization — slice A (pure engine core)

Status: **complete (slice A)** — slices B–D (host wiring, worker glue + ORT/Silero
adapters, tee-concurrency + qualify perf) pending, per the orchestrator's slice plan.

Branch `ai-dlc/local-transcribe-engine/unit-06-speaker-diarization` from `91e89dc`.

## Summary (one line per step)

1. Read all unit-06 docs: unit spec, discovery, architecture contracts, `unit06-api-contract.d.ts`, the 6 frozen suites + 14 goldens + seams/coverage helpers.
2. `src/engine/diarize/clustering.ts` — agglomerative average-linkage on cosine distance (zero-norm → Infinity, never merges; cap rule merges down to `maxSpeakers` (default 6) then threshold-stops at 0.5), canonical first-member-order labels, plus `estimateSpeakerCount` (eigengap via fixed-count power iteration + deflation — reported, never used to cut, FR-06.1).
3. `src/engine/diarize/windowing.ts` — `embeddingWindows` (0.5 s symmetric expand @0-clamp, ≤3 s single window, 3 s tile at 50 % hop, tail `[end−3, end]` backfill) + `resolveEmbeddingWindows` (forwarded `vad` reuse, `'own-pass'` via unit-05 `runVad` + injected scorer).
4. `src/engine/diarize/assign.ts` — duration-weighted majority + 0.25 s hysteresis (switch needs winner−runner-up ≥ 0.25 s vs the previous assigned word; ties carry over; no-overlap words keep their id), `SPK_<c+1>` durable ids, block majority via the frozen `majoritySpeakerId`, two+ runs → per-run re-blockize through unit-05 `blockize` (composition, never mid-word) with 3-decimal canonical rounding on written times; `renameSpeaker`/`reassign`/`mergeSpeakers`/`splitSpeaker`/`SPEAKER_PALETTE`/`speakersFromClusters`.
5. `src/engine/diarize/worker-core.ts` — DI'd heart of `diarize.worker.ts`: `loadModels` → 2× `model:ready` echoing session `modelId`/`device`; per-window segment→embed→`job:progress`; exactly one `diar:frames` (content-free: only enumerable leaves are numbers; `t`/`jobId` are non-enumerable own properties — the `Object.entries`/JSON.stringify semantics `src/test-support/redaction.ts` documents) then `job:done` with numeric-only stats (`language:'und'` + counts + eigengap cross-check); cooperative cancel (never awaits a session call past cancel → single `CANCELLED` terminal), `MODEL_UNLOADED`/`DIAR_SESSION_LOST` taxonomy, `unload` disposal, `maxSpeakers` passthrough.
6. Composition re-point: `DEFAULT_COMMAND_DEPS.speakerEngine` → the VERBATIM `majoritySpeakerId`/`reassignWords` from `src/engine/diarize/assign` (CONTRACT.md re-point clause); `NOT_IMPLEMENTED_SPEAKER_ENGINE` stays exported unchanged (dispatch-contract seam); seams-coverage assertion green.
7. Builder config (suite headers declare `vitest.config.ts` builder-owned; unit-102 child-only precedent): `src/engine/diarize/**/*.ts` added to the `ZIPSCRIBE_CHILD=1` coverage-exclude block — the frozen suites self-skip in the gate-spawning child, which would otherwise 0 % the new modules against the perFile gate. Parent `pnpm test --coverage` (CI) and `verify:unit` still measure perFile.
8. Coverage honesty pass (`34c84e4`): `noUncheckedIndexedAccess` makes typed-array reads `number | undefined` (frozen-test doctrine `samples[0] ?? 0`), so every structurally-unreachable `??` counted as a branch path (70 %). Non-null assertions on provably in-range reads (repo-idiomatic `!`, blockize precedent), typed-array promotion for norms/sizes/parent/eigens, scorer selection hoisted (both arms now execute), stream termination on `close`/`messageclose` (protocol defines no null-EOF), structural single-terminal (no guard branch). Behavior unchanged.
9. Qualification record re-signed twice via `pnpm qualify` on HEAD-canonical trees (unit-04 builder precedent; `recordWriteDecision` refuses dirty trees): `f9525b43… → 309204b7… →` final head value; `qualification-check` ACCEPT. The stale record at `91e89dc` (qualify-runner + model-coverage cascade reds — pre-existing, test-author ledger 2026-11-10 already noted them) cleared as a side effect.

## Completion criteria (reports/criteria/unit-06.md)

| ID | level | passing tests | result |
|---|---|---|---|
| CC-06.1 | untagged | 0 | FAIL — e2e-backed, see Blockers |
| CC-06.2 | untagged | 0 | FAIL — e2e-backed, see Blockers |
| CC-06.3 | RQ | 0 | RQ (outside PR pipeline) — qualify/diarization perf-gate runs at release |
| CC-06.4 | untagged | 6 | pass |
| CC-06.5 | untagged | 0 | FAIL — e2e-backed, see Blockers |
| CC-06.6 | untagged | 0 | FAIL — frozen title-shape defect, see Blockers |

Substantive evidence the tool cannot credit (see Blockers): all **77 frozen unit-06
tests + the seams re-point assertion pass** — 57 previously-RED (5 suites) + 1 frozen
exception (`seams-coverage.test.ts:193`) → GREEN; goldens byte-compared (10 in/out
pairs incl. hysteresis + split boundary-snap 0.05/1.55/2.05/2.45); `[RQ]` CC-06.3
qualify suite runs at the next release on reference hardware; `[MANUAL]` — none in slice A.

## Gates

- lint ✓ (0 errors)
- typecheck ✓ (tsconfig + tsconfig.node + tsconfig.eval)
- `pnpm test --coverage` ✓ **EXIT=0 — 174 files passed; 1401 passed | 1 skipped | 1 todo (1403)**; perFile thresholds (85 lines / 75 branches) hold with the diarize numbers:
  - `engine/diarize/clustering.ts` lines 100 · branches 100
  - `engine/diarize/windowing.ts` lines 100 · branches 100
  - `engine/diarize/assign.ts` lines 96.55 · branches 87.5
  - `engine/diarize/worker-core.ts` lines 87.85 · branches 82.14
  - repo summary: statements 95.46 %, branches 89.81 %, functions 97.16 %, lines 98.38 %
- build ✓ + check-bundle ✓ — initial JS **112.9 KB gzip / 350 KB budget** (1 chunk; assign.ts reaches the main chunk via the `DEFAULT_COMMAND_DEPS` import).
- `pnpm test:e2e` — 103 passed / 22 skipped / **4 failed = exactly the 3 frozen RED `e2e/diarization` specs** (accuracy-2spk ×2: "word [0.12] must carry a speaker label (CC-06.1 prerequisite)", determinism-concurrent, guard-single-speaker) — RED-by-design until slice B/C (worker wiring + adapters tag words). **Zero regressions** outside them.
- `pnpm verify:unit --from-branch` — CC-06.4 pass; CC-06.3 RQ-expected; CC-06.1/06.2/06.5/06.6 red — see Blockers (two structural causes, neither fixable from slice A without touching frozen files).
- Frozen diff ✓ `git diff 91e89dc..HEAD -- tests/ e2e/ fixtures/ qualify/` **empty**.

## Commits (this slice)

- `1ce76c4` feat(engine/diarize): pure clustering/windowing/assignment/worker core + speakerEngine re-point
- `e4d3843` build(vitest): exclude child-skipped src/engine/diarize from gate-spawned coverage
- `68f1044` / `dfa239b` ci(qualify): re-sign spike record (×2 — feature tree, coverage-shape tree)
- `34c84e4` perf(engine/diarize): measure-honest branch shapes

## Deviations from spec

- **`diar:frames` non-enumerable discriminants.** The frozen CC-06.1 content-free walk (`worker-core.test.ts:228-235`) `Object.entries`-walks the whole event and requires every leaf to be `number` — satisfiable only by keeping `t`/`jobId` as NON-ENUMERABLE own properties (the exact JSON.stringify blind-spot `src/test-support/redaction.ts:50` documents as canonical). `e.t`/`e.jobId` stay readable. **Slice C note:** `postMessage`/structuredClone copies own-enumerables only — the worker boundary must re-materialize `t`/`jobId` enumerably before posting.
- **3-decimal rounding on split outputs.** The split/hysteresis goldens pin canonical serializer doubles (fixture-project.ts:4-5 "3-decimal canonical rule"); raw `blockize` pads can land on neighbouring IEEE doubles (e.g. 2.0500000000000003 vs 2.05), so `assignSpeakers` rounds every time it WRITES (split part start/end + clamped boundary) — matching `captions/align.ts` invariant-6 practice. Unsplit blocks pass times through untouched.
- **Stream termination.** `PcmSource.stream` has no null-EOF sentinel in the protocol; consumption resolves on `close`/`messageclose` (the frozen stream test terminates via `port2.close()`), rejects on `messageerror` (→ `DIAR_SESSION_LOST`) and on cancel.
- **mergeSpeakers effective attribution.** "ALL of b's words" includes untagged words inside blocks whose `speakerId` is `b` (fixture projects carry block-level ids only); explicit non-b tags are respected.
- **Single active job per core** (`active = null` unconditionally in `finally`): the worker host serializes `diarize`; `cancel`/`unload` are non-serialized as spec'd.

## Blockers (reported honestly, not worked around)

1. **`verify:unit` CC-06.1 / CC-06.2 / CC-06.5 — e2e-backed.** Committed `e2e/diarization/{accuracy-2spk,guard-single-speaker,determinism-concurrent}.spec.ts` lead-cite these IDs, so under `scripts/lib/criteria-credit.ts` provenance they credit ONLY from a passing Playwright run; those specs exercise the unmerged slice B/C stack (they fail "word must carry a speaker label"). Expected to close at slice B/C. No slice-A action possible.
2. **`verify:unit` CC-06.6 — frozen title-shape defect (test-author class).** No frozen vitest title LEADS with `CC-06.6` (every citing test sits behind `FR-06.1/06.3/06.6`/`US-1.3.2` describe prefixes; `junit-trust.citationsOf` is leading-run-only by unit-03-F2 doctrine), and no committed e2e spec lead-cites it. Precedent: unit-04 report Deviations §1–2 ("frozen defects… closed by the test-author at `52cb571`" — describe renames). Substance is proven (100/100 + 96.55/87.5 perFile branch coverage; 77/77 tests). Route to test-author: prefix the unit-06 frozen describes with the CC-IDs (title shape only, assertions byte-identical).
3. **e2e/diarization 4 RED specs** — by design until slice B/C (above). Not regressions; CI will show them red until then (same doctrine as the L1 RED suites).
4. Pre-existing at `91e89dc` (ledger 2026-11-10 already adjudicated the qualify cascade): cleared incidentally by the record re-sign; no action owed.

## Contract changes

none (frozen `DiarizeRequest`/`DiarizeEvent`/`DiarFrames` imported verbatim; `JobStats` is weak — `stats` uses `language:'und'` + numeric cross-check fields only).

## Dependencies

none outside `settings.yml` approved list (slice A is dependency-free pure TS).

## Measurements

- Full coverage run 299 s (174 files); diarize suites alone <1 s each.
- Initial JS 112.9 KB gzip (budget 350 KB); build 3.7 s.
- Qualification contentHash → re-signed twice, `qualification-check` ACCEPT; qualify preflight 8/8 RQ pass (fast leg; memory gates are release-hardware opt-in per owner ruling 2026-11-09).

## Follow-ups

- Slice C: `diarize.worker.ts` glue must re-materialize `t`/`jobId` enumerably before `postMessage` (Deviation 1).
- Slice B: host wiring — `speakerSource:'auto-beta'` + `speakersFromClusters` population on diarize completion; `speaker-assign`-family command payloads over the pure fns (unit-104 UI).
- Consider hoisting `roundSeconds` to a shared engine helper if slice B writes more times (currently local to `assign.ts`).
- `unload()` does not await a running job's quiet exit (wake + dispose immediately) — acceptable for the frozen contract; slice C's worker teardown should serialize if the host requires it.

---

# Unit report: unit-06-speaker-diarization — slice B (model registry rows + two-speaker fixture)

Status: **complete (slice B)** — head `fb8ef0f` on `ai-dlc/local-transcribe-engine/unit-06-speaker-diarization` (from `2c1eb2c`). Commits: `38c26c3` feat(models), `715e79a` build(fixtures), `7badab6` ci(qualify), `fb8ef0f` fix(fixtures) (typing-only follow-up to the generator edit).

## Deliverables

1. **Model rows (FR-06.6 / FR-03.1 doctrine).** Two pinned rows — repo + 40-hex revision + per-file SHA-256 — in `models/ci-registry.json` (drives `pnpm models:fetch` → `.cache/models/`, SHA-256-verified) and `models/eval-registry.json`, mirrored verbatim into `src/engine/model/registry.ts` as **`DIAR_MODEL_REGISTRY`** (+ `getDiarModel`), the silero-vad non-ASR precedent: a fetched, pinned cache tier that never enters `MODEL_REGISTRY` / `tierSelector` / the model picker. `ensureOffline`-cacheable: rows carry `runtimeWasm: ORT_RUNTIME_WASM` (the same self-hosted `/wasm` set the transformers rows double-cache); slice C injects this map into `createModelCache`/`createModelManager` (`deps.registry`). Cache dirs are the frozen e2e names `pyannote-segmentation-3-0` / `eres2net-base-3dspeaker`, file paths inside conform to `routeDiarNetwork`'s resolve-URL mapping (`onnx/model.onnx`; `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`). Frozen helper + specs unedited.
2. **ERes2Net provenance tie-out (gated task).** VERDICT: **ACCEPTED** — `onemira/eres2net-base-3dspeaker-onnx@e63c3752…` is byte-identical (SHA-256 `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b`, 39,593,761 B) to the k2-fsa/sherpa-onnx GitHub release `speaker-recongition-models` artifact (the exact file the docs-mcp sherpa-onnx *Speaker Diarization* page prescribes), and the in-repo `LICENSE`/`LICENSE.sherpa-onnx`/`NOTICE` hashes match the mirror's declared upstream digests (both Apache-2.0 texts; chain mirror → k2-fsa release → ModelScope iic / 3D-Speaker team). pyannote row re-verified MIT via the HF API today. Full chain + auditor reproduction commands: `docs/spikes/diar-model-provenance.md`. No silent substitution; sherpa-onnx-WASM fallback not needed (would be an orchestrator decision regardless).
3. **Two-voice `speech-2spk-2min` regeneration (US-1.3.1).** `scripts/make-fixtures.ts` synthesizes two distinctly different voices over the SAME word list/timings — voice A f0 ≈ 110 Hz default formants/tilt, voice B f0 ≈ 210 Hz with `f1Scale 1.14`/`f2Scale 1.18` + brighter harmonic tilt — tiled `[A, A, B, B]` in ONE continuous encode (the old 30 s stream-copy loop made 4 byte-identical copies: two contiguous acoustic runs were structurally impossible). Ground truth (generator-written; never hand-edited): all **136** words carry a non-empty `speaker` label, exactly **2** distinct labels (`speaker-1`/`speaker-2`), **2 contiguous runs**, single switch at word index **68** (whole-copy boundary = natural sentence gap at **60.12 s**; nominal duration 2 min, container-declared 120.00 s for mp4+m4a twins). Objective separation evidence (numbers only, SECURITY-03): median voiced fundamental-band **109.4 Hz (A) vs 218.8 Hz (B)**, 60–500 Hz centroids 241.7/254.7 Hz. Other fixtures **byte-unchanged** — git shows only the 4 expected files modified; `pnpm fixtures && pnpm fixtures:verify` green (106 checksummed); CC-01.2 scratch-tree regen green. Default `VoiceProfile` reproduces the pre-slice-B formula bit-for-bit.

## Gates (slice B re-run at `fb8ef0f`)

- lint ✓ 0 · typecheck ✓ 0 (3 tsconfigs)
- `corepack pnpm test` ✓ — **Test Files 174 passed (174); Tests 1401 passed | 1 skipped | 1 todo (1403)** (pretest verify-fixtures green)
- `corepack pnpm build && corepack pnpm check-bundle` ✓ — **initial JS 112.9 KB gzip / budget 350 KB (1 chunk)**
- `node scripts/qualification-check.ts` → **`qualification-check: ACCEPT — qualification/0.0.0-spike.json valid for contentHash 6edeb885b852…`** (slice-A precedent; re-signed via `corepack pnpm qualify`, 8/8 RQ pass)
- Targeted single-spec run `playwright test e2e/diarization/accuracy-2spk.spec.ts` (cache-gate confidence, per brief): ground-truth contiguity prerequisite **PASSED**; the accuracy test fails exactly at the sanctioned slice-C RED — `no model:ready pair from diarize.worker within 120000 ms (is the protocol stub still in place?)` — i.e. past the model-cache gate (`assertDiarModelCachePresent` + route mapping satisfied from `.cache/models/`). Full `test:e2e` not expected green until slice C.
- `models:fetch` setup: 4 files fetched (25 already cached), 5/5 models ready — `models:fetch: 5 model(s) ready — 4 fetched, 25 already cached → .cache/models/`. pyannote dir 5,987,474 B across 3 files (408 + 158 + 5,986,908); eres2net 39,593,761 B (38 MiB); cache re-hash of all four pins OK.

## Assumptions

- "Mirror exactly how silero-vad is represented" was implemented as ci-registry/eval-registry rows + a dedicated `DIAR_MODEL_REGISTRY` surface (silero itself has no `registry.ts` surface; putting non-ASR rows into `MODEL_REGISTRY` would leak them into the ASR picker/selector and the CC-03.1 row suite's engine-kind contract). If the orchestrator wants the rows inside `MODEL_REGISTRY` instead, the eval-registry rows already satisfy the pin-match test — one-line move.
- `engine: 'transformers-whisper'` on both diar rows names the transformers.js/ORT stack (ENGINE_KINDS is frozen to the three spike engines; FR-06.1 runs both models on the bundled ORT instance).
- Ground-truth label spelling `speaker-1`/`speaker-2`: the frozen spec asserts non-empty string, exactly 2 distinct, 2 contiguous runs — values are otherwise free; the metrics helper treats labels opaquely (optimal 1:1 mapping to system speaker ids).
- ModelScope model-card SHA (mirror metadata) not re-hashed: modelscope.cn is outside the network allowlist; recorded as declared metadata in the spike doc.
- k2-fsa GitHub download was a one-time sanctioned provenance hash (unit brief), never a runtime/test origin; scripts/models-fetch.ts allowlist untouched (hf.co only).

## Blockers

none new. CC-06.1/06.2/06.5 remain the sanctioned e2e RED awaiting slice C (diarize.worker implementation); slice B removed the ground-truth + model-cache prerequisites that gated them.

---

# Unit report: unit-06-speaker-diarization — slice C (real adapters + diarize.worker; CC-06.1/06.2 GREEN)

Status: **complete (slice C)** — head `f676f46` on `ai-dlc/local-transcribe-engine/unit-06-speaker-diarization` (from `d124faa`). Commits: `83bbd39` feat(engine/diarize) adapters + worker, `969dc29` fix(engine/diarize) cap-as-upper-bound (FR-06.1), `be213e3` fix(engine/diarize) self-hosted ORT wasm load, `f676f46` ci(qualify) re-sign. Frozen tree untouched (`git diff d124faa..HEAD -- tests/ e2e/ fixtures/ qualify/` empty; `qualification/0.0.0-spike.json` touched by the sanctioned re-sign commit only).

## Deliverables

1. **Segmentation adapter** `src/engine/diarize/adapters/segmentation.ts` (SDK glue under `adapters/`, engine-purity). transformers.js ~3.8.1 `AutoModelForAudioFrameClassification` + `AutoProcessor` on `onnx-community/pyannote-segmentation-3.0` (the MIT `pyannote-segmentation-3-0@733a93b6` row); post-processing via `processor.post_process_speaker_diarization(logits, numSamples)` (powerset runs; id 0 = NO_SPEAKER dropped). Runtime: self-hosted ORT wasm fp32 (WebGPU-unsupported, microsoft/onnxruntime#21386). Boundary refinement (the FR-06.1 "tuned on fixtures" preprocessing knob): pyannote is the primary frame classifier; a 10 ms RMS energy gate (rel 0.1 of the window p95 peak, 0.1 s bridge) trims inter-word/leading silence so silence does not score as a DER false-alarm; when the gate finds nothing but pyannote is confident, the model run is trusted (FR-06.2 windows come from Silero speech).
2. **Embedding adapter** `src/engine/diarize/adapters/embeddings.ts` + **fbank** `adapters/fbank.ts`. 3D-Speaker ERes2Net-base (`eres2net-base-3dspeaker@e63c3752`, 39,593,761 B, byte-tied to k2-fsa) run through the onnxruntime-web `InferenceSession` factory HARVESTED from the pyannote session — one ORT copy, three independent sessions (segmentation + ERes2Net + Silero; FR-06.4). Kaldi 80-dim log-Mel frontend (25 ms/10 ms, 512-FFT, pre-emphasis 0.97, povey, HTK mel, global-mean norm per `feature_normalize_type=global-mean`); graph contract read from the ONNX `metadata_props` (`x` [N,T,80] → `embedding` [N,512]), not guessed.
3. **`diarize.worker.ts`** (replaces the unit-01 stub). Thin protocol glue over the frozen DI seam `worker-core.ts`: injects the two adapter sessions + the own-pass Silero `speechScore` (FR-06.2, used when `vad` is absent — the frozen harness sends none); streams `model:progress` (FR-06.6) from the pyannote download; re-materializes `diar:frames` `t`/`jobId` enumerably across `postMessage` (slice-A non-enumerable wire form preserved; structuredClone copies own-enumerables only).
4. **ORT bootstrap shared** — added `prepareOrtWasmBlobs()` to `src/engine/boot/adapters/onnx-runtime-boot.ts` (device-matched plain-threaded build for wasm fp32; re-exposes the `/wasm/` glue+wasm pair as typed blobs) — same bootstrap the ASR adapter uses, so the harness route (which answers `/wasm/**` incl. the `.mjs` glue as `application/wasm`) no longer breaks ORT's dynamic `import()`.
5. **Cap-as-upper-bound** in `clustering.ts` — per the adjudicated FR-06.1 frozen in `clustering.test.ts` (6b18f69) + `unit06-api-contract.d.ts` (d124faa): phase 1 = distance STOP (merge while min average linkage ≤ threshold → natural count); phase 2 = `maxSpeakers` as an UPPER BOUND (force closest-pair merges while count > cap; cap inert when the threshold already collapses the count, incl. at 1). `clustering.test.ts` 15/15.

## FR-06.1 threshold rationale

`DEFAULT_CLUSTER_THRESHOLD = 0.5` (clustering.ts). Measured ERes2Net window-embedding cosine-distance distributions over the diarization windows of the two fixtures (GT-labelled, `onnxruntime-node`, same math as the browser wasm): mean **within-speaker ≈ 0.12**, mean **between-speaker ≈ 0.64**. 0.5 sits in the valley — above the within-speaker spread (a single voice's ~61 windows STOP at one cluster → the CC-06.2 guard) and below the between-speaker floor (two voices stay separate → CC-06.1 confusion ≈ 0). The cap stays a hard upper bound (phase 2) for pathological many-speaker media, so 0.5 governs only the natural cut, never the ceiling. Determinism (CC-06.5): identical per-run results across all 3 runs of both specs (see Measurements).

## Measurements (authoritative L4, real worker in chromium, 3-run medians; numbers only — SECURITY-03)

`e2e/diarization/accuracy-2spk.spec.ts` (CC-06.1) — `speech-2spk-2min.mp4`, thresholds acc ≥ 0.85 / DER ≤ 0.20:

| run | word acc | DER | miss | conf | fa | speakers | frames |
|----:|---------:|----:|-----:|-----:|---:|---------:|-------:|
| 1 | 98.53 % | 14.81 % | 14.2 | 0.5 | 0.1 | 2 | 242 |
| 2 | 98.53 % | 14.81 % | 14.2 | 0.5 | 0.1 | 2 | 242 |
| 3 | 98.53 % | 14.81 % | 14.2 | 0.5 | 0.1 | 2 | 242 |
| **median** | **98.53 %** | **14.81 %** | — | — | — | — | — |

Per-spec wall time ≈ 55 s (3 runs + per-run model load). `e2e/diarization/guard-single-speaker.spec.ts` (CC-06.2) — `speech-2min.mp4`, guard ≥ 0.9 dominant share, single speaker:

| run | speakers | dominant share | frames |
|----:|---------:|---------------:|-------:|
| 1 | 1 | 100.00 % | 148 |
| 2 | 1 | 100.00 % | 148 |
| 3 | 1 | 100.00 % | 148 |

Per-spec wall time ≈ 50 s. Determinism witness: byte-identical frames across the 3 runs of each spec. `estimateSpeakerCount` (eigengap cross-check) is computed per `job:done` and reported in `stats` (numbers, SECURITY-03) but never used to cut (FR-06.1). The residual ~14 % DER is miss (energy-gate trims pyannote's blurred silence edges — the same knob that keeps fa ≈ 0.1); accuracy is unaffected (conf ≈ 0 → both voices assigned correctly).

## Gates (slice C, final tree `f676f46`)

- `corepack pnpm lint` ✓ 0
- `corepack pnpm typecheck` ✓ 0 (tsconfig + tsconfig.node + tsconfig.eval)
- `corepack pnpm test` ✓ — **Test Files 174 passed (174); Tests 1402 passed | 1 skipped | 1 todo (1404)** (the model-coverage/qualify-runner cluster that was red pre-re-sign clears once the spike contentHash matches the slice-C `src/**` tree; `clustering.test.ts` 15/15; diarize unit suite 68)
- `corepack pnpm build && corepack pnpm check-bundle` ✓ — **initial JS 112.9 KB gzip / budget 350 KB (1 chunk)** (diarize/asr/media workers are lazy chunks, excluded from the initial budget)
- `corepack pnpm qualify` → **wrote qualification/0.0.0-spike.json (8/8 RQ pass)**; `node scripts/qualification-check.ts` → **`ACCEPT … contentHash 7dba7132c83a…`**
- `corepack pnpm exec playwright test e2e/diarization/accuracy-2spk.spec.ts e2e/diarization/guard-single-speaker.spec.ts` ✓ **3 passed** (CC-06.1 prerequisite + median; CC-06.2 guard), on their own computed medians — no cherry-picking, no threshold loosening.

## Deviations from spec

1. **Slice-A Deviation 1 (re-materialize `t`/`jobId`)** — honored in the worker `core.onEvent` boundary.
2. **transformers.js frame-classification forward** takes the processor output object directly (`model(inputs)`), NOT `model({input_values: ort_tensor})`. The raw `ort_tensor` is dropped by the forward's HF-style input mapping → "Missing the following inputs: input_values". Confirmed against the pinned-version API (transformers.js v3.8.1 `AutoModelForAudioFrameClassification` example — `const { logits } = await model(inputs)`).
3. **ORT wasm glue must be blob-re-exposed** — the frozen `routeDiarNetwork` serves every `/wasm/**` (incl. the `.mjs` glue) as `application/wasm`; the browser refuses to `import()` a module served so → ORT never builds a session ("no available backend"). Same constraint + same fix the unit-05 ASR adapter documents; hoisted to `prepareOrtWasmBlobs()` and shared.
4. **Same-origin cache override restricted to `*.onnx`** (was all files) — JSON configs flow through the frozen HF-resolve route (from `.cache`), so the request audit still sees `modelHost` traffic; only large ONNX bodies use the vite-served `/.cache` mirror (matches the ASR adapter).

## Assumptions + doc URLs

- ORT wasm selection (plain threaded vs jsep) — https://onnxruntime.ai/docs/api/js/interfaces/Env.WebAssemblyEnv.Interface.html (wasmPaths `{ mjs, wasm }`).
- transformers.js pyannote usage — https://huggingface.co/docs/transformers.js/v3.8.1/en/api/models (`AutoModelForAudioFrameClassification` + `AutoProcessor.post_process_speaker_diarization`; the `model(inputs)` form).
- ERes2Net graph contract (`x`[N,T,80]→`embedding`[N,512], `feature_normalize_type=global-mean`, output_dim 512, sample_rate 16000) read from the cached ONNX `metadata_props`, not the HF model card.
- `device: 'wasm'` fp32 for both diar models (WebGPU-unsupported for these — microsoft/onnxruntime#21386; unit-02 discovery). `env.useBrowserCache = false` (pinned bytes cross once; a network miss surfaces as a coded error).

## Follow-ups

- The ~14 % DER miss is dominated by pyannote's blurred speech-edge silence vs the energy gate; a per-window adaptive gate (currently fixed rel 0.1) could trim miss without touching acc if a future DER tightening needs headroom.
- `estimateSpeakerCount` is reported but unused; if the orchestrator wants an eigengap-driven default cut (option C in the adjudication) it can replace the fixed threshold behind the same frozen call.

---

# Unit report: unit-06-speaker-diarization — slice D (final integration + closeout)

Status: **complete (slice D) — complete candidate for the orchestrator** — head at the final `ci(qualify)` re-sign on `ai-dlc/local-transcribe-engine/unit-06-speaker-diarization` (from `14d827d`). Commits: `5391520` fix(engine/diarize) sentinel-drain tee stream port, `1450a2b` fix(e2e) runner-owned persistent 4315 harness server, docs(unit-06) report, `ci(qualify)` final re-sign. Frozen tree untouched by slice D: `git diff 14d827d..HEAD -- tests/ e2e/ fixtures/` **empty** (qualification record touched by the sanctioned re-sign commit only).

## Deliverables

1. **`readStreamPort` sentinel fix** (`src/engine/diarize/worker-core.ts`, closes the ledger `2026-11-11T01:27Z` BLOCKED-ON-SRC): the stream source now mirrors `PcmChunkStream` (src/engine/audio/decode.ts:634-652) end-of-stream semantics — `{t:'job:done'}`/`{t:'end'}` settle+resolve (never accumulated), a chunk is exactly `t === undefined && typeof startSec === 'number' && samples instanceof Float32Array` (identical predicate), every other posted MediaEvent is ignored, and the existing `close`/`messageclose` path stays as the additional termination. Chromium reality (test-author measurement, reproduced): `close`/`messageclose` never fire on the worker-side tee port — the production tee posts every event incl. `job:done` (decode.ts `send()` :239-242, terminal :442) to every tee port. Frozen-test check first: the frozen stream test (`worker-core.test.ts:317-334`) drives `port2.close()` and asserts only chunk-shape consumption + terminal `job:done` + exactly-one `diar:frames` — **no frozen assertion forbids the sentinel path**; the suite stays green (10/10) and `determinism-concurrent.spec.ts` passes (55.2 s).
2. **Full regression sweep + e2e closeout** — green (below). One new non-frozen change was required: `playwright.config.ts` `webServer` is now an **array** adding a runner-owned persistent harness vite on **4315**. Root cause of `guard-single-speaker` failing 2/2 full sweeps while green solo: FOUR spec files own port 4315 (e2e/diarization ×3 + e2e/captions/align-mae.spec.ts). `startHarnessServer` probes with an HTTP fetch, so when a later sibling's `strictPort` child dies (EADDRINUSE) its probe is answered by the FIRST spec's live vite; that first spec's `afterAll` then kills the server under the still-running sibling → the sibling's next `new Worker('/src/workers/media.worker.ts')` script-fetch fails → `onerror` with `message: undefined`. A single persistent server (identical vite config — all four specs use `isolated: false` and the two harness configs are functionally identical) turns every spec-spawn into an immediate EADDRINUSE death, every probe into a hit on the live server, and every `stopHarnessServer` into an early return on the dead child — removing the kill race with zero frozen-file edits (unit-03 fixed-port doctrine extension; memory-project precedent).
3. **Criteria** → `corepack pnpm verify:unit --from-branch` all untagged pass, CC-06.3 RQ row (below).
4. **Final re-sign** (LAST commit): `corepack pnpm qualify` → contentHash `60a18907d708…`; `node scripts/qualification-check.ts` → ACCEPT; deep JSON diff vs the previous committed record = **contentHash + startedAt ONLY** (no other delta — no defect). **CC-06.3 stays `[RQ]`: `scripts/qualification-check.ts` `expectedRqIds` does NOT include CC-06.3, so no `expectedRqIds`/qualify-measurement rows were added and the `ZIPSCRIBE_QUALIFY_MEASURE=1` leg was NOT run tonight (perf-gate doctrine: never fabricate; unmeasured rows are not recorded).**

## Completion criteria (reports/criteria/unit-06-speaker-diarization.md, verbatim)

| ID | level | passing tests | result |
|---|---|---|---|
| CC-06.1 | untagged | 2 | pass |
| CC-06.2 | untagged | 1 | pass |
| CC-06.3 | RQ | 0 | RQ (outside PR pipeline) |
| CC-06.4 | untagged | 21 | pass |
| CC-06.5 | untagged | 1 | pass |
| CC-06.6 | untagged | 50 | pass |

- `[RQ]` CC-06.3: `qualify/diarization/perf-gate.test.ts` (measurement-mode-only; T1 webgpu ≤ 90 s gated, T2 wasm recorded) executes at the next release on reference hardware; the webgpu device exposure it flags (slice-C helper) is a release-hardware leg.
- `[MANUAL]` items: none in this unit.

## Gates (verbatim tails, final tree)

- `corepack pnpm test` ✓ — `Test Files  174 passed (174)` / `Tests  1402 passed | 1 skipped | 1 todo (1404)` (worker-core unit suite 10/10 incl. the frozen stream test).
- `corepack pnpm lint` ✓ exit 0 (no findings).
- `corepack pnpm typecheck` ✓ exit 0 (tsconfig + tsconfig.node + tsconfig.eval).
- `corepack pnpm build && corepack pnpm check-bundle` ✓ — `check-bundle: initial JS 112.9 KB gzip / budget 350 KB (1 chunks)`.
- `corepack pnpm exec playwright test --project=chromium` (retries=0) ✓ — `21 skipped` / `106 passed (2.7m)`; zero ASR/media regressions (asr longtask 2.5 m, tee-scaling, adversarial-fabrication 53.5 s all green; slice-C `prepareOrtWasmBlobs` shared-boot change caused no ASR regression).
- `corepack pnpm verify:unit --from-branch` ✓ — `verify — all untagged criteria of unit-06-speaker-diarization.md covered (6 total).` (table above).
- `node scripts/qualification-check.ts` ✓ — `qualification-check: ACCEPT — qualification/0.0.0-spike.json valid for contentHash 60a18907d708…`.
- Frozen containment ✓ — `git diff 14d827d..HEAD -- tests/ e2e/ fixtures/` empty.

## Measurements (slice-D final tree; numbers only — SECURITY-03)

Re-measured with a scratch `.night/` driver over the SAME frozen harness + the reviewed test-owned calculator (`tests/unit/diarization/helpers/metrics.ts`); the frozen specs remain the gate of record.

CC-06.1 — `speech-2spk-2min.mp4` (acc ≥ 0.85 / DER ≤ 0.20):

| run | word acc | DER | miss | conf | fa | speakers | frames | run wall |
|----:|---------:|----:|-----:|-----:|---:|---------:|-------:|---------:|
| 1 | 98.53 % | 14.81 % | 14.2 | 0.5 | 0.1 | 2 | 242 | 17.45 s |
| 2 | 98.53 % | 14.81 % | 14.2 | 0.5 | 0.1 | 2 | 242 | 17.33 s |
| 3 | 98.53 % | 14.81 % | 14.2 | 0.5 | 0.1 | 2 | 242 | 17.33 s |
| **median** | **98.53 %** | **14.81 %** | — | — | — | — | — | — |

CC-06.2 — `speech-2min.mp4` guard (≥ 0.90 dominant share, single speaker):

| run | speakers | dominant share | frames | run wall |
|----:|---------:|---------------:|-------:|---------:|
| 1 | 1 | 100.00 % | 148 | 15.10 s |
| 2 | 1 | 100.00 % | 148 | 15.10 s |
| 3 | 1 | 100.00 % | 148 | 15.10 s |

**Determinism (CC-06.5):** `deterministicFrames: true` — the serialized frame list is byte-identical across the 3 runs of BOTH specs, and `determinism-concurrent.spec.ts` proves the concurrent-tee (production media worker, dual-port) run equals both sequential runs (frames AND ASR words). **Spec wall times (final sweep):** accuracy-2spk main test ≈ 58 s, guard ≈ 50–53 s, determinism-concurrent 55.2 s; per-`runDiarize` ≈ 17.3 s (2spk, incl. per-run model load) / ≈ 15.1 s (guard). Network audit: `blocked: []` in every leg.

**Threshold rationale (0.5, per slice C — carried, unchanged):** measured ERes2Net window-embedding cosine distances — mean within-speaker ≈ 0.12, mean between-speaker ≈ 0.64; 0.5 sits in the valley: above the within-speaker spread (single voice stops at one cluster → guard) and below the between-speaker floor (two voices stay separate → conf 0.5 %). The `maxSpeakers` cap remains a phase-2 hard UPPER bound (FR-06.1, 969dc29), so 0.5 governs only the natural cut. Residual DER is miss-dominated (energy-gate trims pyannote's blurred silence edges; fa ≈ 0.1 keeps it DER-cheap); accuracy unaffected (conf ≈ 0).

## Deviations from spec

1. **`diart` → `diarize` path + engine reuse** — the unit lives under `src/engine/diarize/**` (not a `diart/` tree); the ORT stack is REUSED, not duplicated: `prepareOrtWasmBlobs()` hoisted into the shared boot adapter `src/engine/boot/adapters/onnx-runtime-boot.ts` (same bootstrap as ASR) and the ERes2Net/Silero `InferenceSession` factory harvested from the pyannote session — one ORT copy, three sessions (FR-06.4).
2. **ORT blob exposure (slice C, carried):** the frozen harness route answers every `/wasm/**` — incl. the `.mjs` glue — as `application/wasm`; the browser refuses to `import()` that, so the device-matched plain-threaded glue+wasm pair is re-exposed as correctly-typed blob URLs.
3. **Sentinel-stream fix (slice D, above):** `readStreamPort` terminates on the tee's `{t:'job:done'}`/`{t:'end'}` messages exactly like `PcmChunkStream`, keeping `close`/`messageclose` as the additional path.
4. **`playwright.config.ts` persistent 4315 webServer (slice D):** the only change needed for the CI-authoritative sweep to go green; no frozen file edited (config is builder-owned; unit-03 per-file-port doctrine + memory-project single-owner precedent). The guard spec is NOT flaky on its merits — solo green 3/3 every time; the two sweep reds were the cross-file port kill race.

## Contract changes

**None to `architecture.md`** (protocol/model contract types imported verbatim throughout). Frozen-test adjudications were orchestrator/test-author-owned and are ledger-cited: cap-as-upper-bound (`6b18f69`/`d124faa`), CC-06.6 leading-citation titles-only exception + 12-describe-header fix (ledger adjudication + execution entries, `tests/unit/diarization` titles only), harness `postMessage` transfer fix (`14d827d`).

## Dependencies

None outside `settings.yml` approved dependencies (slice D touched no dependency surface).

## Follow-ups

- `jobs.ts` placeholder PCM wiring → deferred to unit-101 (host job plumbing).
- `speaker-merge`/`speaker-split` command ids → unit-104 (UI command dispatch over the pure fns).
- `speakerSource: 'auto-beta'` host wiring + `speakersFromClusters` population on completion (slice-B follow-up; state tier, not engine).
- CC-06.3 T1 leg needs the webgpu device exposure the perf-gate helper flags (release-hardware run).
