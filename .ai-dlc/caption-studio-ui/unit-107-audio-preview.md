---
status: pending
discipline: frontend
depends_on: [unit-102-editor-core-playback, local-transcribe-engine/unit-04-media-ingest]
workflow: tdd
mode: AHOTL   # well-bounded: one clock implementation + one renderer, strong L1/L4 tests
---

# Unit 107: Audio Projects — Playback & Visualizer

## Description

Make audio-only projects first-class on the preview stage: play **any** importable audio file (native `<audio>` when the browser can, otherwise decoded playback through Web Audio), and render a live **audio visualizer** — by default the FFT spectrum of the playing audio drawn as a line — in place of video, with the caption overlay on top. Spec: `knowledge/design.md` § Audio projects — preview stage; architecture § Playback & preview.

## User Stories

**US-107.1** As a podcaster, my audio file plays in the editor whatever its format.
- *Given* an audio file where `audio.canPlayType(mime)` is non-empty and a muted probe play succeeds, *when* the project opens, *then* the **element clock** is used (`<audio>` → `MediaElementAudioSourceNode` → `AnalyserNode` → destination).
- *Given* a file the element can't play (e.g. `fmt-30s.aiff`, `.wma`, `.amr` in Chromium), *when* the project opens, *then* the **decoded clock** is used: unit-04 `decodeForPlayback` → `AudioWorkletNode` ring buffer → `AnalyserNode` → destination; `AudioContext.currentTime` drives the playhead; play/pause/seek/loop/rate (0.5–2×) behave exactly as with the element clock (shared L3 contract suite), and seek-to-audible ≤ 250 ms.
- *Given* either clock, *when* playing for 10 min, *then* playhead drift vs the audio's true position ≤ 20 ms (measured against a click-track fixture).

**US-107.2** As a podcaster, I see my audio while I edit.
- *Given* an audio project playing `tones-220-1k-5k-10s.wav`, *when* the spectrum line renders, *then* local maxima appear at the x-positions of 220 Hz, 1 kHz and 5 kHz (± 2 CSS px at a 1280 px stage) and the line is otherwise below −60 dBFS on the y-mapping.
- *Given* `silence-10s.wav`, *when* playing, *then* the line sits on the baseline (no NaN/−Infinity artefacts).
- *Given* pause, *then* the last frame stays at 40% opacity and the rAF loop stops (0 visualizer frames while paused); *given* "Waveform" mode, *then* a time-domain line is drawn instead; *given* "Tint by speaker" and an active block, *then* the line uses that speaker's colour.
- *Given* `prefers-reduced-motion: reduce`, *then* the visualizer redraws at ≤ 4 Hz.
- *Given* the caption overlay, *then* captions render over the visualizer with the project style (same `engine/export/overlay.ts` renderer), never occluded by it.

**US-107.3** As a podcaster, the app doesn't offer things that make no sense for audio.
- *Given* `asset.kind === 'audio'`, *when* the workbench renders, *then* the Media tab card shows codec / sample rate / channels / duration (no resolution or fps), the output-aspect selector is absent, and the export dialog contains no burn-in option in the DOM (enforced again in styling-and-export/unit-202).

## Functional Requirements

