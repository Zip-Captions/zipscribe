---
status: pending
phase: mvp
discipline: dev
depends_on: [unit-05-transcription-pipeline]
workflow: tdd
mode: AHOTL   # components off-the-shelf + pure-function clustering; quality bar is fixture-gated. Escalate to HITL if DER gate repeatedly fails
---

# Unit 06: Speaker Diarization (beta)

## Description

Beta speaker labeling: VAD segments → pyannote-segmentation-3.0 (wasm fp32) → 3D-Speaker ERes2Net embeddings → agglomerative clustering → speaker assignment onto `CaptionBlock[]`, plus pure reassignment/rename engine APIs that Intent 2's UI drives. Satisfies orig. FR-1.3.1–1.3.2 (method corrected per `discovery.md`: ERes2Net embeddings replace the brief's MFCC idea). **Zero prior art in zip-captions — all net-new here.**

## User Stories

**US-1.3.1** (orig. FR-1.3.1) As a podcast editor, I want automatic speaker segmentation + embedding clustering, so blocks carry speaker identity.
- *Given* `speech-2spk-2min.mp4` with ground-truth JSON, *when* `diarize()` (T1/T2 wasm tier — segmentation model is WebGPU-unsupported per discovery), *then* per-word speaker accuracy ≥ 85% and DER-style error ≤ 20%.
- *Given* `speech-2min.mp4` (single speaker), *when* diarize, *then* exactly 1 speaker emitted in ≥ 90% of runs (over-clustering guard; 3-run median).
- *Given* 10 min of media, *when* diarize, *then* wall time ≤ 90 s (T1 host).

**US-1.3.2** (orig. FR-1.3.2) As the pipeline, I need speaker fields populated with stable ids and a beta provenance flag.
- *Given* diarization output, *when* applied to blocks, *then* every `block.speakerId` resolves to a `Speaker { id, label:'Speaker 1'…, color: palette[n] }` and `project.speakerSource = 'auto-beta'`.

**US-1.3.3** (orig. FR-1.3.3 — engine half) As the editor UI (`caption-studio-ui/unit-104`), I need pure, undoable speaker mutation functions.
- *Given* `renameSpeaker(project, id, 'Alex')`, *when* applied, *then* label updates everywhere; *given* `reassign(project, blockId, wordRange, toId)`, *then* only those words' `speakerId` (and the resulting block majority) change; *given* `mergeSpeakers(project, a, b)`, *then* all of `b`'s words move to `a` and `b` is removed; *given* `splitSpeaker(project, from, cutTime, newColor)`, *then* `from`'s words after `cutTime` move to a new speaker. All pure (project in → project out), golden-tested, zero async.

## Functional Requirements

- **FR-06.1** `engine/diart/{segmentation,embeddings,clustering,assign}.ts`: segmentation via `AutoModelForAudioFrameClassification` + `post_process_speaker_diarization` (wasm fp32, per microsoft/onnxruntime#21386); embeddings via ERes2Net ONNX run through the onnxruntime-web instance transformers.js bundles (no second ORT copy — verify the 3.8.1 access path; fallback: sherpa-onnx WASM speaker-diarization, recorded as a deviation); clustering = agglomerative average-linkage on cosine distance, stopped by a distance threshold (tuned on fixtures), capped by `maxSpeakers` (default 6); an eigengap estimate on the cosine-affinity matrix is computed as a cross-check and reported (numbers only), not used to cut.
- **FR-06.2** Reuse unit-05 VAD segments (`vad:segments`, forwarded by the main thread in the `diarize` request's `vad` field) as embedding windows (min 0.5 s, max 3 s windows, 50% hop on long segments). When diarize starts before VAD results exist, it runs its own Silero pass.
- **FR-06.3** `assign.ts`: sets `word.speakerId` by word-time majority vote with 0.25 s hysteresis, then `block.speakerId` = majority of its words; blocks spanning two speakers get a boundary-snapped split via unit-05 `blockize` reuse (never mid-word).
- **FR-06.4** Runs in `diarize.worker.ts` **concurrently-optional** with ASR: it reads its own PCM port from the media worker's tee (unit-04 FR-04.1) — a `MessagePort` can't be shared by two consumers. Independent ORT sessions.
- **FR-06.5** Speaker palette: 8 deterministic colors + labels `Speaker N`; `speakerSource` enum `'auto-beta' | 'manual'` — any manual mutation flips to `'manual'`.
- **FR-06.6** Cancellation + progress (`job:progress` per segment batch); errors per engine taxonomy (`DIAR_SESSION_LOST`). Diarization models go through the unit-03 registry (pinned revision, SHA-256, offline-cacheable via `ensureOffline`).
- **FR-06.7** SECURITY-03 applies (embeddings/segments never logged).

## Technical Specification

```ts
// engine/diart/clustering.ts — pure, fully unit-testable
export function agglomerativeCluster(embeds: Float32Array[], opts: { threshold?: number; maxSpeakers?: number }): number[]
// engine/diart/assign.ts — pure
export function assignSpeakers(blocks: CaptionBlock[], frames: DiarFrames): CaptionBlock[]
export function renameSpeaker / reassign / mergeSpeakers / splitSpeaker: (p: Project, ...) => Project
```

## Completion Criteria

- [ ] **CC-06.1** 2-speaker fixture ≥ 85% word accuracy, ≤ 20% DER-style (fixture ground truth, 3-run median)
- [ ] **CC-06.2** Single-speaker over-clustering guard ≥ 90%
- [ ] **CC-06.3** `[RQ]` 10-min diarize ≤ 90 s (T1 perf record; T2 recorded, not gated)
- [ ] **CC-06.4** All four pure mutation APIs golden-tested + undoable (history integration test)
- [ ] **CC-06.5** Concurrent ASR+diarize run: results match sequential runs (determinism assertion)
- [ ] **CC-06.6** Coverage ≥ 85% on `engine/diart/**` (clustering/assign are pure → 100% achievable)

## Risks

- Embedding model size/quality tradeoff (`eres2net-base` vs `-v2`) → registry entry chosen via mini-matrix on 2spk fixtures; document in unit report.
- WebAssembly fp32 segmentation is slow on long files → windowing from VAD segments (FR-06.2) bounds cost; revisit if > 90 s gate fails.

## Docs to consult

- Xenova diarization worker pattern: https://huggingface.co/spaces/Xenova/whisper-speaker-diarization
- docs-mcp `transformers.js` (audio frame classification API); docs-mcp `sherpa-onnx` → speaker-diarization (clustering reference)
- 3D-Speaker ONNX on HF hub (verify repo + license at unit start — `onemira/eres2net-base-3dspeaker-onnx` is an unverified mirror; prefer an upstream 3D-Speaker or k2-fsa release)
- Browser reference: https://huggingface.co/spaces/k2-fsa/speaker-diarization (sherpa-onnx)
