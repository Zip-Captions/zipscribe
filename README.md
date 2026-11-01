# Zipscribe

**Zero-server, browser-only video & audio transcription and caption editor — installable and offline-capable.** Transcribe any-length video or audio (podcasts, interviews, voice memos) locally with Whisper on WebGPU, or bring your own caption file; edit the transcript like a document, tune timing on a timeline, translate captions on-device, style them, and export SRT/VTT/JSON per language or burned-in MP4 — with no uploads and no API keys.

Inspired by the transcript-first editing of Descript, the caption timeline of CapCut Web, and the panel layout/shortcuts of Microsoft Clipchamp — plus speaker diarization, which **neither competitor verifiably offers**.

## Why this exists

Cloud captioning tools gate diarization and timeline editing behind paid tiers, impose transcription minute caps (Descript: 60 min/mo) or length caps (CapCut quick tool: 20 min), and require uploading raw media. Zipscribe runs the entire pipeline client-side:

- **ASR:** multi-engine registry behind one pipeline — primary path Whisper (`onnx-community/whisper-*_timestamped`) via `@huggingface/transformers` 3.8.x on WebGPU; browser-viable candidates from the zip-captions model survey (sherpa-onnx WASM Parakeet/Zipformer, Cactus Whistle) are measured by a model-eval spike before defaults are pinned
- **Bring your own captions:** import SRT, WebVTT, SBV, TTML/DFXP, ASS/SSA; quality checks (reading speed, line length, durations); align existing captions to the audio; shift/stretch timing
- **Diarization (beta):** pyannote-segmentation-3.0 + 3D-Speaker ERes2Net embeddings + agglomerative clustering, all in-browser
- **Translation:** on-device via the browser's built-in Translator API (Chrome/Edge desktop), one track per language, side-by-side review — the approach proven in zip-captions
- **Media I/O:** mediabunny (WebCodecs demux/mux), ffmpeg.wasm lazy fallback. Video: MP4/M4V, MOV, MKV, WebM, TS. Audio: MP3, M4A/M4B, AAC, WAV, FLAC, OGG/OGA, Opus, WEBA, MKA natively; AIFF, ALAC, WMA, AMR/3GP, CAF via ffmpeg.wasm
- **Audio projects:** a live FFT spectrum visualizer (or waveform) on the preview stage under the captions; decoded playback for formats the browser can't play natively; caption-file export (no burn-in for audio)
- **Export:** SRT / VTT / JSON / TSV sidecars per language always; burned-in MP4 (H.264) for video projects on capable browsers
- **Offline & installable:** PWA with a service-worker app shell; models cached (and checksum-verified) for offline use on request
- **Privacy:** media and text never leave the machine; no telemetry

## Status

MVP phase. The specification is complete; the toolchain skeleton (unit-01: the five quality gates — lint / typecheck / vitest with enforced coverage thresholds / build + 350 KB bundle budget / Playwright + criteria traceability — wired into `pnpm` and CI, offline fixture pipeline, model cache) and the engine foundations (unit-02 model-eval spike, unit-03 model manager/registry, unit-04 media ingest) have landed on `develop`.

**Phased roadmap (owner decision 2026-10-31):** every `phase: mvp` unit completes and is locally verifiable — no external accounts — _before_ any productionization work starts. Phase 1 (MVP): unit-05 → 06/07 (transcription, diarization, caption import), 101–107 (workbench, editor, timeline, persistence, audio preview), 200–202 + 204 (styling, export, installable offline PWA — verified against `vite preview`, not Cloudflare), 301/302 (translation). Phase 2 (productionization, gated on owner-provisioned Cloudflare credentials): unit-203 (Pages CD, `_headers`/CSP, Lighthouse, rollback rehearsal), all deferred `[DEPLOY]` criteria (CC-01.14/15/16, CC-203.x, CC-I3.9), un-gated deploy workflows, first `0.1.0` release. Build order with the full phased DAG: `.agent/SPEC-GUIDE.md` § Build order; unit status lives in the unit files' frontmatter.

**Branching & delivery:** git flow — `develop` is the working branch (auto-deploys to staging), `main` is production (auto-deploys on every release/hotfix merge, with automatic rollback). Testing levels, criterion traceability (`CC-…` IDs) and exit gates: `.ai-dlc/knowledge/conventions.md` § Testing strategy, § Version control, § CI/CD.

