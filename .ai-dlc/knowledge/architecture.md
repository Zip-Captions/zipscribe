# Knowledge: Architecture

Persistent system intelligence for Zipscribe. Read before building any unit. Decisions here are settled unless a unit explicitly documents a pass-back.

## Architectural thesis

Zero-server SPA. A **framework-agnostic engine** (pure TypeScript) does all media, inference, and export work inside Web Workers; a thin React shell renders state and dispatches commands. The split makes the hard parts (pipeline, timing math, clustering, serializers) testable in plain vitest without a browser.

```
┌─ main thread ─────────────────────────────────────────────┐
│ React UI (src/ui)   Zustand store (src/state)  commands   │
│        │ dispatch              ▲ events                    │
│        ▼                       │                           │
│ Engine facades (src/engine) — pure TS, DI-friendly         │
└───────┬────────────────────────────────────────────────────┘
        │ structured-clone messages (src/engine/protocol.ts)
┌───────▼────────────────────────────────────────────────────┐
│ Workers (src/workers)                                      │
│  asr.worker.ts      — transformers.js Whisper (webgpu/wasm)│
│  diarize.worker.ts  — VAD + pyannote-seg + embeddings      │
│  media.worker.ts    — mediabunny demux → PCM → resample    │
│  export.worker.ts   — frame render → VideoEncoder → mux    │
└────────────────────────────────────────────────────────────┘
```

## Module map (authoritative paths)

```
src/
  engine/                 # ZERO React/DOM imports. vitest-covered core.
    model/    registry.ts cache.ts capability.ts   # model IDs, Cache API, webgpu|wasm detect
    audio/    decode.ts resample.ts peaks.ts wav.ts
    asr/      transcriber.ts chunker.ts worker-host.ts
    diart/    vad.ts segmentation.ts embeddings.ts clustering.ts assign.ts
    export/   srt.ts vtt.ts json.ts burn-in.ts overlay.ts
    protocol.ts            # worker message unions (single source of truth)
    model.ts               # domain types (single source of truth)
  state/  project-store.ts editor-store.ts history.ts selectors.ts
  ui/     workbench/ transcript/ timeline/ canvas/ style/ export/ shell/
  workers/ asr.worker.ts diarize.worker.ts media.worker.ts export.worker.ts
```

## Canonical domain model (engine/model.ts)

```ts
interface WordToken { text: string; start: number; end: number; probability?: number }
interface CaptionBlock {
  id: string;                 // crypto.randomUUID()
  start: number; end: number; // seconds, absolute media time
  text: string;
  words: WordToken[];         // invariant: sorted, within [start, end]
  speakerId: string;          // Speaker.id
  confidence?: number;        // 0..1 ASR mean probability
}
interface Speaker { id: string; label: string; color: string } // label editable, color from palette
interface MediaAsset {
  id: string; name: string; kind: 'video' | 'audio';
  duration: number; width: number; height: number; fps: number;
}
interface CaptionStyle {
  fontFamily: string; fontWeight: 400 | 700; fontSizePct: number; // % canvas height
  color: string; outlineColor: string; outlineWidth: number;
  backgroundColor?: string; backgroundOpacity: number;
  position: 'top' | 'center' | 'bottom'; marginVPct: number;
  alignment: 'left' | 'center' | 'right';
  maxLinesPerBlock: 1 | 2 | 3;
  highlightMode: 'none' | 'karaoke' | 'bold-active';
  animationPreset?: string;
}
interface Project {
  id: string; name: string; schemaVersion: number;
  asset: MediaAsset; blocks: CaptionBlock[]; speakers: Speaker[];
  style: CaptionStyle; updatedAt: number;
}
```

## Worker protocol (engine/protocol.ts)

```ts
type PcmSource = { kind: 'transfer'; buffer: ArrayBuffer } | { kind: 'stream'; port: MessagePort }  // streaming mandatory for long media (unit-04/05)
type EngineRequest =
  | { t: 'loadModel'; model: ModelId; tier: 'webgpu' | 'wasm' }
  | { t: 'transcribe'; jobId: string; pcm: PcmSource; sampleRate: 16000 }
  | { t: 'diarize';    jobId: string; pcm: PcmSource; sampleRate: 16000; maxSpeakers?: number }
  | { t: 'cancel'; jobId: string } | { t: 'unload' };
type EngineEvent =
  | { t: 'model:progress'; phase: 'download' | 'compile'; received: number; total?: number }
  | { t: 'model:ready'; tier: InferenceTier; model: ModelId }
  | { t: 'job:progress'; jobId: string; processedSec: number; totalSec: number }
  | { t: 'job:segments'; jobId: string; segments: RawSegment[] }   // streamed batches
  | { t: 'job:done'; jobId: string }
  | { t: 'job:error'; jobId: string; error: EngineError };
```

All timestamps produced by the engine are **absolute media seconds**; the UI never re-derives offsets.

## Settled technology decisions (with why)

