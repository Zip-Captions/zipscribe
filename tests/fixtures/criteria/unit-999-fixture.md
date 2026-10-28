---
status: pending
discipline: dev
depends_on: []
workflow: tdd
mode: HITL
---

# Fixture unit: criteria traceability

A synthetic unit used only by `tests/unit/scaffold/verify-criteria.test.ts`.
It exists so `verify:unit` can be exercised in all three cases the unit
requires: an uncovered criterion, an unknown cited ID, and full coverage.
It is never a build unit and never ships.

## Completion Criteria

- [ ] **CC-999.1** A criterion that has a passing test
- [ ] **CC-999.2** A criterion with no test at all
