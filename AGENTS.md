# Zipscribe — Agent Instructions (opencode + sub-agents)

Permanent instructions for any agent (orchestrator or sub-agent) working in this repo.

## Read first, in order

1. `.ai-dlc/settings.yml` — stack, quality gates, reference hardware
2. `.ai-dlc/knowledge/` — architecture, design, product, domain, conventions
3. The active intent's `intent.md`, `discovery.md`, and the unit file you are building
4. `README.md` for context

## Ground rules

- **TDD.** Write the failing test first; unit tests live next to source as `*.test.ts` (vitest), e2e in `e2e/` (playwright). Tests must assert behavior described in the unit's acceptance criteria — tautological or over-mocked tests are defects.
- **Engine purity.** Everything under `src/engine/**` is framework-agnostic TypeScript with **zero React/DOM imports** — it must stay unit-testable in plain vitest (jsdom only at the boundary). UI is thin React in `src/ui/**`, state in `src/state/**`.
- **Do not guess APIs.** `@huggingface/transformers`, `mediabunny`, `sherpa-onnx`, WebCodecs, `@tanstack/react-virtual` — verify signatures against docs-mcp (`transformers.js`, `sherpa-onnx` indexed; ask the orchestrator to scrape `mediabunny` etc. if missing) or official docs before use. Cite the doc URL in code comments only where the API is surprising or a workaround (see `discovery.md` for known issues like transformers.js issue #1739).
- **Version pins are contract.** `@huggingface/transformers` stays on the pinned 3.x line until a documented migration unit bumps it. Do not "upgrade while working".
- **No new dependencies** outside the unit's declared stack without noting it in the unit's Dependencies section in your report.
- **`.ai-dlc/**` is the workflow's state.** Do not edit intent/unit/discovery files (status flips happen at unit completion; orchestrator-owned). Code, tests, and fixtures are yours.
- **WebGPU never blocks the main thread.** All inference runs in `src/workers/`; the main thread must stay at 60 FPS during transcription (this is a testable gate, not a vibe).

## Commands (quality gates)

```bash
pnpm lint          # must pass (exit 0)
pnpm typecheck     # must pass (exit 0)
pnpm test          # must pass (exit 0)
pnpm test:e2e      # required at intent completion and for UI/export units
pnpm build         # must succeed; initial JS budget ≤ 350 KB gzip (models/wasm excluded)
```

A unit is done only when its own Completion Criteria check off **and** all gates pass.

## Git

- Branch per unit: `ai-dlc/<intent>/<unit-slug>` from `main`.
- Conventional commits (`feat(scope): ...`, `test: ...`, `fix: ...`).
- Never commit directly to `main`; never force-push shared branches.

## Fixtures

Test media lives in `fixtures/` (small ffmpeg-generated clips, committed to the repo). Regenerate with `pnpm fixtures` (script from unit-01). Never download fixtures at test time.
