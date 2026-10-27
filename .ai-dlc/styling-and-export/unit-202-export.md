---
status: pending
discipline: frontend
depends_on: [unit-201-styling-engine]
workflow: tdd
mode: AHOTL   # well-bounded serializers + worker pipeline with goldens
---

# Unit 202: Export (sidecars + burn-in)

## Description

Export surface: SRT/VTT/JSON/TSV serializers + parsers (round-trip), export dialog with honest capability gating, `export.worker.ts` burn-in (mediabunny `VideoDecoder` → canvas + `engine/export/overlay.ts` at pts → `VideoEncoder` H.264 + `AudioEncoder` AAC → `Mp4OutputFormat`), WebM fallback tier, progress/cancel/save. Satisfies orig. FR-3.2.1 (full) + FR-3.2.2 (mediabunny correction of mp4-muxer).

## User Stories

**US-3.2.1** (orig. FR-3.2.1) As a user, sidecar export is instant and correct anywhere.
- *Given* project, *when* SRT/VTT/JSON/TSV export, *then* byte-exact goldens incl. escapes (`&`→`&amp;` VTT, newline handling, RTL marks, 3-decimal→`HH:MM:SS,mmm`/`.mmm`), speaker labels per settings (on/off/format `[Alex]:`), filename `{project-slug}-{ts}.{ext}`; *given* our own SRT/VTT, *when* re-imported (Media tab), *then* blocks round-trip ± 5 ms (parser round-trip property test).

**US-3.2.2** (orig. FR-3.2.2, corrected) As a shorts creator, burn-in MP4 is all-client and what-I-saw-is-what-I-got.
- *Given* T1/T2 + `audioEncoder && videoEncoder`, *when* "Burn-in MP4" (res selector ≤ source, fps ≤ source), *then* worker pipeline: decode → `drawImage` → `renderOverlay(ctx, frame@pts)` → encode → mux; output duration = source ± 1 s, audio present, 10 sampled word-boundary frames pixel-match preview identity (unit-201 contract) — verified via ffmpeg-extracted frames in test.
- *Given* progress ≥ 1 Hz (encoded-frames/total) + `cancel()` ≤ 2 s (encoder flush bounded).
- *Given* `AudioEncoder` unavailable (webkit tier), *when* export dialog, *then* MP4 option hidden (honest gating, product rule) with WebM (VP8/VP9 + Opus via `MediaRecorder` on canvas+stream) or SRT/VTT/JSON offered instead.

**US-3.2.3** As a user, export never traps me.
- *Given* export running, *when* editing (undo/redo/edits), *then* edits don't affect in-flight export (snapshot taken at start — versioned), toast on completion with Download + Show-in-folder (File System Access save handle when granted).

## Functional Requirements

- **FR-202.1** `engine/export/{srt,vtt,json,tsv}.ts` pure serializers + `parse.ts` parsers; shared block→cue model; round-trip property tests.
- **FR-202.2** Capability gate from `Capabilities` (engine-1/03) — dialog options computed, not hidden-but-broken; T4 shows requirements copy.
- **FR-202.3** `engine/export/burn-in.ts` in `export.worker.ts`: mediabunny decode+encode per discovery recipe; explicit `colorSpace` params on VideoEncoder (canvas→encoder range gotcha); overlay drawn at exact `pts` from block/word data (**never** live playhead — domain lifecycle rule); audio passthrough via `AudioDecoder→AudioEncoder` or stream-copy when codec-compatible (mediabunny capability).
- **FR-202.4** WebM fallback: `MediaRecorder` on `captureStream`-equivalent (canvas rAF pump + audio track) — quality presets; documented caveats.
- **FR-202.5** Snapshot isolation: export consumes immutable `ProjectSnapshot` (structuredClone at dialog open; `version` tag surfaced in progress UI).
- **FR-202.6** Save flow: prefer `showSaveFilePicker` (remember last dir per settings), fallback anchor-download.
- **FR-202.7** Bundle hygiene: mediabunny + export code lazy-loaded chunk (check-bundle).

## Completion Criteria

- [ ] Sidecar goldens byte-exact (4 formats × escape matrix × speaker modes); round-trip property tests pass
- [ ] Burn-in chromium: duration ± 1 s, audio muxed, 10/10 word-boundary frame identity vs preview
- [ ] WebM fallback passes webkit e2e (frame sanity + playable)
- [ ] Capability gating matrix test (T1/T2/T3 dialog options) — no broken-but-offered options
- [ ] cancel ≤ 2 s; edit-during-export isolation (snapshot) tested
- [ ] Lazy-chunk assertion in check-bundle
- [ ] All gates green incl. `pnpm test:e2e` (chromium + webkit export specs)

## Risks

- H.264 encode parameter mismatches across GPU drivers → encoder probe (`isConfigSupported`) with avc1/avc3 + level ladder; nightly matrix run.
- MediaRecorder webm timing drift → bounded-duration chunking test.

## Docs to consult

- docs-mcp `transformers.js` n/a → mediabunny README (Conversion/encoder APIs — scrape `mediabunny` into docs-mcp at unit start if absent) · MDN VideoEncoder/MediaRecorder
