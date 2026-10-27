---
status: pending
discipline: dev
depends_on: []
workflow: tdd
mode: HITL   # foundational: every later unit inherits this harness
---

# Unit 01: Scaffold & Quality Gates

## Description

Create the buildable skeleton and every quality gate declared in `.ai-dlc/settings.yml`, plus the test-fixture pipeline. After this unit, `pnpm dev` serves an empty workbench shell and CI enforces all gates on every PR.

## User Stories

**US-1.0.1** As a developer-agent, I want a fully-gated toolchain so that every subsequent unit is born testable.
- *Given* a fresh clone, *when* `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck`, *then* all commands exit 0.
- *Given* a deliberately failing test committed to a branch, *when* CI runs, *then* the pipeline fails red.

**US-1.0.2** As a tester, I want deterministic offline fixtures so that ASR tests never touch the network.
- *Given* `pnpm fixtures`, *when* run, *then* `fixtures/` contains the eval corpus per the zip-captions Spike-1.4 corpus design (`zip-captions-monorepo/aidlc-docs/construction/spikes/spike-1.4-plan.md:105-113`): `tone-30s.wav` + `speech-2min.mp4` (single speaker) + `speech-2spk-2min.mp4` (two voices, word-level ground-truth JSON incl. speaker labels) + `speech-10min.mp4` + `audio-120min.mp4` (perf-only) + **taxonomy set: 4–6 `en-clean`, 2 `en-accented`, 1 `en-technical` (domain vocabulary for hotword eval), 1 `en-noisy`, 2 `fr-clean`** — each 30–60 s, H.264+AAC 16 kHz mono, with reference-transcript JSON; plus `harness/manifest.json` (SHA-256, duration, kind, language, ground-truth ref per file).
- *Given* a corrupted fixture file, *when* `pnpm test`, *then* fixture verification fails loudly with the checksum diff.
- *Given* any fixture missing its license record, *when* CI `fixtures-verify` runs, *then* it fails (`fixtures/LICENSES.md` completeness).

## Functional Requirements

- **FR-1.0.1** Vite 7 + React 19 + TS 5 strict (`noUncheckedIndexedAccess`) project, pnpm. Path alias `@engine/*`, `@state/*`, `@ui/*`.
- **FR-1.0.2** Workers wired via Vite `?worker` imports; worker entry stubs exist for all four workers from `knowledge/architecture.md` module map (typed with `EngineRequest`/`EngineEvent` no-ops).
- **FR-1.0.3** vitest: environment `node` default, `jsdom` opt-in per file; coverage config with the ≥ 85% engine gate reported.
- **FR-1.0.4** Playwright: chromium project configured; webkit project present but `test.skip` by default (enabled per-unit).
- **FR-1.0.5** ESLint 9 flat + typescript-eslint (type-checked) + prettier; `eslint src/engine --rule no-react-import` enforced via `no-restricted-imports` (blocks `react`, `react-dom`, DOM globals).
- **FR-1.0.6** `pnpm check-bundle`: post-build script asserting initial JS ≤ 350 KB gzip; lazy chunks (workers/ffmpeg/mediabunny) excluded via config manifest.
- **FR-1.0.7** GitHub Actions CI: install → lint → typecheck → test → build → check-bundle; artifact upload of coverage report.
- **FR-1.0.8** Empty workbench shell route (`/` renders header bar + empty panels from `ui/shell`) with one Playwright smoke test asserting render.

## Technical Specification

- Root files: `package.json` (engines, scripts: dev/build/test/test:e2e/lint/typecheck/fixtures/check-bundle), `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json` (+ `.node.json` for tooling), `eslint.config.js`, `.prettierrc`.
- `scripts/make-fixtures.ts` — ffmpeg-invoking (ffmpeg via `ffmpeg-static` devDependency); speech fixtures produced from bundled public-domain audio segments (vendored under `fixtures/sources/`, licenses noted in `fixtures/LICENSES.md`); `harness/manifest.json` schema: `{ "files": { "<name>": { "sha256": string, "duration": number, "kind": string } } }`.
- `scripts/check-bundle.mjs` — reads `dist/`, gzips initial-entry chunks, compares to budget from `bundle-budget.json`.
- `src/main.tsx`, `src/App.tsx` (shell only), `src/engine/protocol.ts` + `src/engine/model.ts` **created verbatim from `knowledge/architecture.md`** (these two files ARE the contract; other units import, never redefine).

## Completion Criteria

- [ ] All five gate commands exit 0 locally and in CI on the unit branch
- [ ] `pnpm fixtures` regenerates `fixtures/` matching committed checksums (CI job `fixtures-verify`)
- [ ] `src/engine/**` files reject React/DOM imports at lint level (negative test in `eslint.config` fixture test)
- [ ] `pnpm check-bundle` fails when a 400 KB-gzip dummy chunk is injected (negative test)
- [ ] Playwright smoke passes (chromium)

## Risks

- ffmpeg-static licensing (LGPL/GPL builds) — verify build used; document in `fixtures/LICENSES.md`.
- Worker type-safety across main/worker boundary — protocol types must be the only shared surface.

## Docs to consult

- vite.workers: https://vite.dev/guide/workers · vitest: docs-mcp `vitest` · playwright: docs-mcp `playwright`
