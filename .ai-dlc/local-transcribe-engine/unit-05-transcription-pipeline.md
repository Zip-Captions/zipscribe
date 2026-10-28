---
status: pending
discipline: dev
depends_on: [unit-03-model-manager, unit-04-media-ingest]
workflow: tdd
mode: HITL   # novel domain + the leak issue makes this the riskiest unit
---

# Unit 05: Transcription Pipeline (VAD → windowed ASR → caption blocks)

## Description

The core engine: consume the `PcmChunk` stream, segment with Silero VAD, pack speech into ≤ 28 s windows cut at silence, run the spike-selected ASR engine once per window, convert tokens into normalized `CaptionBlock[]` with word timestamps, stream progress, contain the transformers.js WebGPU memory leak by recycling the ASR worker, and stay entirely off the main thread. Satisfies orig. FR-1.2.2 + FR-1.2.3 (corrected per `discovery.md`).

## User Stories

**US-1.2.2** (orig. FR-1.2.2, corrected) As a video creator, I want arbitrarily long audio transcribed in bounded windows, so the tab never runs out of memory.
- *Given* `audio-120min.mp4`, *when* transcribe (T2 + `tiny`, CI-realistic), *then* it completes with < 1 GB sustained JS-heap growth (T1 variant in release qualification, with GPU-process memory staying under the unit-02 recycle ceiling).
- *Given* VAD speech at 35:12.4–35:18.9, *when* windowing, *then* that segment lies wholly inside exactly one ASR window, and every window boundary falls in VAD silence (no speech within ±0.1 s of a cut).
- *Given* continuous speech longer than 28 s, *when* windowing, *then* that window uses the pipeline's internal `chunk_length_s:30, stride_length_s:5` and its output has no duplicated words at stride seams (golden).
- *Given* 45 s of silence, *when* transcribe, *then* zero ASR calls are issued for it (VAD-gate counter assertion).

**US-1.2.3** (orig. FR-1.2.3) As a user, I want the UI smooth while transcription runs.
- *Given* transcription in progress, *when* a `PerformanceObserver('longtask')` samples the main page for 60 s, *then* no long task > 50 ms attributable to engine code (Playwright).
- *Given* `job:progress` events at ≥ 4 Hz, *when* received, *then* each handler completes < 4 ms (store reducer benchmark).

**US-1.2.6** As an editor, I want caption blocks that read like captions, not like a wall.
- *Given* word tokens from ASR, *when* blockization runs, *then* every block satisfies: ≤ `maxLines` (default 2), ≤ 42 chars/line estimate, duration 0.7–7 s where words allow, split at gaps > 0.6 s or sentence-final punctuation, **never** mid-word; `block.start = firstWord.start − 0.05` clamped to previous block end and `block.end = lastWord.end + 0.05` clamped to next block start; punctuation preserved when the engine provides it (`punctuation` registry flag).
- *Given* an engine with `confidence: true` and a low-confidence region (mean word `probability` < 0.45), *when* blocks are emitted, *then* `confidence` is set for UI dimming; *given* `confidence: false`, *then* `confidence` is absent (never fabricated).

**US-1.2.7** As a user on flaky hardware, I want honest degradation.
- *Given* WebGPU OOM/session-loss error mid-run, *when* the error surfaces, *then* the pipeline auto-downgrades to T2 once (`TIER_DOWNGRADE` notice), resumes from the last committed window, and emits no duplicate blocks.

**US-05.1** As a user transcribing non-English media, I choose the language.
- *Given* `transcribe {language:'fr'}`, *when* run on a multilingual model, *then* the engine is forced to French; *given* `language:null` on an engine with `languageDetect:true`, *then* it auto-detects and the detected language is reported in `job:done`'s project update; *given* `language:null` on an engine without detection, *then* the engine facade rejects the request before posting to the worker (typed validation result `LANGUAGE_REQUIRED`, so the UI can ask for a language).

## Functional Requirements

