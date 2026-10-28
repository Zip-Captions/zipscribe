# Zipscribe — Agent Instructions (orchestrator + sub-agents)

Permanent instructions for any agent working in this repo (opencode via `opencode.json` → `instructions`, Claude Code via `.claude/CLAUDE.md`, or others). All agent-facing docs live in `.agent/`; AI-DLC workflow state lives in `.ai-dlc/`. Your job is usually one **unit**: make its Completion Criteria true with all quality gates green, then report.

## Read first, in order

1. `.ai-dlc/settings.yml` — tech stack, version pins, approved dependencies, quality gates, reference hardware, network allowlist
2. `.ai-dlc/knowledge/` — `architecture.md` (contract types + decisions), `domain.md` (vocabulary + invariants), `conventions.md`, `design.md` (UI only), `product.md`
3. The active intent's `intent.md` and `discovery.md`, then the unit file you are building
4. `README.md` for orientation

## When documents disagree

Use this precedence and **name the conflict in your report** instead of silently picking:

1. `src/engine/model.ts` + `src/engine/protocol.ts` once they exist (they are generated verbatim from `knowledge/architecture.md` by unit-01)
2. The unit file (for its own scope)
3. `knowledge/domain.md` invariants → `knowledge/architecture.md` → other knowledge files
4. `discovery.md` (research; may be stale — re-verify anything time-sensitive)

If a change to a contract type is needed, stop and list it under "Contract changes" in your report; the orchestrator updates `architecture.md` first.

## How to build

- **TDD, traced to criteria.** Follow `knowledge/conventions.md` § Testing strategy. Start from the unit's Completion Criteria: write a failing test for each untagged `CC-…` ID, at the lowest level that can prove it (L1 unit → L5 e2e), with the ID in the test title (`test('CC-05.4: …')`). `[RQ]` criteria get a `qualify/**` suite; `[DEPLOY]` criteria an `e2e/deploy/**` spec; `[MANUAL]` criteria a checklist entry in your report. Unit tests sit next to source (`*.test.ts`); e2e in `e2e/`. A test that can't fail, or mocks away the thing under test, is a defect.
- **Engine purity.** `src/engine/**` is framework-agnostic TypeScript: no React imports, no DOM globals (DOM *types* are fine). SDK imports only in `src/workers/*` and `src/engine/**/adapters/`. UI is thin React in `src/ui/**`; state in `src/state/**`.
- **Off the main thread.** Inference, demux, decode and encode run in `src/workers/`. The measurable gate: no main-thread long task > 50 ms attributable to engine code, and ≥ 55 FPS while transcribing. The one exception is the browser Translator/LanguageDetector API (Window-only), which must be called in yielding batches under the same 50 ms gate.
- **Verify APIs before using them.** Check signatures in docs-mcp or official docs for `@huggingface/transformers`, `mediabunny`, `sherpa-onnx`, WebCodecs, `@tanstack/react-virtual`, `vite-plugin-pwa`, the Translator API. Match docs to the **pinned** version: docs-mcp `transformers.js` indexes `main` (4.x) — for the pinned 3.8.x use the versioned docs (`https://huggingface.co/docs/transformers.js/v3.8.1/en/…`). Cite the doc URL in a code comment only where the API is surprising or a workaround.
- **Version pins are contract.** Stay on `settings.yml version_pins` (e.g. `@huggingface/transformers ~3.8.1`). Upgrades happen only in a unit that says so.
- **Dependencies.** Use what's in `settings.yml approved_dependencies` or the unit's Technical Specification. Anything else: list it under "Dependencies" in your report with the reason.
- **Privacy (SECURITY-03).** Transcript text, caption text, translations and audio-derived strings never go into logs, error messages/details, or test artifacts. Log codes and numbers.
- **Network.** Runtime requests go only to `self` and `settings.yml operations.model_hosts`. Tests never touch the network: models come from the local model cache (`pnpm models:fetch`, a setup step) or mocked workers; fixtures come from `fixtures/` (`pnpm fixtures` regenerates; never download at test time).
- **Stay in scope.** Change only what the unit needs. Note refactors you'd like under "Follow-ups" for `/ai-dlc:seed`.

