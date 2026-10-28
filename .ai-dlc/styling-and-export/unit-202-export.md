---
status: pending
discipline: frontend
pass: dev
depends_on: [unit-201-styling-engine, local-transcribe-engine/unit-03-model-manager, local-transcribe-engine/unit-07-caption-import]
workflow: tdd
mode: AHOTL   # well-bounded serializers + worker pipeline with goldens
---

# Unit 202: Export (sidecars + burn-in)

## Description

Export surface: SRT/VTT/JSON/TSV serializers for the source track or any translation track (parsers live in `local-transcribe-engine/unit-07` and are used here for round-trip tests), export dialog with honest capability gating, `export.worker.ts` burn-in (mediabunny `VideoSampleSink` → `OffscreenCanvas` + `engine/export/overlay.ts` at each frame's timestamp → `CanvasSource` H.264 + audio passthrough or AAC → `Mp4OutputFormat`), progress/cancel/save. Satisfies orig. FR-3.2.1 (full) + FR-3.2.2 (mediabunny correction of mp4-muxer).

## User Stories

**US-3.2.1** (orig. FR-3.2.1) As a user, sidecar export is instant and correct anywhere.
- *Given* a project, *when* SRT/VTT/JSON/TSV export for track `source` or a translation language, *then* byte-exact goldens incl. escapes (VTT `&`→`&amp;`, `<`→`&lt;`; `-->` never appears in cue text), newline handling, RTL marks, times as `HH:MM:SS,mmm` (SRT) / `HH:MM:SS.mmm` (VTT), speaker labels per settings (off / VTT `<v Name>` / prefix `[Name]:`), filename `{project-slug}[.{lang}].{ext}`; *given* our own output, *when* parsed by unit-07, *then* blocks round-trip text-exact and ± 1 ms (property test).

**US-3.2.2** (orig. FR-3.2.2, corrected) As a shorts creator, burn-in MP4 is all-client and what-I-saw-is-what-I-got.
- *Given* T1/T2 (`videoEncoder && audioEncoder` capable), *when* "Burn-in MP4" (res selector ≤ source, fps ≤ source, track selector), *then* worker pipeline: decode → `drawImage` → `renderOverlay(ctx, frame@timestamp)` → encode → mux; output duration = source ± 1 s, audio present, 10 sampled word-boundary frames' overlay matches preview (SSIM ≥ 0.99, unit-201 contract) — verified via ffmpeg-extracted frames in test.
- *Given* progress ≥ 1 Hz (encoded-frames/total) + `cancel()` ≤ 2 s (encoder flush bounded).
- *Given* T3 (no `AudioEncoder`, e.g. Safari < 26), *when* the export dialog opens, *then* MP4 burn-in is absent (not disabled-and-broken) with a one-line reason, and all sidecar formats are offered.
- *Given* an **audio project** (`asset.kind === 'audio'`) on any tier, *when* the export dialog opens, *then* burn-in is not rendered at all — no option, no disabled control, no explanatory line — and the dialog is the sidecar dialog (format × track × speaker labels). The export service also rejects a burn-in request for an audio snapshot (`ENCODER_UNSUPPORTED`) as a second line of defence.

**US-3.2.3** As a user, export never traps me.
- *Given* export running, *when* editing (undo/redo/edits), *then* edits don't affect the in-flight export (snapshot taken at start — `ProjectSnapshot.snapshotVersion` shown in progress UI); toast on completion with "Download" or, when a save handle was used, "Saved to <file name>".

## Functional Requirements

- **FR-202.1** `engine/export/{srt,vtt,json,tsv}.ts` pure serializers `(snapshot, { track, speakerLabels }) → string`; shared block→cue model; round-trip property tests against unit-07 parsers. JSON = canonical project subset (blocks + words + speakers + the selected track's entries).
- **FR-202.2** Capability gate from `Capabilities` (unit-03 `probeCapabilities`) — dialog options computed, not hidden-but-broken; T4 shows requirements copy.
- **FR-202.3** `engine/export/burn-in.ts` in `export.worker.ts`: mediabunny `Input`/`VideoSampleSink` decode, `Output` + `Mp4OutputFormat` + `CanvasSource` encode (verify exact class names against docs-mcp `mediabunny` 1.62.x); `VideoEncoder` probed via `isConfigSupported` with an avc1 profile/level ladder; explicit color-space handling (canvas is sRGB/BT.709 full-range → encoder BT.709 limited-range, verify mediabunny exposes it); overlay drawn at each sample's exact timestamp from block/word data (**never** the live playhead); audio stream-copied when the source codec is MP4-compatible (AAC), else decoded and re-encoded to AAC.
- **FR-202.4** Fonts registered in the worker before the first frame (unit-201 FR-201.4).
- **FR-202.5** Snapshot isolation: export consumes an immutable `ProjectSnapshot` (structuredClone at dialog confirm).
- **FR-202.6** Save flow: prefer `showSaveFilePicker` (remember last dir via handle in settings), fallback anchor-download of the result `Blob`. Large outputs: stream to the save handle's writable when available instead of holding the whole MP4 in memory.
- **FR-202.7** Bundle hygiene: mediabunny + export code in a lazy chunk (check-bundle); precached by the service worker (unit-204) so export works offline.

## Completion Criteria

- [ ] **CC-202.1** Sidecar goldens byte-exact (4 formats × escape matrix × speaker modes × source + one translation track incl. RTL); round-trip property tests pass
- [ ] **CC-202.2** Burn-in chromium: duration ± 1 s, audio muxed, 10/10 word-boundary frame overlay SSIM ≥ 0.99 vs preview
- [ ] **CC-202.3** Capability gating matrix test (T1/T2/T3/T4 dialog options) — no broken-but-offered options; webkit e2e shows sidecars only when `AudioEncoder` is absent
- [ ] **CC-202.4** Audio-project gating: for every tier × `kind:'audio'`, no burn-in element exists in the dialog DOM (L2 matrix + L5 with `speech-2min.m4a`); service-level burn-in request for an audio snapshot → `ENCODER_UNSUPPORTED`
- [ ] **CC-202.5** Sidecar export from an audio project (all 4 formats, source + translation track) byte-exact vs goldens
- [ ] **CC-202.6** cancel ≤ 2 s; edit-during-export isolation (snapshot) tested
- [ ] **CC-202.7** Lazy-chunk assertion in check-bundle; export works with network offline (after SW install)
- [ ] **CC-202.8** All gates green incl. `pnpm test:e2e` (chromium + webkit export specs)

## Risks

- H.264 encode parameter mismatches across GPU drivers → encoder probe with avc1/avc3 + level ladder; encoder matrix run in release qualification on every available reference machine.
- Memory on long 1080p exports → streaming write to save handle; bounded encoder queue (`encodeQueueSize` backpressure).

## Boundaries

- WebM burn-in for T3, bilingual burn-in, MP4 soft-subtitle tracks: seeds. Caption parsing/import: unit-07. Translation track UI: unit-302.

## Docs to consult

- docs-mcp `mediabunny` (indexed 1.62.1): `/guide/reading-media-files`, `/guide/media-sources` (CanvasSource, encoding quality), `/guide/writing-media-files`, `/guide/converting-media-files` · MDN VideoEncoder/AudioEncoder · WebVTT spec escapes: https://www.w3.org/TR/webvtt1/
