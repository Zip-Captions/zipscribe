# Unit report: unit-104-transcript-editor

Status: complete — builder slices A–D → adjudications (orchestrator) → adversary AUDIT (1 violation, left RED) → single in-build fix cycle (`48977a4`) → all gates re-run green at that head (this report). BUILD_VERIFIED / PR are orchestrator steps; every gate tail below was re-run by me at `48977a4`, not copied from builder claims. All process evidence: `docs/overnight-ledger.md` (entries 2026-11-12T00:49:39Z → `UNIT-104 AUDIT` 13:57Z → this fix+report entry).

## Completion criteria (`verify:unit --from-branch` at `48977a4`; paste of `reports/criteria/unit-104-transcript-editor.md`)

| ID       | level · evidence                                                                                                                                                                                                                                                                                                                                | tests | result |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| CC-104.1 | untagged · **L5** `e2e/transcript/perf-10k-scroll.spec.ts` — “wheel-scrolling 10k blocks holds ≥ 55 FPS and renders only a bounded window”                                                                                                                                                                                                      | 1     | pass   |
| CC-104.2 | untagged · L2 — word-click seek ≤ 1 frame + select; scroll-intent pause; edit-time viewport pin; follow-scroll positive control                                                                                                                                                                                                                 | 4     | pass   |
| CC-104.3 | untagged · L2 — dblclick→edit→Enter golden (equal-length byte-identical word times), Esc revert, blur commit, IME composition, paste sanitize, Shift+Enter break + 2 AUDIT timing pins                                                                                                                                                          | 6     | pass   |
| CC-104.4 | untagged · L1 **property** (`search-replace.property.test.ts`, fast-check seed 20261111, 150 runs) + L2 (debounce count, caseSensitive/wholeWord corpus, replace-all ONE step, F3/Shift+F3 cycling + closed-bar gate, zero-match no-op)                                                                                                         | 8     | pass   |
| CC-104.5 | untagged · L1+L2 — popover ops: rename, recolor, merge, split (`>= at` boundary), reassign paint, filter view-only, Beta-badge transition, ARIA row contract, rejections NO-step                                                                                                                                                                | 11    | pass   |
| CC-104.6 | untagged · **L5** `e2e/transcript/accessibility.spec.ts` — “axe critical == 0, rows reachable by Tab, visible focus ring, canary never in console”                                                                                                                                                                                              | 1     | pass   |
| CC-104.7 | untagged · **L5** `e2e/transcript/import-qc-flow.spec.ts` — drop `vendor.srt` → report → confirm → QC jump → retime +0.5 → align, each step ONE undo + L1 align-apply (matches/re-interpolate/out-of-bounds) + 2 AUDIT panel-wiring pins                                                                                                        | 1     | pass   |
| CC-104.8 | untagged · L1+L2 — close-gap collapse to `round3((prevEnd+nextStart)/2)`, neighbours meet, later blocks byte-identical, ONE step; `transcript-close-gap` click → command                                                                                                                                                                        | 2     | pass   |
| CC-104.9 | untagged · L1 anchor-test precedent (CC-101.6/CC-102.7 pattern) — **anchor:** `tests/unit/transcript/gates-anchor.test.ts` → “package.json declares every gate script”, “the initial-JS budget is the frozen 350 KB ceiling”, “verify-criteria + CI workflow + settings.yml gates exist; unit declares CC-104.1–9”; gate battery verbatim below | 3     | pass   |
| CC-06.4  | carried · L1 — `speaker-ops.test.ts` “CC-104.5 / CC-06.4: speaker-merge … ONE step, undo byte-equal” and “… speaker-split … ONE step, undo byte-equal”                                                                                                                                                                                          | 2     | pass   |

`verify — all untagged criteria of unit-104-transcript-editor.md covered (9 total)`, exit 0.
`[RQ]` / `[DEPLOY]` criteria: none declared in the unit file. `[MANUAL]` items: **none for unit-104** — CC-104.9 is the anchor-test precedent (name recorded above); the orchestrator appends the BUILD_VERIFIED evidence comment to its evidence block at gate time.

## Gates — battery re-run by me at `48977a4` (verbatim tails)

