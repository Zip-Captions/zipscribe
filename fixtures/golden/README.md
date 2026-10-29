# fixtures/golden — unit-04 media-ingest references (committed, generated once)

These references are **created once by the test author** with the repo-pinned
`ffmpeg-static` build (ffmpeg 6.0, the same binary `scripts/make-fixtures.ts`
uses) and committed, so no test ever decodes/encodes at test time
(`.agent/AGENTS.md` § Network; conventions § Test data).

| File | Produced from | Recipe |
|---|---|---|
| `downmix-stereo.wav` | synthesized: L = 0.02·sin(220 Hz), R = 0.02·sin(330 Hz), 1 s, 44.1 kHz | PCM s16le encode (ffmpeg `-c:a pcm_s16le`) — never mixed |
| `downmix-stereo-mono.wav` | `ffmpeg -f f64le` decode of `downmix-stereo.wav` → `(L+R)/2` in f64 → f32le WAV | the Web Audio stereo downmix rule |
| `downmix-5.1.wav` | synthesized 6 ch (L 440, R 660, C 880, LFE 60, SL 1100, SR 1320 Hz @ 0.02), 1 s, 44.1 kHz, **f32** | `-c:a pcm_f32le -ac 6` (float keeps the small signals exact) |
| `downmix-5.1-mono.wav` | `ffmpeg -f f64le` decode → `0.7071·L + 0.7071·R + C + 0.5·LFE + 0.7071·SL + 0.7071·SR` (Web Audio speaker downmix) → f32le WAV | the 5.1 → mono rule |
| `tone1k-rate48k.wav` | synthesized 1 kHz sine @ 0.5, 4 s, 48 kHz | PCM s16le encode |
| `speech-22k.wav` | `fixtures/audio/fmt-30s.ref.wav` linearly interpolated 16 → 22.05 kHz | PCM s16le encode |
| `playback-44100stereo-ref.f32` | `ffmpeg -i fixtures/audio/fmt-30s.ref.wav -ar 44100 -ac 2 -f f32le` | native-rate playback reference (FR-04.10) |
| `playback-22050mono-ref.f32` | `ffmpeg -i fixtures/audio/fmt-30s.ref.wav -ar 22050 -ac 1 -f f32le` | native-rate playback reference |
| `fmt-30s.ref.f32` | `ffmpeg -i fixtures/audio/fmt-30s.ref.wav -f f32le` | convenience raw copy of the committed reference |

The downmix goldens were verified by re-deriving the mix independently from
the files (`ffmpeg -f f64le` decode in Python/numpy: max |Δ| = 9.0e-5 for the
s16 5.1 file at full scale, i.e. one 16-bit LSB). `not-audio.mp3`,
`fmt-30s.ogg`/`fmt-30s.oga`/`fmt-30s.opus` (broken CRC pages) and
`audio-120min.mp4` are covered in the unit report's Assumptions.

Licenses: same as the rest of `fixtures/` — generated in-repo, CC0-1.0;
the tool (ffmpeg-static) is not shipped (see `fixtures/LICENSES.md`).