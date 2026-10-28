---
status: pending
discipline: dev
depends_on: [unit-01-scaffold-quality-gates]
workflow: tdd
mode: AHOTL   # well-specified media math, strong golden tests available
---

# Unit 04: Media Ingest (demux → 16 kHz PCM → peaks)

## Description

Media worker that turns any supported video or audio file (the full list in `knowledge/architecture.md` § Supported media — MP4/M4V/MOV/MKV/WebM/TS video; MP3/M4A/M4B/AAC/WAV/FLAC/OGG/OGA/OPUS/WEBA/MKA audio natively; AIFF/ALAC/WMA/AMR/3GP/CAF via ffmpeg.wasm) into a **streamed** 16 kHz mono `Float32Array` PCM feed plus metadata and waveform peaks, using mediabunny/WebCodecs with a lazy ffmpeg.wasm fallback. Satisfies orig. FR-1.2.1. Streaming (not whole-file) is mandatory: 120 min of audio must never be resident.

## User Stories

**US-1.2.1** (orig. FR-1.2.1) As a user importing any video/audio file, I want audio extracted client-side at 16 kHz mono PCM, so the transcriber can consume it without uploads.
- *Given* `speech-2min.mp4` (AAC in MP4), *when* `decodeAudio(file)`, *then* PCM chunks arrive with `{ sampleRate:16000, channels:1, format:'f32' }` and duration matches `harness/manifest.json` ± 10 ms.
- *Given* `audio-120min.mp4`, *when* decode, *then* worker RSS-equivalent (heap) stays < 150 MB above baseline (chunk window only) — memory-gate test.
- *Given* a WebM/Opus file on a browser whose `AudioDecoder.isConfigSupported` rejects it, *when* decode, *then* ffmpeg.wasm fallback loads lazily and output matches the WebCodecs path within RMS diff ≤ 1e-3 and duration ± 10 ms on a dual-supported sample (different decoders are never bit-identical).

**US-04.1** As a podcaster, any common audio file I have just works.
- *Given* each file in the `fixtures/audio/` native set, *when* decoded, *then* the path is `webcodecs` on Chromium (per manifest `expectedPath`), duration matches the reference ± 20 ms (± 50 ms for VBR MP3 without a seek table), and the 16 kHz PCM matches `fmt-30s.ref.wav` with normalized cross-correlation ≥ 0.98 (lossless) / ≥ 0.90 (lossy) at an alignment offset ≤ 5 ms — i.e. encoder priming/padding (AAC, MP3, Opus pre-skip) is compensated, so captions don't drift.
- *Given* each file in the fallback set, *when* decoded, *then* the path is `ffmpeg` with the same duration/correlation/offset thresholds.
- *Given* a file whose container has no video track (or only an attached cover image), *when* probed, *then* `asset.kind = 'audio'`, `width = height = fps = 0`, and `audioCodec`, sample rate and channel count are reported.
- *Given* `not-audio.mp3`, *when* probed, *then* `job:error {code:'UNSUPPORTED_MEDIA'}` and no project is created.

**US-1.2.4** As an editor, I want waveform peaks and media metadata immediately, so the timeline is useful before transcription finishes.
- *Given* any import, *when* probe resolves (< 1 s for 10-min file), *then* `{ duration, width, height, fps, audioCodec }` published.
- *Given* decode in progress, *when* peaks requested, *then* min/max pairs at ~50 ms buckets stream incrementally (waveform paints progressively).

**US-1.2.5** As a user, I want import cancellable and resumable from scratch cleanly.
- *Given* decode mid-file, *when* `cancel()`, *then* decoders closed, zero pending callbacks, retry succeeds.

## Functional Requirements

