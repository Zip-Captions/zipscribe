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

**US-1.2.0** As the product, I want measured WER/RTF/memory per engine-tier so that default model choices are defensible and the performance baselines in `settings.yml` are real.
- *Given* the eval corpus from unit-01, *when* the spike harness runs each candidate in Chrome (T1 and forced-T2), *then* `spikes/model-eval-report.md` contains per-engine rows: `{engine, model, tier, corpusClip, WER, RTF(median of 3), peakMemBytes, punctuated: bool, timestamps: 'word-native'|'word-dtw'|'segment', license, verified: true}`.
- *Given* a candidate whose vendor WER cannot be reproduced within +3 points, *when* reported, *then* it is flagged `degraded-vs-vendor` with the delta.

**US-1.2.1** As a privacy reviewer, I want third-party runtimes network-audited before adoption.
- *Given* `cactus needle.wasm` + `whistle.cact`, *when* the harness loads and runs it with a Playwright network recorder, *then* **any** request outside `huggingface.co`/`cdn.jsdelivr.net` (allowlist) fails adoption — per zip-captions Spike 1.4 Q1 telemetry concern.

## Candidates (from prior-art survey, see `discovery.md`)

| # | Engine | Model(s) | Why | Open questions (inherited, now answered here) |
|---|---|---|---|---|
| A | transformers.js 3.8.x | `onnx-community/whisper-{tiny,base,small,large-v3-turbo}_timestamped` | T1 WebGPU path, DTW word timestamps | T1/T2 throughput truth; does `small` fit 4 GB VRAM budget; WER sanity |
| B | sherpa-onnx WASM (single-thread) | `streaming-zipformer-en` (20M/70M/180M int8); **Parakeet TDT 0.6B v3 int8** (multilingual, punctuation + native token timestamps) | Proven Zipformer demos; Parakeet was zip-captions' multilingual recommendation but **never validated in browser** | Does Parakeet load in the WASM build at all? RTF on desktop CPU? |
| C | cactus needle.wasm | `whistle.cact` (16.9 MB, 7 langs, per-word 80 ms timestamps, keyword biasing) | Low-spec T2/T3 champion if it measures out | Telemetry audit (US-1.2.1); no utterance endpointing — acceptable with our VAD? |
| D | license-blocked | Omnilingual 300M (1600 langs), Moonshine v2, MedASR | Catalog-ready if verified | **Do not benchmark until license verified**; record verification outcome in report |

## Functional Requirements

- **FR-02.1** Eval harness (`tools/eval/`): Playwright-driven page loading each engine in a worker; consumes corpus (unit-01 fixtures + ground-truth JSON); computes WER with a JS port of the Whisper text normalizer; enforces hygiene from zip-captions Spike 1.4: **median of 3 runs, model SHA-256 recorded, transcripts never logged to CI artifacts**.
- **FR-02.2** RTF measured per engine incl. audio decode; peak memory via `performance.measureUserAgentSpecificMemory()` (Chrome) sampled during run.
- **FR-02.3** T2 forcing: harness can force `device:'wasm'` (A) and native WASM builds (B, C).
- **FR-02.4** Punctuation decision input: each row records `punctuated` — this resolves the Whisper-no-punctuation gap (candidates B are natively punctuated; if adopted, `punctuation` becomes a style-able transcript property).
- **FR-02.5** Keyword-biasing (hotwords) smoke: Whistle Aho-Corasick biasing measured on the technical-vocabulary clip (prior-art: B-WER 18.43→4.46 on vendor data) — record as future-feature evidence.
- **FR-02.6** Report committed at `.ai-dlc/local-transcribe-engine/spikes/model-eval-report.md` with: measured table, tier→(engine,model) default recommendation, license verification results, and explicit **rejection reasons** for anything dropped.

## Completion Criteria

- [ ] Report exists with measured rows for A, B, C at T1 (B, C at least T2) and forced-T2 for A
- [ ] `whisper-base` T1 RTF recorded; settings.yml baseline `whisper-small ≥ 4×` confirmed or corrected via a follow-up settings patch PR
- [ ] Parakeet verdict: loads-or-not in sherpa WASM + RTF measured (or documented blocker with upstream issue link)
- [ ] Whistle network audit: pass/fail recorded with request log (redacted per FR-02.1 hygiene)
- [ ] Omnilingual/Moonshine/MedASR license status recorded (verified-ok / blocked-pending)
- [ ] Default registry (for unit-03) explicitly recommended in report: `{T1: (engine, model), T2: (engine, model), T3: (engine, model)}`

## Risks

- Parakeet (640 MB int8) may simply not load in sherpa's WASM build → fall back to Whisper multilingual for T1 multilingual and record.
- WER harness scoring bugs silently poison the registry → the harness itself gets golden tests (reference transcript + synthetic noise with known WER).

## Docs to consult

- Prior-art: `~/Documents/zip-captions-monorepo/aidlc-docs/construction/spikes/spike-1.4-plan.md` (executed here, at last)
- docs-mcp: `transformers.js`, `sherpa-onnx`, `cactus-needle`
