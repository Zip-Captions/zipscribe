---
status: pending
workflow: tdd
created: 2026-10-27
announcements: [changelog, release-notes]
---

# Intent: Local Transcribe Engine

## Description

The zero-server inference core: given a user-selected media file of **any practical length**, decode audio entirely in-browser, run VAD-segmented Whisper transcription with word-level timestamps on WebGPU (CPU-WASM fallback), assign beta speaker labels, and emit a normalized `CaptionBlock[]` data model — all inside Web Workers, with progress, cancellation, and model caching. No application code may require a server or an API key.

Maps to Epic 1 (US 1.1–1.3) of the original product brief, corrected against research in `discovery.md`.

## Business Context

- Competitor free tiers cap minutes (Descript 60/mo) or length (CapCut quick tool 20 min); local processing removes both caps and the upload privacy problem.
- The engine is the moat; everything in Intents 2–3 consumes its outputs.
- Research (see `discovery.md`) established: transformers.js 3.8.x is the only viable runtime; sherpa-onnx rejected (no WebGPU, unproven Whisper-in-WASM); mp4-muxer deprecated → mediabunny.

## Completion Criteria

- [ ] Model spike report committed (`spikes/model-eval-report.md`) with measured WER/RTF/memory per engine-tier, license verifications, and the approved default registry — all downstream units build on it
- [ ] `transcribe.mp4` (10 min fixture) → `CaptionBlock[]` with word tokens in ≤ 600 s wall on reference hardware, T1 tier, spike-approved default model (all gates green)
- [ ] A 120-minute media file completes transcription without tab crash/OOM on reference hardware (memory bounded: no > 1 GB sustained growth in a 120-min run; verified via `performance.measureUserAgentSpecificMemory` sampling test)
- [ ] `cancel()` mid-run: partial blocks returned, worker torn down ≤ 2 s, no orphaned GPU buffers (leak-watchdog assertion)
- [ ] With WebGPU disabled, the app auto-selects T2 (wasm q8) with no user configuration and still completes `tiny` transcription e2e
- [ ] Second load of the same model makes zero network requests to `huggingface.co` (Playwright route assertion)
- [ ] Diarization: ≥ 85% per-word speaker accuracy on the 2-speaker fixture; rename/reassign engine API propagates to every block
- [ ] Engine unit-test coverage ≥ 85% lines (`src/engine/**`, excluding worker bootstrap glue)

## Units

| Unit | Discipline | Depends on |
|---|---|---|
| unit-01-scaffold-quality-gates | dev | — |
| unit-02-model-eval-spike | dev | unit-01 |
| unit-03-model-manager | dev | unit-02 |
| unit-04-media-ingest | dev | unit-01 |
| unit-05-transcription-pipeline | dev | unit-03, unit-04 |
| unit-06-speaker-diarization | dev | unit-05 |

## Risks

1. **WebGPU Whisper memory leak** (transformers.js #1739, open): chunk-level dispose + watchdog + T2 downgrade path are mandatory in unit-04, not optional.
2. **fp16/q8 WebGPU instabilities** (#894, #1590): pinned dtypes per module; never deviate from the pinned recipe without a discovery note.
3. **ffmpeg.wasm 2 GB / single-thread speed**: fallback tier only; document user-facing limits honestly.
4. **Diarization quality in-browser**: beta label, manual-edit UI assumptions in Intent 2 (unit-07) are the safety net.

## Boundaries (out of scope)

- Any React UI (Intent 2 renders engine state).
- Burn-in/export (Intent 3).
- Multithreaded wasm / COOP-COEP (explicitly deferred; revisit post-launch via /followup).