- **FR-04.1** `engine/audio/decode.ts` (SDK glue in `engine/audio/adapters/mediabunny.ts`): `new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })` → `getPrimaryAudioTrack()` → `track.canDecode()` → `new AudioSampleSink(track).samples()` (mediabunny drives WebCodecs decoding; we don't call `AudioDecoder` directly) → downmix + resample → 1 s `PcmChunk`s posted as transferables to **every** port in the `decode` request (tee for ASR + diarize; one decode, N consumers; backpressure = slowest consumer, bounded queue of 30 chunks per port).
- **FR-04.2** `engine/audio/resample.ts`: windowed-sinc polyphase resampler to 16 kHz with anti-alias low-pass. Quality assertions: (a) a 10 kHz tone at 44.1 kHz input yields aliased energy (at 6 kHz) ≤ −60 dBFS after resampling; (b) 1 kHz tone passband ripple ≤ 0.1 dB; (c) 44.1→16 kHz speech RMS diff ≤ 1e-3 vs the ffmpeg (`soxr`) reference. (Content "above 8 kHz" cannot exist at 16 kHz output — measure aliasing instead.)
- **FR-04.3** Channel downmix to mono using the Web Audio API mixing rules (same algorithm mediabunny uses for remixing): stereo → (L+R)/2; 5.1 → per Web Audio "speakers" downmix; fixture golden for both.
- **FR-04.4** `engine/audio/peaks.ts`: streaming min/max buckets; bucket width from duration (target ≤ 20 000 buckets); serializable `PeaksData` for later IndexedDB caching (`caption-studio-ui/unit-106` persistence consumes).
- **FR-04.5** ffmpeg.wasm fallback: single-threaded core only (no SharedArrayBuffer/COOP-COEP in production — repo-wide policy), self-hosted under `/wasm`, lazy dynamic import on first need, same `PcmChunk` output contract; emits `decode:support {path:'ffmpeg'}` + `FFMPEG_FALLBACK` notice and `job:progress` like the WebCodecs path. Preferred integration: register it as a mediabunny **custom decoder** so `canDecode()` and the sink loop stay identical; if that proves infeasible, a parallel adapter with the same output contract — record which in the unit report.
- **FR-04.6** Per-codec support matrix probe result cached in-memory per session: `{ container: string, codec: string, supported: 'webcodecs'|'ffmpeg'|'none' }`. `'none'` → `job:error {code:'UNSUPPORTED_MEDIA'}`.
- **FR-04.7** Video frames are **not** decoded here (canvas playback uses `<video>`; export decodes separately in Intent 3).
- **FR-04.9** Format detection by content (mediabunny `input.getFormat()` / magic bytes), never by extension alone; ffmpeg fallback selected when mediabunny can't open the container **or** `track.canDecode()` is false. `MediaAsset.kind` = `video` only when a decodable, non-cover-art video track exists.
- **FR-04.10** Native-rate playback decode (consumed by `caption-studio-ui/unit-107` when the media element can't play the file): `decodeForPlayback(file, fromSec, port)` streams interleaved f32 PCM at the source sample rate (stereo max) from any position, via the same mediabunny/ffmpeg paths; restartable for seeks.
- **FR-04.8** `engine/audio/fingerprint.ts`: `MediaFingerprint {name, size, durationMs, sampleHashes}` (SHA-256 of first/middle/last 64 KB via `file.slice`) computed during probe and included in `media:probed.asset` (unit-106 consumes).

## Technical Specification

- Worker: `src/workers/media.worker.ts`; engine: `src/engine/audio/{decode,resample,peaks}.ts` (+ `.test.ts` beside each).
- `PcmChunkStream` (engine-side helper): async-iterable over `PcmChunk { startSec, samples: Float32Array }` read from a `MessagePort` — **also the contract unit-05's transcriber and unit-06's diarizer consume**. Types come from `protocol.ts`; don't redefine.
- Memory-gate specs run in the Playwright `memory` project against `preview:isolated` (unit-01 FR-1.0.10).
- Golden references generated by `scripts/make-fixtures.ts` via ffmpeg (committed `fixtures/golden/*.json`).

## Completion Criteria

- [ ] **CC-04.1** All unit-01 video fixtures decode to spec (durations match manifest ± 10 ms)
- [ ] **CC-04.2** Audio format matrix (native set): path, duration, correlation and offset thresholds from US-04.1 pass for every file (Chromium, L4)
- [ ] **CC-04.3** Audio format matrix (fallback set): same thresholds via the ffmpeg path
- [ ] **CC-04.4** Audio-only probe: `kind:'audio'` with zero video dimensions and correct codec/sample-rate/channels for every audio fixture; cover-art MP3/M4A still `audio`
- [ ] **CC-04.5** `not-audio.mp3` → `UNSUPPORTED_MEDIA`, no project
- [ ] **CC-04.6** `decodeForPlayback` from 0 s and from a mid-file seek matches the reference PCM at native rate (correlation ≥ 0.98 lossless)
- [ ] **CC-04.7** webkit project: native-set files decode via WebCodecs where Safari supports the codec, else via ffmpeg — the per-browser path matrix is recorded in `discovery.md`
- [ ] **CC-04.8** Resample/mono goldens pass thresholds above (vs ffmpeg-generated references)
- [ ] **CC-04.9** 120-min decode memory gate (< 150 MB above baseline) via sampling test
- [ ] **CC-04.10** ffmpeg fallback e2e on a fixture forced through fallback (stubbed capability probe)
- [ ] **CC-04.11** cancel/retry leaves zero active decoders (worker registry assertion)
- [ ] **CC-04.12** Two-port tee: ASR and diarize ports receive byte-identical chunk sequences; a stalled consumer pauses decode without unbounded buffering
- [ ] **CC-04.13** Fingerprint deterministic across two imports of the same file; differs after a 1-byte change in any sampled region
- [ ] **CC-04.14** Coverage ≥ 85% on `engine/audio/**`

## Risks

- ffmpeg.wasm lazy import path breaks bundle budget → must land in its own lazy chunk (check-bundle enforces).
- Multi-track files (commentary tracks, dual-mono): v1 policy = first audio track + `MULTI_TRACK` notice event.
- `ALL_FORMATS` pulls every demuxer into the media worker chunk → acceptable (worker is lazy, excluded from the initial budget); record the chunk size.
- Gapless/priming metadata varies by encoder (iTunes `iTunSMPB`, LAME header, Opus pre-skip) → the offset criterion catches it; if mediabunny doesn't compensate one of them, compensate in the adapter and record it in discovery.

## Docs to consult

- docs-mcp `mediabunny` (indexed 1.62.1, guide pages): `/guide/reading-media-files`, `/guide/media-sinks`, `/guide/supported-formats-and-codecs#custom-decoders` — re-index if unit-01 pins a different version
- MDN AudioDecoder / AudioData: https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder
- ffmpeg.wasm single-thread usage: https://ffmpegwasm.netlify.app/docs/getting-started/usage