## Where everything lives (AI-DLC spec map)

| Path                                 | Artifact                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `.agent/AGENTS.md`                   | Instructions for every coding agent (precedence rules, gates, unit report format)                                               |
| `.agent/REVIEW.md`                   | Review checklist for the pipeline reviewer and any other reviewer                                                               |
| `.agent/SPEC-GUIDE.md`               | How to add/extend intents and units: required discovery areas, spec conventions, build order                                    |
| `.ai-dlc/settings.yml`               | Project config: tech stack, version pins, approved deps, quality gates, reference hardware, network allowlist, git strategy     |
| `.ai-dlc/knowledge/`                 | Persistent project intelligence (architecture contract, design, product, domain, conventions)                                   |
| `.ai-dlc/local-transcribe-engine/`   | **Intent 1** — video/audio → PCM → VAD → windowed ASR → caption blocks + beta speakers; caption-file import, QC, align-to-audio |
| `.ai-dlc/caption-studio-ui/`         | **Intent 2** — workbench, transcript editor, timeline, playback sync, audio playback + visualizer, shortcuts, persistence       |
| `.ai-dlc/styling-and-export/`        | **Intent 3** — design pass, caption styling, sidecar + burn-in export, Cloudflare Pages deploy, installable offline PWA         |
| `.ai-dlc/caption-translation/`       | **Intent 4** — on-device translation engine + translation workspace                                                             |
| `.claude/CLAUDE.md`, `opencode.json` | Tool bridges that load `.agent/AGENTS.md` for Claude Code and opencode                                                          |
| `docs/spikes/`                       | Spike reports written by units (e.g. unit-02 model evaluation)                                                                  |
| `qualification/`                     | Release-qualification results per version (`pnpm qualify` on reference hardware)                                                |

Each intent directory contains `intent.md` (description + completion criteria + frontmatter quality gates), `discovery.md` (research findings with citations), and `unit-NNN-*.md` files (user stories, functional requirements, technical specification, completion criteria).

## Planned commands (created by unit `local-transcribe-engine/unit-01`)

```bash
pnpm install           # install
pnpm dev               # vite dev server (service worker disabled)
pnpm test              # vitest (engine + unit tests)
pnpm test:e2e          # playwright (against a production preview build)
pnpm lint              # eslint
pnpm typecheck         # tsc --noEmit
pnpm build             # production bundle
pnpm check-bundle      # initial JS ≤ 350 KB gzip
pnpm fixtures          # regenerate test fixtures (incl. the gitignored 120-min perf file)
pnpm models:fetch      # download pinned CI models into .cache/models (setup step, never during tests)
pnpm verify:unit <u>   # criteria report: every CC-ID covered by a passing test
pnpm qualify           # release qualification on reference hardware → qualification/<version>.json
pnpm preview:isolated  # COOP/COEP preview for memory-gate tests only
```

## Browser support (v1)

| Capability                                      | Chrome/Edge desktop | Safari 26+                        | Firefox              | Older Safari           |
| ----------------------------------------------- | ------------------- | --------------------------------- | -------------------- | ---------------------- |
| Transcribe (WebGPU / WASM)                      | ✓ / ✓               | tier-dependent                    | WASM                 | WASM + ffmpeg.wasm     |
| Edit, import captions, sidecar export, offline  | ✓                   | ✓                                 | ✓                    | ✓                      |
| Audio projects (all listed formats, visualizer) | ✓                   | ✓ (decoded playback where needed) | ✓                    | ✓ (ffmpeg.wasm decode) |
| MP4 burn-in                                     | ✓                   | ✓                                 | ✓ (verify WebCodecs) | ✗ (sidecars only)      |
| On-device translation                           | ✓ (138+/148+)       | ✗ (import/manual tracks only)     | ✗                    | ✗                      |
| Install / open files from OS                    | ✓ / ✓               | Add to Dock / ✗                   | ✗                    | ✗                      |

## Reference hardware (performance baselines)

Baselines in the specs are asserted against: desktop Chrome (stable channel, WebGPU enabled), 8+ CPU cores, Apple Silicon M-series or discrete GPU ≥ 4 GB VRAM, 16 GB RAM. Lower tiers get documented degradation, not baseline guarantees.
