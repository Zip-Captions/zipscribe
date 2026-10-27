---
status: pending
discipline: dev
depends_on: [unit-02-model-eval-spike]
workflow: tdd
mode: HITL   # pins runtime versions & tier logic everything else rides on
---

# Unit 03: Model Manager & Registry

## Description

Multi-engine model registry (populated from the spike report), capability detection, tier→(engine,model) selection, Cache-API downloads with progress + checksum verification, warm-up compile, unload. Implements FR-1.1 family of the original brief; engine abstraction so B/C candidates from the spike slot in without pipeline changes.

## User Stories

**US-1.1.1** (orig. FR-1.1.1) As a user on any WebGPU browser, I want hardware detected and the right tier chosen automatically, so that I never configure anything.
- *Given* `navigator.gpu` absent, *when* boot, *then* tier = T2 and `model:ready` reports `tier:'wasm'`.
- *Given* adapter request fails, *when* load, *then* automatic retry on T2 with user-facing notice event.
- *Given* T4 (no WebGPU, no WASM-SIMD, or < 4 GB memory), *when* boot, *then* blocked state published with reasons; zero downloads attempted.

**US-1.1.2** (orig. FR-1.1.2) As a user, I want model choice with sizes and caching, so first runs are fast and repeat runs instant.
- *Given* the registry (spike-approved models, labeled sizes, `enOnly` flags, multilingual badges), *when* a model is selected, *then* download streams via HF CDN with `model:progress` events.
- *Given* a cached model, *when* reloaded, *then* zero `huggingface.co` requests.
- *Given* corrupted cache (SHA-256 mismatch), *when* load, *then* `model:error` code `CACHE_CORRUPT` → automatic re-download.

**US-1.1.3** (orig. FR-1.1.3) As a user, I want honest progress so I know download vs compile.
- *Given* load, *when* phases occur, *then* `model:progress` emits `phase:'download'` then `phase:'compile'` (warm-up) before `model:ready`.

**US-1.1.4** As the product, I want large downloads gated.
- *Given* a model > 100 MB (zip-captions catalog convention), *when* selected, *then* a user-confirmation event is required before bytes move.

## Functional Requirements

- **FR-03.1** `engine/model/registry.ts`: `EngineKind = 'transformers-whisper' | 'sherpa-wasm' | 'cactus-whistle'`; `ModelSpec { id, engine, repo, dtypeRecipe?, approxBytes, languages, punctuation, timestampMode, license, tierHint }`. Rows imported from `spikes/model-eval-report.md` recommendation — hard-coded after spike, not runtime-fetched in v1 (catalog JSON deferred).
- **FR-03.2** `capability.ts`: pure `probeCapabilities(env) → Capabilities { tier T1–T4, webgpuAdapter, wasmSimd, audioDecoder, audioEncoder, deviceMemGB }` (injected env; T-table from `knowledge/architecture.md`).
- **FR-03.3** `tierSelector(capabilities, opts) → { engine, model, tier }` per spike defaults, overridable by user model choice; device-memory gate blocks `large-v3-turbo`/Parakeet below 16 GB.
- **FR-03.4** Manager lifecycle: `loadModel(id) → ready | error`, `unload()`, single-flight coalescing, `cancelLoad()`.
- **FR-03.5** transformers.js imported **only** behind `EngineKind:'transformers-whisper'` worker glue; sherpa/cactus glue likewise isolated per engine.
- **FR-03.6** All model bytes verified against registry SHA-256; cache key `zipscribe-models`.
- **FR-03.7** Registry entries' repo reachability exercised by `@network`-tagged integration test (manual; CI skips).

## Technical Specification

Contracts in `src/engine/model/{registry,capability,cache}.ts`; `EngineRequest`/`EngineEvent` per `knowledge/architecture.md` (note: `transcribe` carries `PcmSource` — see unit-05; loading events unchanged).

## Completion Criteria

- [ ] Registry populated from spike report (all recommended tiers covered) with license + punctuation + timestampMode fields filled
- [ ] Tier matrix unit-tested T1–T4 via fake envs incl. adapter-reject and low-memory paths
- [ ] Playwright: cache-hit load asserts 0 HF requests (route spy)
- [ ] Single-flight + cancelLoad tested; `unload()` → subsequent job errors with `MODEL_UNLOADED`
- [ ] > 100 MB confirmation gate tested; SHA-256 tamper test yields `CACHE_CORRUPT` + redownload
- [ ] Coverage ≥ 85% on `engine/model/**`

## Risks

- Cache API eviction (Safari quotas) → checksum on every cache read.
- Engine-specific import shapes leaking into the pipeline → boundary lint test: only `workers/*.worker.ts` may import engine SDKs.

## Docs to consult

- docs-mcp `transformers.js` → `/api/env`, `/guides/dtypes`, `/guides/webgpu`; `sherpa-onnx` → wasm build; ORT Web env flags: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- Catalog/checksum convention prior art: `zip-captions-monorepo/packages/zip_core/lib/src/constants/catalog_constants.dart`
