---
status: pending
phase: mvp
discipline: frontend
depends_on: [unit-200-style-export-offline-design, unit-201-styling-engine, unit-202-export, unit-204-pwa-offline]
workflow: default
mode: AHOTL
---

# unit-205-intent-closure-suite — Styling & Export intent journey proofs

## Description

Intent-level composition suite: `e2e/intent/styling-and-export.spec.ts`, the sibling of the closed `e2e/intent/caption-studio-ui.spec.ts` / `local-transcribe-engine.spec.ts` (same doctrine: real app on the built bundle, mocked fast worker where ASR would run, no network, SECURITY-03 codes/lengths only across the console boundary). Per-unit suites 200–204 own component-level proofs; this file proves the intent-level user journeys and is the **lead-citation leg** for the criteria the 2026-11-24 `verify:intent styling-and-export` audit found UNCOVERED: CC-I3.1–.8 and CC-I3.10 (CC-I3.8 is `pnpm test:e2e` green incl. webkit — the closure run cites it; CC-I3.9 is `[DEPLOY]`, stays awaiting-credentials per the MVP gate in `knowledge/product.md` § Roadmap).

Behaviour already exists at unit level (CC-I3.6/.7 ≡ CC-204.1/.2 etc. — "morning item: add lead-citation legs" from unit-204's post-review); this unit adds journeys + citations, not features. If a journey exposes a real defect, file it as a blocker in the unit report; do not loosen a threshold.

## User Stories

**US-205.1** As the owner, the whole styling→export→install→offline story works as one journey in a real browser on the production build, so I can trust the intent without re-clicking every unit.
- *Given* a built bundle served by `vite preview` (project chromium), *when* the scripted journey styles a caption set with each preset + a custom control, *then* the preview canvas shows the styled overlay and the export dialog offers the tier-correct formats (journey J1/J3/J4/J5 below).
- *Given* the same project, *when* sidecars are exported for the source track and a translation track, *then* bytes match the unit-202 goldens (J2).
- *Given* a burned MP4, *when* frames are sampled at 10 word-boundary timestamps, *then* active-word highlight matches preview render (SSIM ≥ 0.99, J3 — reuse the unit-202 golden machinery).
- *Given* an audio-only project, *when* the export dialog opens, *then* no MP4 option exists in the DOM and the Style tab hides aspect controls (J5).
- *Given* a fresh context after one visit, *when* offline reload, *then* the project reopens from IDB, edits autosave, a sidecar exports offline (J7, reusing the unit-204 harness without touching `e2e/pwa/**`).

## Functional Requirements

- **FR-205.1** New file `e2e/intent/styling-and-export.spec.ts` only; no edits to existing `e2e/**`, `src/**` (defects → blockers, not silent fixes). Reuse helpers/imports from unit-202/204 suites.
- **FR-205.2** Every test title lead-cites its intent criterion (`test('CC-I3.3: …')`), one journey per cited ID (J1 CC-I3.1, J2 CC-I3.2, J3 CC-I3.3, J4 CC-I3.4, J5 CC-I3.5, J6 CC-I3.6, J7 CC-I3.7, J8 CC-I3.8 aggregate cite on the chromium project run, J9 CC-I3.10).
- **FR-205.3** J4 runs under the webkit project (capability gating, no AudioEncoder); J8's citation asserts the full `pnpm test:e2e` (all projects) passes as the suite's final gate test or via the verifier's junit — test-author decides, but "test that can't fail" is forbidden.
- **FR-205.4** Byte-equal reload doctrine where state round-trips (mirrors caption-studio-ui.spec.ts header doctrine).

## Technical Specification

Built on the existing `e2e/intent/` harness pattern (fixture media via local server, mocked ASR via `injectAsrEvent` where transcription text is needed pre-styling; `window.__zip` bridges only where an existing unit suite already exposes them). WebKit project via `test.skip`-free project tagging as in `e2e/export/**` webkit specs. SSIM/frame machinery imported from unit-202 golden utilities.

## Completion Criteria

- [ ] **CC-205.1** `pnpm exec playwright test --project=chromium e2e/intent/styling-and-export.spec.ts` green; tests lead-cite CC-I3.1, .2, .3, .5, .6, .7, .10 (and .8 per FR-205.3 mechanism)
- [ ] **CC-205.2** webkit journey (J4) green under `--project=webkit`: SRT/VTT/JSON/TSV offered, MP4 never offered
- [ ] **CC-205.3** `pnpm verify:intent styling-and-export` exits 0 with CC-I3.1–.8/.10 credited (CC-I3.9 `[DEPLOY]` excluded per conventions § Criterion traceability)
- [ ] **CC-205.4** All existing suites still green (`pnpm test`, `pnpm test:e2e`) — pure addition, zero edits to committed specs
- [ ] **CC-205.5** SECURITY-03: spec asserts no caption/translation text in captured console during journeys (redaction assertion like unit-301's pattern)

## Risks

- Journey duplication of unit-202/204 runtime cost → keep journeys to the composition points; share golden artifacts rather than re-deriving frames where the unit-202 machinery allows.
- Lead-citation gaming (citation without journey) → reviewer checklist: each cited ID must exercise the intent-level composition named in the intent.md criterion text, not a unit test re-run.

## Boundaries

Owns: `e2e/intent/styling-and-export.spec.ts`, `tests/unit/intent/styling-and-export-anchor.test.ts` (static anchor legs per gates-anchor doctrine, added in the review round for CC-205.2/.3/.4 credit) (+ fixtures only if a new one is unavoidable, via `pnpm fixtures` regeneration). Doesn't own: any `src/**`, unit-200–204 specs, `e2e/intent/caption-translation.spec.ts` (unit-303), deploy concerns (unit-203, frozen).

## Docs to consult

`e2e/intent/caption-studio-ui.spec.ts` header doctrine; `.ai-dlc/knowledge/conventions.md` § Testing strategy, § Criterion traceability; docs-mcp `playwright` (projects, fixtures); `knowledge/product.md` § Roadmap (gate definition).
