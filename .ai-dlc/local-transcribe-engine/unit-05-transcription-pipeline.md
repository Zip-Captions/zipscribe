---
status: pending
discipline: dev
depends_on: [unit-03-model-manager, unit-04-media-ingest]
workflow: tdd
mode: HITL   # novel domain + the leak issue makes this the riskiest unit
---

# Unit 05: Transcription Pipeline (VAD → chunked ASR → caption blocks)

## Description

The core engine: consume the `PcmChunkStream`, segment with Silero VAD, run the spike-selected ASR engine in bounded windows (Whisper: `chunk_length_s:30`, `stride_length_s:5`), convert tokens into normalized `CaptionBlock[]` with word timestamps, stream progress, survive the transformers.js WebGPU memory leak, and stay entirely off the main thread. Satisfies orig. FR-1.2.2 + FR-1.2.3 (corrected per `discovery.md`).

## User Stories

**US-1.2.2** (orig. FR-1.2.2, corrected) As a video creator, I want arbitrarily long audio transcribed in bounded sliding windows, so the tab never runs out of memory.
- *Given* `audio-120min.mp4`, *when* transcribe (T2 + `tiny`, CI-realistic), *then* completes with < 1 GB sustained heap growth and zero GPU-process growth beyond one chunk's working set (T1 variant in nightly).
- *Given* VAD detects speech at 35:12.4–35:18.9, *when* windowing, *then* the containing ASR window starts ≥ 5 s before and ends ≥ 5 s after the segment (`stride_length_s:5`; original brief's 1 s overlap available as `strideOverride` config).
- *Given* 45 s of silence, *when* transcribe, *then* zero ASR calls issued for it (VAD-gate counter assertion).

**US-1.2.3** (orig. FR-1.2.3) As a user, I want the UI at 60 FPS while transcription runs.
- *Given* transcription in progress, *when* a `PerformanceObserver('longtask')` samples the main page for 60 s, *then* no long task > 50 ms attributable to engine code (Playwright).
- *Given* `job:progress` events at ≥ 4 Hz, *when* received, *then* each handler completes < 4 ms (store reducer benchmark).

**US-1.2.6** As an editor, I want caption blocks that read like captions, not like a wall.
- *Given* word tokens from ASR, *when* blockization, *then* every block satisfies: ≤ `maxLines` (default 2), ≤ 42 chars/line estimate, split at gaps > 0.6 s or sentence-final punctuation, **never** mid-word, `block.start = firstWord.start − 0.05` clamped to previous block end, punctuation preserved when engine provides it (`punctuation` registry flag).
- *Given* low-confidence region (mean word `probability` < 0.45), *when* blocks emitted, *then* `confidence` field set for UI dimming.

**US-1.2.7** As a user on flaky hardware, I want honest degradation.
- *Given* WebGPU OOM/session-loss error mid-run, *when* error surfaces, *then* pipeline auto-downgrades to T2 once (user-visible notice), resumes from last completed segment, no duplicate blocks.

## Functional Requirements

- **FR-05.1** `engine/asr/chunker.ts`: VAD segmentation via `onnx-community/silero-vad` (512-sample window, configurable threshold 0.5, min-speech 0.25 s, min-silence 0.35 s — defaults settable, tuned via spike corpus); merges segments closer than 0.3 s.
- **FR-05.2** `engine/asr/transcriber.ts`: engine-agnostic `transcribe(stream, spec, onEvent)`; Whisper path through pipeline options `{ chunk_length_s:30, stride_length_s:5, return_timestamps:'word' }`; transducer paths consume native token timestamps. Backpressure: ASR consumes ≤ `k` PCM batches ahead (k=30 s).
- **FR-05.3** Leak containment (T1): chunk-loop `dispose()` per spec in discovery, session re-creation every 40 chunks, heap sampling; on threshold breach → proactive T2 downgrade (same path as US-1.2.7).
- **FR-05.4** `engine/asr/blockize.ts`: pure function `words → CaptionBlock[]` implementing US-1.2.6 (golden-fixture tested; exported for unit-06 re-assignment reuse).
- **FR-05.5** Worker protocol per architecture `PcmSource = {kind:'transfer', buffer} | {kind:'stream', port}`; `transcribe` request accepts both; `job:segments` streamed per completed VAD segment (sorted, deduped by id).
- **FR-05.6** Cancellation: `cancel(jobId)` aborts within 2 s (abort-flag checked between batches; in-flight ASR call allowed to finish its current window, results discarded).
- **FR-05.7** Determinism: fixed ASR seeds/options where engine supports; WER regression test (Whisper-normalizer from unit-02 harness) on `en-clean` clips ≤ spike baseline + 2 points (`@slow`, nightly; smoke with `tiny` per-PR).
- **FR-05.8** SECURITY-03 (carried from zip-captions): transcript text never enters logs, telemetry, or error `message` fields (log types/codes only; redaction test asserts no transcript substring appears in emitted errors).

## Technical Specification

- `src/workers/asr.worker.ts` (imports spike-selected engine glue only); `src/engine/asr/{chunker,transcriber,blockize,worker-host}.ts`.
- `RawSegment` (protocol) = `{ start, end, text, words: WordToken[], probability }` — engine output before blockization.
- Error taxonomy (`EngineError.code`): `MODEL_UNLOADED | GPU_OOM | SESSION_LOST | DECODE_STALL | CANCELLED | ENGINE_INTERNAL`.

## Completion Criteria

- [ ] 120-min CI-tier (T2+tiny) completes within memory gate; T1 variant recorded in nightly run
- [ ] No main-thread long task > 50 ms during transcription (Playwright longtask assertion)
- [ ] Golden WER: `en-clean` clips ≤ spike-report baseline + 2 pts (nightly `@slow`), `tiny` smoke passes per-PR
- [ ] `blockize` goldens: line/char/gap/punctuation invariants hold for all fixtures (property tests)
- [ ] Mid-run forced `GPU_OOM` → single auto-downgrade, no duplicates, notice event emitted
- [ ] cancel ≤ 2 s with partial blocks returned (intent criterion) — worker torn down cleanly
- [ ] Coverage ≥ 85% on `engine/asr/**`; SECURITY-03 redaction test passes

## Risks

- #1739 leak characteristics differ per model/GPU → watchdog thresholds configurable; nightly tracks trend.
- VAD over/under-segmentation poisons block boundaries → tunables + fixture corpus (accented/noisy clips) in report matrix.

## Docs to consult

- docs-mcp `transformers.js` → `/api/pipelines` (ASR options), `/guides/webgpu`; issue #1739/#1755 status re-check at unit start
- docs-mcp `sherpa-onnx` → VAD + non-streaming ASR (if B engine selected for a tier)
- Simulated-streaming patterns prior art: `zip-captions-monorepo/aidlc-docs/construction/on-device-multilingual-stt/functional-design/business-rules.md`
