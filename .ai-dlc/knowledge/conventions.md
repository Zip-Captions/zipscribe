# Knowledge: Conventions

Coding, testing, naming, and repo conventions. Binding on all units unless the unit overrides with justification.

## Repository & style

- pnpm only (`packageManager` pinned). Node ≥ 22. No `any` (`@typescript-eslint/no-explicit-any`: error); `noUncheckedIndexedAccess` on — handle `undefined` explicitly.
- File naming: `kebab-case.ts`; component files `PascalCase.tsx`; tests colocated `*.test.ts`, property tests `*.property.test.ts`, e2e `e2e/<area>/<flow>.spec.ts`.
- Exports: named only (no default exports) except React components' memo wrappers.
- No classes in `engine/` beyond thin adapter classes with constructor-injected deps; prefer plain functions + option objects.
- Discriminated unions with `t:` tag for all protocol/worker messages (see architecture). No stringly-typed commands.
- Errors: `EngineError` taxonomy codes (unit-05) + `ZipscribeError` subclass pattern; **never embed transcript/user content in `message`** (SECURITY-03, enforced by redaction tests).
- Comments only for non-obvious workarounds; include doc URL when citing upstream issue (pattern: `// workarounds transformers.js#1739: per-chunk dispose — https://github.com/...`).

## Architecture rules (lint-enforced)

- `src/engine/**`: no `react`, `react-dom`, `document`, `window` imports/globals. No direct SDK imports (transformers/sherpa/cactus/ffmpeg/mediabunny) — SDK glue lives only in `src/workers/*` and `src/engine/**/adapters/`.
- `src/ui/**`: no business logic; components read stores via selectors, dispatch commands. No async logic in components (delegated to state thunks/services).
- `src/state/**`: pure reducers + command definitions; side effects in `src/state/services/` only.
- Time is seconds everywhere; formatting only via `ui/format.ts` (`formatTimecode(sec, {fps?})`) and export serializers.

## State & commands

- Zustand slices: `project` (entity data), `editor` (selection/playhead/UI), `jobs` (transcribe/diarize/export state), `settings` (tier prefs).
- Every mutation goes through `state/commands/<name>.ts` — pure `(state, payload) → patch`, registered in the command registry (undoable via zundo, `undoable: true` default; UI-only states excluded).
- Selectors memoized (`zustand/shallow` or `useShallow`); no full-store subscriptions in render.

## Testing

- vitest: `node` env default; `jsdom` per-file via docblock only for components; no network (model downloads mocked via `cachedFetch` fake).
- Property tests (fast-check) required for: blockize invariants, clustering purity, timecode round-trip, SRT/VTT escape/parse round-trip.
- Golden tests: fixtures with checksum-verified manifest (`fixtures/harness/manifest.json`); goldens committed under `fixtures/golden/`; regeneration requires PR note.
- Playwright: chromium always; webkit project per-unit opt-in for export/compat specs; real-model tests tagged `@slow` (nightly), mocked-worker tests per-PR; **never assert wall-clock timings below 10 s** (CI flake policy — perf gates run on self-hosted runner).
- Test naming: `<unit>-<req> : <behavior>` e.g. `FR-2.2.2: split at playhead produces two blocks with contiguous times`.
- Coverage floors per AGENTS.md (engine 85% lines; UI: behavior coverage, not %).

## UI conventions

- Components: function components, no `React.memo` by default (measure first). Tailwind + tokens (no raw hex outside `tokens.css`/speaker palette). Keyboard handling exclusively via command registry bindings (`ui/commands/useCommands.ts`), never ad-hoc `onKeyDown` outside inputs.
- Timecode inputs: `TimecodeInput` (shared), tabular-nums, parse/format via `ui/format.ts`, invalid state + recovery (no silent clamp).
- ARIA: transcript list `role="list"`, rows `aria-label` = `"<speaker>, <timecode>, <text>"`; status live-region `aria-live="polite"` for job progress.
- Focus management: focus never leaves user during streaming updates (auto-scroll = `scrollIntoView({block:'nearest'})` only, no `.focus()`).

## Commits & PRs (AI-DLC)

- Branch `ai-dlc/<intent>/<unit-slug>`; conventional commits (`feat(transcript): …`, `test(engine): …`); PR description links unit file + Completion Criteria checklist copied in with results.
- Bundle-budget failures and gate failures block PR merge (CI).
- No drive-by refactors outside unit scope (AGENTS.md); note desired refactors in PR description for `/seed`.

## Docs & citations

- Non-trivial third-party API usage verified against docs-mcp/official docs before use (AGENTS.md); cite URL in code comment when surprising (e.g., `// mediabunny Conversion API: https://github.com/Vanilagy/mediabunny#conversion`).
- Competitor-UX claims in specs require sources from `knowledge/design.md` § Sources.