- `corepack pnpm lint` → `> eslint .` — exit 0.
- `corepack pnpm typecheck` → `tsc --noEmit -p tsconfig.json && …node… && …eval…` — exit 0.
- `corepack pnpm exec prettier --check .` → `All matched files use Prettier code style!` — exit 0.
- `corepack pnpm exec vitest run tests/unit/transcript` → `Test Files 13 passed (13)` / `Tests 79 passed (79)` — the adversarial file (RED at :115 at `c590215`) is GREEN: `vitest run tests/unit/transcript/adversarial/unit104-adversarial.test.tsx` → `Tests 38 passed (38)`.
- `corepack pnpm exec vitest run tests/unit/editor tests/unit/workbench` → `Test Files 29 passed (29)` / `Tests 216 passed (216)`. (Seeds file `src/state/commands/unit104-commands.test.ts` → `21 passed (21)`.)
- `corepack pnpm test` → `Test Files 188 passed (188)` / `Tests 1505 passed | 1 skipped | 1 todo (1507)` — exit 0. The five CC-02.5/CC-03.8 qualification reds self-resolved: the in-suite qualify leg RE-SIGNED the spike record per the unit-04 F-2 write-policy on the clean tree (JSON diff = `contentHash`+`startedAt` only, never results) → committed as `chore(qualify): re-sign spike qualification record for current contentHash`; `qualification/0.0.0-spike.json` now validates against this tree (previously stale since `bea3058`, proven red at `5e96b70`).
- `corepack pnpm test --coverage` → exit 0, zero “does not meet threshold” lines. `Coverage summary: Statements 95.54% (4349/4552) · Branches 90.34% (2331/2580) · Functions 96.99% (743/766) · Lines 98.42% (3756/3816)`. Directory rows incl. `engine/model 96.27 | 93.59 | 96.49 | 98.79`, `engine/captions 98.94 | 94.65 | 100 | 99.16`, `state 95.31 | 94.53 | 94.78 | 96.67`, `state/commands 90.19 | 82.53 | 99.15 | 99.32` — settings.yml engine 85/75 and src/state perFile ≥80 met. (One benign v8 note: `Failed to parse …/src/state/CONTRACT.md. Excluding it from coverage.`)
- `corepack pnpm build && corepack pnpm exec node scripts/check-bundle.mjs` → `assets/index-Bbsvplye.js 124.9 KB gzip` / `check-bundle: initial JS 124.9 KB gzip / budget 350 KB (1 chunks)` — exit 0.
- `corepack pnpm exec playwright test e2e/transcript --reporter=list` → `3 passed (27.6s)` (perf-10k 19.8s, accessibility, import-qc-flow).
- Adjacent sanity `corepack pnpm exec playwright test e2e/editor e2e/workbench e2e/timeline e2e/captions --reporter=list` → `20 passed (51.6s)` — unit-104 regressed nothing upstream.
- Test integrity: `git diff <unit-104 base>..HEAD -- tests e2e fixtures` contains ONLY the five orchestrator-adjudicated frozen-test amendments (99c7012/46455e3/5e96b70, citations in their commit messages) + the adversary’s NEW additive file `tests/unit/transcript/adversarial/unit104-adversarial.test.tsx` (38 tests, `c590215`). Zero builder/adversary edits to pre-existing frozen suites.

## Deviations from spec

