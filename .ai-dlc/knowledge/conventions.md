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

- `src/engine/**`: no `react`, `react-dom` imports; no DOM *globals* (`document`, `window`, `localStorage`) via `no-restricted-globals`. DOM *types* (`CanvasRenderingContext2D`, `OffscreenCanvasRenderingContext2D`, `File`) are allowed — engine code receives such objects by injection. No direct SDK imports (transformers/sherpa/cactus/ffmpeg/mediabunny) — SDK glue lives only in `src/workers/*` and `src/engine/**/adapters/`.
- `src/ui/**`: no business logic; components read stores via selectors, dispatch commands. No async logic in components (delegated to state thunks/services).
- `src/state/**`: pure reducers + command definitions; side effects in `src/state/services/` only.
- Time is seconds everywhere; formatting only via `ui/format.ts` (`formatTimecode(sec, {fps?})`) and export serializers.

## State & commands

- Zustand slices: `project` (entity data), `editor` (selection/playhead/UI), `jobs` (transcribe/diarize/export state), `settings` (tier prefs).
- Every mutation goes through `state/commands/<name>.ts` — pure `(state, payload) → patch`, registered in the command registry (undoable via zundo, `undoable: true` default; UI-only states excluded).
- Selectors memoized (`zustand/shallow` or `useShallow`); no full-store subscriptions in render.

## Testing strategy

The goal: every construction step (unit, intent, release) ends with **machine-checked evidence** that its Completion Criteria hold. Tests are derived from criteria, written first (TDD), and traced back to them by ID.

### Principles

