---
status: done-with-followups   # merged (PR #6); follow-ups: HITL registry/runtime pin approval (revert point af06525), FR-03.7 @network manual run, registry v2 runtimeWasm SHAs, sherpa-onnx devDep removal
phase: mvp
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
- *Given* `navigator.gpu` absent, *when* boot, *then* tier = `T2` and `model:ready` reports `device:'wasm'`.
- *Given* adapter request fails, *when* load, *then* automatic retry on T2 with user-facing notice event.
- *Given* T4 (no WebGPU, no WASM-SIMD, or < 4 GB memory), *when* boot, *then* blocked state published with reasons; zero downloads attempted.

**US-1.1.2** (orig. FR-1.1.2) As a user, I want model choice with sizes and caching, so first runs are fast and repeat runs instant.
- *Given* the registry (spike-approved models, labeled sizes, `enOnly` flags, multilingual badges), *when* a model is selected, *then* download streams via HF CDN with `model:progress` events.
- *Given* a cached model, *when* reloaded, *then* zero requests to any `operations.model_hosts` origin.
- *Given* corrupted cache (SHA-256 mismatch), *when* load, *then* `model:error` code `CACHE_CORRUPT` → corrupt entries evicted → one automatic re-download (a second mismatch surfaces the error; no loop).
- *Given* the network drops mid-download, *when* the fetch fails, *then* `model:error {code:'NETWORK', retryable:true}` and no partial file remains in the cache.

**US-1.1.3** (orig. FR-1.1.3) As a user, I want honest progress so I know download vs compile.
- *Given* load, *when* phases occur, *then* `model:progress` emits `phase:'download'` then `phase:'compile'` (warm-up) before `model:ready`.

**US-1.1.4** As the product, I want large downloads gated.
- *Given* a model > 100 MB (zip-captions catalog convention), *when* selected, *then* `model:confirm-required {bytes}` is emitted and no bytes move until `confirmDownload` arrives.

**US-03.1** As a user who works offline, I want to make chosen models available offline and see what's stored (engine half of unit-204's "Offline models" panel).
- *Given* `ensureOffline(modelId)`, *when* called online, *then* every model file **and** the runtime wasm it needs are fetched, SHA-256-verified and cached; `listCached()` then reports it `offlineReady: true` with bytes on disk.
- *Given* the network is offline and the model is not cached, *when* `loadModel` is called, *then* it fails immediately with an `OFFLINE_MODEL_MISSING` notice — no fetch attempted, no hang.
- *Given* `removeCached(modelId)`, *when* called, *then* its cache entries are deleted and `navigator.storage.estimate()` usage drops accordingly.

## Functional Requirements

- **FR-03.1** `engine/model/registry.ts`: `EngineKind = 'transformers-whisper' | 'sherpa-wasm' | 'cactus-whistle'`; `ModelSpec { id, engine, repo, revision /* commit SHA */, files: {path, sha256, bytes}[], dtypeRecipe?, approxBytes, languages, punctuation, confidence, languageDetect, timestampMode, license, attribution?, tierHint, runtimeWasm: string[] }`. Rows imported from `docs/spikes/model-eval-report.md` recommendation — hard-coded after spike, not runtime-fetched in v1 (catalog JSON deferred).
- **FR-03.2** `capability.ts`: pure `probeCapabilities(env) → Capabilities { tier: Tier, webgpuAdapter, wasmSimd, audioDecoder, audioEncoder, videoEncoder, deviceMemGB: number | null, online: boolean }` (injected env; T-table from `knowledge/architecture.md`; `deviceMemGB` null when the browser doesn't expose it — never blocks).
- **FR-03.8** Offline API: `ensureOffline(id)`, `listCached() → {id, bytes, offlineReady, verifiedAt}[]`, `removeCached(id)`; runtime wasm files listed in `ModelSpec.runtimeWasm` are cached alongside the model (same-origin `/wasm/*` — the service worker may also hold them; double caching of wasm is acceptable, of models is not).
- **FR-03.3** `tierSelector(capabilities, opts) → { engine, model, tier }` per spike defaults, overridable by user model choice; device-memory gate blocks `large-v3-turbo`/Parakeet below 16 GB.
- **FR-03.4** Manager lifecycle: `loadModel(id) → ready | error`, `unload()`, single-flight coalescing, `cancelLoad()`.
- **FR-03.5** transformers.js imported **only** behind `EngineKind:'transformers-whisper'` worker glue; sherpa/cactus glue likewise isolated per engine.
- **FR-03.6** All model bytes verified against registry SHA-256 at the pinned `revision` (URLs use `resolve/<revision>/…`, never `main`); cache name `zipscribe-models`. transformers.js fetches are routed through our cache adapter (`env.useCustomCache`/`env.customCache` — confirm names in 3.8.1 docs) so verification happens on write and on read.
- **FR-03.7** Registry entries' repo reachability exercised by `@network`-tagged integration test (manual; CI skips).

## Technical Specification

Contracts in `src/engine/model/{registry,capability,cache}.ts`; `AsrRequest`/`ModelEvent` per `knowledge/architecture.md` (`loadModel {model, device}`, `confirmDownload`, `model:confirm-required|progress|ready|error`). Tier (`T1–T4`) is computed on the main thread by `probeCapabilities`; workers only ever see a `Device`.

## Completion Criteria

- [ ] **CC-03.1** Registry populated from spike report (all recommended tiers covered) with license + punctuation + timestampMode fields filled
- [ ] **CC-03.2** Tier matrix unit-tested T1–T4 via fake envs incl. adapter-reject and low-memory paths
- [ ] **CC-03.3** Playwright: cache-hit load asserts 0 model-host requests (route spy); offline (`context.setOffline(true)`) load of a cached model succeeds; offline load of an uncached model emits `OFFLINE_MODEL_MISSING` within 1 s
- [ ] **CC-03.4** `ensureOffline` / `listCached` / `removeCached` tested (fake Cache API + storage estimate)
- [ ] **CC-03.5** Network-drop mid-download test: `NETWORK` error, no partial cache entry
- [ ] **CC-03.6** Single-flight + cancelLoad tested; `unload()` → subsequent job errors with `MODEL_UNLOADED`
- [ ] **CC-03.7** > 100 MB confirmation gate tested; SHA-256 tamper test yields `CACHE_CORRUPT` + redownload
- [ ] **CC-03.8** Coverage ≥ 85% on `engine/model/**`

## Risks

- Cache API eviction (Safari quotas) → checksum on every cache read.
- Engine-specific import shapes leaking into the pipeline → boundary lint test: only `workers/*.worker.ts` may import engine SDKs.

## Docs to consult

- docs-mcp `transformers.js` → `/api/env`, `/guides/dtypes`, `/guides/webgpu`; `sherpa-onnx` → wasm build; ORT Web env flags: https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html
- Catalog/checksum convention prior art: `zip-captions-monorepo/packages/zip_core/lib/src/constants/catalog_constants.dart`
