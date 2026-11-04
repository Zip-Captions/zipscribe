# Unit report: unit-102-editor-core-playback

Status: complete — **HITL CONTRACT FREEZE: merge flagged for morning review; merge commit is the designated revert point.**

## Completion criteria (verify:unit --from-branch @ 83c9624)

| ID       | level                          | tests | result                                                                   |
| -------- | ------------------------------ | ----- | ------------------------------------------------------------------------ |
| CC-102.1 | untagged (property, 500 cases) | 1     | pass                                                                     |
| CC-102.2 | untagged (L1 + L5 chromium)    | 3     | pass                                                                     |
| CC-102.3 | untagged (L1)                  | 22    | pass                                                                     |
| CC-102.4 | untagged (golden + property)   | 6     | pass                                                                     |
| CC-102.5 | untagged (L1 + lint)           | 3     | pass                                                                     |
| CC-102.6 | untagged (L5 chromium trace)   | 1     | pass                                                                     |
| CC-102.7 | `[MANUAL]` gate-derived        | —     | orchestrator BUILD_VERIFIED evidence below (unit-101 CC-101.6 precedent) |

## Gates

lint ✓ · typecheck ✓ · format:check ✓ · test ✓ (119 files, 955 passed \| 1 skipped \| 1 todo) · build+check-bundle ✓ (104.4 KB gzip / 350 KB) · test:e2e ✓ (95 passed incl. playback-sync + fps-10k; 24.6 min builder run @ slice D + full-suite CI re-coverage) · qual-check ACCEPT (contentHash e8683393, re-sign 83c9624, deep-compare) · porcelain empty.

## Deviations from spec

- `SyncArbitrator.clockTime()` extends FR-102.3's four members — mandated by the frozen test contract (`unit102-api-contract.d.ts`) and required so components never read `currentTime` (FR-102.3/CC-102.5 guard). architecture.md needs no change (arbitrator interface owned by this unit's CONTRACT.md/generated types).
- `jumpable:false` ≡ zundo 2.3.0 API absence (no jump API exists) — ASSUMPTION recorded in code.
- CS.3 fix located at arbitrator sampler, not media-clock.ts, because frozen `media-clock.test.ts:123` pins the detached-0 read; scenario satisfied exactly.
- Transport-bar, overlay, bridge-gate, media-clock L1 suites were builder-authored (my brief mis-cited a frozen transport-bar file that never existed); ALL independently ratified by test-author: 2 assertions rewritten as implementation-mirroring (spec-cited design.md:87/88), 19/19 mutation kill-map, rest ratified (ledger 2026-11-04T~16:4xZ).

## Frozen-file adjudications (reviewers must re-verify)

1. `active-word.test.ts:15` `activeWord(b,2)?.text` → `activeWord(b,2)` (`.toBeNull` kept; nullish-chain `?.text` can never be null) — ae57f8c.
2. `contract.test.ts:98` needles `SyncArbitrator`/`exportService` → lowercase (lowercased subject can never contain mixed-case; sibling assertions untouched) — a1de111.

## Adversarial (tests/unit/editor/adversarial/**, additions-only)

8 findings / 24 probes, single fix cycle: undo/redo mergeChain reset (CH.1), -0 normalization (CH.8), block-merge speakerId by word majority per domain.md §Speaker (CH.10), playhead duration cap (CS.2), detach playhead hold (CS.3), honest inverted-loop rejection (CS.7), overflow-safe round3 (CS.8), lint rule catches template-member currentTime form (CS.10). M1-M8 kill-map 24/24.

## Contract changes

None to architecture.md. Contract-freeze artifacts: `src/state/CONTRACT.md` + generated types (downstream 103–107 import types only).

## Dependencies

none added (zundo/immer/zustand installed at unit-101).

## Measurements

playback-fps-10k: 60.0 FPS, 151 frames, 0 drops >33 ms over 2.5 s with 10 000 virtualized blocks; loop wrap error 0.0 ms (±33 ms budget); initial JS 104.4 KB gzip; test:e2e 95 passed.

## Follow-ups

- Keyboard-allowlist eslint rule (unit-105 seed; noted in eslint.config.js).
- decoded-clock (unit-107) + Timeline/Transcript editors (103/105) against frozen CONTRACT.md.
- SSH key on this host rejected by GitHub — pushes via gh HTTPS helper (re-auth morning).