1. **Criteria-driven.** Every Completion Criterion has an ID and at least one test (or, for the few that can't be automated in CI, a recorded result) that proves it. Whoever writes the tests starts from the criteria list, not from the implementation.
2. **Behaviour through public seams.** Test engine functions, the worker protocol, store commands and user flows — not private internals. Mock only at system boundaries (SDKs, browser APIs, workers) and only with the shared fakes in `src/test-support/`.
3. **Hermetic and deterministic.** No network in any test (Playwright blocks all non-local requests; models come from the local model cache, below). Injected clocks, seeded property tests (seed printed on failure), checksum-verified fixtures, bundled fonts, fixed DPR for visual tests.
4. **Privacy is tested, not trusted.** Every suite loads a *canary transcript* containing a unique marker string; a global spy on `console.*`, thrown errors, `EngineError.detail`, notices and written artifacts fails the run if the marker ever appears (SECURITY-03).
5. **Fast PR feedback.** Target ≤ 15 min wall time for the PR pipeline (sharded Playwright). Anything slower or hardware-bound moves to release qualification, never to "skip".

### Test levels

| Level | What it proves | Tooling | Where it lives | Runs |
|---|---|---|---|---|
| **L0 Static** | Types, lint, architecture rules (engine purity, keyboard allowlist, import boundaries), dependency licenses, spec lint (criteria IDs well-formed, `depends_on` resolve, frontmatter valid) | tsc, eslint, `scripts/license-check.ts`, `scripts/spec-lint.ts` | repo-wide | every PR |
| **L1 Unit & property** | Pure engine/state logic; invariants; serializers; parsers; math (resample, windowing, clustering, timecode, FFT scaling) | vitest (`node` env), fast-check, goldens | `*.test.ts`, `*.property.test.ts` next to source | every PR |
| **L2 Component** | React components in isolation: rendering states, ARIA, keyboard handling inside editable components | vitest + jsdom (per-file docblock) + `@testing-library/react` + `user-event` | `*.test.tsx` next to component | every PR |
| **L3 Contract** | Fakes and real implementations obey the same contract: worker protocol (`MediaRequest/Event`…), `TranslationEngine`, persistence service, media-element clock | shared suites `src/**/contract/*.contract.ts` run against fakes (vitest) **and** real implementations (L4) | `src/**/contract/` | every PR |
| **L4 Browser integration** | Real workers + real WebCodecs/mediabunny/ONNX in Chromium on real fixtures and small real models: decode every format, `tiny` ASR smoke, diarization on the 2-speaker fixture, short burn-in, visualizer spectrum, IndexedDB persistence | Playwright (chromium; webkit where the capability exists), local model cache | `e2e/integration/**` | every PR |
| **L5 End-to-end flows** | User journeys from the criteria on the **production build** (`vite preview`): import → transcribe → edit → export, offline/PWA, keyboard-only walkthroughs, axe scans, visual goldens. Mocked workers by default; a few `@real` flows reuse L4 models | Playwright projects `chromium`, `webkit`, `memory` (COOP/COEP preview) | `e2e/<area>/<flow>.spec.ts` | every PR |
| **L6 Release qualification (`RQ`)** | Absolute performance baselines (`settings.yml performance_baselines`), 120-min memory, default/large-model WER + word-timing MAE, WebGPU tier, encoder matrix, real Translator API | `pnpm qualify` on reference hardware (`settings.yml reference_hardware`) | `qualify/**` | every `release/*` branch (and on demand) |
| **L7 Deployment smoke (`DEPLOY`)** | The deployed site: headers + CSP, boot request audit, SW registration + installability, app boots, sample clip plays, Lighthouse budgets | Playwright against the deployed URL, `@lhci/cli` | `e2e/deploy/**` | after every preview, staging and production deploy |
| **M Manual (`MANUAL`)** | Only what can't be automated (owner design review, Safari Add-to-Dock, real-browser offline translation) | checklist + sign-off record | unit report / qualification file | as the criterion states |

### Criterion traceability

- **IDs.** Units: `CC-<unit#>.<n>` (e.g. `CC-05.4`, `CC-204.2`). Intents: `CC-I<k>.<n>` — I1 local-transcribe-engine, I2 caption-studio-ui, I3 styling-and-export, I4 caption-translation. Numbered in file order including "Failure cases". **Never renumber**: new criteria get the next number; retired ones are struck through (`~~…~~`) and keep their ID.
- **Level tag.** A criterion verified outside the PR pipeline carries a tag right after its ID: `` `[RQ]` ``, `` `[DEPLOY]` ``, or `` `[MANUAL]` ``. Untagged = must be proven by L1–L5 in every PR.
- **Tests name the criterion.** `test('CC-05.4: every VAD segment lies in exactly one window', …)`; several IDs may appear in one title. Story IDs (`US-…`) may be added for readability.
- **`pnpm verify:unit <unit-stem>`** / **`pnpm verify:intent <slug>`** parse the criteria, read the vitest + Playwright JUnit reports, and write `reports/criteria/<name>.md` (ID · level · tests · result). They **fail** when an untagged criterion has no passing test, when a test cites an unknown ID, or when a `[RQ]`/`[MANUAL]` criterion is missing from the latest qualification file at release time. The PR description embeds the generated table.

### Exit gates

**Unit exit** (unit PR merges into `develop`) — all of:
1. Quality gates green: lint, typecheck, test (with enforced coverage thresholds), build + bundle/precache budgets, e2e (for units with UI/export/PWA scope), `verify:unit`.
2. Every untagged criterion has a passing test; `[DEPLOY]` criteria pass on the PR preview deployment.
3. Contract suites pass for every seam the unit touched.
4. Unit report complete (`.agent/AGENTS.md` format); the reviewer agent approved in-session; for `mode: HITL` units the owner approves during the session. There is no PR review step while the team is solo — the PR exists to run CI and the preview deploy, then auto-merges.
5. No test passed only on retry (see flake policy).

**Intent exit** (orchestrator flips intent `status: completed`) — all of:
1. Every unit exited; `verify:intent` green for the intent's own criteria.
2. A qualification run on `develop` HEAD passes every `[RQ]` criterion of the intent and its units; `[MANUAL]` items signed off.
3. Mutation testing (Stryker) on the intent's pure engine modules: score ≥ 60% (gating from Intent 2 onward; Intent 1 records a baseline).
4. axe: 0 critical/serious violations across the intent's views; keyboard-only walkthrough passes.
5. No quarantined test older than 14 days in the intent's area.

**Release exit** (`release/X.Y.Z` merges into `main`) — all of:
1. PR pipeline green on the release branch; release-candidate preview `[DEPLOY]` smoke green.
2. `qualification/X.Y.Z.json` present, its content hash matches the release tree (see below), and every `[RQ]`/`[MANUAL]` criterion of every completed unit passes.
3. Changelog generated and reviewed.
4. After merge: production deploy + production `[DEPLOY]` smoke green, or automatic rollback.

### Release qualification (no nightly CI)

- `pnpm qualify [--intent <slug>]` runs L6 suites on a reference machine and writes `qualification/<version>.json`: `{ version, contentHash, machine: {browser, os, cpu, gpu, ramGB}, startedAt, results: [{ id: 'CC-05.1', pass, measured, threshold }], manual: [{ id, by, date, browser, result, note }] }`.
- `contentHash` = SHA-256 over `src/**`, `public/**`, `package.json`, `pnpm-lock.yaml`, and the model registry — so committing the qualification file itself doesn't invalidate it, but any code change does.
- The `qualification-check` CI job on `release/*` recomputes the hash and fails on mismatch, missing IDs or any `pass:false`. Results from previous releases stay in `qualification/` as the performance trend.

### Test data, fixtures and models

- **Fixtures:** small media + caption + ground-truth files committed under `fixtures/` (≤ 50 MB total, `fixtures/LICENSES.md`); large ones generated deterministically by `pnpm fixtures` (gitignored, checksum-verified via `fixtures/harness/manifest.json`).
- **Models:** `pnpm models:fetch` downloads the registry's CI models (`tiny`, diarization, VAD) at their pinned revision into `.cache/models/` with SHA-256 verification — a setup step like `pnpm install`, never during a test. CI caches it keyed by the registry hash. Tests serve models from disk via a Playwright route; the real network stays blocked.
- **Goldens:** `fixtures/golden/` + per-format `*.expected.json`; regenerate with `pnpm test -- --update-goldens`; the PR must contain a "Golden changes" note explaining why (checked by the reviewer agent).

### Mocks and fakes

- Shared fakes only (`src/test-support/`): fake workers (scripted event streams), fake `TranslationEngine`, fake Cache/Storage/IndexedDB (`fake-indexeddb`), fake clock, fake media element/AnalyserNode. Each fake passes its L3 contract suite.
- `vi.mock` is allowed only for third-party SDK module paths, never for our own modules (lint rule).

### Performance, accessibility, visual, security

- **Performance (PR):** structural budgets only — zero engine-attributed long tasks > 50 ms, DOM-row bounds, dirty-region redraw counts, bundle/precache size, rAF frame-drop sampler with a CI-tolerant threshold. **Never assert absolute wall-clock times below 10 s in PR suites.** Absolute baselines are `[RQ]`.
- **Accessibility:** axe scan on every view a unit adds; live-region announcements asserted; `prefers-reduced-motion` respected (visualizer, shimmer); keyboard-only walkthrough per intent.
- **Visual:** canvas outputs (overlay, timeline, visualizer) compared by SSIM against goldens, chromium only, DPR 1 and 2, bundled fonts.
- **Security & privacy:** canary-redaction harness; request audit with the `model_hosts` allowlist in every e2e; CSP-violation listener in every e2e against built output; `pnpm audit --prod` (high/critical fails); license check.

### Coverage and flakiness

- vitest `coverage.thresholds` enforced (not just reported): `src/engine/**` lines 85 / branches 75; `src/state/**` lines 80. UI is gated by behaviour (criteria), not %.
- Unit tests: zero retries. Playwright: 1 retry in CI; any test that passed only on retry is listed in the PR summary and **blocks merge** until fixed or quarantined (`@quarantine` + issue link; still runs, doesn't gate). Quarantine > 14 days blocks intent exit.

### Who builds what

- unit-01: L0 spec-lint/license-check, vitest/Playwright configs with coverage thresholds, `src/test-support/` skeleton + canary harness, request-audit and CSP-listener fixtures, `models:fetch`, `verify:unit`/`verify:intent`, the PR pipeline **and all four deploy workflows with a minimal smoke** (so every merge deploys from day one).
- unit-02: `pnpm qualify` runner, qualification schema + `qualification-check` job (it needs reference hardware anyway).
- unit-203: full L7 deploy smoke, Lighthouse CI, headers/CSP, hardening of the deploy workflows. Every other unit adds tests at the levels its criteria need.

### Other rules

- Never weaken a test, threshold, or gate to go green (skip, `.only`, loosened tolerance, deleted assertion). If a criterion is unreachable, stop and report it as a blocker with the measured value.
- Memory-gate specs run in the `memory` Playwright project against the COOP/COEP preview (`settings.yml testing.memory_tests`); ONNX `numThreads = 1` everywhere so isolation doesn't change engine behaviour.
- Service worker is **disabled in `pnpm dev`**; PWA/offline specs run against `vite preview` of a production build.

## Requirement IDs

- Legacy IDs from the original brief are kept where a story says `(orig. FR-x.y.z)` — they exist for traceability only.
- New stories: `US-<unit-number>.<n>` (e.g. `US-204.1`); new requirements: `FR-<unit-number>.<n>`. IDs are unique repo-wide; never reuse one.

## UI conventions

- Components: function components, no `React.memo` by default (measure first). Tailwind + tokens (no raw hex outside `tokens.css`/speaker palette). Keyboard handling exclusively via command registry bindings (`ui/commands/useCommands.ts`). The only allowed `onKeyDown` handlers are inside text-editing components (`ui/**/editable/**`, `TimecodeInput`) for Enter/Esc/Shift+Enter/IME handling — lint allowlists exactly those paths.
- Timecode inputs: `TimecodeInput` (shared), tabular-nums, parse/format via `ui/format.ts`, invalid state + recovery (no silent clamp).
- ARIA: transcript list `role="list"`, rows `aria-label` = `"<speaker>, <timecode>, <text>"`; status live-region `aria-live="polite"` for job progress.
- Focus management: focus never leaves user during streaming updates (auto-scroll = `scrollIntoView({block:'nearest'})` only, no `.focus()`).

## Version control (git flow)

| Branch | Purpose | Created from | Merges into | Deploys to |
|---|---|---|---|---|
| `main` | Production. Every merge is a release, tagged `vX.Y.Z` | — | — | **production** (automatic) |
| `develop` | Integration / working branch; default target for all unit PRs | `main` (once) | `release/*` | **staging** (automatic) |
| `ai-dlc/<intent>/<unit-stem>` | AI-DLC unit branch (git-flow feature branch) | `develop` | `develop` (squash) | PR preview |
| `feature/<topic>` | Human feature/spec work | `develop` | `develop` (squash) | PR preview |
| `release/X.Y.Z` | Stabilise a release: fixes, version bump, changelog, qualification | `develop` | `main` (merge commit) + back-merge to `develop` | release-candidate preview |
| `hotfix/X.Y.Z` | Urgent production fix | `main` | `main` (merge commit) + back-merge to `develop` | PR preview → production |

- **Versioning:** SemVer. Pre-1.0 releases (`0.Y.Z`) while intents are in flight; `1.0.0` when the v1 scope (intents 1–4) qualifies. The version lives in `package.json` and is shown in About.
- **Branch protection:** `main` and `develop` reject direct pushes and force-pushes and require the CI checks, with **zero required reviews** (solo team; add reviewers here if the team grows); PRs auto-merge when green; a `branch-policy` check fails any PR into `main` whose head isn't `release/*` or `hotfix/*`.
- **Commits & PRs:** conventional commits (`feat(transcript): …`, `test(engine): …`, `fix: …`) — the changelog is generated from them. PR description links the unit file and embeds the `verify:unit` criteria table. Gate failures block merge.
- No drive-by refactors outside unit scope (`.agent/AGENTS.md`); note desired refactors in the PR description as backlog seeds (`knowledge/product.md` § Seeds).

## CI/CD (GitHub Actions → Cloudflare Pages)

Build once per workflow run; the deploy job ships the exact `dist/` artifact that the same run tested.

| Trigger | Pipeline | Result |
|---|---|---|
| PR into `develop`, `release/*` or `main` | `ci.yml`: install (pnpm cache) → L0 → L1–L3 (vitest + coverage) → build + budgets → `models:fetch` (cached) → L4–L5 Playwright (chromium + webkit, sharded) → `verify:unit` for changed units → deploy PR preview (`wrangler pages deploy dist --branch <head-branch>`) → L7 smoke + Lighthouse on the preview URL → PR comment (URL + criteria table) | merge allowed when green |
| Push to `develop` | `deploy-staging.yml`: full CI on the merge commit → deploy `--branch develop` (staging alias `develop.<project>.pages.dev`) → L7 smoke incl. a real model download through the allowlisted hosts | staging always equals `develop` |
| Manual "Start release" (`workflow_dispatch`, input: version) | `start-release.yml`: cut `release/X.Y.Z` from `develop`, bump version, generate changelog, open PR into `main` | release PR |
| Push to `release/*` | `ci.yml` + RC preview deploy + `qualification-check` | release PR mergeable once qualified |
| Push to `main` | `deploy-production.yml`: full CI → deploy to production (`--branch main`, Pages production branch) → L7 smoke against production → **pass:** tag `vX.Y.Z`, GitHub Release with changelog, open + auto-merge back-merge PR `main → develop` · **fail:** automatic rollback (redeploy the previous release tag's artifact) and open an incident issue | production always equals the latest qualified release |

- GitHub Environments `preview`, `staging`, `production` hold `CLOUDFLARE_API_TOKEN` (Pages-edit scope) + `CLOUDFLARE_ACCOUNT_ID`. Production has no manual approval step: the release PR auto-merges once CI, RC-preview smoke and `qualification-check` pass. The owner's only actions are pressing "Start release" and committing the qualification file from the reference machine.
- `concurrency` per environment: a newer staging deploy cancels a pending older one; production deploys never cancel each other.
- Rollback on demand: `deploy-production.yml` `workflow_dispatch` with `ref: vX.Y.Z`, or Cloudflare Pages' dashboard rollback (documented in `docs/RELEASE.md`).

## Docs & citations

- Non-trivial third-party API usage verified against docs-mcp/official docs before use (`.agent/AGENTS.md`); cite URL in code comment when surprising (e.g., `// mediabunny custom decoders: https://mediabunny.dev/guide/supported-formats-and-codecs#custom-decoders`).
- Docs must match the **pinned** version. docs-mcp `transformers.js` indexes `main` (4.x); for 3.8.x behaviour read the versioned docs (`https://huggingface.co/docs/transformers.js/v3.8.1/en/…`) or the `3.8.1` source tag.
- Competitor-UX claims in specs require sources from `knowledge/design.md` § Sources.
