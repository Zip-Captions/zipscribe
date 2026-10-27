# Discovery Log: Local Transcribe Engine

Research findings with sources. Agents: verify current status before relying on anything time-sensitive (open issues may have merged).

## Runtime selection

| Candidate | Verdict | Evidence |
|---|---|---|
| `@huggingface/transformers` 3.8.x (onnxruntime-web WebGPU) | **SELECTED** — only zero-server stack with Whisper + word timestamps + chunked long-form + HF CDN/Cache API | https://huggingface.co/docs/transformers.js/en/guides/webgpu · https://huggingface.co/docs/transformers.js/en/guides/dtypes · https://huggingface.co/docs/transformers.js/en/api/pipelines |
| sherpa-onnx | REJECTED — zero WebGPU docs (CUDA native only); Whisper-in-WASM never demonstrated; diarization in WASM npm single-threaded, no browser demo | https://k2-fsa.github.io/sherpa/onnx/wasm/build.html · .../speaker-diarization/javascript.html |
| whisper.cpp WASM | REJECTED — no WebGPU acceleration in this app's shape; breaks perf baseline | (surveyed in research session 2026-10-27) |

## Whisper on WebGPU — pinned recipe

- Pipeline: `pipeline('automatic-speech-recognition', model, { device: 'webgpu' })`, dtype recipe **`{ encoder_model: 'fp32', decoder_model_merged: 'q4' }`** (Xenova demo standard).
- Models: `onnx-community/whisper-{tiny,base,small,large-v3-turbo}_timestamped` (`_timestamped` = extra cross-attention weights enabling `return_timestamps: 'word'`).
- Long audio: `chunk_length_s: 30, stride_length_s: 5`. (Original brief proposed 1 s overlap; research recommends 5 s — deviation documented per FR-1.2.2.)
- Word timings are DTW-derived → **approximate**; editor must support manual timing correction.
- Open issue #1739: ~650 MB/30 s-chunk GPU memory growth, whisper-small, v4.2.0; fix PR #1755 open as of 2026-10. Mitigations: pin 3.8.x, per-chunk `dispose()` + `gc()` watchdog, tier downgrade.
- Issue #894: fp16 combos throw/broken transcripts; WASM beat WebGPU for whisper-base on M2; q8-on-WebGPU pathologically slow → follow pinned dtypes, offer WASM tier.
- Issue #1590: v4 fp16 sentence-segmentation regression on `large-v3-turbo_timestamped` → another reason for the 3.x pin.
- VAD: no official pipeline; `onnx-community/silero-vad` (MIT) runs via ort-web with custom glue.
- Caching: `env.useBrowserCache` (Cache API) on by default; set `cacheKey: 'zipscribe-models'`; shader compilation NOT persisted → warm-up run after load (Xenova demo pattern).

## Media I/O

- **mediabunny** (Vanilagy) supersedes **mp4-muxer (deprecated)** — read/write MP4/MOV/MKV/WebM/MP3/WAV, WebCodecs-accelerated, `Mp4OutputFormat`, `CanvasSource`, subtitle tracks. https://github.com/Vanilagy/mediabunny · https://github.com/Vanilagy/mp4-muxer
- WebCodecs `AudioDecoder`: Chrome/Edge 94+, Firefox 130+, **Safari 26+ only**; always probe `isConfigSupported`. https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder
- `VideoEncoder` Safari 16.4+ but `AudioEncoder` Safari 26+ → burn-in export is T1/T2 only (Intent 3).
- Resample to 16 kHz mono Float32 **in worker** (linear/polyphase); do NOT use OfflineAudioContext (unavailable in workers).
- ffmpeg.wasm fallback: **single-threaded build only** → no SharedArrayBuffer → no COOP/COEP needed anywhere. Limits: ~0.04× native decode speed, 2 GB input cap. https://ffmpegwasm.netlify.app/docs/performance/

## Diarization components (all MIT-tier, on HF Hub)

