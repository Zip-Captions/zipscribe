# Discovery Log: Styling, Export & Offline App

Research findings with sources. Created at spec review 2026-10-27; verify time-sensitive items at unit start.

## Media output (mediabunny, docs-mcp `mediabunny` 1.62.1)

- Reading for burn-in: `Input` + `BlobSource` + `VideoSampleSink` (`sample.draw(ctx, x, y)`); audio via `AudioSampleSink` or packet-level copy with `EncodedPacketSink`.
- Writing: `Output` + `Mp4OutputFormat`; video from a canvas via `CanvasSource` (codec + `Quality`, e.g. `new Quality('high')` or `{bitrate}`); audio sources accept `transform: {numberOfChannels, sampleRate}`. Subtitle tracks are writable, **not readable**.
- Conversion API can trim/resize/transcode/resample in one call — candidate for the audio-passthrough path.
- https://mediabunny.dev/guide/media-sources · /guide/writing-media-files · /guide/converting-media-files

## WebCodecs gating

- `VideoEncoder` Safari 16.4+, `AudioEncoder` Safari 26+ → MP4 burn-in requires both; T3 = sidecars only in v1 (WebM-via-MediaRecorder dropped: MediaRecorder is realtime, main-thread only and not available in workers — seed).
- Canvas → encoder color: canvas content is sRGB; specify BT.709 on the encoder side and verify range handling with a color-bar golden.

## PWA / offline

| Fact | Source |
|---|---|
| Chrome install criteria: HTTPS, manifest with `name`/`short_name`, 192 + 512 icons, `start_url`, `display` ∈ fullscreen/standalone/minimal-ui/window-controls-overlay, no `prefer_related_applications`; engagement heuristics (one click + 30 s). A service worker is **not** listed as a requirement. | https://web.dev/articles/install-criteria |
| `vite-plugin-pwa` 2.0.0 (peer: vite 3–8, workbox 7.4); `workbox-window` 7.4.1; `@vite-pwa/assets-generator` 2.0.0 | npm dist-tags 2026-10-27 |
| Lighthouse removed its PWA category (v12) → installability is tested via CDP / manifest assertions | Lighthouse changelog (verify) |
| `file_handlers` + `launchQueue` and `launch_handler` are Chromium desktop features for installed apps | MDN (verify current support) |
| Cloudflare Pages per-file limit 25 MiB | Cloudflare Pages limits docs (verify) |

## Fonts

- OffscreenCanvas in a worker uses the worker's `FontFaceSet` (`self.fonts`) — fonts must be loaded there too, or burn-in silently falls back to a system face.

## Open questions

- [ ] Can the opt-in Google Fonts toggle coexist with a static CSP header? (unit-203 decides: allow fonts origins statically vs drop remote fonts)
- [ ] Does mediabunny expose encoder color-space config on `CanvasSource`, or is it inferred? (unit-202)
- [ ] Exact ORT/ffmpeg wasm file sizes for the pinned versions vs the 25 MiB limit and the 15 MB precache budget (unit-01/204)