- **FR-05.1** `engine/asr/vad.ts` + `chunker.ts`: Silero VAD via `onnx-community/silero-vad` (512-sample window, threshold 0.5, min-speech 0.25 s, min-silence 0.35 s — defaults settable, tuned via spike corpus); merge segments closer than 0.3 s; pack consecutive segments into windows ≤ 28 s, cutting only inside silence; pad windows ±0.2 s clamped to the midpoint of the neighbouring silence. Emits `vad:segments` (diarization reuses them).
- **FR-05.2** `engine/asr/transcriber.ts`: engine-agnostic `transcribe(stream, spec, opts, onEvent)`; Whisper path = one pipeline call per window with `{ return_timestamps:'word', language, task:'transcribe' }` (+ `chunk_length_s:30, stride_length_s:5` only for windows > 28 s); word times offset by window start → absolute seconds. Transducer paths consume native token timestamps. Backpressure: ≤ 30 s of PCM buffered ahead.
- **FR-05.3** Leak containment (T1): the ASR worker host (`worker-host.ts`, main-thread side) samples GPU growth via the unit-02 method (or a per-window counter calibrated by unit-02 when sampling is unavailable in production) and **recycles the worker** — terminate, respawn, reload the (cached) model, resume with `resumeFromSec` = end of last committed window — before the recycle ceiling. Emits `WORKER_RECYCLED` notice (not user-visible copy by default). If the spike shows the pinned version doesn't leak, the cadence is "never" but the mechanism stays (it is also the OOM-recovery path).
- **FR-05.4** `engine/asr/blockize.ts`: pure function `words → CaptionBlock[]` implementing US-1.2.6 (golden-fixture + property tested; exported for unit-06 reassignment reuse).
- **FR-05.5** Worker protocol per architecture: `transcribe` accepts both `PcmSource` kinds; `job:segments` streamed per completed window (sorted; RawSegment windows never overlap, so no dedupe beyond stride seams).
- **FR-05.6** Cancellation: `cancel(jobId)` aborts within 2 s (abort flag checked between windows; an in-flight window may finish, its results are discarded). Partial blocks already emitted are kept; project `transcription:'partial'`.
- **FR-05.7** Determinism: greedy decoding, fixed options; WER regression test (Whisper normalizer from unit-02 harness) on `en-clean` clips ≤ spike baseline + 2 points (default model: release qualification; `tiny` smoke: per-PR).
- **FR-05.8** SECURITY-03 (carried from zip-captions): transcript text never enters logs, telemetry, or error `detail` fields (codes only; redaction test asserts no transcript substring appears in emitted errors/notices).
- **FR-05.9** Hallucination guard: drop or flag a window's output when it repeats the same n-gram ≥ 4 times, when text appears for a window VAD marked < 0.5 s speech, or when the decoder hits max tokens; counts reported in `job:done` stats (numbers only).

## Technical Specification

- `src/workers/asr.worker.ts` (imports spike-selected engine glue only); `src/engine/asr/{vad,chunker,transcriber,blockize,worker-host}.ts`.
- Types from `protocol.ts`: `RawSegment`, `VadSegment`, `EngineError`; error codes used here: `MODEL_UNLOADED | GPU_OOM | SESSION_LOST | DECODE_STALL | CANCELLED | ENGINE_INTERNAL`.
- ONNX `numThreads = 1` on the wasm device (settings `testing.onnx_threads`).

## Completion Criteria

- [ ] **CC-05.1** `[RQ]` 120-min run within memory gate on T2+tiny and T1+default model (reference hardware)
- [ ] **CC-05.2** 10-min run with forced worker recycles every 3 windows: JS heap flat (± 50 MB) and output identical to an unrecycled run (real `tiny` model, CI)
- [ ] **CC-05.3** No main-thread long task > 50 ms during transcription (Playwright longtask assertion)
- [ ] **CC-05.4** Windowing property tests: every VAD segment in exactly one window; cuts only in silence; windows ≤ 28 s unless continuous speech
- [ ] **CC-05.5** `tiny` smoke: `speech-2min.mp4` transcribes end-to-end in CI with WER ≤ spike `tiny` baseline + 5 pts
- [ ] **CC-05.6** `[RQ]` Golden WER with the default model: `en-clean` ≤ spike baseline + 2 pts; `fr-clean` with `language:'fr'` ≤ spike baseline + 2 pts (reference hardware)
- [ ] **CC-05.7** `blockize` goldens: line/char/duration/gap/punctuation invariants hold for all fixtures (property tests)
- [ ] **CC-05.8** Mid-run forced `GPU_OOM` → single auto-downgrade, no duplicates, notice event emitted
- [ ] **CC-05.9** Forced worker recycle mid-run (test hook) → resumed output equals an uninterrupted run (block-for-block)
- [ ] **CC-05.10** cancel ≤ 2 s with partial blocks returned (intent criterion) — worker torn down cleanly
- [ ] **CC-05.11** Hallucination guard: synthetic repeated-output fixture is dropped/flagged
- [ ] **CC-05.12** Coverage ≥ 85% on `engine/asr/**`; SECURITY-03 redaction test passes

## Risks

- #1739 leak characteristics differ per model/GPU → recycle ceiling configurable; every release qualification records the trend.
- VAD over/under-segmentation poisons block boundaries → tunables + fixture corpus (accented/noisy clips) in report matrix.
- Worker recycle cost (model re-init + shader warm-up per recycle) → measured in release qualification; if > 10% of wall time, revisit cadence.

## Docs to consult

- transformers.js 3.8.1 versioned docs: `/api/pipelines` (ASR options, `language`, `task`), `/guides/webgpu`; issue #1739/#1755 status re-check at unit start
- docs-mcp `sherpa-onnx` → `wasm/vad-asr`, VAD (if B engine selected for a tier)
- Simulated-streaming patterns prior art: `zip-captions-monorepo/aidlc-docs/construction/on-device-multilingual-stt/functional-design/business-rules.md`
