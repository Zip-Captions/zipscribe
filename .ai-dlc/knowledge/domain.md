# Knowledge: Domain

Ubiquitous language and domain model (entities/relationships/invariants). Code types live in `src/engine/model.ts` (canonical); this is the vocabulary agents must use.

## Glossary

| Term | Definition (not: …) |
|---|---|
| **Media asset** | The imported file's metadata + handle. Not the decoded PCM. |
| **PCM feed** | 16 kHz mono Float32 stream in 1-s batches (`PcmChunk`). Not a full-file buffer (forbidden for long media). |
| **Raw segment** | Engine output before blockization: `{start,end,text,words[],probability}`. Not user-visible. |
| **Caption block** ("block") | User-facing unit on the timeline + transcript row. Has stable `id`, words, speaker. Not a "subtitle line" (words, not lines, are the timing atoms). |
| **Word token** | Atomic timing unit: text + start/end + probability. Words are never split; merges produce new text, timings interpolate. |
| **Speaker** | Named, colored identity with stable `id` (`SPK_…`). Labels are cosmetic; ids are durable. "Speaker 1" is a label, never an id. |
| **Speaker assignment** | Word→speaker mapping materialized onto blocks by majority vote. Word-level truth, block-level display. |
| **Tier** | Runtime capability class T1–T4 (architecture) selecting engine+model+quality. Not a user subscription level (there is none). |
| **Blockization** | Deterministic pure word→blocks grouping (gaps/punctuation/length policy). Not ASR segmentation. |
| **VAD segment** | Speech region from Silero. Feeds chunking, embeddings, blockization hints. Not a block. |
| **Project** | Persisted editor state (schema-versioned). Media bytes are NOT in the project (only handle/fingerprint + cached blob < 500 MB). |
| **Command** | One undoable mutation of editor state (split, merge, retime, edit-text, rename-speaker…). Not a keyboard shortcut (many commands, one keybinding). |
| **Loop region** | User in/out points; playback cycles; distinct from block bounds. |
| **Playhead** | Single global transport position in seconds. UI derives nothing else from video element time without arbitration (sync arbitrator decides). |

## Domain model (relationships)

```
Project 1—1 MediaAsset
Project 1—* CaptionBlock *—1 Speaker   (speakerId; Speaker 1—* WordToken via majority display)
CaptionBlock 1—* WordToken             (ordered, non-overlapping, within block bounds)
Project 1—1 CaptionStyle               (whole-project style in v1; per-block overrides = seed)
TranscriptionJob 1—* RawSegment        (ephemeral, worker-side until blockized)
DiarizationJob 1—* DiarFrame           (ephemeral; word-time → speaker probability)
```

## Invariants (property-test these; UI must never be able to violate them)

1. `0 ≤ word[i].start ≤ word[i].end ≤ word[i+1].start` within a block; blocks ordered & non-overlapping.
2. `block.text` == concatenation of visible word texts (punctuation attached to preceding word token).
3. Deleting all words deletes the block (no empty blocks persist).
4. Renaming a speaker never touches ids; deleting last block of a speaker does not delete the speaker (label reuse until project close).
5. `project.speakerSource = 'manual'` once any speaker mutation occurs — reverting auto is explicit only.
6. Times are seconds (float, 3-decimal precision ceiling); display formatting only at render/export edges.
7. Importing new media replaces the project's blocks/speakers after confirmation (no silent discard).
8. Autosave writes only when `updatedAt` changed; reload after save-restart reproduces byte-equal project (golden).

## Job lifecycles

```
Import:  idle → probing → decoding(peaks∥) → ready   | error(missing-media|decode|ffmpeg-required)
Transcribe: idle → loading-model → running(segments streaming) → done | cancelled(partial kept) | degraded(T2) | error
Diarize: idle → running → done | cancelled | error   (runnable concurrent with Transcribe)
Export:  idle → preparing → encoding(progress) → packaging → done(file saved) | cancelled | error(capability)
```

`transcribe` and `diarize` are separate jobs with separate cancel — users may accept transcript and re-run speakers only.
