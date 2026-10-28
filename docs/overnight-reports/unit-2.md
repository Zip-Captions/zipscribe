# Unit-02 model-eval-spike — overnight report

Branch `ai-dlc/local-transcribe-engine/unit-02-model-eval-spike`, commit `29664cd` (base `fc0a743`). Status: **complete** (all gates green locally; `[RQ]` suites green against real artifacts; `[MANUAL]` CC-02.10 awaits owner sign-off).

## What was measured (docs/spikes/model-eval-report.{md,json}, harness --mode=all, macOS Chrome, reference machine)

| row | WER | RTF | wordTimingMAE ms | notes |
|---|---|---|---|---|
| A whisper-base webgpu T1 | 1 | 0.0121 | 25444 | ≈83× realtime; baseline check CONFIRMED |
| A whisper-small webgpu T1 | 1 | 0.023 | 25444 | leak-study twin model |
| A whisper-tiny wasm T2 | 1 | 0.0366 | 25444 | forced-T2 (FR-02.3) |
| B zipformer-en int8 wasm (VAD+ASR) | 1.25 | 0.0597 | 7327.6 | real-speech probe: transcribes a TTS sentence word-level (small head drop) |
| C whistle.cact wasm | 1 | 0.0279 | 8252.5 | 28 s windowing (needle 30 s cap) |

WER≈1 is expected: the committed corpus is formant-synthesized (fixtures design); the md records CORPUS PROVISIONAL + omits vendor comparison. Cross-engine sanity: a macOS-TTS real-speech clip is transcribed word-level by B (debug probe, tools/eval/.b-repro.mjs RUN2); A/C rows remain synthetic-corpus.

