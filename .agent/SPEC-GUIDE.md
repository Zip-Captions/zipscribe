# Spec Guide — Zipscribe

Standing context for anyone (human or agent) adding or changing intents and units in `.ai-dlc/` — AI-DLC Inception work (Mob Elaboration: intent → user stories, NFRs, risks, units; see docs-mcp `ai-dlc-method`).

## Required discovery areas for any new intent

1. **Privacy**: does it touch transcript/caption/translation text or audio? → SECURITY-03 criteria + redaction test.
2. **Network**: does it add a runtime origin? → update `settings.yml operations.model_hosts`, CSP (unit-203), request audit.
3. **Offline**: does it work offline after first visit? If it needs a download, it must be user-initiated and visible in "Offline models".
4. **Tiers & browsers**: behaviour on T1–T4 and on non-Chromium browsers; honest gating copy.
5. **Contract impact**: new/changed types in `knowledge/architecture.md` (model/protocol) and domain invariants.
6. **Undo & persistence**: new commands, schema version bump + migration (unit-106 framework).
7. **Main-thread budget**: where the work runs; long-task gate.
8. **Media kinds**: behaviour for video *and* audio projects (preview, export, fixtures).
9. **Test levels**: which level (L1–L7, M) proves each criterion; what fixtures and fakes it needs.

## Conventions for specs

- Units: Intent 1 = `unit-01…09`, Intent 2 = `unit-101…`, Intent 3 = `unit-200…`, Intent 4 = `unit-301…`; next intent starts at `unit-401`.
- IDs: new stories `US-<unit#>.<n>`, requirements `FR-<unit#>.<n>`; legacy brief IDs only with "(orig. …)". Never reuse an ID.
- Every unit file: frontmatter (`status`, `phase`, `discipline`, `depends_on`, `workflow`, `mode`), then Description, User Stories (Given/When/Then), Functional Requirements, Technical Specification, Completion Criteria (incl. failure cases), Risks, Boundaries, Docs to consult. `phase: mvp` = provable locally with no external accounts; `phase: production` = deploy/CD/ops work, gated on owner-provisioned credentials (§ Build order).
- Every intent: frontmatter (`status`, `workflow`, `created`, `announcements`) and a "Failure cases" block in Completion Criteria. Quality gates live only in `settings.yml` and run in CI.
- Every Completion Criterion gets the next `CC-…` ID and, if it can't be proven in PR CI, an `[RQ]`/`[DEPLOY]`/`[MANUAL]` tag (`knowledge/conventions.md` § Criterion traceability). Prefer criteria that L1–L5 tests can prove; split mixed criteria.
- Research goes in the intent's `discovery.md` with source links and the date verified.

## Build order (phased DAG, current; critical path in bold)

Owner decision 2026-10-31: **all MVP work is completed before any productionization/deploy work.** `phase: production` units and every `[DEPLOY]`-tagged criterion run only after the MVP phase is done and the owner has provisioned Cloudflare credentials (`settings.yml operations.ci_secret`); until then `[DEPLOY]` criteria stay **awaiting-credentials** per `.agent/overnight-pipeline.md` Adaptation 3 — they are never faked, skipped-as-done, or allowed to block a phase-1 unit.

### Phase 1 — MVP (no external accounts; every gate locally provable)

Landed: **unit-01 → unit-02 → unit-03 → unit-04** (unit-04 ∥ unit-02 after 01).

Remaining, in DAG order:

1. **unit-05** (transcription pipeline) — the value unit; then **unit-06** (diarization) ∥ **unit-07** (caption import)
2. **unit-101 → unit-102** (contract freeze), then unit-103 / 106 / 107 ∥ (107 needs 04); then **unit-104** → unit-105. 101–103/106/107 are contract-first against mocked workers and may overlap 05–07.
3. unit-200 (design pass, after 101) → **unit-201** → **unit-202** (export)
4. unit-301 after 102; unit-302 last (needs 301 + 104 + 202)
5. **unit-204** (installable offline PWA) after 200 + 202 + 03 + 106 — deliberately **not** behind unit-203: it verifies against `vite preview` + CDP and self-provides its `sw.js`/manifest header entries (FR-204.6)

MVP exit = every `phase: mvp` unit at its exit gate + `pnpm dev`/`pnpm build && pnpm preview` demo path works locally with cached models. Only then is the app considered worth publishing.

### Phase 2 — Productionization (owner-gated on Cloudflare credentials)

- **unit-203** (Cloudflare Pages CD, `_headers`/CSP hardening, Lighthouse-on-preview, L7 smoke on preview/staging/production, rollback rehearsal, release cutting + `docs/RELEASE.md`)
- Deferred `[DEPLOY]` criteria from earlier units: CC-01.14/15/16 (unit-01), CC-203.1/2/3/4/6/7/8, CC-I3.9 (intent 3 delivery)
- `wrangler` devDependency + un-gating the token-gated deploy workflows (`.github/workflows/deploy-*.yml`)
- First release: `release/0.1.0` via "Start release" → production deploy + rollback smoke + tag (CC-01.15/16 exercised here)

Phase-2 units branch from `develop` like any unit; their PRs are simply cut once credentials exist. No phase-1 unit may add a `phase: production` dependency.
