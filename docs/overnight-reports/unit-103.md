# Unit report: unit-103-timeline

Status: complete — test-author RED (b782a2b) → builder slices A–D → adjudications (1)–(9) → BUILD_VERIFIED (orchestrator re-ran every gate twice: at 1c1d793 and post-fix 968765c) → adversary round A (3 genuine findings, 39 survived) → single in-build fix cycle → AUDIT_CLEAN. All evidence in docs/overnight-ledger.md (entries 2026-11-09T21:15Z → 2026-11-10T01:20Z).

## Completion criteria (verify:unit --from-branch, final tree; paste of reports/criteria/unit-103-timeline.md)

| ID       | level                                   | tests | result                                       |
| -------- | --------------------------------------- | ----- | -------------------------------------------- |
| CC-103.1 | untagged (golden + hit-test parity)     | 23    | pass                                         |
| CC-103.2 | untagged (L1 + L5, one-undo-step)       | 16    | pass                                         |
| CC-103.3 | untagged (L1 constraints/snap)          | 11    | pass                                         |
| CC-103.4 | untagged (L5 chromium p95 sampler)      | 2     | pass                                         |
| CC-103.5 | untagged (L5 keyboard-only walkthrough) | 5     | pass                                         |
| CC-103.6 | `[MANUAL]` gate meta-criterion          | —     | NOT marked done — awaiting owner (see below) |

- `[RQ]` / `[DEPLOY]` criteria: none declared in the unit file.
- `[MANUAL]` items: **CC-103.6** “All gates green” — gate meta-criterion tagged `` `[MANUAL]` `` per CC-102.7/CC-101.6 precedent (gates-spawning-gates circularity; orchestrator spec-line edit, anchored in the unit file at BUILD_VERIFIED 1c1d793). **Awaiting owner** (per run-config, [MANUAL] items are NOT marked done): owner / merge-review date / chromium 143-tier reference machine / result — checklist = confirm the verbatim gate tails below.

## Gates — orchestrator BUILD_VERIFIED battery, re-run by me (not builder claims)

Rounds: battery #1 at 1c1d793 (pre-adversary), #2 at 968765c (post-fix-cycle), #3 at 8bba3ab/post-R2 a41e599 (head) — tails below verbatim from #2 (112.8 KB); head battery (ledger 2026-11-10T02:55Z + post-R2) reproduces identically at 112.9 KB (registry Ctrl rows +0.1 KB). Reviewer rounds 1–2 reproduced all gates independently at their heads.

- `corepack pnpm lint` → exit 0 (`eslint .` silent)
- `corepack pnpm typecheck` → exit 0 (tsconfig + .node + .eval)
- `corepack pnpm exec prettier --check .` → exit 0 (L0 CI step; 3 reds found at slice-D and fixed by orchestrator in 1c1d793 — formatting-only, word-diff proven: `src/state/CONTRACT.md` table reflow, `controller.ts`/`renderer.ts` chain wraps)
- `corepack pnpm test` → `Test Files 168 passed (168)` / `Tests 1334 passed | 1 skipped | 1 todo (1336)` exit 0 (163 pre-existing + timeline suites + adversary additions; `1 skipped`/`1 todo` are pre-existing baseline)
- `corepack pnpm test --coverage` (CI-authoritative) → `Statements 95.64% (3668/3835) · Branches 89.78% (2012/2241) · Functions 97.7% (639/654) · Lines 98.83% (3210/3248)` exit 0, zero "does not meet" lines (engine 85/75, state 80 thresholds enforced)
- `corepack pnpm build && corepack pnpm check-bundle` → `assets/index-….js 112.8 KB gzip` / `check-bundle: initial JS 112.8 KB gzip / budget 350 KB (1 chunks)` exit 0 (Timeline mount = +8.4 KB over pre-unit 104.4 KB; bridge behind lazy ?ziptest=1)
- `corepack pnpm exec playwright test --project=chromium` → `102 passed · 21 skipped (2.6m)` exit 0 — CI-authoritative e2e phase (memory project = reference-hardware qualify per owner ruling ledger 2026-11-09T17:05Z; webkit = view tier, not in CI — same gate practice as unit-101/102). Includes e2e/timeline 7/7.
- `corepack pnpm verify:unit --from-branch` → all 5 untagged criteria covered, exit 0 (table above)
- Qualification: record re-signed LAST (nested gates re-signed post-format commit; fixer re-signed at a92ce9b post-fix) → `node scripts/qualification-check.ts` → `ACCEPT — qualification/0.0.0-spike.json valid for contentHash 1231fa0a2897…`; deep JSON-diff vs HEAD = `['contentHash','startedAt']` only (both re-signs).
- Test integrity: `git diff b782a2b..HEAD -- tests/unit/timeline e2e/timeline fixtures/golden/timeline` = the 3 orchestrator-adjudicated edits ONLY (hittest:45 `?.id` drop — adjudication 7; constraints:89 → `toBe(3.543)` — adjudication 9; d.ts split-rule header correction — adjudication 8c) + adversary NEW files (additions-only, `tests/unit/timeline/adversarial/**`). Zero builder test edits; zero builder-authored suites (ratification pass N/A, recorded).

