---
status: pending
phase: mvp
discipline: frontend
depends_on: [unit-301-translation-engine, unit-302-translation-workspace, caption-studio-ui/unit-104-transcript-editor, styling-and-export/unit-202-export]
workflow: default
mode: AFK
---

# unit-303-intent-closure-suite — Caption Translation intent journey proofs

## Description

Intent-level composition suite: `e2e/intent/caption-translation.spec.ts`, sibling of the `e2e/intent/` suites (same doctrine: real app on the built bundle, no network, mocked Translator API where the real one can't run in CI, SECURITY-03 codes/lengths only). It is the **lead-citation leg** for the criteria the 2026-11-24 `verify:intent caption-translation` audit found UNCOVERED: CC-I4.1, CC-I4.3, CC-I4.4, CC-I4.5, CC-I4.7. (CC-I4.2 `[RQ]` runs at release qualification; CC-I4.6 `[MANUAL]` is the owner's Chrome offline-pack check — evidence pack exists from the 2026-11-23 sign-off run.)

Behaviour exists at unit-301/302 level; this unit adds intent journeys + citations, not features. Real defects surfaced by a journey are blockers in the unit report, never threshold loosening.

## User Stories

**US-303.1** As the owner, translate→review→export works as one scripted journey on the production build, so I trust the intent without re-clicking every unit.
- *Given* a 200-block English project on the built bundle, *when* translate→French+Spanish runs with the mocked Translator API, *then* every block carries an entry with status `translated` or `failed` and the workspace renders both tracks (journey T1, cites CC-I4.1).
- *Given* a completed translation set, *when* a translation is edited and then its source block is split, *then* `edited` is set and the affected translations become `stale` per domain invariant 10 (T3, cites CC-I4.3).
- *Given* the tracks, *when* SRT/VTT/JSON export per language (incl. the RTL Arabic golden) and burn-in of a translation track, *then* sidecars are byte-exact and the burned frames render the translated text (T4, cites CC-I4.4 — reuse unit-202/301 golden machinery).
- *Given* the webkit project, *when* the translation workspace opens, *then* translation actions are absent with the explanatory note while import + manual translation still work (T5 under webkit, cites CC-I4.5).
- *Given* the whole run, *when* console output is captured, *then* no caption/translation text appears — codes and counts only (T6, cites CC-I4.7).

## Functional Requirements

- **FR-303.1** New file `e2e/intent/caption-translation.spec.ts` only; no edits to existing `e2e/**`, `src/**` (defects → blockers).
- **FR-303.2** Test titles lead-cite their intent criterion: T1 CC-I4.1, T3 CC-I4.3, T4 CC-I4.4, T5 CC-I4.5 (webkit project), T6 CC-I4.7.
- **FR-303.3** Mocked Translator API via the existing inject seam from unit-301/302 suites (never the network); failure-path fixtures exercise `failed` status honestly.
- **FR-303.4** Byte-equal reload doctrine where state round-trips (mirrors caption-studio-ui.spec.ts header doctrine).

## Technical Specification

Built on the `e2e/intent/` harness pattern; reuse the unit-301 mocked-translator fake and unit-302 workspace bridges already exposed to specs; unit-202 golden utilities for sidecar byte-exactness and burn-in frame checks; webkit journey via project tagging as in `e2e/export/**`.

## Completion Criteria

- [ ] **CC-303.1** chromium journeys green, lead-citing CC-I4.1, .3, .4, .7
- [ ] **CC-303.2** webkit journey green, lead-citing CC-I4.5
- [ ] **CC-303.3** `pnpm verify:intent caption-translation` exits 0 with CC-I4.1/.3/.4/.5/.7 credited (CC-I4.2 `[RQ]`, CC-I4.6 `[MANUAL]` excluded per conventions)
- [ ] **CC-303.4** `pnpm test` + `pnpm test:e2e` fully green — pure addition, zero edits to committed specs
- [ ] **CC-303.5** Reviewer checklist pass: each cited ID exercises the intent-level journey named in `intent.md`, not a unit-test re-run

## Risks

- Duplicating unit-301/302 runtime → share fixtures/fakes; journeys stop at composition points.
- Mock fidelity masking real Translator behaviour → that is what CC-I4.2 `[RQ]` covers at release; CI never claims it.

## Boundaries

Owns: `e2e/intent/caption-translation.spec.ts` (+ unavoidable new fixtures via `pnpm fixtures`). Doesn't own: `src/**`, unit-301/302 specs, `[RQ]`/`[MANUAL]` executions, styling-and-export closure (unit-205).

## Docs to consult

`e2e/intent/caption-studio-ui.spec.ts` doctrine; unit-301/302 spec files (fakes/bridges); `knowledge/domain.md` invariant 10; docs-mcp `chrome-built-in-ai` (Translator contract); `knowledge/product.md` § Roadmap.
