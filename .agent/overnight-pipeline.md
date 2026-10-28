# Overnight pipeline — repo binding and pre-adaptations

Unattended runs in this repo are executed by the **`overnight-pipeline`
skill** (`~/.config/opencode/skills/overnight-pipeline/` — SKILL.md,
process.md, run-config.md). The orchestrator runs as the `overnight`
primary agent defined in `opencode.json`; pipeline subagents
(`test-author`, `builder`, `adversary`, `fixer`, `reviewer`) carry their
permission fences there. Review procedure: `.agent/REVIEW.md`.

This file records **pre-kickoff assumption adaptations** (process.md
Assumptions policy: adapt before kickoff, never mid-run). The run's
Step 0 ledger entry must cite this file.

## Adaptation 1 — `CI_GREEN` deferred for unit-01

`.github/workflows/ci.yml` does not exist yet; it is a deliverable of
`unit-01-scaffold-quality-gates` (FR-1.0.7). Until `ci.yml` lands:

- **Unit-01 only:** `gh pr checks <n>` returning *no checks reported*
  counts as `CI_GREEN (adapted: pre-CI unit)` in the ledger. Any check
  that DOES exist (e.g. added mid-run) must be green as normal.
- **Every unit from unit-02 onward:** the normal gate applies — missing
  checks is treated as red (hard blocker), because unit-01 is required
  to have delivered the workflow. If unit-01 merged without `ci.yml`,
  that is a morning-review finding, not something later units paper over.

## Fixed run-config values (agreed, don't re-ask at kickoff)

| Key | Value |
|---|---|
| `base` | `develop` (remote default; `main` protected per git flow) |
| `ledger path` | `docs/overnight-ledger.md` (gitignored — verified) |
| run-config scratch | `.agent/overnight-run-config.md` (gitignored — verified) |
| `report format` | `docs/overnight-reports/unit-<N>.md` — tracked; note `reports/` is gitignored repo-wide, so the old default `docs/reports/` is unusable |
| `gates` | from `.ai-dlc/settings.yml` (orchestrator reads verbatim at kickoff) |
| `test quality probe` | `kill-check` default; **Stryker available** — `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` are already in devDependencies, so `mutation:stryker` is a valid per-unit upgrade |

Everything else (`units` order, `external deps`, `device policy`,
`unit exceptions`, …) stays a Phase B question.
