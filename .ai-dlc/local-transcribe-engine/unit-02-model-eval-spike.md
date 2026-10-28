---
status: pending
discipline: dev
depends_on: [unit-01-scaffold-quality-gates]
workflow: default
mode: HITL   # model-selection judgement; this report decides everything downstream
---

# Unit 02: Model Evaluation Spike

## Description

Execute the browser-side model benchmark that the sibling project (zip-captions) planned as "Spike 1.4" but never ran. Produce measured (not vendor) data for the candidate engines **in this app's actual runtime** (Chrome WebGPU + WASM), then write the decision report that populates the model registry in unit-03. Prior-art survey and vendor numbers: `discovery.md` § Prior-art.

## User Stories

**US-02.1** As the product, I want measured WER/RTF/memory/timing accuracy per engine-tier so that default model choices are defensible and the performance baselines in `settings.yml` are real.
- *Given* the eval corpus from unit-01, *when* the spike harness runs each candidate in Chrome (T1 and forced-T2), *then* `docs/spikes/model-eval-report.md` contains per-engine rows: `{engine, version, model, revision, device, corpusClip, WER, wordTimingMAEms, RTF(median of 3), peakJsHeapBytes, gpuMemGrowthPerWindowBytes, punctuated: bool, confidence: bool, languageDetect: bool, timestamps: 'word-native'|'word-dtw'|'segment', license, verified: true}`.
- *Given* a candidate whose vendor WER cannot be reproduced within +3 points, *when* reported, *then* it is flagged `degraded-vs-vendor` with the delta.

**US-02.2** As a privacy reviewer, I want third-party runtimes network-audited before adoption.
- *Given* `cactus needle.wasm` + `whistle.cact`, *when* the harness loads and runs it with a Playwright network recorder, *then* **any** request outside `self` + `settings.yml operations.model_hosts` fails adoption — per zip-captions Spike 1.4 Q1 telemetry concern. The same audit runs for engines A and B (ORT/sherpa must load wasm from `/wasm`, never a CDN).

**US-02.3** As the engine owner, I want to know whether the pinned runtime leaks, so the pin and the worker-recycle cadence rest on data.
- *Given* `whisper-small_timestamped` with the pinned dtype recipe on T1, *when* 20 consecutive 28 s windows are transcribed as separate pipeline calls on **3.8.1** and on **latest 4.x**, *then* the report records GPU-process memory after each window for both versions, the per-window growth, and whether pipeline `dispose()` reclaims it; plus the recommended recycle ceiling (bytes) for unit-05.

## Candidates (from prior-art survey, see `discovery.md`)

| # | Engine | Model(s) | Why | Open questions (inherited, now answered here) |
|---|---|---|---|---|
| A | transformers.js 3.8.x | `onnx-community/whisper-{tiny,base,small,large-v3-turbo}_timestamped` | T1 WebGPU path, DTW word timestamps | T1/T2 throughput truth; does `small` fit 4 GB VRAM budget; WER sanity |
| B | sherpa-onnx WASM (single-thread), **non-streaming VAD+ASR path** (`wasm/vad-asr`) — file transcription, not live streaming | **Parakeet TDT 0.6B v3 int8** (multilingual, punctuation + native token timestamps); English small option `parakeet_tdt_ctc_110m-en int8`; `streaming-zipformer-en` only as a reference row | Official WASM VAD+ASR demos exist; Parakeet was zip-captions' multilingual recommendation but **never validated in browser** | Does Parakeet 0.6B load in the WASM build (memory ceiling)? RTF on desktop CPU? Word-level timestamps or token-level only? |
| C | cactus needle.wasm | `whistle.cact` (16.9 MB, 7 langs, per-word 80 ms timestamps, keyword biasing) | Low-spec T2/T3 champion if it measures out | Telemetry audit (US-02.2); no utterance endpointing — acceptable with our VAD? |
| D | license-blocked | Omnilingual 300M (1600 langs), Moonshine v2, MedASR | Catalog-ready if verified | **Do not benchmark until license verified**; record verification outcome in report |

## Functional Requirements

