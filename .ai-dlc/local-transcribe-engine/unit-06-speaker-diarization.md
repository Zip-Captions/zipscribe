---
status: pending
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
- *Given* `renameSpeaker(project, id, 'Alex')`, *when* applied, *then* label updates everywhere; *given* `reassign(project, blockId, wordRange, toId)`, *then* only those words (and resulting block majority) change; *given* `mergeSpeakers(a, b)`, *then* all words move and `b` is removed; *given* `splitSpeaker(from, cutTime, newColor)`, *then* words after `cutTime` move to a new speaker. All pure (project in → project out), golden-tested, zero async.

## Functional Requirements

- **FR-06.1** `engine/diart/{segmentation,embeddings,clustering,assign}.ts`: segmentation via `AutoModelForAudioFrameClassification` + `post_process_speaker_diarization` (wasm fp32, per microsoft/onnxruntime#21386); embeddings via ERes2Net ONNX through ort-web; clustering = agglomerative average-linkage, cosine distance, threshold + k estimated by eigengap heuristic with `maxSpeakers` override (default 6).
- **FR-06.2** Reuse unit-05 VAD segment boundaries as embedding windows (min 0.5 s, max 3 s windows, 50% hop on long segments).
- **FR-06.3** `assign.ts`: word-time majority vote with 0.25 s hysteresis; blocks overlapping two speakers get boundary-snapped split via unit-05 `blockize` reuse (never mid-word).
- **FR-06.4** Runs in `diarize.worker.ts` **concurrently-optional** with ASR: `diarize(job)` consumes the same `PcmSource`; safe to run while transcription streams (independent sessions; shared VAD results via cache).
- **FR-06.5** Speaker palette: 8 deterministic colors + labels `Speaker N`; `speakerSource` enum `'auto-beta' | 'manual'` — any manual mutation flips to `'manual'`.
- **FR-06.6** Cancellation + progress (`job:progress` per segment batch); errors per engine taxonomy (`DIAR_SESSION_LOST` added).
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

- [ ] 2-speaker fixture ≥ 85% word accuracy, ≤ 20% DER-style (fixture ground truth, 3-run median)
- [ ] Single-speaker over-clustering guard ≥ 90%
- [ ] 10-min diarize ≤ 90 s (T1 perf record; T2 recorded, not gated)
- [ ] All four pure mutation APIs golden-tested + undoable (history integration test)
- [ ] Concurrent ASR+diarize run: results match sequential runs (determinism assertion)
- [ ] Coverage ≥ 85% on `engine/diart/**` (clustering/assign are pure → 100% achievable)

## Risks

- Embedding model size/quality tradeoff (`eres2net-base` vs `-v2`) → registry entry chosen via mini-matrix on 2spk fixtures; document in unit report.
- WebAssembly fp32 segmentation is slow on long files → windowing from VAD segments (FR-06.2) bounds cost; revisit if > 90 s gate fails.

## Docs to consult

- Xenova diarization worker pattern: https://huggingface.co/spaces/Xenova/whisper-speaker-diarization
- docs-mcp `transformers.js` (audio frame classification API); docs-mcp `sherpa-onnx` → speaker-diarization (clustering reference)
- 3D-Speaker ONNX on HF hub (verify repo + license at unit start)