## When you're stuck

Keep tests and gates honest: if a criterion can't be met, leave the test failing or skipped-with-reason and report it as a **blocker** with the measured value and what you tried. Never loosen a threshold, delete an assertion, or mark a criterion done that isn't.

## Files you own vs don't

- Yours: code, tests, fixtures, `docs/**` (incl. `docs/spikes/` reports).
- Orchestrator-owned: `.ai-dlc/**` (intent/unit/discovery/knowledge files and status flips). Propose changes in your report instead of editing them.

## Commands (quality gates)

```bash
pnpm lint                         # exit 0
pnpm typecheck                    # exit 0
pnpm test                         # exit 0 (vitest; coverage thresholds enforced — settings.yml coverage)
pnpm build && pnpm check-bundle   # initial JS ≤ 350 KB gzip (models/wasm/lazy chunks excluded)
pnpm test:e2e                     # UI/export/PWA units and every intent completion
pnpm verify:unit --from-branch    # every untagged CC-ID has a passing test → reports/criteria/<unit>.md
```

Setup (not gates): `pnpm fixtures`, `pnpm models:fetch`. Release only: `pnpm qualify` on reference hardware.

A unit is done when it meets the **unit exit gate** in `knowledge/conventions.md` § Exit gates — Completion Criteria proven **and** every gate green. Intent frontmatter `quality_gates` is what the AI-DLC harness enforces.

## Unit report (return this when you finish or stop)

```markdown
## Unit report: <unit file stem>
Status: complete | blocked | partial
### Completion criteria
(paste reports/criteria/<unit>.md — one row per CC-ID: level · tests · result)
- `[RQ]` items: qualify suite name, expected to run at the next release
- `[MANUAL]` items: who / date / browser+version / result
### Gates
lint ✓ | typecheck ✓ | test ✓ (engine cov 91%) | build+bundle ✓ (312 KB) | e2e ✓/n/a | criteria ✓
### Deviations from spec        (what and why; "none" if none)
### Contract changes            (proposed edits to architecture.md types; "none")
### Dependencies                (anything outside approved_dependencies; "none")
### Measurements                (perf/memory/WER numbers the unit produced)
### Follow-ups                  (seeds, refactors, open questions)
```

## Git

Git flow — full model in `knowledge/conventions.md` § Version control and § CI/CD.

- Branch per unit: `ai-dlc/<intent-slug>/<unit-file-stem>` **from `develop`**, PR back into `develop` — it auto-merges (squash) once every gate is green; there is no review step (solo team). `main` only receives `release/*` and `hotfix/*`.
- Conventional commits (`feat(engine): …`, `test(timeline): …`, `fix: …`) — the changelog is generated from them.
- Never commit directly to `main` or `develop`; never force-push shared branches. Merging to `develop` deploys staging automatically; merging a release to `main` deploys production automatically — so a green PR must really be shippable.

## docs-mcp libraries relevant here

`transformers.js` (main/4.x), `sherpa-onnx`, `mediabunny` (1.62.1, guide pages), `vite`, `vitest`, `playwright`, `react`, `@tanstack/react-virtual`, `chrome-built-in-ai` (Translator/LanguageDetector), `cactus-needle`, `github actions`, `ai-dlc` / `ai-dlc.dev` (workflow), `prompt engineering guide`. Not indexed yet (scrape at unit start): `vite-plugin-pwa`, `zustand`/`zundo`, `idb`, `@ffmpeg/ffmpeg`, `@testing-library/react`, Stryker, Web Audio API (MDN).

## Where agent docs live

- `.agent/AGENTS.md` (this file), `.agent/REVIEW.md` (review rules — reviewers read it with this file).
- `.ai-dlc/` is the AI-DLC workflow's own directory (intents, units, knowledge, `ELABORATION.md`) — its location is fixed by the tool.