- **FR-02.1** Eval harness (`tools/eval/`): Playwright-driven page loading each engine in a worker; consumes corpus (unit-01 fixtures + ground-truth JSON); computes WER with a JS port of the Whisper text normalizer; enforces hygiene from zip-captions Spike 1.4: **median of 3 runs, model SHA-256 recorded, transcripts never logged to CI artifacts**.
- **FR-02.2** RTF measured per engine incl. audio decode; JS memory via `performance.measureUserAgentSpecificMemory()` (requires the COOP/COEP `preview:isolated` server from unit-01); GPU-process memory via an out-of-band sampler the harness validates first (known-allocation calibration test). `numThreads = 1` in all runs.
- **FR-02.7** Word-timing accuracy: `wordTimingMAEms` = mean |start/end − reference| over aligned words (reference timings from unit-01 ground truth); the editor's manual-correction burden is judged from this, not WER.
- **FR-02.8** Capability probes per engine: language auto-detect works without `language` (bool), per-word probability available (bool), punctuation (bool). These become registry flags in unit-03.
- **FR-02.10** Release-qualification runner (the harness generalizes into it): `pnpm qualify [--intent <slug>]` runs every `qualify/**` suite on the current machine, records machine info, and writes `qualification/<version>.json` per `knowledge/conventions.md` § Release qualification (incl. `contentHash`); `scripts/qualification-check.ts` + the `qualification-check` CI job verify it on `release/*`. This spike's own measurements are the first qualification file (`qualification/0.0.0-spike.json`).
- **FR-02.9** Pin revisions: every evaluated model row records the HF commit SHA (`x-repo-commit`) and per-file SHA-256 — unit-03 copies them verbatim.
- **FR-02.3** T2 forcing: harness can force `device:'wasm'` (A) and native WASM builds (B, C).
- **FR-02.4** Punctuation decision input: each row records `punctuated` — this resolves the Whisper-no-punctuation gap (candidates B are natively punctuated; if adopted, `punctuation` becomes a style-able transcript property).
- **FR-02.5** Keyword-biasing (hotwords) smoke: Whistle Aho-Corasick biasing measured on the technical-vocabulary clip (prior-art: B-WER 18.43→4.46 on vendor data) — record as future-feature evidence.
- **FR-02.6** Report committed at `docs/spikes/model-eval-report.md` (code-owned path; `.ai-dlc/**` stays orchestrator-owned) with: measured table, tier→(engine,model) default recommendation, license verification results, and explicit **rejection reasons** for anything dropped.

## Completion Criteria

- [ ] **CC-02.1** `[RQ]` Report exists with measured rows for A, B, C at T1 (B, C at least T2) and forced-T2 for A
- [ ] **CC-02.2** `[RQ]` #1739 leak measured on 3.8.1 and latest 4.x (US-02.3) with a pin recommendation and recycle ceiling
- [ ] **CC-02.3** `[RQ]` `wordTimingMAEms` + capability flags (`languageDetect`, `confidence`, `punctuated`) recorded for every adopted row
- [ ] **CC-02.4** `[RQ]` Network audit (US-02.2) passes for every adopted engine
- [ ] **CC-02.5** `pnpm qualify` produces a schema-valid `qualification/0.0.0-spike.json`; `qualification-check` rejects it after a one-byte change under `src/` (hash mismatch) and accepts it unchanged
- [ ] **CC-02.6** WER harness golden tests: reference transcript + synthetic edits with known WER score exactly
- [ ] **CC-02.7** `[RQ]` `whisper-base` T1 RTF recorded; settings.yml baseline `whisper-small ≥ 4×` confirmed or corrected via a follow-up settings patch PR
- [ ] **CC-02.8** `[RQ]` Parakeet verdict: loads-or-not in sherpa WASM + RTF measured (or documented blocker with upstream issue link)
- [ ] **CC-02.9** `[RQ]` Whistle network audit: pass/fail recorded with request log (redacted per FR-02.1 hygiene)
- [ ] **CC-02.10** `[MANUAL]` Omnilingual/Moonshine/MedASR license status recorded (verified-ok / blocked-pending)
- [ ] **CC-02.11** `[RQ]` Default registry (for unit-03) explicitly recommended in report: `{T1: (engine, model), T2: (engine, model), T3: (engine, model)}`

## Risks

- Parakeet (640 MB int8) may simply not load in sherpa's WASM build → fall back to Whisper multilingual for T1 multilingual and record.
- WER harness scoring bugs silently poison the registry → the harness itself gets golden tests (reference transcript + synthetic noise with known WER).

## Docs to consult

- Prior-art: `~/Documents/zip-captions-monorepo/aidlc-docs/construction/spikes/spike-1.4-plan.md` (executed here, at last)
- docs-mcp: `transformers.js` (indexes `main`/4.x — use 3.8.1 versioned docs for the pinned path), `sherpa-onnx` (`wasm/vad-asr`, NeMo Parakeet pages), `cactus-needle`
- Leak report: https://github.com/huggingface/transformers.js/issues/1739 · fix PR #1755
