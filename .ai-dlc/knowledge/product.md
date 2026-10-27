# Knowledge: Product

Business rules, personas, vocabulary of business, feature inventory. Domain vocabulary lives in `domain.md`.

## Product thesis

Zipscribe is the free, private, unlimited-length alternative to Descript/Clipchamp/CapCut captioning — trading "good enough" cloud ASR for "great + local" WebGPU ASR plus editor features the competitors verifiably lack (auto-diarization, transcript search, caption merge, real timing inputs). The privacy story (media never leaves the device) is a first-class selling point, not a footnote — and a technical constraint (SECURITY-03: transcripts never logged).

## Personas

| Persona | Job-to-be-done | Key features |
|---|---|---|
| **Creator Casey** (YouTuber, 1–3 videos/wk) | captions + stylized shorts fast, no subscription | transcript-first edit, style presets, MP4 burn-in, speaker badges for interviews |
| **Podcast editor Priya** | accurate multi-speaker transcripts for show notes + SRT | diarization beta + reassign, rename speakers globally, VTT/SRT/JSON export |
| **Journalist Jonas** (interviews, sensitive sources) | local-only processing, verifiable privacy | zero uploads, model provenance panel, no telemetry |
| **HoH/Librarian Sam** (from zip-captions lineage) | searchable archive of meeting recordings | transcript search, JSON export, keyboard-only operation |

## Business rules

1. **Free core is permanent**: import → transcribe → edit → SRT/VTT/JSON export, no accounts, no watermark, no minute caps. Monetization (later, out of scope): premium models/styles only via explicit opt-in units.
2. **Privacy invariant** (SECURITY-03): no analytics/telemetry without a separate, default-off unit; transcript text never enters logs/error messages (mirrors zip-captions business-rules.md:30).
3. **Beta honesty**: diarization is labeled `beta` in UI until quality gates (≥ 85% 2-spk fixture accuracy) pass on **real-user corpus** (post-launch metric, not fixture-only).
4. **Honest capability UX**: tier shown as chip (`GPU · CPU · Limited`); users are never silently degraded — a one-line notice always names what changed and why.
5. **Unlimited means engineering-verified**: "unlimited length" claims require the 120-min gate; marketing copy may not exceed what tests prove.

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

## Feature inventory (v1 = intents 1–3) / Backlog seeds

v1: import, transcribe, diarize-beta, transcript edit, timeline edit, styles, export, autosave, shortcuts, deploy.
**Seeds (`.seed` candidates — capture revisit conditions when scoped):** hotwords/keyword biasing (B/C engines native; prior-art B-WER 18.4→4.5), translation (Chrome Translator API — zip-captions v1-proven web path), live captions mode (streaming Zipformer path), multithreaded WASM tier + COOP/COEP experiment, share-links via file (project JSON + media hash), browser extension (screen-share capture), media library (multiple assets per project), WebM burn-in for Safari-26-, model catalog.json remote updates (zip-captions catalog pattern).

## Success metrics (post-launch, anonymized-countable only if/when telemetry unit exists — else manual/PGS)

- ≥ 60% of imports reach an export (funnel health)
- median time-to-first-export < 15 min on 10-min media
- diarization rename/reassign usage rate (proxy for auto-quality)
- crash-free sessions ≥ 99% (error-only reporting, content-free)
