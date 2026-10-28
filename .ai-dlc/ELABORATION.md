# Elaboration Context — Zipscribe

Standing context for every `/ai-dlc:elaborate` session in this repo.

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
- Every unit file: frontmatter (`status`, `discipline`, `depends_on`, `workflow`, `mode`, `pass` if the intent has passes), then Description, User Stories (Given/When/Then), Functional Requirements, Technical Specification, Completion Criteria (incl. failure cases), Risks, Boundaries, Docs to consult.
- Every intent: frontmatter `quality_gates` copied from `settings.yml` (+ `e2e` when it has UI, + `criteria`), and a "Failure cases" block in Completion Criteria.
- Every Completion Criterion gets the next `CC-…` ID and, if it can't be proven in PR CI, an `[RQ]`/`[DEPLOY]`/`[MANUAL]` tag (`knowledge/conventions.md` § Criterion traceability). Prefer criteria that L1–L5 tests can prove; split mixed criteria.
- Research goes in the intent's `discovery.md` with source links and the date verified.

## Build order (current DAG, critical path in bold)

**unit-01 → unit-02 → unit-03 → unit-05 → unit-07 → unit-104 → unit-201 → unit-202 → unit-203 → unit-204**; unit-04 ∥ unit-02 after 01; unit-101 → unit-102 → unit-103/106/107 can start right after unit-01 against mocked workers (contract-first; 107 also needs unit-04); unit-200 (design pass) after unit-101; unit-301 after unit-102; unit-302 last (needs 104 + 202).
