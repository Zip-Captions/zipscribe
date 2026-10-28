---
status: pending
discipline: dev
depends_on: [unit-01-scaffold-quality-gates, unit-05-transcription-pipeline]
workflow: tdd
mode: AHOTL   # parsers + pure transforms with strong goldens; alignment is the only judgement call
---

# Unit 07: Caption Import, QC & Align-to-Audio

## Description

Let users bring their own captions. Pure, main-thread engine code that turns a third-party caption file (SRT, WebVTT, SBV, TTML/DFXP, ASS/SSA, Zipscribe JSON) into a source track or a translation track, with an honest `ImportReport`; estimates word timings inside imported cues; aligns caption text to the media's audio using ASR word timings; computes caption-quality (QC) issues; and provides whole-track retiming (offset / stretch). The parsers are also the round-trip half of unit-202's serializers. UI surfaces live in `caption-studio-ui` (unit-101 import flow, unit-104 QC + tools).

## User Stories

**US-07.1** As an editor with an existing caption file, I import it next to my video and start fixing instead of re-transcribing.
- *Given* a media project and `fixtures/captions/vendor.srt` (Windows-1252, CRLF, `<i>` tags), *when* imported as the source track, *then* blocks match the file's cues 1:1 in count, start/end (± 1 ms) and text (tags stripped, line breaks kept as `breakAfter`), `captionOrigin = 'imported'`, and the `ImportReport` lists `TAGS_STRIPPED` with the count.
- *Given* a WebVTT file with `<v Alex>` voice spans, `NOTE`/`STYLE`/`REGION` blocks and cue settings, *when* imported, *then* voices become speakers (`Alex` label, stable new ids, `speakerSource:'manual'`), comment/style/region blocks are ignored, cue positioning is reported as `POSITION_DROPPED`.
- *Given* SBV (YouTube), TTML/DFXP (text profile) and ASS/SSA (`Dialogue:` lines, override tags `{\...}` stripped) fixtures, *when* imported, *then* each passes its golden.
- *Given* overlapping, zero-duration or empty cues, *when* imported, *then* they are clamped/fixed/dropped per domain invariant 11 and each fix is counted in the report.
- *Given* a file in an unrecognized format or undecodable bytes, *when* imported, *then* a typed error (`UNRECOGNIZED_FORMAT` / `ENCODING`) — no partial project change.

**US-07.2** As an editor, I see what language the file is in.
- *Given* a caption file with no language metadata, *when* imported on a browser exposing `LanguageDetector`, *then* `detectedLanguage` is set from a sample of cue text (detection runs on the main thread, ≤ 2 KB sample) and the import dialog pre-selects it; without the API, the dialog asks.

**US-07.3** As an editor, imported word timings are useful immediately and exact on request.
- *Given* an imported cue, *when* blocks are created, *then* word times are estimated by character weight inside the cue (punctuation adds a short pause weight) and `word.timing = 'estimated'`.
- *Given* "Align to audio" on a project with imported captions, *when* run, *then* the media is transcribed with the project language (reusing the unit-05 job), ASR words are matched to caption words (normalized-token global alignment, e.g. Needleman–Wunsch with a Whisper-normalizer cost), matched words get ASR times (`'aligned'`), unmatched words are re-interpolated between aligned neighbours and stay `'estimated'`; **text and cue count never change**; one undo step; report gives % words aligned.
- *Given* the `en-clean` fixtures with their reference captions imported, *when* aligned, *then* `wordTimingMAEms` is within 1.5× of direct-transcription MAE (unit-02 baseline).

**US-07.4** As an editor, I can fix global sync problems in one go.
- *Given* `retimeAll(project, { offsetSec, scale, anchorSec })`, *when* applied, *then* every block and word time maps `t → anchor + (t − anchor) × scale + offset`, clamped to media duration, one undo step (fixes constant offsets and 23.976↔25 fps drift).
- *Given* two-point sync (pick a block, type its correct time; pick another, type its time), *when* applied, *then* `offset` and `scale` are solved from the two points.

**US-07.5** As an editor, I see what's wrong with my captions.
- *Given* any project, *when* `checkCaptions(project, rules)` runs, *then* it returns `QcIssue[]` for: reading speed > 20 CPS (`CPS_HIGH`), line > 42 chars (`LINE_TOO_LONG`), > `maxLinesPerBlock` lines, duration < 0.7 s / > 7 s, gap < 2 frames between blocks (`GAP_TINY`), block outside media duration, and for each translation track `TRANSLATION_STALE` / `TRANSLATION_MISSING`. Thresholds are settings with these defaults; pure and incremental (≤ 5 ms for a 1-block change in a 10 000-block project).
- *Given* "Re-flow captions" on imported blocks, *when* applied, *then* blocks are rebuilt with unit-05 `blockize` from their words (keeping speakers and word timings), one undo step, and translations on re-flowed blocks become stale.

