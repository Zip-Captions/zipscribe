# Discovery Log: Local Transcribe Engine

Research findings with sources. Agents: verify current status before relying on anything time-sensitive (open issues may have merged).

## Runtime selection

| Candidate | Verdict | Evidence |
|---|---|---|
| `@huggingface/transformers` 3.8.x (onnxruntime-web WebGPU) | **SELECTED** — only zero-server stack with Whisper + word timestamps + chunked long-form + HF CDN/Cache API | https://huggingface.co/docs/transformers.js/en/guides/webgpu · https://huggingface.co/docs/transformers.js/en/guides/dtypes · https://huggingface.co/docs/transformers.js/en/api/pipelines |
| sherpa-onnx | REJECTED **as primary runtime** — no WebGPU (CPU WASM only). *Revised 2026-10-27:* official WASM **non-streaming VAD+ASR** path exists (`wasm/vad-asr`, HF-space demos for Zipformer-CTC etc.) and a browser speaker-diarization space exists → retained as candidate engine host (B) and diarization fallback | https://k2-fsa.github.io/sherpa/onnx/wasm/build.html · https://github.com/k2-fsa/sherpa-onnx/tree/master/wasm/vad-asr · https://huggingface.co/spaces/k2-fsa/speaker-diarization |
| whisper.cpp WASM | REJECTED — no WebGPU acceleration in this app's shape; breaks perf baseline | (surveyed in research session 2026-10-27) |

## Whisper on WebGPU — pinned recipe

- Pipeline: `pipeline('automatic-speech-recognition', model, { device: 'webgpu' })`, dtype recipe **`{ encoder_model: 'fp32', decoder_model_merged: 'q4' }`** (Xenova demo standard).
- Models: `onnx-community/whisper-{tiny,base,small,large-v3-turbo}_timestamped` (`_timestamped` = extra cross-attention weights enabling `return_timestamps: 'word'`).
- Long audio: VAD speech packed into ≤ 28 s windows cut at silence, one pipeline call per window. Pipeline-internal `chunk_length_s: 30, stride_length_s: 5` applies only to continuous speech > 28 s. (Original brief proposed fixed windows with 1 s overlap; overlap at arbitrary cut points duplicates or splits words, so cuts at silence replace it — deviation documented per FR-1.2.2.)
- Word timings are DTW-derived → **approximate**; editor must support manual timing correction.
- Open issue #1739: ~650 MB/30 s-chunk GPU memory growth, whisper-small, **v4.2.0**; leak happens *inside a single `pipe()` call*, both `return_timestamps` modes, reclaimed only on page close; suspected undisposed `encoder_outputs` + dropped past-key-value buffers. Fix PR #1755 still open 2026-10-27. **Not reported against 3.8.x — but also not tested there.** Mitigations: (1) unit-02 measures 3.8.1 vs 4.3.x; (2) one pipeline call per ≤ 28 s VAD window (never the whole file); (3) recycle the ASR worker (terminate → GPUDevice freed → respawn → resume) when sampled GPU memory crosses a ceiling; (4) T2 downgrade. In-process `dispose()` alone is insufficient per the issue.
- Issue #894: fp16 combos throw/broken transcripts; WASM beat WebGPU for whisper-base on M2; q8-on-WebGPU pathologically slow → follow pinned dtypes, offer WASM tier.
- Issue #1590: v4 fp16 sentence-segmentation regression on `large-v3-turbo_timestamped` → another reason for the 3.x pin.
- VAD: no official pipeline; `onnx-community/silero-vad` (MIT) runs via ort-web with custom glue.
- Caching: `env.useBrowserCache` (Cache API) on by default; set `cacheKey: 'zipscribe-models'`; shader compilation NOT persisted → warm-up run after load (Xenova demo pattern).
- ORT wasm location: transformers.js loads onnxruntime-web `.wasm`/`.mjs` from a CDN by default → set `env.backends.onnx.wasm.wasmPaths` to self-hosted `/wasm/` (offline + CSP + privacy). Verify exact file set for the pinned ORT version; watch Cloudflare Pages' 25 MiB per-file limit.

## Verified during spec review (2026-10-27)

