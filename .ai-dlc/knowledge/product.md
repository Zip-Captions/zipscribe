# Knowledge: Product

Business rules, personas, vocabulary of business, feature inventory. Domain vocabulary lives in `domain.md`.

## Product thesis

Zipscribe is the free, private, unlimited-length alternative to Descript/Clipchamp/CapCut captioning — trading "good enough" cloud ASR for "great + local" WebGPU ASR plus editor features the competitors verifiably lack (auto-diarization, transcript search, caption merge, real timing inputs). The privacy story (media never leaves the device) is a first-class selling point, not a footnote — and a technical constraint (SECURITY-03: transcripts never logged). Because everything is local, Zipscribe is also an **installable app that works offline** once its models are downloaded — something no cloud captioner can offer.

## Personas

| Persona | Job-to-be-done | Key features |
|---|---|---|
| **Creator Casey** (YouTuber, 1–3 videos/wk) | captions + stylized shorts fast, no subscription | transcript-first edit, style presets, MP4 burn-in, speaker badges for interviews |
| **Podcast editor Priya** | accurate multi-speaker transcripts for show notes + SRT | diarization beta + reassign, rename speakers globally, VTT/SRT/JSON export |
| **Localizer Lea** (freelance subtitler) | fix a client's existing SRT and deliver it in 3 languages | caption import, QC issues list, align-to-audio, retime-all (offset/stretch), translation tracks with side-by-side editing, per-language export |
| **Journalist Jonas** (interviews, sensitive sources) | local-only processing, verifiable privacy | zero uploads, model provenance panel, no telemetry |
| **HoH/Librarian Sam** (from zip-captions lineage) | searchable archive of meeting recordings | transcript search, JSON export, keyboard-only operation |

## Business rules

1. **Free core is permanent**: import → transcribe → edit → SRT/VTT/JSON export, no accounts, no watermark, no minute caps. Monetization (later, out of scope): premium models/styles only via explicit opt-in units.
2. **Privacy invariant** (SECURITY-03): no analytics/telemetry without a separate, default-off unit; transcript text never enters logs/error messages (mirrors zip-captions business-rules.md:30).
3. **Beta honesty**: diarization is labeled `beta` in UI until it reaches ≥ 85% per-word accuracy on a **real-world corpus** — owner-curated recordings with consent, evaluated offline by the unit-02 harness (no telemetry involved). Fixture-only passes don't lift the badge.
4. **Honest capability UX**: tier shown as chip (`GPU · CPU · Limited`, plus `Offline` when disconnected); users are never silently degraded — a one-line notice always names what changed and why.
5. **Unlimited means engineering-verified**: "unlimited length" claims require the 120-min gate; marketing copy may not exceed what tests prove.
6. **Offline after first visit**: once loaded, the app shell always opens offline; editing, sidecar export, burn-in and persistence never need the network; transcription/diarization need only models the user has already downloaded. Models are downloaded **only by explicit user action** (transcribe, or "Make available offline") — never prefetched in the background.
7. **Install is optional, never nagged**: one "Install app" entry in the header menu when the browser offers it; no interstitials or repeated banners.
8. **Bring your own captions**: any project can start from (or replace its source track with) an existing caption file. Zipscribe preserves the file's text and cue timing exactly and reports every adjustment it had to make; improvements (QC fixes, alignment, re-flow, retime) are explicit, undoable commands.
9. **Translation is on-device and labelled**: translations use the browser's on-device translator — no text leaves the machine. Machine translations carry a "Machine-translated" badge until a human edits them; the UI says plainly when the browser can't translate (Chrome/Edge desktop only in v1) and never offers a broken option.
10. **Audio is first-class**: every popular audio format imports, plays and transcribes (podcasts, voice memos, interviews). Audio projects get a live spectrum visualizer instead of video and export caption files; burn-in doesn't exist for them, so it's never shown.

## Competitive positioning (verified gaps to exploit)

| Feature | Clipchamp | CapCut Web | Zipscribe v1 |
|---|---|---|---|
| Transcription location | Azure (cloud) | cloud | **local WebGPU/WASM** |
| Minute/length caps | rate-limits, fail modes | 20-min quick tool | **none (engineering-gated)** |
| Auto diarization | ✗ (unverified) | ✗ (unverified) | **✓ beta** |
| Transcript search | ✗ documented | ✗ documented | **✓** |
| Caption merge shortcut | ✗ | drag only | **✓ Ctrl+Shift+M** |
| Timing numeric inputs | ✗ documented | ✗ documented | **✓** |
| Export | SRT only | SRT (unverified) | **SRT+VTT+JSON+MP4 burn-in** |
| Undo depth | 50 | — | **≥ 100** |
| Keyboard overlay | ✓ | ✗ | ✓ |
| Works offline / installable | ✗ (cloud ASR) | ✗ (cloud ASR) | **✓ PWA (after model download)** |
| Import existing caption file | (unverified) | (unverified) | **✓ SRT/VTT/SBV/TTML/ASS + align-to-audio** |
| Caption translation | (unverified) | cloud (unverified) | **✓ on-device, multi-language tracks (Chrome/Edge desktop)** |

## Feature inventory (v1 = intents 1–3) / Backlog seeds

v1: media import, caption-file import + QC + align-to-audio, language choice, transcribe, diarize-beta, transcript edit, timeline edit, translation tracks, styles, sidecar (per language) + MP4 export, autosave, shortcuts, installable offline PWA, deploy.
**Seeds (`.seed` candidates — capture revisit conditions when scoped):** hotwords/keyword biasing (B/C engines native; prior-art B-WER 18.4→4.5), translation fallback for non-Chromium browsers (transformers.js Opus-MT in a worker; CC-BY 4.0 — not NLLB, which is NC), per-translation-track retiming, bilingual stacked burn-in, MP4/MKV soft-subtitle tracks (multi-language, no re-encode), extracting embedded text subtitle tracks from MP4/MKV (mediabunny can't read subtitle tracks; ffmpeg.wasm path), SCC/CEA-608 import, caption-only projects (no media), live captions mode (streaming Zipformer path), multithreaded WASM tier + COOP/COEP experiment, share-links via file (project JSON + media hash), browser extension (screen-share capture), media library (multiple assets per project), WebM burn-in for Safari-26- (T3), true ripple delete with media cuts (EDL applied at export), per-block style overrides, `⌘K` command palette UI, Web Share Target (open media shared from other apps), window-controls-overlay title bar, model catalog.json remote updates (zip-captions catalog pattern).

## Success metrics (post-launch, anonymized-countable only if/when telemetry unit exists — else manual/PGS)

- ≥ 60% of imports reach an export (funnel health)
- median time-to-first-export < 15 min on 10-min media
- diarization rename/reassign usage rate (proxy for auto-quality)
- crash-free sessions ≥ 99% (error-only reporting, content-free)
