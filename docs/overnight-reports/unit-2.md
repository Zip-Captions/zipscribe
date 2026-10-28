# Unit report: unit-02-model-eval-spike

Branch `ai-dlc/local-transcribe-engine/unit-02-model-eval-spike`, HEAD `922ca00` (base `fc0a743`, PR #5 OPEN).
Status: **complete-with-blockers** — measured artifacts real and all gates green, but CC-02.8 (Parakeet) is an
upstream **blocker** (`loads=false`, k2-fsa/sherpa-onnx#2200) and CC-02.10 `[MANUAL]` **awaits owner sign-off**.
Supersedes the build-1 report (commit `a6ec6c5`), whose measurements were rejected as junk (see
`docs/overnight-ledger.md` "UNIT-02 BUILD_VERIFIED FAILED") and which still claimed the since-removed
third-party `speech-asr@1.1.6` dependency — that claim is FALSE at this HEAD.

**HITL flag** (unit frontmatter `mode: HITL`): the model-selection judgement — the § Measurements tier
recommendation for the unit-03 registry — is for the owner's morning review; the unit's squash-merge commit
into `develop` is the revert point.

This report mirrors the measured artifacts (`docs/spikes/model-eval-report.{md,json}`,
`docs/spikes/gpu-calibration.json`, `docs/spikes/network/{A,B,C}.json`, `docs/spikes/parakeet-verdict.json`,
`qualification/0.0.0-spike.json`) — never the reverse. Every number below is copied verbatim from them.

## Completion criteria

From `reports/criteria/unit-02-model-eval-spike.md` (`corepack pnpm verify:unit --from-branch`, exit 0, 2026-10-28):

| ID       | level    | passing tests | result                       |
| -------- | -------- | ------------- | ---------------------------- |
| CC-02.1  | RQ       | 0             | RQ (outside PR pipeline)     |
| CC-02.2  | RQ       | 0             | RQ (outside PR pipeline)     |
| CC-02.3  | RQ       | 0             | RQ (outside PR pipeline)     |
| CC-02.4  | RQ       | 0             | RQ (outside PR pipeline)     |
| CC-02.5  | untagged | 12            | pass                         |
| CC-02.6  | untagged | 9             | pass                         |
| CC-02.7  | RQ       | 0             | RQ (outside PR pipeline)     |
| CC-02.8  | RQ       | 0             | RQ (outside PR pipeline)     |
| CC-02.9  | RQ       | 0             | RQ (outside PR pipeline)     |
| CC-02.10 | MANUAL   | 0             | MANUAL (outside PR pipeline) |
| CC-02.11 | RQ       | 0             | RQ (outside PR pipeline)     |

`[RQ]` items — `pnpm qualify` (qualify/model-eval suites, data-driven over the spike artifacts) →
`qualification/0.0.0-spike.json`: **8/8 criteria pass** on the reference machine (Apple M2 Pro, 34.4 GB RAM,
apple metal-3, HeadlessChrome/156): CC-02.1 8/8, CC-02.2 3/3, CC-02.3 2/2, CC-02.4 1/1, CC-02.7 2/2,
CC-02.8 1/1, CC-02.9 1/1, CC-02.11 1/1 assertions. Note on CC-02.8: its qualify assertion passes because the
criterion is "verdict recorded (loads-or-not + RTF or documented blocker)" — the **substantive outcome is the
blocker**: `parakeetVerdict.loads=false` (`docs/spikes/parakeet-verdict.json`, `model-eval-report.json`),
`Aborted()` at `_SherpaOnnxCreateOfflineRecognizer` after `loadMs: 16112` for the 640 MB int8 TDT, upstream
https://github.com/k2-fsa/sherpa-onnx/issues/2200 (32-bit wasm heap cannot grow; verified live against the
same model class and vad-asr path). This unit cannot make Parakeet pass; retest when upstream ships a fix.

`[MANUAL]` CC-02.10 — **owner checklist, never agent-marked done.** Agent-recorded research only
(`qualification/manual.json`, by "opencode overnight agent (license research, official sources)", 2026-10-28;
full notes + URLs in `model-eval-report.json` `licenses[]` and `tools/eval/licenses.json`):

- [ ] Omnilingual ASR 300M (facebookresearch/omnilingual-asr): **verified-ok** — code and models Apache-2.0 per
      the official repository LICENSE; companion corpus CC-BY-4.0 (not shipped). Owner confirms.
- [ ] Moonshine v2 (moonshine-ai/moonshine-tiny): **verified-ok** — model card license tag MIT (HF API
      cardData). Owner confirms.
- [ ] MedASR (google/medasr): **blocked-pending** — gated HF repo under Health-AI-Developer-Foundations terms
      (acceptance, usage restrictions, no unmodified clinical use); gated download also conflicts with the
      no-auth runtime fetch (settings.yml `model_hosts`). Requires legal review + owner sign-off before any
      benchmark; **no benchmark row present** (unit spec: license verified before benchmarking).

## Gates

Verbatim, re-run at this HEAD (docs-only change; nothing broke):
lint ✓ exit 0 (0 problems) · typecheck ✓ exit 0 (`tsconfig.json` + `tsconfig.node.json` + `tsconfig.eval.json`)
· test ✓ exit 0 — **94 passed | 1 skipped | 1 todo** (22 files, 64.8 s; incl. frozen CC-02.5 ×12 / CC-02.6 ×9)
· build ✓ + check-bundle ✓ — initial JS **68.3 KB gzip** / 350 KB budget (1 chunk) · test:e2e ✓ exit 0 (1
passed chromium, 3 `[DEPLOY]` skipped per Adaptation 3, 4.3 s) · `verify:unit --from-branch` ✓ exit 0 ("all
untagged criteria … covered (11 total)") · `pnpm qualify` **8/8 RQ** (committed artifact restored; the frozen
CC-02.5 re-run inside `pnpm test` regenerated only `startedAt`) · `qualification-check` ✓ —
"ACCEPT — qualification/0.0.0-spike.json valid for contentHash fba967fe7b74…" · frozen contract ✓ —
`git diff fc0a743..HEAD --diff-filter=M -- tests e2e qualify` is **empty**.
Pre-existing red (not from this slice): `format:check` fails on 3 committed `tools/` files
(`tools/eval/harness.mjs`, `tools/eval/pages/engine-a.ts`, `tools/eval/pin-models.mjs`) — landed with the
slice-2C commits; `tools/**` is frozen for docs-only slices, so this needs an orchestrator/builder fix
(`prettier --write tools/eval`) before CI-green.

## Deviations from spec

1. **Corpus is sine-formant synthesized (unit-01 interim)** — every row runs `taxi-en-technical` (33.984 s)
   from the unit-01 generator. Consequence (recorded as CORPUS PROVISIONAL in the spike md): **WER /
   wordTimingMAEms are cross-engine-comparison-grade on this machine only, not absolute accuracy claims**,
   and US-02.1's `degraded-vs-vendor` (+3 pts) check **cannot be adjudicated** on synthetic audio — vendor
   comparison rows are omitted, not passed. WER≈1 (perfect) across A/C rows and 1.25 for B reflect synthetic
   phonation, not real speech; see unit-01 report Deviations item 7.
2. **Engine B runtime source**: npm `sherpa-onnx` ships only the node-targeted wasm build (top-level
   `require("path")` → browser-hostile). The official k2-fsa **browser** build of the non-streaming
   `wasm/vad-asr` path is therefore loaded from the pinned k2-fsa Hugging Face Space
   `spaces/k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc @ 9d5fc71d88ab…` — npm registry + HF only
   (allowlist-compliant); per-file SHA-256 in `models/eval-registry.json` (id `sherpa-wasm-vad-asr`) with the
   `.wasm` digest **equal to the HF LFS oid**. The Space ships a 367 MB zh-model `.data` preload;
   `Module.getPreloadedPackage` is stubbed to skip that fetch (self-origin requests only). ASSUMPTION
   (accepted by the orchestrator at slice-2C verification): the same-org Space is the documented official
   carrier (docs-mcp sherpa-onnx wasm pages).
3. **VAD model**: onnx-community/silero-vad **v5** fails to load in this sherpa build → pinned **v4**
   `deepghs/silero-vad-onnx` `silero_vad.onnx` (MIT, SHA-256-pinned in the registry).
4. **Parakeet (CC-02.8)**: upstream blocker, see § Completion criteria — `loads=false`, k2-fsa/sherpa-onnx#2200.
   No fallback multilingual row was substituted (unit spec's fallback is a unit-03 registry decision).
5. **WER harness normalizer scope** (FR-02.1 "JS port of the Whisper text normalizer"): English-only port of
   `openai/whisper` `whisper_normalizer/english.py` — lowercase, contraction expansion, punctuation-category
   strip, whitespace collapse (Levenshtein WER over normalized words). Upstream **number-to-word conversion
   deliberately NOT ported** (needs `inflect` morphology; not exercised by this corpus) and `well` excluded
   from the contraction map — documented in `tools/eval/wer-core.mjs` with the upstream URL. Golden tests
   (CC-02.6 ×9) score synthetic edits exactly.

## Contract changes

No `architecture.md` type edits were needed. Tool deviations inside frozen/orchestrator-owned paths, from
`git log -p fc0a743..HEAD`, for the orchestrator's attention:

- `scripts/verify-criteria.ts` (frozen-adjacent): the unknown-ID check additionally accepts IDs **declared by
  sibling unit/intent files under `.ai-dlc/**`** — otherwise the whole-repo test scan fails every unit after
  the first (earlier units' frozen tests cite their own IDs). Typo-catch intact: undeclared IDs still exit
  non-zero; the CC-01.9 fixture negatives stay green. Judged defensible by the orchestrator
  (BUILD_VERIFIED-FAILED ledger entry); the reviewer should confirm.
- `package.json`: `typecheck` gains `tsconfig.eval.json`; new scripts `qualify`, `eval:run` (FR-02.10 /
  FR-02.1 surface).
- `scripts/models-fetch.ts`: optional `--registry <path>` (eval uses `models/eval-registry.json`; CI keeps the
  frozen `models/ci-registry.json` default).
- `vite.config.ts`: eval engine pages build only under `ZIPSCRIBE_EVAL=1` — the per-PR `pnpm build` and the
  shipped app/bundle are untouched.
- `scripts/qualify.ts` machine probe: opens a secure-context localhost origin with adapter gating (build-1
  probed `about:blank` and reported `webgpu-unavailable` falsely; now `"apple metal-3"` with the probe server
  closed so the process exits).
- Measurement-semantics choices in `tools/eval/harness.mjs` (slice 2B/2C fixes): negative per-window GPU
  deltas clamp to 0 (growth floor — never negative-as-data); `peakJsHeap` guarantees ≥1 sample or records
  null+reason (never 0); report seed-merge so partial modes don't blank sections.

## Dependencies

`package.json` diff vs `fc0a743` (all dev-side, eval-harness only; nothing ships in the app graph):

- **REMOVED** (slice 2C, commit `658a3f7`): `speech-asr@1.1.6` — the build-1 third-party carrier of the
  sherpa browser build (anyshu/easy-asr wrapper, unknown provenance). Rejected at the BUILD_VERIFIED audit;
  zero references remain (verified by grep). Engine B now uses the official k2-fsa assets (Deviation 2).
- ADDED `cactus-needle@0.3.0` (devDependency, Apache-2.0) — engine C's npm browser package; `needle.wasm` /
  `needle.cjs` / `LICENSE` are vendor-vendored under a SHA-256-pinned manifest
  (`node_modules/cactus-needle/vendor/manifest.json`, Cactus-Compute/needle3 @ `2ae11323dc000f5e70c49f7403efa6af12ba9e67`).
- ADDED `sherpa-onnx@2.0.1` (devDependency, Apache-2.0) — carried from build-1; at HEAD **no harness/page
  code references it** (engine B loads the official HF-Space build). Candidate for removal — see Follow-ups.
- HF-hosted vendor assets (inside `settings.yml operations.model_hosts`), SHA-256-pinned in
  `models/eval-registry.json` / `model-eval-report.json runtimeAssets`:
  - sherpa official build @ Space rev `9d5fc71d88ab…`: `sherpa-onnx-wasm-main-vad-asr.js`
    `8a7f50a3…`, `.wasm` `e4dead1d…` (= LFS oid), `sherpa-onnx-asr.js` `6297ed75…`, `sherpa-onnx-vad.js`
    `ca2b0844…`.
  - cactus-needle vendor @ `2ae11323…`: `needle.cjs` `964681b2…`, `needle.wasm` `c43f48e1…`, `LICENSE`
    `cfc7749b…`; model `whistle.cact` from Cactus-Compute/whistle @ rev `b358ddadd89b…`.
- Isolated twin: `tools/eval/node-4x/` holds `@huggingface/transformers ^4.3.2` in its **own** node_modules
  (measurement-only for the #1739 leak study; the app stays on the pinned 3.8.1 — version pins honored).
- Everything else matches `settings.yml approved_dependencies` / unit-spec pins (license-check green since
  unit-01).

## Measurements

Environment (all rows): macOS Darwin 24.6.0 arm64, Apple M2 Pro; chromium new-headless 156 with
`--enable-unsafe-webgpu --use-angle=metal --enable-features=SharedArrayBuffer`; `crossOriginIsolated=true`;
navigator.gpu adapter=YES **apple metal-3**, non-fallback; `numThreads=1`; median-of-3 wall incl. audio
decode. GPU sampler calibrated first (`docs/spikes/gpu-calibration.json`): allocated 536870912 B → observed
GPU-process growth **1112539136 B**, `passed=true`, `isolatedPage=true`, `allocatorOk=true` (pid 44427).

| #   | engine                                    | model (revision)                                                    | dev/tier  | WER  | MAE ms  | RTF    | per-run wall ms          | peak JS heap B | GPU Δ/win B | lang | conf | punct | timestamps  |
| --- | ----------------------------------------- | ------------------------------------------------------------------- | --------- | ---- | ------- | ------ | ------------------------ | -------------- | ----------- | ---- | ---- | ----- | ----------- |
| A   | transformers.js 3.8.1                     | whisper-base_timestamped `608c49e613…`                              | webgpu T1 | 1    | 20189.7 | 0.0206 | 1110.7 / 696.1 / 701     | 1091493336     | 0           | ✓    | ✗    | ✗     | word-native |
| A   | transformers.js 3.8.1                     | whisper-small_timestamped `65caa70f29…`                             | webgpu T1 | 1    | 14123.5 | 0.0424 | 1518.2 / 1425.9 / 1439.9 | 1462388508     | 2097152     | ✓    | ✗    | ✗     | word-native |
| A   | transformers.js 3.8.1 (forced T2)         | whisper-tiny_timestamped `5172442937…`                              | wasm T2   | 1    | 14719.5 | 0.0674 | 2373.1 / 2291.8 / 2284.3 | 894262250      | 0           | ✓    | ✗    | ✗     | word-native |
| B   | sherpa-onnx wasm/vad-asr (space 9d5fc71d) | csukuangfj/sherpa-onnx-zipformer-en-2023-06-26 (int8) `11a70a47ec…` | wasm T2   | 1.25 | 8047.5  | 0.0579 | 2027.3 / 1969.1 / 1951.2 | 88933177       | 0           | ✗    | ✗    | ✗     | word-native |
| C   | cactus-needle@0.3.0 (rev 2ae11323)        | Cactus-Compute/whistle (whistle.cact) `b358ddadd8…`                 | wasm T2   | 1    | 8241.1  | 0.0271 | 989.5 / 918.1 / 921.4    | 2809637        | 0           | ✓    | ✓    | ✓     | word-native |

All rows `ok=true`, `verified=true`, license Apache-2.0, clip `taxi-en-technical` (33.984 s), from
`model-eval-report.json`. WER/MAE carry the Deviation-1 caveat (synthetic corpus). FR-02.5 hotword smoke
(C row): `keywordsRequested=2`, `groundTruthMatches=2`, **`biasApplied=false`** — recorded honestly; keyword
biasing is future-feature evidence, not measured benefit.

**#1739 leak study** (US-02.3; whisper-small_timestamped webgpu, `{encoder_model: fp32, decoder_model_merged:
q4}`, 20 × 28 s windows, out-of-band macOS `footprint` on the GPU process):

| version | per-window growth B | samples | dispose() reclaims | dispose before → after B | recycle ceiling B | baseline B |
| ------- | ------------------- | ------- | ------------------ | ------------------------ | ----------------- | ---------- |
| 3.8.1   | 2207528             | 20/20   | **false**          | 2174746624 → 2156920832  | 1498911512        | 1492123648 |
| 4.3.2   | 204361944           | 20/20   | **true**           | 5801771008 → 370147328   | 1430533608        | 1253048320 |

Pin recommendation (verbatim from the report): keep `settings.yml version_pins` at ~3.8.1 — measured
per-window growth is ~2.2 MB (3.8.1, stable −7.3…+4.2 MB/window real samples) vs ~204 MB (~200 MB class) per
window on 4.x; revisit 4.x when transformers.js PR #1755 (fixes #1739) merges and re-measure. The dispose
asymmetry is recorded: 3.8.1 dispose does **not** reclaim GPU-process memory, 4.3.2 does. **Recycle-ceiling
recommendation for unit-05: ~1.43–1.50 GB** (report values 1430533608 / 1498911512; formula in harness).

**Network audits (US-02.2)** — redacted request logs (URLs/ids only, SECURITY-03), all `pass=true`, 0 requests
outside self + `model_hosts`: A `docs/spikes/network/A.json` (28 requests, self-only, models self-served from
`/hf-cache`), B `B.json` (18, self-only, official sherpa assets self-hosted under `/sherpa`), C `C.json` (7 —
self + the pinned `https://huggingface.co/Cactus-Compute/whistle/resolve/b358dda…/whistle.cact`). Whistle
telemetry concern (zip-captions Spike 1.4 Q1): cleared.

**Baseline check (CC-02.7)** — `baselineCheck.outcome: "confirmed"`; verbatim statement: "Measured
whisper-base T1 RTF 0.0206 (≈48.5× realtime) — the settings.yml performance_baselines entry (whisper-small ≥
4× realtime) is achievable on reference hardware; confirmed, no settings patch needed." The whisper-small
T1 row measures RTF **0.0424** (≈24× realtime), so the baseline holds against the model it names.

**Recommendation (CC-02.11, HITL — owner review)** — unit-03 default registry, every pair traced to a
measured row: T1 transformers.js / `onnx-community/whisper-base_timestamped`;
T2 sherpa-onnx / `csukuangfj/sherpa-onnx-zipformer-en-2023-06-26 (int8)`;
T3 cactus-needle / `Cactus-Compute/whistle (whistle.cact)`.

## Follow-ups

- **3.8.1 silent >30 s truncation** (slice-2B finding): unchunked whisper feature extraction truncates audio
  past 30 s without warning (`feature_extraction_whisper.js:70-83`); the eval harness vendors the vendor
  `chunk_length_s:30`/`stride:5` recipe (this biased build-1's RTF ~1.75× low). **unit-05 (engine pipeline)
  must chunk long audio** — do not call the pipeline with >30 s buffers.
- Registry handoff (unit-03): adopt T2=sherpa-zipformer + T3=whistle per the recommendation above; copy HF
  commit SHAs + per-file SHA-256 verbatim (FR-02.9). Whisper rows are unpunctuated + no confidence → the
  unit-03 punctuation pass stays on the table; whistle is punctuated + confidence + language-detect.
- **Parakeet retest** when k2-fsa/sherpa-onnx#2200 is fixed (same harness: `pnpm eval:run` verdict path).
- **Corpus vendoring awaits owner** (unit-01 F2 interim): sine-formant fixtures must be replaced with
  openly-licensed real speech + forced-aligned ground truth under an approved network exception; until then
  all WER/MAE rows are comparison-only (Deviation 1).
- CC-02.10 `[MANUAL]` owner sign-off (checklist above) before any release-qualification acceptance.
- Drop the unused `sherpa-onnx@2.0.1` devDependency (and the stale "npm sherpa-onnx" header comment in
  `scripts/copy-vendor-assets.ts`) if the orchestrator agrees nothing references it.
- `verify:unit`: consider first-class multi-unit mode upstream — the sibling-declared-ID acceptance in
  `verify-criteria.ts` is a stopgap (Contract changes).
