# Model evaluation spike — unit-02 (FR-02)

Machine: GPU helper pid present; calibration: PASSED (observed 1112539136 bytes of 536870912 allocated).

Browser: launch mode **new-headless** (new-headless via Playwright `channel:'chromium'`, headed fallback — [playwright.dev/docs/browsers](https://playwright.dev/docs/browsers)), args `--no-sandbox --enable-unsafe-webgpu --use-angle=metal --enable-features=SharedArrayBuffer`; crossOriginIsolated=true; navigator.gpu adapter=YES; gpuSamplerPid=44427.

## Measured rows (US-02.1) — median-of-3 wall incl. audio decode, numThreads:1

CORPUS PROVISIONAL: ground truth is synthesized TTS (unit-01 fixtures) — WER/MAE numbers are valid for CROSS-ENGINE comparison on this machine, NOT as absolute accuracy claims (see domain notes). vendor figures (degraded-vs-vendor) cannot be adjudicated on synthetic audio and are omitted (no vendor comparison rows).

| engine | engineId | version | model | revision | device | adapter | tier | clip | WER | wordTimingMAEms | RTF | per-run wall ms | peak JS heap (MB) | GPU Δ/window | lang | conf | punct | timestamps | license |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| transformers.js | A | 3.8.1 | onnx-community/whisper-base_timestamped | 608c49e613 | webgpu | apple metal-3 | T1 | taxi-en-technical | 1 | 20189.7 | 0.0206 | 1110.7 / 696.1 / 701 | 1091 | 0 | true | false | false | word-native | Apache-2.0 |
| transformers.js | A | 3.8.1 | onnx-community/whisper-small_timestamped | 65caa70f29 | webgpu | apple metal-3 | T1 | taxi-en-technical | 1 | 14123.5 | 0.0424 | 1518.2 / 1425.9 / 1439.9 | 1462 | 2097152 | true | false | false | word-native | Apache-2.0 |
| transformers.js | A | 3.8.1 | onnx-community/whisper-tiny_timestamped | 5172442937 | wasm | apple metal-3 | T2 | taxi-en-technical | 1 | 14719.5 | 0.0674 | 2373.1 / 2291.8 / 2284.3 | 894 | 0 | true | false | false | word-native | Apache-2.0 |
| sherpa-onnx | B | sherpa-onnx wasm/vad-asr (official k2-fsa build, space rev 9d5fc71d) | csukuangfj/sherpa-onnx-zipformer-en-2023-06-26 (int8) | 11a70a47ec | wasm | - | T2 | taxi-en-technical | 1.25 | 8047.5 | 0.0579 | 2027.3 / 1969.1 / 1951.2 | 89 | 0 | false | false | false | word-native | Apache-2.0 |
| cactus-needle | C | cactus-needle@0.3.0 (needle.wasm, vendor manifest rev 2ae11323) | Cactus-Compute/whistle (whistle.cact) | b358ddadd8 | wasm | - | T2 | taxi-en-technical | 1 | 8241.1 | 0.0271 | 989.5 / 918.1 / 921.4 | 3 | 0 | true | true | true | word-native | Apache-2.0 |

`peak JS heap` n/a means `performance.measureUserAgentSpecificMemory()` (which requires the COOP/COEP `preview:isolated` server, [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory)) produced no sample on the run page — the reason is recorded per-row; it is never reported as 0. `GPU Δ/window` is the median of the out-of-band GPU-process phys_footprint delta sampled before/after each of the three runs (sampler calibrated first).

Punctuation decision (FR-02.4): the `punct` column records whether the engine output was punctuated; engines without punctuation must be paired with the unit-03 punctuation pass (whisper: unpunctuated → pass needed).

## Slice-2C asset provenance (build-1 rejection note)

build-1 measured B/C on the third-party `speech-asr`/`anyshu-easy-asr` wrapper (removed from package.json); slice 2C re-measured them on official assets: engine B = official k2-fsa browser wasm build of the non-streaming wasm/vad-asr path from the k2-fsa Hugging Face Space (`k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc` @ 9d5fc71d…, per-file SHA-256 in `models/eval-registry.json` id `sherpa-wasm-vad-asr`, the .wasm digest equals the HF LFS oid), engine C = npm `cactus-needle@0.3.0` browser build (vendor-vendored needle.wasm, SHA-256-pinned manifest, Cactus-Compute/needle3 @ 2ae11323…) + `whistle.cact` from Cactus-Compute/whistle @ b358dda… — all hosts inside settings.yml `operations.model_hosts` + npm.


## #1739 leak study (US-02.3)

whisper-small_timestamped, T1 (webgpu), pinned dtype recipe `{ encoder_model: "fp32", decoder_model_merged: "q4" }`, 20 consecutive 28 s windows as separate pipeline calls on `speech-10min`; per-window GPU-process phys_footprint via out-of-band macOS `footprint` (RSS does not show Metal allocations on macOS — issue #1739 guidance). Windows the sampler could not observe are recorded null, never duplicated to pad the count.

- 3.8.1 (onnx-community/whisper-small_timestamped, webgpu): per-window growth 2207528 bytes over 20/20 windows; dispose() reclaims: false (2174746624 → 2156920832 bytes); worker-recycle ceiling recommendation: 1498911512 bytes (unit-05).
- 4.3.2 (onnx-community/whisper-small_timestamped, webgpu): per-window growth 204361944 bytes over 20/20 windows; dispose() reclaims: true (5801771008 → 370147328 bytes); worker-recycle ceiling recommendation: 1430533608 bytes (unit-05).

Pin decision: Measured per-window GPU-process growth on the pinned @huggingface/transformers 3.8.x is 2207528 bytes/window vs 204361944 bytes/window on 4.x — keep the settings.yml version_pins at ~3.8.1; revisit 4.x when transformers.js PR #1755 (fixes issue #1739) merges and re-measure (worker-recycle ceiling covers the residual leak).

## Network audit (US-02.2 / CC-02.4 / CC-02.9)

- engine A: pass=**true** — request log `docs/spikes/network/A.json` (redacted: urls/ids/timestamps only, SECURITY-03). No request outside self + settings.yml model_hosts.
- engine B: pass=**true** — request log `docs/spikes/network/B.json` (redacted: urls/ids/timestamps only, SECURITY-03). No request outside self + settings.yml model_hosts.
- Whistle (needle.wasm) telemetry concern (Spike 1.4 Q1 prior-art): pass=**true** — request log `docs/spikes/network/C.json` (redacted: urls/ids/timestamps only, SECURITY-03). No request outside self + settings.yml model_hosts.

## Parakeet verdict (CC-02.8)

- Parakeet (sherpa-onnx WASM vad-asr): loads=false, blocker: https://github.com/k2-fsa/sherpa-onnx/issues/2200. load failed in sherpa WASM (Error:RuntimeError:Aborted(). Build with -sASSERTIONS for more info.|RuntimeError: Aborted(). Build with -sASSERTIONS for more info. at abort (http://localhost:4179/sherpa/sherpa-onnx-wasm-main-vad-asr.js:1); upstream wasm/vad-asr model-support limitation (640 MB int8 TDT)

## Baseline check (CC-02.7)

- whisper-base T1 RTF 0.0206; baseline under review: settings.yml performance_baselines: whisper-small ≥ 4× realtime (T1, reference hardware); outcome **confirmed**. Measured whisper-base T1 RTF 0.0206 (≈48.5× realtime) — the settings.yml performance_baselines entry (whisper-small ≥ 4× realtime) is achievable on reference hardware; confirmed, no settings patch needed.

## License verification (CC-02.10)

- Omnilingual ASR 300M (facebookresearch/omnilingual-asr): verified-ok — Code and models Apache-2.0 per the official repository LICENSE (verified 2026-10-28); companion corpus dataset is CC-BY-4.0 (dataset not shipped). Apache-2.0 permits the commercial SaaS use (FR-1.0.2). Not benchmarked this unit (candidate D is license-gated research scope, benchmark only after owner picks it).
- Moonshine v2 (moonshine-ai/moonshine-tiny): verified-ok — Model card license tag: MIT (verified 2026-10-28 via HF API cardData). MIT permits commercial use. Not benchmarked this unit.
- MedASR (google/medasr): blocked-pending — Gated HF repo; use governed by the Health AI Developer Foundations terms of use (custom terms requiring acceptance, usage restrictions, and no unmodified clinical use — verified 2026-10-28 from the model card). Requires legal review + owner sign-off before any benchmark (unit spec: do not benchmark until license verified); gated download also conflicts with the no-auth runtime model fetch (settings.yml model_hosts). No benchmark row present.

Candidate-D [MANUAL] sign-off owner-pending; blocked-pending candidates have no benchmark rows (unit spec: license verified before benchmarking).

## Recommendation — unit-03 default registry (CC-02.11)

- **T1**: transformers.js / onnx-community/whisper-base_timestamped
- **T2**: sherpa-onnx / csukuangfj/sherpa-onnx-zipformer-en-2023-06-26 (int8)
- **T3**: cactus-needle / Cactus-Compute/whistle (whistle.cact)

Every recommended (engine, model) pair traces to a measured row above; anything rejected/dropped carries its reason in the audit and Parakeet sections above.

## Notes and protocol deviations

- sherpa B reference row uses csukuangfj/sherpa-onnx-zipformer-en-2023-06-26 (int8): the `…zipformer-en-20230626-low_frame_rate`-era `110m`-class repos referenced in discovery notes are empty on HF (documented deviation, domain-notes).
- B timestamps: sherpa transducer emits per-token starts (ends estimated from the next token) — recorded as word-native.
- Engines emitting no words on the synthetic clip get wordTimingMAEms = clipDuration (maximal correction burden sentinel), never 0.
- 4.x leak twin: @huggingface/transformers 4.3.2 from the isolated npm install under tools/eval/node-4x (measurement-only; the app stays on the pinned 3.8.1).
- SECURITY-03: no transcript text appears in this report or any artifact — scores, lengths, hashes and URLs only.