| Decision | Choice | Why |
|---|---|---|
| Inference runtime | **Engine-abstracted registry** (`EngineKind: transformers-whisper | sherpa-wasm | cactus-whistle`); primary path `@huggingface/transformers@3.8.x`, `device:'webgpu'`, per-module dtypes `{encoder_model:'fp32', decoder_model_merged:'q4'}`; non-primary engines gated on unit-02 measured spike | Only zero-server stack with Whisper + word timestamps + long-form chunking + HF CDN caching. 3.x pinned: 4.x previews have WebGPU Whisper regressions (see intent-1 discovery). sherpa-WASM (Parakeet/Zipformer: native punctuation + token timestamps) and Cactus Whistle (16.9 MB multilingual) adopted only if the spike measures them out — prior-art survey in intent-1 `discovery.md`. |
| Word timestamps | `onnx-community/whisper-*_timestamped` + `return_timestamps:'word'` | DTW-on-cross-attention; `_timestamped` exports ship the needed weights. Timings are approximate → UI must allow manual timing correction (drives the editor requirements). |
| Long audio | VAD-segmented (Silero) then chunked pipeline calls, `chunk_length_s:30`, `stride_length_s:5` | Whisper is 30 s fixed-window; VAD windows avoid mid-sentence cuts and bound memory. Per-chunk session reuse + explicit dispose/`gc` watchdog (transformers.js #1739 leak). |
| Diarization | pyannote-segmentation-3.0 (`AutoModelForAudioFrameClassification`, wasm fp32) + 3D-Speaker ERes2Net ONNX via ort-web + agglomerative clustering (DIY) | No off-the-shelf browser pipeline exists; components are MIT on the Hub. Shipped as **beta** with manual reassign/rename UI. |
| Demux/mux | mediabunny (WebCodecs) | mp4-muxer is deprecated (same author directs to mediabunny); supports MP4/MOV/MKV/WebM/MP3/WAV read+write, subtitle tracks, canvas sources. |
| Decode fallback | single-threaded ffmpeg.wasm, lazy-loaded | Covers containers WebCodecs can't; single-threaded build avoids SharedArrayBuffer → **no COOP/COEP needed anywhere in v1**. |
| Burn-in export | mediabunny `VideoDecoder→canvas(overlay)→VideoEncoder(H.264)+AudioEncoder(AAC)→Mp4OutputFormat` | All-client 1080p. AudioEncoder gap (Safari < 26) gates burn-in to the capable tier; soft-sub export is always available. |
| Timeline rendering | custom canvas 2D (dpr-scaled), data-model hit-testing | 60 FPS drag/zoom with thousands of blocks; DOM blocks would thrash. |
| State | zustand + immer + zundo (undo ≥ 100) | Editor needs one canonical mutable state + command history; React is a subscriber. Chosen over Redux (ceremony) and Signals libs for ecosystem/agent familiarity — view layer is swappable behind `state/`. |
| Persistence | IndexedDB (idb): Project JSON + waveform peaks; media via File System Access API handle, blob cache < 500 MB | Local-first; re-link file on reopen when handle is stale. |
| Hosting | Cloudflare Pages, static, `public/_headers` | Zero-server fits the privacy thesis; `_headers` for wasm cache rules. |

## Degradation tiers (feature-detect at boot, `engine/model/capability.ts`)

| Tier | Detect | ASR | Diarize | Media | Export |
|---|---|---|---|---|---|
| **T1 WebGPU** | `navigator.gpu` + adapter ok | webgpu fp32/q4 | wasm | WebCodecs | MP4 burn-in |
| **T2 WASM-CPU** | no webgpu | wasm q8 (tiny/base) | wasm | WebCodecs | MP4 burn-in (slow) |
| **T3 Limited** | no WebCodecs AudioDecoder (Safari < 26) | wasm | wasm | ffmpeg.wasm | SRT/VTT/JSON + WebM |
| **T4 Blocked** | no WebGPU, no WASM SIMD, < 4 GB | hard-stop screen with requirements list | — | — | — |

## Cross-cutting invariants

1. Main thread: no inference, no demux, no encode — only UI work (gate: no > 50 ms long tasks during transcription).
2. Engine modules receive dependencies (sessions, fs handles) via constructor/factory injection — mockable in vitest.
3. Every destructive edit is a command in history (undoable); autosave ≥ every 2 s idle.
4. Timestamps monotonic within a block; block.start < block.end; speakerId always resolves to a Speaker.
5. All model downloads go through Cache API (`cacheName: 'zipscribe-models'`) with checksum verification against the manifest.
6. **SECURITY-03 (privacy invariant, carried from zip-captions):** transcript text, transcripts, and audio-derived strings never appear in logs, telemetry, error `message` fields, or crash reports — log codes/types only; redaction tests enforce.
7. Punctuation/capitalization are engine-dependent (`punctuation` registry flag) — UI copy and export serializers must not promise punctuation the selected engine doesn't emit.
