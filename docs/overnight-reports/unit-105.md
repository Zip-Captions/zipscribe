# Unit report: unit-105-command-system

Status: complete — test-author RED (2e3e00e) → builder slices A–D → adversary AUDIT (zero violations) → BUILD_VERIFIED at `5df746a` → CI round-1 exposed two scaffold/environment adaptations, adjudicated + fixed (`094ba8e`, `80fbb0a`) → reviewer R1 APPROVE @ `5df746a`, R2 APPROVE @ `80fbb0a` → CI green → squash-merged to develop as `84d349d` (PR #16). Every gate tail below was re-run by the orchestrator, not copied from subagent claims. Full process evidence: `docs/overnight-ledger.md` (entries `UNIT-105 PREP` 2026-11-12T21:19Z → `BUILD_VERIFIED + REVIEW-R1 APPROVE`).

## Completion criteria (`verify:unit --from-branch` at `5df746a`; `reports/criteria/unit-105-command-system.md`)

| ID       | level · evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | tests | result |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------ |
| CC-105.1 | untagged · L1 registry↔design-table snapshot (live-parsed `.ai-dlc/knowledge/design.md` oracle, bidirectional trace, exact 2-row exemption list — reviewer tamper probes reddened it both directions) + FR-105.6 catalog JSON + L2 command/arbitrator suite: keyboard-simulated transport per CONTRACT § Transport/SyncArbitrator (Space one-play, J/L ±5/±10, ±1/fps, ±1 s, Home/End/⌘←/⌘→ clamped, I/O/Y/Shift+I/O, ⌘Z/⌘⇧Z/⌘Y once-each, ⌘A/Esc, Delete ONE step, Shift+Delete gap-MIDPOINT 4.375 + later blocks byte-identical + ONE step, ⌘S/Ctrl+S spy) | 15    | pass   |
| CC-105.2 | untagged · L1 pure `resolveContext` (focus input/timeline/transcript/body + selection) + L2 suppression: input/contenteditable ⇒ S/Delete/arrows silent, `⌘Z/⌘S/⌘/` always-live (mac+win); timeline-focused S/⌘⇧M/Z+← apply; held-letter chord fires once, bare Z never, arrow-after-release = transport step; US-2.3.1 exactly-once sweep over ALL bindings                                                                                                                                                                                                 | 16    | pass   |
| CC-105.3 | untagged · L1 KeySpec parser: `CmdOrCtrl` mac→Meta / win→Ctrl both platforms, frozen `Meta+Ctrl+Alt+Shift+<key>` order, `KeyZ+ArrowLeft`, code-vs-key tokens, platform glyphs ⌘⌥⇧⌃ vs text, reserved rejection (Meta+W/T/N/Q, Ctrl+Tab) with code-only errors                                                                                                                                                                                                                                                                                                | 8     | pass   |
| CC-105.4 | untagged · L2 overlay: dialog role + aria-modal + label (same node), Tab/Shift+Tab trap, Esc close + opener-focus restore, live filter (label + key-token, zero-state), five category groups, platform glyphs, COUNT = unique registered ids                                                                                                                                                                                                                                                                                                                 | 8     | pass   |
| CC-105.5 | untagged · L1 conflict detection: dev `DUPLICATE_BINDING` throw (same id+keys, same-scope keys), post-resolution `BROWSER_RESERVED`, prod precedence focused-panel > global + gated-wins-only-while-open                                                                                                                                                                                                                                                                                                                                                     | 8     | pass   |
| CC-105.6 | untagged · anchor-test precedent (gate scripts in package.json, frozen 350 KB budget, unit declares CC-105.1–.6, branch-exists with CI-PR-context tri-source)                                                                                                                                                                                                                                                                                                                                                                                                | 4     | pass   |

`verify — all untagged criteria of unit-105-command-system.md covered (6 total)`, exit 0. `[RQ]`/`[DEPLOY]`/`[MANUAL]` criteria: none declared in the unit file.

## Gates — battery re-run by the orchestrator at `5df746a` (verbatim tails)

- `corepack pnpm lint` → `> eslint .` — exit 0.
- `corepack pnpm typecheck` → `tsc --noEmit -p tsconfig.json && …node… && …eval…` — exit 0.
- `corepack pnpm format:check` → `All matched files use Prettier code style!` — exit 0.
- `corepack pnpm test --coverage` → exit 0 — `Test Files 201 passed (201)` / `Tests 1616 passed | 1 skipped | 1 todo (1618)`. Coverage summary `Statements 95.65% (4354/4552) · Branches 90.46% (2334/2580) · Functions 97.12% (744/766) · Lines 98.48% (3758/3816)`, zero threshold misses (engine 85/75, state 80 met). (Benign v8 note: `Failed to parse …/src/state/CONTRACT.md. Excluding it from coverage.` — carried non-blocking.)
- `corepack pnpm build && corepack pnpm check-bundle` → `assets/index-BJixoeDO.js 128.4 KB gzip` / `check-bundle: initial JS 128.4 KB gzip / budget 350 KB (1 chunks)` — exit 0.
- `corepack pnpm test:e2e` → `22 skipped` / `110 passed (9.6m)` — exit 0 (zero failures; memory/recycle + perf specs included).
- `corepack pnpm verify:unit --from-branch` → exit 0, table above.
- CI (final head `80fbb0a`, run 43360971250): `quality pass 29m47s` · `fixtures-verify pass 29s` · `preview-deploy pass 15s`.
- Test integrity: `git diff 775900f..HEAD -- tests` = additive `tests/unit/commands/**` (12 files, 108 tests, every one CHILD-gated — audited) + FIVE orchestrator-adjudicated cited amendments (keyspec Ctrl-order `eded577`, history-baseline clear `ed3fe2d`, queryAllBy zero-count `075f1b1`, branch-exists CI context `094ba8e`, CC-01.1 child budget `80fbb0a`) + the one alias hunk in `vitest.config.ts` and the additive `toHaveAttribute` matcher in `src/test-support/matchers.ts`. Zero `.only`, zero new `eslint-disable`, zero `vi.mock`, no pre-existing frozen suite edited beyond the adjudications.

## Deviations from spec

- **Handler-less bindings at intent boundaries:** `translate.cycle-view` (⌘⇧L) and `view.captions-toggle` (⌘\) are registered per the design table with intentionally unmounted handlers (caption-translation/unit-302 and Intent-3 overlay ownership respectively); dispatch is the documented registry no-op — reviewer-confirmed precedent. `view.save-snapshot` (⌘S) dispatches the frozen command; the autosave provider is unit-106 (injected `onSave` callback, documented no-op default).
- **`useEditorCommands(app, { onSave?, platform? })`:** platform param is carried for the overlay/glyph seam (chord resolution reads event modifier flags at the useCommands bridge — unchanged frozen semantics).
- **Overlay open-state owner = Workbench** (`registerCommandHandler('view.shortcuts-overlay', …)`), superseding the d.ts prose "useEditorCommands mounts the overlay" — the frozen harness mounts Workbench without `transport`, so only the Workbench path satisfies the frozen test; recorded at slice C.
- **Filter match is key-token equality, not substring** (frozen `space`→1-row oracle rules out substring: `'backspace'.includes('space')`).
- **CI scaffold adaptations** (round-1 failures, environment assumptions not product defects): branch-exists anchor tri-source (Actions PR checkout has no local `refs/heads`); CC-01.1 nested-child explicit 240 s budget (90 s spawn budget was tuned at 77 files/690 tests per the unit-102 note; measured child today: 49–50 s local idle, CI SIGTERM > 90 s under contention; anti-hang bound — assertions, thresholds and the parent 600 s budget untouched).
- **Five frozen-test amendments**, all orchestrator-adjudicated with citations and reviewer double-verification (R1: three; R2: all five, per-assertion strength table). None reduces an assertion.

## Contract changes

None. `src/state/**` diff vs develop: empty. CONTRACT.md FROZEN surface untouched; keyboard dispatch reaches state exclusively via `EditorApp.dispatch` / `EditorHistoryApi` / `EditorStore.setSelection`. design.md untouched (the Ctrl+G/⌘⇧G rows were already adjudicated in at unit-104; the snapshot expects them).

## Dependencies

None beyond `settings.yml approved_dependencies`. `git diff origin/develop..HEAD -- package.json pnpm-lock.yaml` empty. RuleTester comes from the existing `eslint` devDependency.

## Measurements

- Bundle: initial JS **128.4 KB gzip** (budget 350 KB; +3.5 KB over unit-104 — registry/keyspec/overlay).
- Coverage: All files **95.65 / 90.46 / 97.12 / 98.48** (S/B/F/L); exit 0.
- Tests: 201 files / **1618** (108 new unit-105 incl. 41 adversary AUDIT); nested scaffold child 49.3–50 s.
- e2e: **110 passed / 22 skipped / 0 failed** (9.6 m); CI quality 29m47s green.
- Qualification: `qualification/0.0.0-spike.json` re-signed `5df746a` (contentHash+startedAt only; last src-touching commit chain verified by reviewer recomputation: samples-artifact decomposition identical to base record).

## Follow-ups

- **Unknown-`when` fail-open** (registry.ts gate default + `toCommandBinding` strip): a typo-gated extension becomes always-live; typed `INVALID_GATE` rejection is the safer default (adversary pinned current behaviour as measured; fix requires a frozen-shape decision).
- **`registerBinding` dev-default throws in prod bundles** if a future prod caller omits `{dev:false}` — gate default on `import.meta.env.DEV` when the first prod caller lands (reviewer MINOR-1).
- **Lint-rule evasion (out of frozen scope):** `<div {...{onKeyDown}}/>` spread and `createElement('div',{onKeyDown})` slip past the JSXAttribute rule; extend the rule + RuleTester fixtures in a future unit.
- **`dispatchCommand` first-row-per-id gate** — pin the uniform-gate-per-id invariant (or per-row gating) before any id gains mixed `when` rows (reviewer OBS-2).
- **`dispatchCommand('unknown-id')` message echoes the id** — ids are code-defined (no user content), but a code-only `UNKNOWN_COMMAND_ID` would make SECURITY-03 uniformly defensible.
- **vitest.config.ts:34 stale "frozen 30 s" comment** — three generations of child-budget docs diverged; doc sweep.
- Carried from unit-104 (unchanged): `RETIME_DEGENERATE` dead branch, word-range paint, timeline hidden-speaker seed.
