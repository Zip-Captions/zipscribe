---
status: pending
workflow: tdd
git:
  change_strategy: unit
  auto_merge: true
created: 2026-10-27
announcements: [changelog, release-notes]
passes: []
active_pass: ""
quality_gates:
  - name: lint
    command: pnpm lint
  - name: typecheck
    command: pnpm typecheck
  - name: unit_tests
    command: pnpm test
  - name: bundle_budget
    command: pnpm build && pnpm check-bundle
  - name: criteria
    command: pnpm verify:unit --from-branch
---

# Intent: Local Transcribe Engine

## Description

The zero-server inference core: given a user-selected media file of **any practical length**, decode audio entirely in-browser, run VAD-segmented Whisper transcription with word-level timestamps on WebGPU (CPU-WASM fallback), assign beta speaker labels, and emit a normalized `CaptionBlock[]` data model — all inside Web Workers, with progress, cancellation, and model caching. The same data model can instead be **imported from a user's existing caption file** (SRT/VTT/SBV/TTML/ASS), checked for quality, and aligned to the audio (unit-07). No application code may require a server or an API key.

Maps to Epic 1 (US 1.1–1.3) of the original product brief, corrected against research in `discovery.md`.

## Business Context

- Competitor free tiers cap minutes (Descript 60/mo) or length (CapCut quick tool 20 min); local processing removes both caps and the upload privacy problem.
- The engine is the moat; everything in Intents 2–3 consumes its outputs.
- Research (see `discovery.md`) established: transformers.js 3.8.x is the primary runtime (WebGPU + word timestamps); sherpa-onnx is not the primary runtime (no WebGPU) but is a candidate *engine host* via its official WASM VAD+ASR path; mp4-muxer deprecated → mediabunny.
- Everything this intent downloads (models, runtime wasm) must be cacheable for offline use (Intent 3 unit-204 makes the app an offline PWA on top of it).

## Completion Criteria

- [ ] **CC-I1.1** Model spike report committed (`docs/spikes/model-eval-report.md`) with measured WER/RTF/memory/word-timing error per engine-tier, the 3.8.1-vs-4.x leak measurement, license verifications, and the approved default registry — all downstream units build on it
- [ ] **CC-I1.2** `[RQ]` `speech-10min.mp4` → `CaptionBlock[]` with word tokens in ≤ 600 s wall on reference hardware, T1 tier, spike-approved default model (all gates green)
- [ ] **CC-I1.3** `[RQ]` `audio-120min.mp4` completes transcription without tab crash/OOM on reference hardware: JS heap (`measureUserAgentSpecificMemory`, COOP/COEP test server) shows < 1 GB sustained growth, and GPU-process memory (sampled out-of-band, method fixed by unit-02) stays below the worker-recycle ceiling
- [ ] **CC-I1.4** `cancel()` mid-run: partial blocks returned, worker torn down ≤ 2 s, no orphaned GPU buffers (leak-watchdog assertion)
- [ ] **CC-I1.5** With WebGPU disabled, the app auto-selects T2 (wasm q8) with no user configuration and still completes `tiny` transcription e2e
- [ ] **CC-I1.6** Second load of the same model makes zero requests to any `operations.model_hosts` origin, and no run ever requests a non-allowlisted origin (ORT wasm served from `/wasm`) — Playwright request audit
- [ ] **CC-I1.7** Diarization: ≥ 85% per-word speaker accuracy on the 2-speaker fixture; rename/reassign engine API propagates to every block
- [ ] **CC-I1.8** Engine unit-test coverage ≥ 85% lines (`src/engine/**`, excluding worker bootstrap glue)
- [ ] **CC-I1.9** Audio: every file in the `fixtures/audio/` format matrix (native + ffmpeg-fallback sets) probes as `kind:'audio'` and decodes within the unit-04 duration/correlation/offset thresholds; `speech-2min.m4a` transcribes to the same blocks as `speech-2min.mp4` (± 50 ms per word)
- [ ] **CC-I1.10** Caption import: every `fixtures/captions/` format/edge-case golden passes; align-to-audio keeps text unchanged and reaches MAE within 1.5× of direct ASR on `en-clean`

### Failure cases
- [ ] **CC-I1.11** Network drops mid-download → `model:error {code:'NETWORK', retryable:true}`; the partial file is not left in cache; retry resumes cleanly
- [ ] **CC-I1.12** Offline with no cached model → `OFFLINE_MODEL_MISSING` notice before any job starts (no hang, no spinner forever)
- [ ] **CC-I1.13** Unsupported codec with ffmpeg fallback unavailable → `job:error {code:'UNSUPPORTED_MEDIA'}`; no partial project created

## Units

| Unit | Discipline | Depends on |
|---|---|---|
| unit-01-scaffold-quality-gates | dev | — |
| unit-02-model-eval-spike | dev | unit-01 |
| unit-03-model-manager | dev | unit-02 |
| unit-04-media-ingest | dev | unit-01 |
| unit-05-transcription-pipeline | dev | unit-03, unit-04 |
| unit-06-speaker-diarization | dev | unit-05 |
| unit-07-caption-import | dev | unit-01, unit-05 |

## Risks

1. **WebGPU Whisper memory leak** (transformers.js #1739, open; reported on 4.2.0, ~650 MB GPU per 30 s chunk *inside one pipeline call*): unit-02 measures whether 3.8.1 is affected; unit-05 implements per-window pipeline calls + ASR-worker recycling + T2 downgrade. Mandatory, not optional.
2. **fp16/q8 WebGPU instabilities** (#894, #1590): pinned dtypes per module; never deviate from the pinned recipe without a discovery note.
3. **ffmpeg.wasm 2 GB / single-thread speed**: fallback tier only; document user-facing limits honestly.
4. **Diarization quality in-browser**: beta label, manual-edit UI in Intent 2 (`caption-studio-ui/unit-104`) is the safety net.
5. **HF hosting drift**: repos at `main` change and CDN redirect hosts change (2026: `*.cdn.hf.co` xet bridge). Registry pins `revision`; allowlist is a settings list, re-verified by unit-203's request audit.

## Boundaries (out of scope)

- Any React UI (Intent 2 renders engine state).
- Burn-in/export (Intent 3).
- Multithreaded wasm / COOP-COEP in production (explicitly deferred; revisit post-launch via `/ai-dlc:followup`). COOP/COEP on the *test* preview server for memory measurement is allowed.
- Service worker / install (Intent 3 unit-204) — this intent only guarantees everything it fetches is cacheable and same-origin or allowlisted.
