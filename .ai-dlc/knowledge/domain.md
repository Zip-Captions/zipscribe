# Knowledge: Domain

Ubiquitous language and domain model (entities/relationships/invariants). Code types live in `src/engine/model.ts` (canonical); this is the vocabulary agents must use.

## Glossary

| Term | Definition (not: …) |
|---|---|
| **Media asset** | The imported file's metadata + handle. Not the decoded PCM. `kind` is `video` when the file has a decodable video track, else `audio`. |
| **Audio project** | A project whose asset is `kind:'audio'`. Same editing, transcription, translation and sidecar export as video; preview shows the visualizer; no burn-in exists. |
| **Visualizer** | Live rendering of the playing audio on the preview stage (default: FFT spectrum line). Decorative — never the source of timing. |
| **Media clock** | The single time source behind the playhead: the media element's clock or the decoded-audio `AudioContext` clock. |
| **PCM feed** | 16 kHz mono Float32 stream in 1-s batches (`PcmChunk`). Not a full-file buffer (forbidden for long media). |
| **Raw segment** | Engine output before blockization: `{start,end,text,words[],probability}`. Not user-visible. |
| **Caption block** ("block") | User-facing unit on the timeline + transcript row. Has stable `id`, words, speaker. Not a "subtitle line" (words, not lines, are the timing atoms). |
| **Word token** | Atomic timing unit: text + start/end (+ optional probability, speakerId, breakAfter). Never split by block operations. A text edit that turns one word into several splits its span proportionally by character count; joining two words takes the union of their spans. |
| **Manual line break** | `breakAfter: true` on a word (Shift+Enter). Not a token of its own — words stay the only timing atoms. |
| **Speaker** | Named, colored identity with stable `id` (`SPK_…`). Labels are cosmetic; ids are durable. "Speaker 1" is a label, never an id. |
| **Speaker assignment** | `word.speakerId` (truth) materialized onto `block.speakerId` by majority vote. Word-level truth, block-level display. |
| **Tier** | Runtime capability class T1–T4 (architecture) selecting engine+model+quality. Not a user subscription level (there is none). |
| **Device** | Inference backend `webgpu` \| `wasm`. A tier picks a device; never call a device a tier. |
| **Notice** | Coded, content-free user-facing message from the engine (`TIER_DOWNGRADE`, `MULTI_TRACK`…); UI owns the copy. |
| **Fingerprint** | `{name, size, durationMs, sampleHashes}` identifying a media file for re-linking without storing it. |
| **Project snapshot** | Immutable copy of a project taken when an export starts; edits after that never affect the export. |
| **Source track** | `project.blocks` — the captions in the media's spoken language, with words, timings and speakers. Every other track hangs off it. |
| **Translation track** | One `TranslationTrack` per target language: per-source-block translated text. Owns **no timing** — it always uses the source block's start/end. Not a second set of blocks. |
| **Stale translation** | An entry whose `sourceHash` no longer matches its source block's text (the source was edited, split or merged after translating). Shown, flagged, never silently retranslated. |
| **Caption import** | Creating or replacing a track from a user's caption file (SRT/VTT/SBV/TTML/ASS/JSON). Not "re-import of our export" only — any third-party file. |
| **Estimated timing** | Word times interpolated inside an imported cue (`word.timing = 'estimated'`). Cue start/end are the file's truth; word times are a guess until aligned. |
| **Align to audio** | Running ASR on the media and matching its timed words to existing caption text, transferring timings (`'aligned'`) without changing the text. |
| **QC issue** | A computed caption-quality finding (reading speed, line length, duration, stale translation…). Derived, never stored. |
| **Offline-ready** | A model (and its runtime wasm) fully cached and checksum-verified, so transcription works without network. |
| **Blockization** | Deterministic pure word→blocks grouping (gaps/punctuation/length policy). Not ASR segmentation. |
| **VAD segment** | Speech region from Silero. Feeds chunking, embeddings, blockization hints. Not a block. |
| **Project** | Persisted editor state (schema-versioned). Media bytes are NOT in the project (only handle/fingerprint + cached blob < 500 MB). |
| **Command** | One undoable mutation of editor state (split, merge, retime, edit-text, rename-speaker…). Not a keyboard shortcut (many commands, one keybinding). |
| **Loop region** | User in/out points; playback cycles; distinct from block bounds. |
| **Playhead** | Single global transport position in seconds. UI derives nothing else from video element time without arbitration (sync arbitrator decides). |

