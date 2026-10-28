## Unit

Closes unit: `ai-dlc/<intent-slug>/<unit-file-stem>`

## Completion criteria

<!-- paste reports/criteria/<unit>.md — one row per CC-ID -->

| ID  | level | tests | result |
| --- | ----- | ----- | ------ |

## Gates

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test` (coverage thresholds enforced)
- [ ] `pnpm build && pnpm check-bundle`
- [ ] `pnpm test:e2e`
- [ ] `pnpm verify:unit --from-branch`

## Deviations from spec

<!-- what and why; "none" -->

## Contract changes

<!-- proposed edits to architecture.md types; "none" -->

## Dependencies

<!-- anything outside settings.yml approved_dependencies; "none" -->

## Measurements

<!-- perf/memory/WER numbers this PR produced -->

## Follow-ups

<!-- seeds for the backlog; refactors; open questions -->