- **US-2.1.7 word-range reassign “paint”** implemented as block-level `speaker-assign` only — the frozen acceptance shape omits word-range painting; adversary recorded it as an OBSERVATION (not test-pinned). Word-range paint → Follow-ups seed.
- **Add-as-translation** option in the import dialog is honestly DISABLED with code tooltip `TRANSLATION_TRACKS_INTENT_3_SCOPE` — translation tracks are Intent 4 scope.
- **Adjudicated contract rows** (orchestrator CONTRACT.md commits `a7725b5`/`1dfc6da`): close-gap delete meets at the gap MIDPOINT `round3((prevEnd+nextStart)/2)`; `captions-retime-all` gains optional `scale`+`anchorSec` (FR-104.8 stretch), `offsetSec`-only remains the plain-shift shape.
- **word-spans isomorphic-carry** (`2d2de09`): 1:1 equal-length edits carry per-word `[start,end]` byte-identically (the edit-preserves-timing golden) instead of re-deriving by character weight — a refinement ON TOP of the frozen rule, not a loosening.
- **Five frozen-test defect amendments** with citations (test-author commits `99c7012`, `46455e3`, `5e96b70`): getByTestId-multi, trailing-break vs invariant 2, getAllBy-empty, verbatim-replace oracle, retime-scale oracle anchor map (engine `retimeAll` formula is spec-of-record).
- **Builder `matchers.ts` + vitest `setupFiles` wiring** — zero new dependency (no package.json/lock change).
- **Overscan adjudication**: FR-104.2 overscan preserved at **6** (slice-B fix `5e6c915`-era entry 2026-11-12T05:05Z).
- **Adversary AUDIT fix (this cycle, `48977a4`)**: `replace-text` now DELETES blocks whose text is emptied to `''` — exactly the frozen `block-edit-text` delete path (invariant 3: no empty block persists; invariant-10 `TranslationRules.onBlockDelete` hook; `validateTranslationIntegrity` pre-check whose rejection discards the whole draft), still ONE command = ONE undo step; zero-matches remains mutation/step-free. Frozen property corpus verified compatible BEFORE fixing (PAIRS never generate `replacement:''` — no STOP).
- Slice-D runtime fixes surfaced by the frozen e2e (ledger 2026-11-12T05:40Z): selection-stable fixed-slot TimecodeInput (absolute layout — a dblclick’s second click never shifts off the word); `not-editing`-gated chords are left to the editing surface (Space typing); editor draft canonicalizes Chromium U+00A0; perf-seed speaker synthesis lives in the TEST bridge, never the strict reducer (`DANGLING_SPEAKER_REF` semantics intact, frozen CC-102.3).

## Contract changes

`src/state/CONTRACT.md` only — no `architecture.md` change needed (state-layer only): the two adjudicated rows (close-gap midpoint; retime-all scale/anchor) + four unit-104 EXTENDS commands (`speaker-merge`, `speaker-split`, `replace-text`, `captions-align-apply`, per unit-06 adjudication 3) + binding EXTENDS (search/qc chords, `search-open` when-gate) — `1dfc6da`/`a7725b5`.

## Dependencies

None beyond `settings.yml approved_dependencies`. Verified: `git diff origin/develop..HEAD -- package.json pnpm-lock.yaml` → **empty** (fast-check was already approved for unit-04 property suites).

## Measurements

- Perf scroll: **59.6 FPS** while wheel-scrolling 10k virtualized rows (floor 55); **renderedRows 30** during scroll (≤ 3×viewport cap 72, ≤ 200 absolute); seed `totalRows 10000`, bridge `issueCount 29999`.
- Bundle: initial JS **124.9 KB gzip** (budget 350 KB).
- Coverage: All files **95.54 / 90.34 / 96.99 / 98.42** (S/B/F/L), Lines 3756/3816, thresholds exit 0.
- Align flow: **5/7 words aligned (71%)** via the scripted-ASR frozen flow (toast observed verbatim: `aligned 5/7 words (71%)`, numbers-only per SECURITY-03).
- Undo discipline: import 2 steps (replace + speakers), defect edit 1, retime +0.5 1, fix edit 1, align apply 1 — `+5` exact vs baseline (frozen e2e); replace-all ONE step (property suite P3); close-gap ONE step.
- e2e: transcript 3/3 (27.6s), adjacent suites 20/20 (51.6s).

## Follow-ups

- **Word-range speaker reassign “paint”** (US-2.1.7 residual) — needs its own frozen acceptance shape; backlog seed.
- **`RetimeDialog` `RETIME_DEGENERATE` dead branch** — unreachable (`fromA===fromB` is pre-guarded as `RETIME_POINTS_INCOMPLETE`); either reach it (two-point where solveRetime itself returns degenerate) or drop the code.
- **`respanWords` drops the word `timing` provenance** on text edits (unit-102 surface, outside @104 scope) — seed for unit-105+ backlog.
- **Align toast copy review** — `aligned X/Y words (Z%)` numbers-only is honest but terse; UX pass at Intent-8 styling.
- Bridge-side speaker synthesis (perf seeding) is a TEST-bridge convenience; if a future product flow ever imports blocks without declaring speakers, the strict reducer rejection stays the contract.
