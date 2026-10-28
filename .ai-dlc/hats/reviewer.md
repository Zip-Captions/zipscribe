<!-- Project augmentation for the AI-DLC reviewer hat (appended under "Project Augmentation"). Add only Zipscribe-specific instructions here — never copy the plugin hat. -->

## Zipscribe review context (read before reviewing any unit)

1. Read `.agent/REVIEW.md` and `.agent/AGENTS.md` in full. Every violated REVIEW.md "Always check" item is a **high-confidence blocking issue**; files matching its "Skip" patterns are excluded.
2. Check the unit against the **unit exit gate** in `.ai-dlc/knowledge/conventions.md` § Exit gates:
   - `reports/criteria/<unit-stem>.md` exists (from `pnpm verify:unit --from-branch`) and every untagged `CC-…` criterion maps to a passing test whose title cites that ID — read at least one such test per criterion and confirm it would fail if the behaviour broke (no tautological or over-mocked tests).
   - `[RQ]` criteria have a `qualify/**` suite; `[DEPLOY]` criteria have an `e2e/deploy/**` spec; `[MANUAL]` criteria have a sign-off entry (who/date/browser/result) in the unit report.
   - No Completion Criterion was renumbered, reused or silently dropped (compare with `git show develop:<unit file>`).
3. Check the unit report (format in `.agent/AGENTS.md` § Unit report): deviations, contract changes and new dependencies are declared, and any contract change is reflected in `.ai-dlc/knowledge/architecture.md` before code depends on it.
4. For `mode: HITL` units, present the decision to the owner in-session before approving — there is no PR review step while the team is solo, so this is the human checkpoint.
