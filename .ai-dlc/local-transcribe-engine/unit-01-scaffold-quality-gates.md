---
status: done-with-followups   # merged (PR #3 + #4); follow-ups: CC-01.14/15/16 [DEPLOY] awaiting-credentials (phase 2), Pro-plan branch protection, corpus vendoring
phase: mvp
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
- *Given* `pnpm fixtures`, *when* run, *then* `fixtures/` contains the eval corpus per the zip-captions Spike-1.4 corpus design (`zip-captions-monorepo/aidlc-docs/construction/spikes/spike-1.4-plan.md:105-113`): `tone-30s.wav` + `speech-2min.mp4` (single speaker) + `speech-2spk-2min.mp4` (two voices, word-level ground-truth JSON incl. speaker labels) + `speech-10min.mp4` + `audio-120min.mp4` (perf-only, **generated, gitignored**) + **taxonomy set: 4–6 `en-clean`, 2 `en-accented`, 1 `en-technical` (domain vocabulary for hotword eval), 1 `en-noisy`, 2 `fr-clean`** — each 30–60 s, H.264 video (solid-color 320×180 is fine) + AAC audio, with reference-transcript JSON and **word-level reference timings**; plus `harness/manifest.json`.
- *Given* the generated `audio-120min.mp4`, *when* regenerated on another machine, *then* its SHA-256 matches the manifest (deterministic concat of committed sources; ffmpeg flags pinned).
- *Given* `pnpm fixtures`, *when* run, *then* `fixtures/audio/` contains the **audio format matrix**, all transcoded from one 30 s speech excerpt with a 16 kHz WAV reference (`fmt-30s.ref.wav`): native set `fmt-30s.mp3` (CBR 128k), `fmt-30s.vbr.mp3` (VBR + Xing header), `.m4a` (AAC-LC), `.m4b`, `.aac` (ADTS), `.wav` (PCM16 44.1 kHz stereo), `.flac`, `.ogg` (Vorbis), `.oga`, `.opus` (Ogg Opus), `.weba` (WebM Opus), `.mka`; fallback set `.aiff`, `.alac.m4a`, `.wma`, `.amr`, `.3gp`, `.caf`; plus `speech-2min.m4a` and `speech-2spk-2min.m4a` (audio-only twins of the video fixtures, same ground truth), `tones-220-1k-5k-10s.wav` (three steady sine tones for visualizer peak tests), `sweep-20-20k-10s.flac` (log sweep), `silence-10s.wav`, and `not-audio.mp3` (random bytes with an `.mp3` name). Each entry in the manifest has `codec`, `sampleRate`, `channels`, `expectedPath: 'webcodecs'|'ffmpeg'` and the reference WAV it derives from.
- *Given* a corrupted fixture file, *when* `pnpm test`, *then* fixture verification fails loudly with the checksum diff.
- *Given* any fixture missing its license record, *when* CI `fixtures-verify` runs, *then* it fails (`fixtures/LICENSES.md` completeness).

## Functional Requirements

