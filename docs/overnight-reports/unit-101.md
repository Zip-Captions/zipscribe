# Unit report: unit-101-workbench-shell

Status: complete

## Completion criteria (verify:unit --from-branch @ d7794c4)

| ID       | level                 | tests | result                                            |
| -------- | --------------------- | ----- | ------------------------------------------------- |
| CC-101.1 | untagged (L2+L5)      | 6     | pass                                              |
| CC-101.2 | untagged (L2+L5)      | 8     | pass                                              |
| CC-101.3 | untagged (L2)         | 13    | pass                                              |
| CC-101.4 | untagged (L2)         | 6     | pass                                              |
| CC-101.5 | untagged (L2+L5)      | 6     | pass                                              |
| CC-101.6 | [MANUAL] gate-derived | —     | owner: orchestrator BUILD_VERIFIED evidence below |

`[MANUAL]` (CC-101.6): orchestrator, 2026-11-04, chromium headless + node 22 — all gate commands exit 0 at d7794c4 (see Gates). Adjudicated gate-derived; circular as an automated test (gates-spawning-gates); same tag applies to the identical criterion in units 102–107.

## Gates

lint ✓ · typecheck ✓ · format:check ✓ · test ✓ (99 files, 796 passed | 1 skipped | 1 todo) · build+check-bundle ✓ (95.0 KB gzip / 350 KB) · test:e2e ✓ (89 passed incl. 6 workbench specs re-run at head; 21 skipped) · qual-check ACCEPT (contentHash ddafa57d, re-sign d7794c4, deep-compare pass) · `git status --porcelain --untracked-files=all` empty.

## Deviations from spec

- Contract-first per owner scope: caption-file intake goes through the injectable `ImportCaptionsService` seam (production provider = typed not-implemented until unit-07 PR #9 merges); no `src/engine/captions` import (unmerged). Test wiring: frozen fake importer + L5 `setCaptionImportOverride`.
- "fixtures never served" (US-2.0.2) honored as app-never-fetches-`/fixtures/` + `/samples/speech-2min.mp4` request assertion (preview server legitimately serves public/fixtures copies for L4 specs); sample copied to public/samples at build via `scripts/copy-samples.ts` (gitignored output).
- Resize drag physics asserted at the `setPanelSize` store seam (clamp+persist) + handle presence; pointer UX polish deferred (102+).
- Align-vs-Replace dispatches the same AsrRequest; distinction surfaced as `jobs.running.kind` per US-2.0.4 wording.

## Frozen-file adjudications (reviewers must re-verify)

1. `tests/unit/workbench/helpers/mount.tsx:15` fake-clock path `../../../`→`../../../../` (901528f).
2. `tests/unit/workbench/keyboard.test.tsx` user-event chords `{Alt>1/2/3}`→`{Alt>}1/2/3` (f843feb) — builder-verified `readNextDescriptor` `^>\d+` repeat semantics; intent = CC-101.5 chord.
3. `tests/unit/workbench/drop-zone.test.tsx:53-67` bind fake wrapper (`const fake = createFakeImportService()` → `fake.importCalls`) — frozen helper exposes `importCalls` only on the wrapper (cd6f842).
4. `tests/helpers/repo.ts` jsdom-safe REPO_ROOT (7da6601, ratified) — node-side path byte-identical, cwd fallback marker-validated.

## Adversarial (tests/unit/workbench/adversarial/**, additions-only)

11 findings, single fix cycle: jobId correlation on `job:segments`/`job:error` (SM.1–3), displaced-job cancel + Start double-fire (SM.4), settings upper bound + never-throws read (SET.2/SET.4), seam-rejection honesty + per-drop caption pairing + intake catch (IN.1–4/IN.9). 18 probes passed kill-checked. Full suite green incl. self-gates after re-sign.

## Contract changes

none (contracts matched byte-for-byte to tests/unit/workbench/unit101-api-contract.d.ts).

## Dependencies

zustand@5, immer, zundo@2, @tanstack/react-virtual, tailwindcss@4 (runtime); @testing-library/react, @testing-library/user-event, fake-indexeddb, @axe-core/playwright (dev). All settings.yml approved_dependencies.

## Measurements

CLS 0.000 (was 0.348 pre-fix) across 4 streamed job:segments batches; axe 0 critical/serious (accent contrast 3.2→4.7:1); initial JS 95.0 KB gzip; test:e2e full 24.9 min.

## Follow-ups

- Wire real `importCaptions` when unit-07 merges (single composition-root change in `src/app/ports.ts`).
- Tailwind v4 unwired (token CSS hand-rolled per design.md) — decide at 103/105 styling units.
- `isContentEditable` guard branch untestable under jsdom — add browser coverage with unit-102 editor (contenteditable lands there).
- `defaultModelForTier`/confirm-download surface extends per unit-102 EXTENDS clause.