| Fact | Evidence |
|---|---|
| npm: `@huggingface/transformers` latest **4.3.2** (stable), last 3.x **3.8.1**; `mediabunny` 1.62.1; `onnxruntime-web` 1.31.1; `sherpa-onnx` 2.0.1; vite 8.3.5; react 19.3.1 | `registry.npmjs.org/-/package/<name>/dist-tags` |
| HF model files 302-redirect to `us.aws.cdn.hf.co` (xet bridge); `resolve/main` returns `x-repo-commit` (e.g. whisper-base_timestamped @ `608c49e6…`) | `curl -I https://huggingface.co/onnx-community/whisper-base_timestamped/resolve/main/…` |
| `onnx-community/pyannote-segmentation-3.0` license MIT (sha `733a93b6…`); `onnx-community/silero-vad` MIT | HF API `/api/models/<repo>` |
| `onemira/eres2net-base-3dspeaker-onnx` exists, tagged apache-2.0 + "mirror", 0 downloads → **provenance unverified**: trace to upstream 3D-Speaker release or export ERes2Net ourselves; sherpa-onnx ships 3D-Speaker ONNX embeddings as an alternative source | HF API |
| mediabunny reading: `new Input({formats: ALL_FORMATS, source: new BlobSource(file)})` → `getPrimaryAudioTrack()` → `track.canDecode()` → `new AudioSampleSink(track).samples(start, end)`; reads lazily; supports custom decoders; subtitle tracks not readable; Conversion API can resample/downmix (Web Audio mixing rules) | https://mediabunny.dev/guide/reading-media-files · /guide/quick-start · /guide/converting-media-files |
| mediabunny reads (and writes) MP4/M4V/M4A, MOV, CMAF, MKV, WebM, Ogg, MP3, WAVE, ADTS (.aac), FLAC, MPEG-TS, HLS; input format singletons `MP4, QTFF, MATROSKA, WEBM, MP3, WAVE, OGG, ADTS, FLAC, MPEG_TS, HLS`; `ALL_FORMATS` bundles every demuxer (size cost) | https://mediabunny.dev/guide/supported-formats-and-codecs · /guide/input-formats |
| `performance.measureUserAgentSpecificMemory()` is only exposed in cross-origin-isolated contexts and measures JS/DOM memory, not GPU memory | MDN |
| transformers.js docs indexed in docs-mcp track **`main` (4.x)** — not the pinned 3.8.x | docs-mcp `transformers.js` pages are `/docs/transformers.js/main/…` |

## Media I/O

- **mediabunny** (Vanilagy) supersedes **mp4-muxer (deprecated)** — read/write MP4/MOV/MKV/WebM/MP3/WAV, WebCodecs-accelerated, `Mp4OutputFormat`, `CanvasSource`, subtitle tracks (write only — reading is unsupported). https://github.com/Vanilagy/mediabunny · https://github.com/Vanilagy/mp4-muxer
- WebCodecs `AudioDecoder`: Chrome/Edge 94+, Firefox 130+, **Safari 26+ only**; always probe `isConfigSupported`. https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder
- `VideoEncoder` Safari 16.4+ but `AudioEncoder` Safari 26+ → burn-in export is T1/T2 only (Intent 3).
- Resample to 16 kHz mono Float32 **in worker** (linear/polyphase); do NOT use OfflineAudioContext (unavailable in workers).
- ffmpeg.wasm fallback: **single-threaded build only** → no SharedArrayBuffer → no COOP/COEP needed anywhere. Limits: ~0.04× native decode speed, 2 GB input cap. https://ffmpegwasm.netlify.app/docs/performance/

## Diarization components (all MIT-tier, on HF Hub)

- Segmentation: `onnx-community/pyannote-segmentation-3-0` via `AutoModelForAudioFrameClassification` + `AutoProcessor.post_process_speaker_diarization`. Official demo runs **wasm fp32** (WebGPU unsupported for this model: microsoft/onnxruntime#21386).
- Embeddings: 3D-Speaker **ERes2Net** ONNX (candidate `onemira/eres2net-base-3dspeaker-onnx` — provenance unverified, see table above) via the onnxruntime-web instance transformers.js already bundles (avoid a second ORT copy).
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

- [ ] Does 3.8.1 exhibit the #1739 leak? (unit-02, decides the pin)
- [ ] Measure actual T1 throughput for `small` vs `base` during unit-02; consider `large-v3-turbo` as opt-in on ≥ 16 GB VRAM.
- [ ] Does the 3.8.1 ASR pipeline expose per-word probabilities? (docs show only `{text, timestamp}` chunks) — if not, `confidence` needs a custom generate path or stays absent for engine A.
- [ ] Whisper language auto-detect in transformers.js 3.8.1 pipeline: supported, or must `language` always be passed? Drives the transcribe-popover default.
- [ ] Method for sampling Chrome GPU-process memory in Playwright (CDP `SystemInfo`, OS process metrics, or `chrome://gpu` scrape) — unit-02 picks and validates one.
- [ ] mediabunny custom decoder as the ffmpeg.wasm integration point (unit-04).
- [ ] Post-launch: multithreaded wasm + COOP/COEP as a Pages-header experiment (/seed).
- [ ] ffmpeg.wasm: consider mp4box.js as lighter demux-only fallback.
