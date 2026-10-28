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

## Adaptation 2 — branch protection unavailable (Free org)

`Zip-Captions` is a private repo on the **Free** plan: the branch-protection
and ruleset APIs return 403 "Upgrade to GitHub Pro". FR-1.0.7's
platform-level protection (required checks, no direct/force pushes) therefore
cannot be created, and there is nowhere for unit-01 to test it.

- The enforced substitute is the `branch-policy` CI check (rejects PRs into
  `main` from anything but `release/*`/`hotfix/*`) plus git-flow and the
  orchestrator's own rule against pushing to `main`/`develop`.
- CC-01.13 is reported as **partially met (adapted)**: `develop` exists and
  is the default branch (verified via API `default_branch=develop`);
  platform-level rejection is **deferred to the owner** (needs Pro/org plan
  or a public repo) and is never marked done.
- Unit-01's report must record this as an adaptation, not as passing.

## Adaptation 3 — `[DEPLOY]` criteria deferred for this run

No Cloudflare Pages project, no GitHub Environments (API: `total_count: 0`)
and no `CLOUDFLARE_*` secrets exist. Owner decision (2026-10-28): run the
deterministic work; record CC-01.14/15/16 as **awaiting-credentials** in the
ledger and the report, flag them for morning review. Environment secrets are
repo-level on this plan, so the owner can add them later without a re-run.

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