- Segmentation: `onnx-community/pyannote-segmentation-3-0` via `AutoModelForAudioFrameClassification` + `AutoProcessor.post_process_speaker_diarization`. Official demo runs **wasm fp32** (WebGPU unsupported for this model: microsoft/onnxruntime#21386).
- Embeddings: 3D-Speaker **ERes2Net** ONNX (e.g. `onemira/eres2net-base-3dspeaker-onnx`) via raw ort-web sessions.
- Clustering: agglomerative (average-linkage, cosine distance) over VAD-segment embeddings → speaker labels. DIY (~300 LOC), no library.
- Reference worker pattern (Xenova whisper-speaker-diarization): https://huggingface.co/spaces/Xenova/whisper-speaker-diarization

## Competitor baseline (from UX research session, verified docs)

- Clipchamp: Azure ASR (server-side), SRT-only export, no verified diarization, split=S, Z/C+arrows trim, Ctrl+±/0 zoom, Ctrl+/ shortcuts. https://support.microsoft.com/en-us/clipchamp/keyboard-shortcuts-for-clipchamp
- CapCut Web: timeline caption blocks with drag-edge retiming, split/combine, Ctrl+A batch style, transcript-based editing w/ filler removal; quick AI-captions capped at 20 min; no official diarization doc. https://www.capcut.com/resource/add-captions-with-ai
- → True local diarization is differentiating; both competitors' timing-edit UX is weakly documented (our chance to beat).

## Prior-art model survey (zip-captions monorepo, mined 2026-10-27)

Source: `~/Documents/zip-captions-monorepo/aidlc-docs/` (spikes 1.1/1.3/1.4, on-device-multilingual-stt design). **All quantitative figures there are vendor-published and flagged unverified — that project's Spike 1.4 (which would have measured them) was never executed. Zipscribe unit-02 runs it, in-browser, for real.**

| Model | Source/license | Survey verdict | Zipscribe disposition (unit-02 candidate) |
|---|---|---|---|
| Whisper (tiny→large-v3-turbo) | OpenAI, MIT | high-accuracy option; turbo "most significant development" (vendor RTFx ~216 optimized) | **A**: primary T1 (transformers.js), measured WER/RTF |
| sherpa streaming Zipformer en (20–180 MB int8) | k2-fsa, Apache-2.0 | adopted primary on-device engine there (92/100 weighted); int8 within 1–2% of fp32 | **B1**: T2 English fast path candidate; WASM-proven |
| **Parakeet TDT 0.6B v3 int8** (~640 MB) | NVIDIA, CC-BY-4.0 | multilingual sweet spot: vendor FLEURS WER de 5.04/es 3.45/fr 5.15/it 3.00/nl 7.48/pl 7.31/en 4.85; RTF 0.09–0.22 (RK3588 CPU); punctuation + native token timestamps + hotwords | **B2**: multilingual candidate — **never validated in browser**; unit-02 measures loadability+RTF in sherpa WASM |
| **Cactus Whistle** (16.9 MB, 2-bit) | Cactus, Apache-2.0 | size champion, 7 langs, per-word 80 ms timestamps, keyword biasing B-WER 18.43→4.46; official `needle.wasm`; **telemetry verification outstanding**; no utterance endpointing | **C**: low-spec T2/T3 candidate; unit-02 includes network audit (telemetry = disqualifier) |
| Omnilingual ASR 300M (1600 langs) | facebookresearch | blocked on license verification (non-commercial risk); Dart + WASM npm examples exist | **D**: license-verify first; benchmark only if cleared |
| Moonshine v2 / MedASR / NeMo fast-conformer | canvasecurity / unverified | license unverified / niche | **D**: catalog-ready only |
| Distil-Whisper | OpenAI-derived | rejected there: English-centric, "a trap for multilingual" | not a candidate |
| Vosk / DeepSpeech / PocketSphinx / Silero-STT / Azure | various | rejected (accuracy/dead/cloud) | not candidates |
| sherpa-onnx **as runtime** | k2-fsa | (our earlier verdict) rejected vs transformers.js | **revised**: rejected as *primary runtime*, retained as *engine host* for B1/B2 behind the registry abstraction |

Carried-over patterns adopted into this spec: model catalog rows with SHA-256 + size-gated download confirmations (> 100 MB, unit-03 FR-03.4); eval hygiene (median of 3, model hashes, no transcripts in CI logs — unit-02 FR-02.1); **SECURITY-03 transcript-text-never-logged** as repo invariant (unit-05 FR-05.8); simulated-streaming/VAD windowing design (informs unit-05). No diarization prior art exists there — unit-06 is net-new. Future seeds (backlog, not units): hotwords/keyword-biasing (B/C native), Chrome Translator API for caption translation (their v1-proven web path).

## Open questions / followups

- [ ] Verify 3.8.x vs latest-patched 3.x at unit-02 start (pin may float within `~3.8.0`).
- [ ] Measure actual T1 throughput for `small` vs `base` during unit-04 perf test; consider `large-v3-turbo` as opt-in on ≥ 16 GB VRAM.
- [ ] Post-launch: multithreaded wasm + COOP/COEP as a Pages-header experiment (/seed).
- [ ] ffmpeg.wasm: consider mp4box.js as lighter demux-only fallback.