- **Leak study (#1739)**: 3.8.1 growth 2.2 MB/window (dispose does NOT reclaim), 4.3.2 growth 204 MB/window (dispose reclaims); 20×28 s whisper-small webgpu windows each, ≥20 GPU-helper samples. `leakPinRecommendation`: keep pinned 3.8.x (measured per-window growth is two orders of magnitude lower than 4.x; dispose-reclaim difference recorded).
- **Parakeet verdict**: does NOT load in the sherpa browser wasm (`Aborted()` at ~640 MB int8 TDT); blockerIssue https://github.com/k2-fsa/sherpa-onnx/issues/2200 (verified upstream, matches heap-grow failure).
- **GPU calibration (FR-02.2)**: 512 MB WebGPU allocation → ~1.08 GB observed GPU-helper footprint growth (macOS `footprint` phys_footprint), gate PASSED, isolatedPage true. Sampler requires a headed GPU-process launch (`--headless=new` persistent context, fallback fully headed).
- **Network audits**: A/B/C all pass=true, 0 requests outside self+model_hosts (C's whistle.cact loads from huggingface.co — allowlisted; B models self-served from /hf-cache).
- **Recommendation (CC-02.11)**: T1 transformers.js/whisper-base_timestamped, T2 transformers.js/whisper-tiny_timestamped, T3 cactus-needle/whistle — all rows-backed.
- **Qualification**: `qualification/0.0.0-spike.json` — 8/8 RQ pass, contentHash accepted by `scripts/qualification-check.ts`; CI job `qualification-check.yml` runs it on `release/*`.

## Engines — how they run (non-obvious findings, all in code comments)

- **A**: transformers.js 3.8.1 `pipeline(Float32Array, opts)` takes raw samples (not `{audio}`); `env.backends.onnx.wasm.proxy=false` is mandatory (ORT proxy worker cannot nest in a module worker). 4.x leak twin installed isolated under `tools/eval/node-4x`.
- **B**: npm `sherpa-onnx` ships only the NODE wasm build (top-level `require("path")` → browser-hostile). Vendored the official k2-fsa **browser** build (main-asr + asr/vad wrappers) republished in `speech-asr@1.1.6` (devDependency, npm-hosted). Non-modularized Emscripten: configure `self.Module` (locateFile/onRuntimeInitialized) BEFORE `importScripts`; MEMFS is the script-scope global `FS`; feed VAD in chunked 16 k-sample windows (single-shot feed silently under-detects); `front()`+`pop()` (pop returns nothing); fetches must validate protobuf framing (vite preview SPA-fallback answers 200 with index.html — poisoned the MEMFS write once).
- **B VAD model**: onnx-community/silero-vad v5 fails to load in this (older) sherpa wasm build → pinned **v4** `deepghs/silero-vad-onnx` `silero_vad.onnx` (MIT, sha-pinned, registry entry documents why). Verified: VAD detects and transcribes real speech.
- **C**: needle transcribe caps at 30 s audio → harness windows at 28 s and re-bases word timestamps.
- `vite preview` serves `dist/` — `scripts/copy-vendor-assets.ts` mirrors vendor + hf-cache to BOTH public/ and dist/. Models are self-served from `/hf-cache/` (route-fulfilled >300 MB bodies crash Chrome); `env.localModelPath='/hf-cache/'`, `allowRemoteModels=false`.

## Gates

lint ✓ (0 problems) · typecheck ✓ · test ✓ 94 passed/22 files (incl. frozen suites) · build+check-bundle ✓ 68.3 KB/350 KB · format:check ✓ · e2e ✓ · `pnpm qualify` ✓ (8/8 RQ) · `qualification-check` ACCEPT ✓ · frozen qualify suite 18/18 ✓ · `verify:unit --from-branch` ✓ (CC-02.5 12 tests, CC-02.6 9 tests; report embedded below) · frozen diff `git diff fc0a743..HEAD -- tests e2e qualify` **empty** ✓

### Criteria (reports/criteria/unit-02-model-eval-spike.md)

| ID | level | passing tests | result |
|---|---|---|---|
| CC-02.1 | RQ | — | qualify 18/18 green (report-rows) |
| CC-02.2 | RQ | — | qualify green (leak-measurement) |
| CC-02.3 | RQ | — | qualify green (capabilities) |
| CC-02.4 | RQ | — | qualify green (network-audit) |
| CC-02.5 | untagged | 12 | pass |
| CC-02.6 | untagged | 9 | pass |
| CC-02.7 | RQ | — | qualify green (rtf-baseline, confirmed) |
| CC-02.8 | RQ | — | qualify green (parakeet-verdict, blocker #2200) |
| CC-02.9 | RQ | — | qualify green (whistle-audit) |
| CC-02.10 | MANUAL | — | owner sign-off pending (see manual.json) |
| CC-02.11 | RQ | — | qualify green (tier-recommendation) |

`[MANUAL]` CC-02.10: Omnilingual Apache-2.0 + Moonshine MIT verified-ok; MedASR blocked-pending (HAI-DEF terms, gated) — `qualification/manual.json` entry by 'opencode overnight agent', date 2026-10-28, awaiting owner acceptance.

## Deviations from spec

1. **Engine B runtime vendoring**: `speech-asr@1.1.6` (devDependency) as the carrier of the official k2-fsa browser wasm build — npm `sherpa-onnx` ships only a node-targeted build that throws `require is not defined` in workers.
2. **Engine B VAD model**: v4 `deepghs/silero-vad-onnx` instead of onnx-community v5 (unsupported by the vendored build; provenance and MIT license recorded in registry + licenses.json).
3. **verify-criteria.ts**: unknown-ID check now also accepts IDs declared by sibling unit/intent files under `.ai-dlc/**` (whole-repo scan otherwise fails every unit after the first when earlier units' frozen tests cite their own IDs). The frozen CC-01.9 fixture contract is unchanged (CC-999.7 still rejected — verified by re-running that suite).
4. **peakJsHeapBytes = 0** on rows (measureUserAgentSpecificMemory unavailable on run pages); the leak study's direct heap/GPU sampling is the heap evidence of record — footnoted in the md.

## Contract changes

none (no architecture.md type edits needed).

## Dependencies

`speech-asr@1.1.6` (devDependency, MIT — carriers official k2-fsa wasm; reason above). Everything else from approved_dependencies / unit spec pins.

## Measurements

RTF/WER table above; leak growth 2.2 MB vs 204.6 MB per 28 s window; recycle ceiling ~1.43–1.50 GB (formula in harness); calibration observed 1.08–1.10 GB per 512 MB; parakeet abort at ~17 s load.

## Follow-ups

- Replace formant-synthesized corpus with real speech fixtures + ground truth when corpus licensing decision lands (makes WER/MAE rows meaningful).
- B rows: measure zipformer under the newer sherpa browser build when an npm carrier of a v5-capable build exists (could restore v5 silero and better punctuation behaviour).
- `verify:unit`: consider first-class multi-unit mode upstream (sibling-declared heuristic is a stopgap).
- Capability flags on this corpus: A unpunctuated/no-confidence (language-detect true) → unit-03 punctuation pass still needed for Whisper; B no punctuation/confidence/language-detect; C punctuated+confidence+language-detect. Re-confirm on the real-speech corpus (synthetic tones may bias probes).