- **FR-107.1** `state/services/playback/media-clock.ts`: `interface MediaClock { play(); pause(); seek(t); setRate(r); setLoop([a,b]|null); readonly time: number; readonly paused: boolean; onEnded(cb); dispose() }`; `element-clock.ts` (wraps any `HTMLMediaElement` — also used for video) and `decoded-clock.ts` (Web Audio). `SyncArbitrator` (unit-102) consumes only `MediaClock`. Clock choice is made once at project open by `choosePlaybackPath(asset, probe)` (pure, L1-tested).
- **FR-107.2** Decoded clock: `AudioWorkletProcessor` reading a SharedArrayBuffer-free ring buffer fed by `MessagePort` transfers (no COOP/COEP needed); 2 s buffer target, underrun → pause + `PLAYBACK_STALL` notice, auto-resume when refilled.
- **FR-107.3** `engine/audio/spectrum.ts` (pure): `toSpectrumLine(bins: Float32Array, { sampleRate, fftSize, width, height, minHz:30, maxHz, minDb:-90, maxDb:-10, pointsPerPx: 0.5 }) → Float32Array /* x,y pairs */` — log-frequency resampling with max-pooling per output point, dB clamp, NaN/−Infinity → minDb; `toWaveformLine(samples, …)` for time-domain mode. All visual math lives here so it's unit-testable.
- **FR-107.4** `ui/canvas/visualizer/`: `AnalyserNode` (`fftSize: 4096`, `smoothingTimeConstant: 0.75`), `getFloatFrequencyData` / `getFloatTimeDomainData` per rAF while playing, Catmull-Rom path, DPR-scaled canvas behind the caption overlay layer; frame cost ≤ 2 ms at a 1920×1080 stage (L4 measures with `performance.now()` around draw, generous CI threshold; absolute ≤ 2 ms is `[RQ]`).
- **FR-107.5** Settings: `visualizer.mode: 'spectrum' | 'waveform'`, `visualizer.tintBySpeaker: boolean` in the `settings` slice (persisted, not in project history).
- **FR-107.6** `AudioContext` is created/resumed on the first user play gesture (autoplay policy); its state is reflected in the transport (no silent failure).

## Technical Specification

- Files per FR paths; `aria-hidden="true"` on the visualizer canvas.
- Fakes: `src/test-support/fake-analyser.ts` (scripted bins) and fake `MediaClock`; both covered by the L3 clock contract suite that the real element and decoded clocks also pass (L4).

## Completion Criteria

- [ ] **CC-107.1** `choosePlaybackPath` L1 table test: every `fixtures/audio/` entry × {chromium, webkit} capability profile → expected path
- [ ] **CC-107.2** MediaClock L3 contract suite passes for the fake, element and decoded clocks (play/pause/seek/loop/rate/ended)
- [ ] **CC-107.3** Decoded playback (L4, Chromium): `fmt-30s.aiff` and `fmt-30s.wma` play, seek-to-audible ≤ 250 ms, no underrun in a 30 s run
- [ ] **CC-107.4** `[RQ]` Drift ≤ 20 ms after 10 min on the click-track fixture, both clocks
- [ ] **CC-107.5** `toSpectrumLine` L1: tone bins → peaks at the right x (± 2 px); silence → baseline; NaN/−Infinity handled; property test: output length and bounds for arbitrary inputs
- [ ] **CC-107.6** Visualizer L4: `tones-220-1k-5k-10s.wav` playing → canvas peaks at the three expected x-positions (pixel scan); paused → zero frames drawn over 2 s; reduced-motion → ≤ 4 Hz
- [ ] **CC-107.7** Visual golden (SSIM ≥ 0.98) of the spectrum line + caption overlay from scripted bins, DPR 1 and 2
- [ ] **CC-107.8** Audio-project UI: Media card fields, no aspect selector, no burn-in element anywhere in the DOM (L5, `speech-2min.m4a`)
- [ ] **CC-107.9** axe: 0 critical/serious on the audio workbench; visualizer `aria-hidden`
- [ ] **CC-107.10** All gates green incl. `pnpm test:e2e`

## Risks

- **AudioWorklet + MessagePort throughput** on long files → 2 s ring buffer and chunked transfers; underrun notice instead of glitchy audio.
- **Analyser on `MediaElementAudioSourceNode`** reroutes element audio through the AudioContext — volume/mute controls must act on a `GainNode`, not the element (tested).

## Boundaries

- Decoded playback for *video* the element can't play: seed. Audiogram video export: seed (burn-in doesn't exist for audio projects).

## Docs to consult

- MDN Web Audio: `AnalyserNode`, `AudioWorkletNode`, `MediaElementAudioSourceNode`, autoplay policy · mediabunny media-player example (decoded playback pattern): https://mediabunny.dev/examples/media-player
