# Zipscribe

**Zero-server, browser-only video transcription & caption editor.** Transcribe any-length video locally with Whisper on WebGPU, edit the transcript like a document, tune timing on a timeline, style captions, and export SRT/VTT or burned-in MP4 — with no uploads and no API keys.

Inspired by the transcript-first editing of Descript, the caption timeline of CapCut Web, and the panel layout/shortcuts of Microsoft Clipchamp — plus speaker diarization, which **neither competitor verifiably offers**.

## Why this exists

Cloud captioning tools gate diarization and timeline editing behind paid tiers, impose transcription minute caps (Descript: 60 min/mo) or length caps (CapCut quick tool: 20 min), and require uploading raw media. Zipscribe runs the entire pipeline client-side:

- **ASR:** multi-engine registry behind one pipeline — primary path Whisper (`onnx-community/whisper-*_timestamped`) via `@huggingface/transformers` on WebGPU; browser-viable candidates from the zip-captions model survey (sherpa-WASM streaming Zipformer/Parakeet, Cactus Whistle) are measured by a model-eval spike before defaults are pinned
- **Diarization (beta):** pyannote-segmentation-3.0 + 3D-Speaker ERes2Net embeddings + agglomerative clustering, all in-browser
- **Media I/O:** mediabunny (WebCodecs demux/mux), ffmpeg.wasm lazy fallback
- **Export:** SRT / VTT / JSON sidecars always; burned-in MP4 (H.264) on capable browsers
- **Privacy:** media never leaves the machine; models cached in the Cache API for offline use

## Status

Spec phase. This repository is currently **specification only** — no application code yet. Build proceeds unit-by-unit through the AI-DLC workflow defined in `.ai-dlc/`.

## Where everything lives (AI-DLC spec map)

| Path | Artifact |
|---|---|
| `.ai-dlc/settings.yml` | Project config: stack, quality gates, reference hardware, git strategy |
| `.ai-dlc/knowledge/` | Persistent project intelligence (architecture, design, product, domain, conventions) |
| `.ai-dlc/local-transcribe-engine/` | **Intent 1** — media → decoded audio → VAD → chunked Whisper → caption blocks + beta speaker labels |
| `.ai-dlc/caption-studio-ui/` | **Intent 2** — workbench layout, transcript editor, timeline, playback sync, shortcuts, persistence |
| `.ai-dlc/styling-and-export/` | **Intent 3** — caption styling engine, sidecar + burn-in export, production deploy to Cloudflare Pages |

Each intent directory contains `intent.md` (description + completion criteria), `discovery.md` (research findings with citations), and `unit-NN-*.md` files (user stories, functional requirements, technical specification, completion criteria).

## Planned commands (created by unit `local-transcribe-engine/unit-01`)

```bash
pnpm install          # install
pnpm dev              # vite dev server
pnpm test             # vitest (engine + unit tests)
pnpm test:e2e         # playwright
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit
pnpm build            # production bundle
```

## Reference hardware (performance baselines)

Baselines in the specs are asserted against: desktop Chrome (stable channel, WebGPU enabled), 8+ CPU cores, Apple Silicon M-series or discrete GPU ≥ 4 GB VRAM. Lower tiers get documented degradation, not baseline guarantees.