## Device (chromium headless, production `vite preview`, 1280×720)

Keyboard-only walkthrough (CC-103.5, OBSERVED via spec): Alt+3 focuses the timeline section → arrow-walk moves `focusedBlockId` (blk_v1) → Enter selects and the live region announces the block text; S splits the focused block at the playhead in one step (4→6 blocks); Ctrl+Shift+M merges adjacent selection (→ blk_m1, wordCount 4); held-letter chords Z+← / C+→ trim the focused edge to the playhead (4.00 / 4.55, wordCount 3); ⌘= / ⌘− / ⌘0 zoom in / out / fit-to-content (t0→0).

## Deviations from spec

- **Content-sized canvas**: the canvas is `position:absolute` inside a clipping `.tl-lanes` host, CSS width = duration×pxPerSec clamped by BACKING_STORE_MAX_PX 32 000/dpr; draw model `(t−t0)·pps` unchanged, renderer untouched. Required by the frozen perf spec's blockClick geometry (block width ≥1.5 px **and** click x ≤ box.width−40 for mids to 45.46 s ⇒ the canvas box must be content width; a viewport-sized box is arithmetically infeasible).
- **Production default viewport 200 px/s** (d.ts leaves the default free; L2 pins pass explicit viewports). ≥1.5 px/block at the 10 ms 10k-block density — the frozen perf floor — while the fit command still yields content-fit zoom.
- **Viewport-path work for measurable input→state round-trips**: backing-store re-derivation on every viewport change + a `flushSync` panel re-render (the app's established flushSync-on-notify store→React doctrine). `performance.now()` on the preview page is clock-clamped (~100 µs, non-cross-origin-isolated — probe-verified); an O(1) pan chain measures as exact 0 and the frozen spec’s `every(v > 0)` non-vacuity guard (rightly) rejects it. All counted samples now measure real work with 3–30× p95 headroom.
- **`window.tl` page accessor** installed inside `installTimelineBridge()` (sibling of the specs’ own `window.__zipPerf` pattern; ziptest-only, production never loads the bridge chunk). Playwright does not serialize Node-side closures — probe evidence in `.night/closure-probe.mjs` — the frozen spec invokes `tl()` in-page.
- Robustness for frozen L1/L2/jsdom paths: `setPointerCapture` try/catch (synthetic pointerId NotFoundError), null-2D-context tolerance (transport-bar test mounts the panel in jsdom).
- Interaction wiring (frozen contract silent on input plumbing): non-passive wheel (**Ctrl+wheel / trackpad pinch** = anchor-at-cursor zoom — design.md's `⌘+wheel` is reserved by Chromium page-zoom and uncapturable, so ctrlKey/pinch is the wired equivalent, named per PR#13 F4; the frozen perf spec dispatches `ctrlKey: true`), plain wheel = pan, ruler click = seek, ruler drag = playhead scrub (begin/drag/end), `rafs` exposed on `AppContext`, third lazy bridge in `App` under `?ziptest=1`, Workbench mounts the panel when `transport.rafs && currentProject !== null` (placeholder text preserved otherwise).
- Zoom bindings registered with BOTH `Meta` and `Ctrl` spellings (design.md:73 platform rule + merge precedent; frozen d.ts re-frozen in lockstep — orchestrator adjudication 10, PR#13 F2).

## Contract changes

- `src/state/CONTRACT.md` `block-split` row EXPANDED (orchestrator edit b116938, adjudication 8a): the straddler side (nearer-midpoint, ties→first, clamped, `SPLIT_EMPTY_PART` retained) is now EXPLICIT. The row was previously silent on the side — this PINS, not changes, the frozen shape; unit-102's spec never mentioned straddlers (grep-verified), the retired all-straddlers-right behavior was an impl choice pinned by two unit-102 tests (re-anchored intent-preservingly via test-author adjudication execution, ledger 23:05Z with evidence). Downstream (104/105) read the rule from the row + generated types unchanged.
- No `architecture.md` edits needed (no contract TYPE touched; `parseTimecode` ms option is additive in `src/ui/format.ts`, frozen tenths default intact — adjudication 1).
- Frozen-file edits this unit — ALL via orchestrator spec-line adjudication, executed by the TEST-AUTHOR session, ledger-recorded (exceptions #7–#12 territory; precedents on record): `tests/unit/timeline/hittest.test.ts:45` (assertion-mechanism defect), `tests/unit/timeline/constraints.test.ts:89` (tolerance-boundary defect → exact deterministic write), `tests/unit/timeline/unit103-api-contract.d.ts` (header claim corrected), `tests/unit/editor/commands-reducer.test.ts` + `tests/unit/editor/adversarial/command-history-adversarial.test.ts` (block-split reject cases re-anchored to a genuinely-emptying split `blk_b@3.05`; CH.6 0.7/1.0 → legitimate accepts w/ invariant checks + reject coverage preserved via 3.05).
- `.ai-dlc/caption-studio-ui/unit-103-timeline.md`: status flip (orchestrator-owned) + CC-103.6 `[MANUAL]` tag (precedent CC-101.6/CC-102.7).

## Dependencies

None added.

## Measurements

- Input→state latency, 10k blocks (probe, production build, chromium — same sampling as the frozen spec): wheelPan p50 ≈ 0.2 ms / p95 < 1.0 ms; zoom-key p50 ≈ 1.6 / p95 ≈ 2.5 ms; wheel-zoom (Ctrl+wheel/pinch) p50 ≈ 1.2 / p95 ≈ 1.3 ms; ruler-click, block-click, playhead-scrub: spec-asserted (all counted samples > 0, p95 < 16 ms). Clock caveat above. Gate: every action class p95 < 16 ms with ≥ 6× headroom.
- Initial JS **112.8 KB gzip** final (budget 350 KB; +8.4 KB over pre-unit 104.4 KB); full-suite wall 274.7 s; coverage 95.64 % stmt / 89.78 % branch (enforced); chromium e2e phase 102 passed / 21 skipped in 2.6 m.
- Hit-test index: O(log n + k) query verified at 10k with duplicate starts + reversed insertion (adversary TL.13).

## Follow-ups

- Waveform lane: 48 px reserved, `waveform: []` — PeaksData wiring is outside the frozen slice surface (needs decode seam; unit-107 adjacency).
- Renderer culls no blocks (full content canvas repaint per dirty frame — spec-budget-compliant at 10k, revisit with waveform + real media).
- `window.tl` accessor could move behind the same `?ziptest=1` query guard at module load rather than call-site (already only reached via the lazy bridge chunk).
- Bridge could expose viewport for future `timeAtX` fuzz specs (kept numbers-only per SECURITY-03).
- Vitest coverage `include` (`src/**`) hands `src/state/CONTRACT.md` to rollup → benign `PARSE_ERROR … Excluding it from coverage` log noise in the authoritative CI coverage run; narrow to `src/**/*.{ts,tsx}` in a follow-up (unit-01-owned config; PR#13 F5).

## Adversary round (AUDIT_CLEAN)

Round A (adversary 5fa9a83) → fix cycle A. All three findings adjudicated REAL;
fixed in-build with zero test edits (the three KNOWN VIOLATION proofs turn green
via implementation; `git diff 5fa9a83..HEAD -- tests/unit/timeline e2e/timeline
fixtures/golden/timeline` empty).

- **F1 (TL.15, dispatched-edge adjacency floor)** — fixed, `62b969b`.
  `controller.ts` endDrag re-derives the adjacency clamps from the CURRENT block
  set before dispatch (`reClampToFinalGeometry`): gesture-side clamping dispatches
  the clamped value (ghost 5.95 against re-timed neighbour 5.98 → dispatched
  5.93, gap = 0.05 ≥ ADJACENCY_MIN_GAP_SEC). d.ts § controller:376-378 honoured;
  the stale ghost stays legal (d.ts pins the DISPATCHED value, not the ghost).
- **F2 (TL.16, same class, body side)** — fixed, `62b969b`. Body-drag floor/
  ceiling re-derived at dispatch against final neighbour geometry (prev.end
  2.03 → dispatched start 2.08, gap = 0.05). The impossible-clamp case
  (clamp would reverse the gesture / neighbour inside the block's span)
  command-rejects `BLOCKS_OVERLAP` without dispatching — which also keeps the
  frozen TL.18 split-mid-drag expectation (reject + store untouched) green.
- **F3 (TL.40, timeline bindings leaking into editing focus)** — fixed,
  `239108e`. `useCommands` onKeyDown suppresses `timeline.*` binding dispatch
  while the frozen `isEditing()` predicate is true — before `preventDefault`,
  so the caret key reaches the input (TL.40 `defaultPrevented === false` pin).
  Doctrine from design.md § Keyboard shortcuts:104 enforced at the dispatch
  layer where the `not-editing` guard lives; the frozen binding table and
  registry untouched; save/undo/overlay unaffected (not `timeline.*`).

Gates after fixes: targeted `vitest run tests/unit/timeline` 101/101 (98+3);
full `pnpm test` 1334 passed / 1 skipped / 1 todo; lint 0; typecheck 0;
build+check-bundle 112.8 KB gzip (≤ 350 KB); `pnpm qualify` + `qualification-check`
ACCEPT, record deep-diff = contentHash+startedAt only (`a92ce9b`).

## Review round 1 (PR #13 — CHANGES_REQUESTED → fixed)

Fresh-context reviewer (worktree `.night/review-pr13`, read-only, removed clean;
full report posted: PR #13 comment 6761043954). Per-criterion verdicts all
SATISFIED; independent coverage re-run green; independent contentHash recompute
matched; 5/5 kill-checks (incl. both adversary-proof classes) turned red on
defect re-introduction. Findings and dispositions:

| #   | Sev    | Disposition                                                                                                                                                                                                                                                                                          |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | HIGH   | prettier red at f22353d (criteria-table padding from my report finalization — battery had been run at 968765c; my miss). Fixed `49578db` (`prettier --write` on the report only).                                                                                                                    |
| F2  | MEDIUM | zoom bindings Meta-only vs design.md:73 "Ctrl elsewhere" + merge precedent. Orchestrator adjudication 10: Ctrl spellings added — d.ts table re-frozen by test-author `bd0419d`, registry rows by fixer `32817ad` (table-driven `resolveBinding`, no aliasing logic; same ids).                       |
| F3  | MEDIUM | design.md keyboard table stale (FR-103.7 focus/Enter rows). Knowledge-owner edit (this report's commit): rows added for `←/→` block focus + `Enter` toggle; zoom row updated with Ctrl spellings; `⌘+wheel` row corrected to `Ctrl+wheel` (F4) — keeps unit-105's registry-vs-table snapshot honest. |
| F4  | LOW    | Report/PR claimed "⌘+wheel"; impl is Ctrl+wheel/pinch (Chromium reserves ⌘+wheel). Named in Deviations above + design.md row corrected.                                                                                                                                                              |
| F5  | LOW    | Coverage `include` parse-noise on CONTRACT.md — follow-up seed above (unit-01 config).                                                                                                                                                                                                               |

Reviewer verified the six frozen-file edits real (adjudications 7–10), the
re-anchored unit-102 pins load-bearing, and the AUDIT_CLEAN fixes
implementation-side.

### Round 2 (d85d91b — CHANGES_REQUESTED → fixed)

F1/F3/F4/F5 confirmed FIXED; F2 PARTIAL — new findings, both closed:

- **NEW-1 (MED)**: the frozen table-test (`keyboard-live-region.test.tsx`
  `expected[]`, which declares the d.ts EXTENDS table as its source) had not
  tracked the adjudication-10 re-freeze — deleting any Ctrl zoom row kept all
  gates green. Orchestrator adjudication 11 (mechanical consequence of 10),
  test-author executed `e2432d8`: three rows added; kill-check now red on
  `'Ctrl+='` deletion (`binding timeline.zoom-in Ctrl+=: expected undefined
to be defined`) — load-bearing, matching Meta control.
- **NEW-2 (LOW)**: `Timeline.tsx:41/:351` comments still said "⌘+wheel" —
  comment-only rename to Ctrl+wheel/pinch `5b8eae9` (zero code lines;
  frozen perf-spec titles left as name-only artifacts per reviewer).

Post-R2 battery (orch, a41e599): lint 0 · typecheck 0 · prettier 0 · test
1334/1/1 · build 112.9 KB/350 · verify:unit ✓ · re-sign `a41e599`
(contentHash `f9525b43bc20…`, deterministic startedAt per tree — `pnpm test`
regenerates the identical record via the unit-02 qualify-runner contract
test; record↔tree validity additionally carried by the 4 model-eval tests
in every full run) → `qualification-check` ACCEPT.
