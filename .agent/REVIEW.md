# Review Guidelines — Zipscribe

Project code-review rules for every reviewer — the pipeline `reviewer` subagent and anyone else reviewing a diff — read together with `.agent/AGENTS.md`. Findings that violate an "Always check" item are **HIGH** severity.

## Always check

1. **SECURITY-03 privacy**: no transcript/caption/translation text or audio-derived strings in `console.*`, thrown error messages, `EngineError.detail`, notices, telemetry, or committed test artifacts. Errors carry codes and numbers only.
2. **Network allowlist**: no new runtime origin outside `self` + `.ai-dlc/settings.yml operations.model_hosts`; no CDN-hosted wasm/scripts; CSP in `public/_headers` matches the allowlist; the service worker never caches model-host responses.
3. **Engine purity**: `src/engine/**` has no React imports and no DOM globals (`document`, `window`, `localStorage`); SDK imports (`@huggingface/transformers`, `mediabunny`, `sherpa-onnx`, `@ffmpeg/*`, `self.Translator`) only in `src/workers/*`, `src/engine/**/adapters/**`, or `src/engine/translate/chrome-translator.ts`.
4. **Main thread**: no inference/decode/encode on the main thread; Translator API calls batched with yields.
5. **Contract drift**: `src/engine/model.ts` / `protocol.ts` changed without a matching `knowledge/architecture.md` change, or types redefined elsewhere instead of imported.
6. **Domain invariants** (`knowledge/domain.md` 1–12): reducers/commands that can produce overlapping blocks, empty blocks, dangling speaker or translation-entry ids, or that move media/later blocks on delete.
7. **Undo**: every user-visible mutation goes through a registered command; machine job output (transcription segments, translation runs) is not pushed onto history.
8. **Version pins / dependencies**: changes to pinned versions (`settings.yml version_pins`) or new packages outside `approved_dependencies` without a unit that authorizes them.
9. **Test integrity**: weakened thresholds, deleted assertions, `.only`, unexplained `.skip`, tests that mock the unit under test, network access in tests, wall-clock assertions under 10 s in per-PR suites.
10. **Honest capability UX**: options offered that the current tier/browser can't run (MP4 burn-in without `AudioEncoder`, translation without `Translator`); any burn-in UI rendered for an audio project; silent degradation without a notice.
11. **Keyboard**: `onKeyDown` outside `ui/commands/**`, `ui/**/editable/**`, `TimecodeInput`; bindings not in the `knowledge/design.md` shortcut table.
12. **Service worker safety**: `registerType` other than `prompt`, auto-reloads, precache over budget, SW enabled in dev.
13. **Criterion traceability**: a changed or new Completion Criterion without a test citing its `CC-…` ID (or the right `[RQ]`/`[DEPLOY]`/`[MANUAL]` tag); tests citing unknown IDs; renumbered or reused IDs.
14. **Git flow & deploy safety**: PRs into `main` from anything but `release/*`/`hotfix/*`; workflow changes that deploy an artifact other than the one tested, skip post-deploy smoke, or remove automatic rollback.

## Skip

- `fixtures/**` binary media and generated goldens (review the generator script instead)
- `pnpm-lock.yaml`
- `docs/spikes/**` measurement tables (review conclusions, not numbers)
- `.ai-dlc/**` (spec changes are reviewed in spec PRs, not code review)