- **FR-1.0.1** Vite 7 + React 19 + TS 5 strict (`noUncheckedIndexedAccess`) project, pnpm. Path alias `@engine/*`, `@state/*`, `@ui/*`.
- **FR-1.0.2** Workers wired via Vite `?worker` imports; worker entry stubs exist for all four workers from `knowledge/architecture.md` module map, each typed with its own request/event union (`MediaRequest/MediaEvent`, `AsrRequest/AsrEvent`, `DiarizeRequest/DiarizeEvent`, `ExportRequest/ExportEvent`) as no-ops.
- **FR-1.0.9** Runtime wasm self-hosting: build step copies the pinned onnxruntime-web wasm/mjs files into `public/wasm/` (hashed or versioned path); a boot-time config sets `env.backends.onnx.wasm.wasmPaths = '/wasm/'` and `numThreads = 1`. Test: a production build makes no request to any CDN for wasm.
- **FR-1.0.10** Test preview server: `pnpm preview:isolated` serves `dist/` with `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` for memory-gate specs only (Playwright project `memory`); the default preview and production never send them.
- **FR-1.0.11** Exact resolved versions of every `stack` dependency recorded in the unit report (and `version_pins` patched for mediabunny). Resolve the `vite@7` vs `vite@8` decision (settings note) by checking vitest + `vite-plugin-pwa` peer ranges; record the choice.
- **FR-1.0.3** vitest: environment `node` default, `jsdom` opt-in per file; coverage config with the ≥ 85% engine gate reported.
- **FR-1.0.4** Playwright: chromium project configured; webkit project present but `test.skip` by default (enabled per-unit).
- **FR-1.0.5** ESLint 9 flat + typescript-eslint (type-checked) + prettier. For `src/engine/**`: `no-restricted-imports` blocks `react`, `react-dom` and SDK packages outside `**/adapters/**`; `no-restricted-globals` blocks `document`, `window`, `localStorage` (DOM *types* stay allowed — see conventions).
- **FR-1.0.6** `pnpm check-bundle`: post-build script asserting initial JS ≤ 350 KB gzip; lazy chunks (workers/ffmpeg/mediabunny) excluded via config manifest.
- **FR-1.0.7** Git flow + PR pipeline (`knowledge/conventions.md` § Version control, § CI/CD): create `develop` from `main` and make it the default branch; branch protection on `main` and `develop` (required checks, no direct/force pushes) + `branch-policy` check (PRs into `main` only from `release/*`/`hotfix/*`); `.github/workflows/ci.yml` for PRs into `develop`, `release/*`, `main`: install (pnpm cache) → lint → typecheck → test (coverage thresholds) → build → check-bundle → `models:fetch` (cached by registry hash) → Playwright (chromium + webkit, sharded) → `verify:unit` for changed unit files → upload coverage/JUnit/criteria reports. `.github/pull_request_template.md` with unit link + criteria table section.
- **FR-1.0.13** Continuous deployment from day one (all four workflows in conventions § CI/CD, minimal smoke): PR → preview deploy + comment; `develop` → staging; `start-release.yml` (cut `release/X.Y.Z`, bump, changelog, PR into `main`); `main` → production + tag + GitHub Release + back-merge PR + automatic rollback on failed smoke. Smoke at this stage = app boots, version/hash visible, zero console errors. unit-203 hardens it (full L7 suite, headers/CSP, Lighthouse, attribution, rehearsal). Requires the owner to create the Cloudflare Pages project and the GitHub Environment secrets (HITL step, recorded in the report).
- **FR-1.0.12** Test harness per `knowledge/conventions.md` § Testing strategy → "Who builds what": `scripts/spec-lint.ts` (criteria IDs, `depends_on`, frontmatter), `scripts/license-check.ts`, `scripts/verify-criteria.ts` (`verify:unit`, `verify:intent`, `--from-branch`), `scripts/models-fetch.ts` (`models:fetch`, SHA-256-verified, `.cache/models/`), `src/test-support/` (fake workers, fake clock, fake media element + AnalyserNode, fake storage, canary-transcript redaction spy), Playwright fixtures for the request audit (network blocked except localhost) and the CSP-violation listener, vitest `coverage.thresholds` from `settings.yml coverage`, Playwright `retries: 1` with retry-pass detection that fails the run.
- **FR-1.0.8** Empty workbench shell route (`/` renders header bar + empty panels from `ui/shell`) with one Playwright smoke test asserting render.

## Technical Specification

- Root files: `package.json` (engines, scripts: dev/build/test/test:e2e/lint/typecheck/fixtures/check-bundle), `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json` (+ `.node.json` for tooling), `eslint.config.js`, `.prettierrc`.
- `scripts/make-fixtures.ts` — ffmpeg-invoking (ffmpeg via `ffmpeg-static` devDependency); speech fixtures produced from vendored, openly licensed audio (`fixtures/sources/`, licenses in `fixtures/LICENSES.md`). `harness/manifest.json` schema:
  `{ "files": { "<name>": { "sha256": string, "duration": number, "kind": "tone"|"speech"|"speech-2spk"|"perf", "language": string|null, "category": "en-clean"|"en-accented"|"en-technical"|"en-noisy"|"fr-clean"|null, "groundTruth": string|null, "generated": boolean, "license": string } } }` (`groundTruth` = path to `{words:[{text,start,end,speaker?}]}` JSON).