## Domain model (relationships)

```
Project 1—1 MediaAsset
Project 1—* CaptionBlock *—1 Speaker   (block.speakerId = majority of word.speakerId)
WordToken *—0..1 Speaker               (word.speakerId; absent until diarized or manually assigned)
CaptionBlock 1—* WordToken             (ordered, non-overlapping, within block bounds)
Project 1—1 CaptionStyle               (whole-project style in v1; per-block overrides = seed)
Project 1—* TranslationTrack           (≤ 1 per language; language ≠ project.language)
TranslationTrack 1—* TranslationEntry  (keyed by source CaptionBlock.id)
TranscriptionJob 1—* RawSegment        (ephemeral, worker-side until blockized)
DiarizationJob 1—* DiarFrame           (ephemeral; word-time → speaker probability)
```

## Invariants (property-test these; UI must never be able to violate them)

1. `0 ≤ word[i].start ≤ word[i].end ≤ word[i+1].start` within a block; blocks ordered & non-overlapping.
2. `block.text` == `words` joined with `' '`, using `'\n'` instead after a word with `breakAfter` (punctuation is part of the preceding word's text). v1 languages are space-delimited; CJK joining is out of scope.
3. Deleting all words deletes the block (no empty blocks persist).
4. Renaming a speaker never touches ids; deleting last block of a speaker does not delete the speaker (label reuse until project close).
5. `project.speakerSource = 'manual'` once any speaker mutation occurs — reverting auto is explicit only.
6. Times are seconds (float, rounded to 3 decimals on write); display formatting only at render/export edges.
7. Importing new media replaces the project's blocks/speakers after confirmation (no silent discard).
8. Autosave writes only when `updatedAt` changed; reload after save-restart reproduces a byte-equal project. "Byte-equal" means the **canonical serialization** (`state/services/serialize.ts`: sorted object keys, no `undefined`, numbers via the 3-decimal rule) — goldens compare that output.
9. Caption timing edits never move media. v1 has no media cutting: deleting a block leaves a gap (or, with "close gap", extends the neighbouring blocks); it never shifts later blocks in time.
10. Every `TranslationEntry` key resolves to an existing source block. Deleting a source block deletes its entries; **merge** concatenates the entries (space-joined) and marks the result stale; **split** keeps the entry on the first part and marks both parts stale (second part gets an empty stale entry). Retiming a source block never marks translations stale.
11. Import never violates invariants 1–4: overlapping cues are clamped (earlier cue ends at the later cue's start), zero/negative durations become 0.1 s, empty cues are dropped — each counted in the `ImportReport`, never silent.
12. Import preserves the file's cue segmentation and text exactly (after tag stripping); re-flowing into our block rules is a separate, undoable "Re-flow captions" command.

## Job lifecycles

```
Import:  idle → probing → decoding(peaks∥) → ready   | error(missing-media|decode|ffmpeg-required)
Transcribe: idle → loading-model → running(segments streaming) → done | cancelled(partial kept) | degraded(T2) | error
Diarize: idle → running → done | cancelled | error   (runnable concurrent with Transcribe)
Export:  idle → preparing → encoding(progress) → packaging → done(file saved) | cancelled | error(capability)
Caption import: idle → decoding-text → parsing → mapping(report) → confirm(replace source | add as translation | cancel) → done | error(unrecognized-format | encoding)
Align:   idle → transcribing(ASR, reuses Transcribe job) → matching → done(words aligned / unmatched kept estimated) | cancelled
Translate (per target language): unsupported | downloadable → (user gesture) downloading → ready → translating(progress) → done | partial(failed entries) | cancelled
Model:   absent → (confirm if > 100 MB) → downloading → verifying → compiling → ready | error(CACHE_CORRUPT → redownload once)
App:     online ⇄ offline   (orthogonal to all jobs; offline + model absent → OFFLINE_MODEL_MISSING notice, never a hang)
```

`transcribe` and `diarize` are separate jobs with separate cancel — users may accept transcript and re-run speakers only. Both consume one decode: the media worker tees identical PCM chunks to both ports.
