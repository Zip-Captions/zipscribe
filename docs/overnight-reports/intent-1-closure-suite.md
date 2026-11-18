# Intent-1 closure suite report (Local Transcribe Engine)

Status: complete — orchestrator-implemented (flow doctrine [107-ADJ 17]) → verify:intent round 1: 9/11 (wrapping describes swallowed the new test-level citations — the [107-ADJ 25] `describe › test`-head rule re-learned) → round 2 commit (13 describe/gated() heads lead-cited) → **verify:intent exit 0, all 11 untagged pass** → PR #22 CI round 1 RED (retry-pass guard CC-01.12: `perf-10k-latency` p95 flake under the added 2-core CPU load — flake policy: fix, not re-roll) → whole-file serial worker mode for the real-whisper legs → CI round 2 **GREEN** (run 44350224169) → squash-merged as `13704e8`. Every gate tail re-run by the orchestrator.

## Completion criteria (`pnpm verify:intent local-transcribe-engine`; `reports/criteria/local-transcribe-engine.md`)

| ID       | level · evidence                                                                                                                                                                                                                                                                                                                              | tests | result |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| CC-I1.1  | untagged · NEW `tests/unit/engine/spike-report-anchor.test.ts`: committed spike JSON+md complete (per-tier WER/RTF/memory/word-timing on OK rows, both #1739 leak sides 3.8.1 vs 4.x measured, license statuses w/ no benchmark row for blocked-pending, recommendation ↔ shipped `TIER_DEFAULT_MODEL` w/ measured-row + registry resolution) | 4     | pass   |
| CC-I1.2  | `[RQ]` — reference-hardware qualify (owner ruling 2026-11-09)                                                                                                                                                                                                                                                                                 | —     | RQ     |
| CC-I1.3  | `[RQ]` — reference-hardware qualify (memory/GPU gates, same ruling)                                                                                                                                                                                                                                                                           | —     | RQ     |
| CC-I1.4  | untagged · leading-cited `worker-host.test.ts` cancel ≤ 2 s (partials kept, clean teardown, late window discarded) + branches cancel-in-handshake + dispose lifecycle                                                                                                                                                                         | 3     | pass   |
| CC-I1.5  | untagged · NEW e2e: `navigator.gpu` removed → production `probeDeviceCapability` self-selects T2/wasm (zero config) + tiny transcription completes; + capability.test T2 case (vitest backup)                                                                                                                                                 | 1     | pass   |
| CC-I1.6  | untagged · model-cache cache-hit ZERO-request route spy + scaffold network-audit ORT /wasm + zero-CDN production build                                                                                                                                                                                                                        | 1     | pass   |
| CC-I1.7  | untagged · accuracy-2spk 3-run median ≥ 85 % + assign renameSpeaker-everywhere / reassign-range (gated() head)                                                                                                                                                                                                                                | 2     | pass   |
| CC-I1.8  | untagged · NEW `tests/unit/engine/engine-coverage-gate.test.ts` (nested providers run, glue pair excluded per root block, 85/75 + json-summary + per-file 85 floor) + four existing coverage-gate suites head-cited                                                                                                                           | 6     | pass   |
| CC-I1.9  | untagged · NEW e2e m4a≡mp4 word/block parity ± 50 ms (fresh context per run) + probe kind:'audio' matrix + format-matrix native/fallback decode legs                                                                                                                                                                                          | 39    | pass   |
| CC-I1.10 | untagged · captions golden (all formats, byte-equal) + align text-unchanged property + align-mae ≤ 1.5× spike                                                                                                                                                                                                                                 | 19    | pass   |
| CC-I1.11 | untagged · models-fetch CLI drop-mid-fetch (citations moved to head) + manager-download NETWORK retryable / NO partial / retry-completes (describe head-cited)                                                                                                                                                                                | 7     | pass   |
| CC-I1.12 | untagged · model-cache offline+uncached → OFFLINE_MODEL_MISSING ≤ 1 s, zero fetches + manager-lifecycle seam case                                                                                                                                                                                                                             | 1     | pass   |
| CC-I1.13 | untagged · probe not-audio.mp3 → UNSUPPORTED_MEDIA, no asset/project (describe head-cited)                                                                                                                                                                                                                                                    | 20    | pass   |

`verify — all untagged criteria of intent.md covered (13 total)`, exit 0.

## Gates

- `lint` / `typecheck` / `format:check` → exit 0.
- `corepack pnpm test` → `Test Files 233 passed` / `Tests 1878 passed | 1 skipped | 1 todo` (skip pair = pre-existing [MANUAL] branch-protection awaits-org-plan pair, CC-01.13).
- `build && check-bundle` → 143.4 KB gzip / 350 KB.
- New e2e legs standalone green (1.7 m); accuracy-2spk + probe standalone 22 passed (1.1 m); format-matrix junit re-parse 18/18 CC-I1.9 credits all-pass.
- CI (final head, run 44350224169): quality + fixtures-verify + preview-deploy all success; zero retry-passes (guard exit-0).
- Qualification: no `src/**` bytes touched → record unchanged, `qualification-check: ACCEPT` re-verified pre-commit.

## Deviations

- **Harness extension** (`e2e/asr/fixtures/harness.ts`, e2e-owned): `autoTier` option (runs the production capability seam in-page) + additive `words`/`selectedTier`/`selectedDevice` summary fields — required to prove "auto-selects … with no user configuration" honestly rather than by injecting the tier.
- **Serial worker mode at file level** in the new spec: two concurrent whisper-tiny runs pushed `perf-10k-latency` p95 into a retry-pass on the 2-core runner (run 44344972278); flake policy honored with a fix (one live whisper burst from this file), not a re-roll. Local full `pnpm test`/verify unaffected.
- **Round-1 credit gap (9/11)**: test-level citation prefixes are invisible when a wrapping `describe`/`gated()` carries a different leading ID — fixed by head-prefixing the wrapping heads (assertion-preserving titles only), the [107-ADJ 25] lesson applied to describes this time.

## Follow-ups

- Reference-hardware qualify pass for CC-I1.2/CC-I1.3 at release (pre-existing [RQ] posture).
- Spike corpus remains PROVISIONAL (synthetic TTS ground truth) — owner fixture upgrade is the standing seed.
- Consider a dedicated `heavy` chromium project if further CPU-heavy intent specs tip perf-spec margins again (per-project scheduling is the sanctioned isolation, precedent: memory/drift).