- **Candidate sources (verify license at unit start; no NC licenses):** LibriSpeech `test-clean` (CC BY 4.0) for `en-clean` + transcripts; word timings from a forced-alignment pass run once at fixture-authoring time (committed, never at test time); `speech-2spk-2min` synthesized by interleaving utterances from two LibriSpeech speakers (ground truth exact by construction); Common Voice (CC0) for `en-accented` + `fr-clean`; `en-noisy` = clean clip mixed with CC-BY noise (e.g. MUSAN) at a fixed SNR; `en-technical` = recorded in-house or CC0. L2-ARCTIC / Speech Accent Archive are NC/SA — **do not use**.
- Repo size budget: committed fixtures ≤ 50 MB total (the audio matrix is ~10 MB at 30 s per format); anything larger is generated by `pnpm fixtures` and gitignored.
- Codecs the pinned `ffmpeg-static` build can't encode (check WMA/AMR/ALAC/CAF muxers at unit start) are produced once with a full ffmpeg and committed with a note in `fixtures/LICENSES.md` — never generated at test time.
- `scripts/check-bundle.mjs` — reads `dist/`, gzips initial-entry chunks, compares to budget from `bundle-budget.json`.
- `src/main.tsx`, `src/App.tsx` (shell only), `src/engine/protocol.ts` + `src/engine/model.ts` **created verbatim from `knowledge/architecture.md`** (these two files ARE the contract; other units import, never redefine).

## Completion Criteria

- [ ] **CC-01.1** All five gate commands exit 0 locally and in CI on the unit branch
- [ ] **CC-01.2** `pnpm fixtures` regenerates `fixtures/` matching committed checksums (CI job `fixtures-verify`)
- [ ] **CC-01.3** `src/engine/**` files reject React/DOM imports at lint level (negative test in `eslint.config` fixture test)
- [ ] **CC-01.4** `pnpm check-bundle` fails when a 400 KB-gzip dummy chunk is injected (negative test)
- [ ] **CC-01.5** Playwright smoke passes (chromium)
- [ ] **CC-01.6** Production build request audit: zero CDN requests for wasm (FR-1.0.9); `preview:isolated` reports `crossOriginIsolated === true`, default preview reports `false`
- [ ] **CC-01.7** Committed fixtures ≤ 50 MB; `fixtures/LICENSES.md` lists every source with license + URL
- [ ] **CC-01.8** Audio format matrix present and manifest-verified (every file from US-1.0.2's audio list, with codec/sampleRate/channels/expectedPath)
- [ ] **CC-01.9** `verify:unit` negative tests: fails for an untagged criterion with no test, for a test citing an unknown CC-ID, and passes when every criterion is covered (fixture unit file)
- [ ] **CC-01.10** Redaction harness negative test: a deliberate `console.log` of the canary marker fails the suite
- [ ] **CC-01.11** Coverage thresholds enforced: dropping engine coverage below 85% fails `pnpm test` (negative test)
- [ ] **CC-01.12** A test that passes only on Playwright retry fails the CI run (negative test)
- [ ] **CC-01.13** `develop` exists and is the default branch; a PR from a feature branch into `main` is rejected by `branch-policy`
- [ ] **CC-01.14** `[DEPLOY]` This unit's PR gets a preview URL comment; merging it deploys staging; smoke passes on both
- [ ] **CC-01.15** `[DEPLOY]` First release `0.1.0` cut via "Start release", merged to `main`, deployed to production, tagged, back-merged into `develop` (qualification file = unit-01 scope only: gates + smoke)
- [ ] **CC-01.16** `[DEPLOY]` Forced smoke failure on a throwaway production deploy (test hook) rolls back automatically

## Risks

- ffmpeg-static licensing (LGPL/GPL builds) — verify build used; document in `fixtures/LICENSES.md`.
- Worker type-safety across main/worker boundary — protocol types must be the only shared surface.

## Docs to consult

- vite.workers: https://vite.dev/guide/workers · docs-mcp `vite`, `vitest`, `playwright` · transformers.js env (3.8.1 versioned docs, not docs-mcp `main`): `env.backends.onnx.wasm`
