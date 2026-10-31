# fixtures/golden — unit-04 media-ingest references (committed, generated once)

These references are **created once by the test author** with the repo-pinned
`ffmpeg-static` build (ffmpeg 6.0, the same binary `scripts/make-fixtures.ts`
uses) and committed, so no test ever decodes/encodes at test time
(`.agent/AGENTS.md` § Network; conventions § Test data). Tone samples are
emitted by the pinned ffmpeg (`lavfi aevalsrc`, double-precision expression
math — the build's `sine` source has no amplitude control); WAV containers use
hand-written **canonical RIFF headers** (fmt chunk size 16, tag 1 = PCM /
tag 3 = IEEE float) because ffmpeg's wav muxer emits `WAVE_FORMAT_EXTENSIBLE`
(0xFFFE) for float, which the frozen test helper (`tests/unit/audio/helpers/wav.ts`)
parses as int32 garbage. Regeneration script: `.night/regen-goldens.mjs`
(provenance record; samples reproducible with the commands below).

| File | Produced from | Recipe |
|---|---|---|
| `downmix-stereo.wav` | synthesized: L = 0.5·sin(440 Hz), R = 0.5·sin(660 Hz), 1 s, 16 kHz | `ffmpeg -f lavfi -i "aevalsrc=0.5*sin(2*PI*440*t)\|0.5*sin(2*PI*660*t):sample_rate=16000:duration=1" -c:a pcm_s16le` (canonical s16 header) — never mixed |
| `downmix-stereo-mono.wav` | `ffmpeg -f f64le` decode of `downmix-stereo.wav` → `(L+R)/2` in f64 → f32le canonical header | the Web Audio stereo downmix rule |
| `downmix-5.1.wav` | synthesized 6 ch (L 440, R 660, C 880, LFE 60, SL 1100, SR 1320 Hz @ 0.02), 1 s, 16 kHz, **f32** | `ffmpeg -f lavfi -i "aevalsrc=0.02*sin(2*PI*440*t)\|…six expressions…:sample_rate=16000:duration=1:channel_layout=5.1" -c:a pcm_f32le` (canonical **float tag-3** header, not extensible) |
| `downmix-5.1-mono.wav` | `ffmpeg -f f64le` decode → `√0.5·(L+R) + C + 0.5·(SL+SR)` (**LFE muted**) → f32le canonical header | the 5.1 → mono speaker downmix of WHATWG Web Audio § 4.5 (composition of 5.1→stereo, each 1/√2·(L+R) stereo→mono): C at unity, surrounds at ½, LFE silenced — the same rule mediabunny's `AudioResampler` implements and `src/engine/audio/resample.ts` `mixToMono` uses. The LFE-inclusive variant caps correlation at ≈0.95, so it is NOT the golden |
| `tone1k-rate48k.wav` | synthesized 1 kHz sine @ 0.5, 4 s, 48 kHz | PCM s16le encode (canonical header) |
| `tone10k-rate8k.wav` | synthesized 10 kHz sine @ 0.05, 4 s, 8 kHz (above Nyquist — an alias probe; no test consumes it yet) | PCM s16le encode (canonical header) |
| `speech-22k.wav` | `fixtures/audio/fmt-30s.ref.wav` linearly interpolated 16 → 22.05 kHz | PCM s16le encode (canonical header) |
| `playback-44100stereo-ref.f32` | `ffmpeg -i fixtures/audio/fmt-30s.ref.wav -af "pan=stereo\|c0=c0\|c1=c0" -ar 44100 -f f32le` | native-rate playback reference (FR-04.10). `pan` duplicates the mono channel at **unity gain** — `-ac 2` would apply ffmpeg's −3 dB mono→stereo upmix (L=R=0.7071), which breaks the frozen RMS ≤ 1e-3 assertion by exactly the upmix gain |
| `playback-22050mono-ref.f32` | `ffmpeg -i fixtures/audio/fmt-30s.ref.wav -ar 22050 -ac 1 -f f32le` | native-rate playback reference |
| `fmt-30s.ref.f32` | `ffmpeg -i fixtures/audio/fmt-30s.ref.wav -f f32le` | convenience raw copy of the committed reference |

The goldens were verified by re-deriving the expected mix independently from
the committed bytes (f64 decode + the spec formula in Node): stereo mix tones
measure 0.2500 per band (440/660 Hz @ 0.5 input, frozen
`tests/unit/audio/resample.test.ts` CC-04.8); the 5.1 mono golden measures
√0.5·0.02 on L/R, 0.02 on C, 0.5·0.02 on SL/SR and **no 60 Hz component**
(LFE muted); `playback-44100stereo-ref.f32` round-trips to the 16 kHz mono
reference at Δrms 2.4e-6, correlation 0.9997, offset 0. The frozen suite
(12/12) is the arbiter — it is green against `src/engine/audio/resample.ts`
at commit b9a3bff. `not-audio.mp3`, `fmt-30s.ogg`/`fmt-30s.oga`/`fmt-30s.opus`
(broken CRC pages) and `audio-120min.mp4` are covered in the unit report's
Assumptions.

Licenses: same as the rest of `fixtures/` — generated in-repo, CC0-1.0;
the tool (ffmpeg-static) is not shipped (see `fixtures/LICENSES.md`).

## Computed references (not committed) — CC-04.3 decoder-parity goldens

`fmt-30s.amr`/`fmt-30s.3gp` carry hand-built MR122 AMR-NB payloads (see
`fixtures/LICENSES.md`): no AMR-NB encoder exists in the offline toolchain
(ffmpeg-static `-encoders | grep amr` is empty, @ffmpeg/core is decode-only
for amr_nb, system ffmpeg none; downloads forbidden), so a real-speech AMR
fixture cannot be authored and the matrix's source-correlation oracle is
physically unreachable (measured corr 0.0036 — content difference, not a
decode failure). Those CC-04.3 rows use a **decoder-parity golden** instead:
the SAME committed bitstream decoded by the pinned ffmpeg-static on the Node
side

```
ffmpeg -i fixtures/audio/fmt-30s.<amr|3gp> -vn -map 0:a:0 -f f32le pipe:1
```

(`ffmpegStaticNativePcm` in `e2e/media/helpers/media.ts`, the generator's own
pinned binary — no system-ffmpeg fallback) versus the production
ffmpeg.wasm adapter in the browser (`decodeNativeFfmpeg`,
`scripts/harness/ffmpeg-overlay.mjs`), asserting waveform correlation ≥ 0.999
and identical frame counts at the stream's native rate (8 kHz mono). Unlike
the committed goldens this reference is computed at test time — it is a pure
function of the committed bytes and the pinned decoder build, so
determinism holds without vendoring another payload; a drift in either fails
the row loudly. A genuine speech AMR payload stays a corpus-vendoring owner
flag (sine-formant interim-corpus precedent).