## Functional Requirements

- **FR-07.1** `engine/captions/decode-text.ts`: BOM sniff (UTF-8, UTF-16LE/BE) → strict UTF-8 → windows-1252 fallback; encoding reported; user override re-decodes.
- **FR-07.2** `engine/captions/parse/*.ts`: one pure parser per format → `ParsedCue { start, end, text, voice?: string, lines: string[] }[]` + format metadata (language if declared: VTT `Language:` header / TTML `xml:lang`). Format detection by content sniff, extension only as tie-breaker. Timestamp grammars per spec (SRT `HH:MM:SS,mmm`, VTT `[HH:]MM:SS.mmm`, SBV `H:MM:SS.mmm`, TTML clock/offset times incl. `ttp:frameRate`, ASS `H:MM:SS.cc`).
- **FR-07.3** `engine/captions/import.ts`: `importCaptions(project, file, { as: 'source' | { translation: lang }, encoding? }) → { project, report }`. As **source**: replaces `blocks`, speakers from voices, keeps existing translations only if the user confirms (they'd all become stale/unmatched). As **translation**: each cue maps to the source block with maximum time overlap; several cues on one block are space-joined; cues overlapping no block are dropped and counted (`CUE_UNMATCHED`); `origin:'imported'`, status `'edited'` (human-authored).
- **FR-07.4** `estimate-timing.ts`, `align.ts`, `retime.ts`, `qc.ts`: pure functions as in the stories; `align.ts` takes ASR words as input (no SDK imports) so it's unit-testable with fixtures.
- **FR-07.5** Speaker-prefix heuristic: lines starting `[Name]:` / `NAME:` / `- ` dialogue dashes are offered (checkbox in the dialog, default on when ≥ 30% of cues match) as speaker labels and stripped from text.
- **FR-07.6** SECURITY-03: caption text is user content — never logged, never in error `detail`; parse errors carry line numbers only.
- **FR-07.7** Size guard: files > 20 MB or > 100 000 cues are rejected with a clear error (no main-thread hang); parsing yields to the event loop every 2 000 cues.

## Technical Specification

- Paths per `knowledge/architecture.md` module map (`src/engine/captions/**`); types `CaptionFormat`, `ImportReport`, `QcIssue` from the architecture block.
- Fixtures: `fixtures/captions/` — one small file per format + edge cases (CRLF, BOM, UTF-16, cp1252 accents, RTL Arabic, overlapping cues, `<v>`, ASS override tags, TTML with `ttp:frameRate`), each with a golden `*.expected.json` of resulting blocks/report. Third-party samples must be self-authored or CC0.

## Completion Criteria

- [ ] **CC-07.1** Goldens pass for every format and edge-case fixture (blocks + report byte-equal via canonical serialization)
- [ ] **CC-07.2** Property test: `parse(serialize(project, fmt))` round-trips text exactly and times ± 1 ms for SRT/VTT/SBV/TTML (serializers from unit-202 stubbed by minimal writers until 202 lands, then swapped)
- [ ] **CC-07.3** Alignment: `en-clean` MAE within 1.5× of direct ASR; text and cue count unchanged (property test with perturbed timings)
- [ ] **CC-07.4** `retimeAll` + two-point solve unit-tested incl. clamping at media bounds
- [ ] **CC-07.5** QC rules unit-tested per code; incremental check ≤ 5 ms on 10 000 blocks (benchmark)
- [ ] **CC-07.6** Malformed/oversized input → typed errors, project unchanged; redaction test (no cue text in errors)
- [ ] **CC-07.7** Coverage ≥ 85% on `engine/captions/**`

## Risks

- **Format long tail** (TTML profiles, ASS karaoke tags, VTT inline timestamps `<00:00:01.000>`): v1 keeps text and cue timing, drops styling, and reports it. VTT inline timestamps, when present, seed word timings (`'aligned'`) — cheap win.
- **Alignment on loose captions** (vendor captions often paraphrase): unmatched words stay estimated; report % aligned so the user knows.
- **LanguageDetector availability** is Chrome/Edge desktop only — dialog must work without it.

## Boundaries

- Import dialog, QC panel, retime tool UI: `caption-studio-ui/unit-101`, `unit-104`. Translation-track editing: `caption-translation/unit-302`.
- Embedded subtitle tracks inside MP4/MKV, SCC/CEA-608, image-based subtitles: seeds (`knowledge/product.md`).

## Docs to consult

- WebVTT spec: https://www.w3.org/TR/webvtt1/ · TTML2: https://www.w3.org/TR/ttml2/ · SRT de-facto grammar (no formal spec — test against real-world samples) · ASS format: http://www.tcax.org/docs/ass-specs.htm (verify)
- MDN `LanguageDetector`; docs-mcp `chrome-built-in-ai` → language-detection
