// Model registry (FR-03.1) — the spike-approved model catalog.
//
// Row provenance (FR-03.1: "hard-coded after spike, not runtime-fetched"):
// - Provenance (repo, 40-hex revision, per-file path/sha256/bytes) is the
//   verbatim content of `models/eval-registry.json` (written by
//   `tools/eval/pin-models.mjs`, verified by `scripts/models-fetch.ts`) for the
//   five shipped rows. Tests assert an exact match against that file — if the
//   pins rotate, regenerate these constants from it (runtime JSON import is
//   excluded here on purpose: `tsconfig.json` carries no `resolveJsonModule`
//   and the engine must not read files/network; AGENTS.md § Network).
// - Enrichment (languages, punctuation, confidence, languageDetect,
//   timestampMode, license, deviceHint, tierHint) comes from
//   `docs/spikes/model-eval-report.json` `rows[]` + `recommendation`
//   (unit-02 CC-02.11 tier defaults: T1 whisper-base, T2 sherpa-zipformer,
//   T3 cactus-whistle) and `docs/spikes/model-eval-report.md` § Recommendation.
// - `runtimeWasm` lists the same-origin runtime assets `ensureOffline` caches
//   alongside the model (FR-03.8): the self-hosted onnxruntime-web files under
//   `/wasm` (copied out of `@huggingface/transformers@3.8.1/dist` by
//   `scripts/copy-wasm.ts`, mirroring `public/wasm/`), the k2-fsa vad-asr
//   assets under `/sherpa` (mirroring `public/sherpa/`), and the vendored
//   needle runtime.
//
// Engine purity: framework-agnostic data + pure functions; no DOM globals, no
// network, no SDK imports (FR-03.5 — SDK glue lives behind worker adapters).

import type { Device, Tier } from '@engine/protocol'

export type EngineKind = 'transformers-whisper' | 'sherpa-wasm' | 'cactus-whistle'

export type TimestampMode = 'word-native' | 'word-derived' | 'segment' | 'none'

export interface ModelFile {
  path: string
  sha256: string
  bytes: number
}

export interface ModelSpec {
  id: string
  engine: EngineKind
  /** HF repo id (or `spaces/<owner>/<name>`), never fetched at runtime. */
  repo: string
  /** 40-hex pinned commit SHA — URLs are always `resolve/<revision>/...`, never `main`. */
  revision: string
  files: ModelFile[]
  /** transformers.js per-module dtype recipe, e.g. `{ encoder_model: 'fp32', decoder_model_merged: 'q4' }`. */
  dtypeRecipe?: Record<string, string>
  approxBytes: number
  /** Supported BCP-47 primary tags; `['*']` = multilingual (languageDetect decides). */
  languages: string[]
  punctuation: boolean
  confidence: boolean
  languageDetect: boolean
  timestampMode: TimestampMode
  license: string
  attribution?: string
  tierHint: Tier
  /** Same-origin paths (`/wasm/...`, `/sherpa/...`) fetched by `ensureOffline` alongside the model. */
  runtimeWasm: string[]
  enOnly: boolean
  /** FR-03.3 gate: selector refuses this model when `deviceMemGB !== null && deviceMemGB < minDeviceMemGB`. */
  minDeviceMemGB?: number
  /** HF `device` the row was measured on (provenance from the spike table). */
  deviceHint?: Device
}

export const ENGINE_KINDS: EngineKind[] = ['transformers-whisper', 'sherpa-wasm', 'cactus-whistle']

/** Whisper (transformers.js) dtype recipe settled in architecture.md and measured in the spike leak study. */
const WHISPER_DTYPE_RECIPE: Record<string, string> = { encoder_model: 'fp32', decoder_model_merged: 'q4' }

/** Self-hosted onnxruntime-web files (transformers.js engine), mirrors `public/wasm/` (`scripts/copy-wasm.ts`). */
const ORT_RUNTIME_WASM: string[] = ['/wasm/ort-wasm-simd-threaded.jsep.mjs', '/wasm/ort-wasm-simd-threaded.jsep.wasm', '/wasm/ort-wasm-simd-threaded.mjs', '/wasm/ort-wasm-simd-threaded.wasm']

/** Official k2-fsa browser wasm build of the non-streaming wasm/vad-asr path (spike slice-2C), mirrors `public/sherpa/`. */
const SHERPA_RUNTIME_WASM: string[] = ['/sherpa/sherpa-onnx-wasm-main-vad-asr.js', '/sherpa/sherpa-onnx-wasm-main-vad-asr.wasm', '/sherpa/sherpa-onnx-asr.js', '/sherpa/sherpa-onnx-vad.js']

/** Vendored cactus-needle@0.3.0 browser runtime (spike slice-2C, vendor manifest Cactus-Compute/needle3 @ 2ae11323). */
const NEEDLE_RUNTIME_WASM: string[] = ['/wasm/needle.cjs', '/wasm/needle.wasm']

/** Registry rows keyed by `ModelId` (registry key = `id`). */
export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  'whisper-base_timestamped@608c49e6': {
    id: 'whisper-base_timestamped@608c49e6',
    engine: 'transformers-whisper',
    repo: 'onnx-community/whisper-base_timestamped',
    revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
    files: [
      { path: 'config.json', sha256: 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b', bytes: 2243 },
      { path: 'generation_config.json', sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0', bytes: 3832 },
      { path: 'preprocessor_config.json', sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d', bytes: 339 },
      { path: 'tokenizer.json', sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566', bytes: 2480466 },
      { path: 'tokenizer_config.json', sha256: '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573', bytes: 282682 },
      { path: 'vocab.json', sha256: '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a', bytes: 1036584 },
      { path: 'merges.txt', sha256: '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6', bytes: 493869 },
      { path: 'normalizer.json', sha256: 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd', bytes: 52666 },
      { path: 'added_tokens.json', sha256: '9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1', bytes: 34604 },
      { path: 'special_tokens_map.json', sha256: 'e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691', bytes: 2194 },
      { path: 'onnx/encoder_model.onnx', sha256: '7fcea817bb2be4d86729b521e5a7fcbec28fa743edfed67e882b33ff15852540', bytes: 82451730 },
      { path: 'onnx/decoder_model_merged_q4.onnx', sha256: 'fc1902ce2e42c69b2346d8e2a98898c60c01da1e6a64ae90f41d22350ac7db13', bytes: 123738327 },
    ],
    dtypeRecipe: WHISPER_DTYPE_RECIPE,
    approxBytes: 211_000_000,
    languages: ['*'],
    punctuation: false, // spike row `punctuated: false` — unit-03+ punctuation pass required (FR-02.4)
    confidence: false, // spike row `confidence: false` — word probabilities not exposed
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    attribution: 'OpenAI Whisper weights converted by onnx-community (Apache-2.0)',
    tierHint: 'T1', // spike recommendation CC-02.11: T1 default
    runtimeWasm: ORT_RUNTIME_WASM,
    enOnly: false,
    deviceHint: 'webgpu',
  },
  'whisper-small_timestamped@65caa70f': {
    id: 'whisper-small_timestamped@65caa70f',
    engine: 'transformers-whisper',
    repo: 'onnx-community/whisper-small_timestamped',
    revision: '65caa70f294b46e1c33ff820aae6b16d048ab818',
    files: [
      { path: 'config.json', sha256: '457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18', bytes: 2227 },
      { path: 'generation_config.json', sha256: 'f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0', bytes: 3893 },
      { path: 'preprocessor_config.json', sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d', bytes: 339 },
      { path: 'tokenizer.json', sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566', bytes: 2480466 },
      { path: 'tokenizer_config.json', sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce', bytes: 282683 },
      { path: 'vocab.json', sha256: '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a', bytes: 1036584 },
      { path: 'merges.txt', sha256: '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6', bytes: 493869 },
      { path: 'normalizer.json', sha256: 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd', bytes: 52666 },
      { path: 'added_tokens.json', sha256: '9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1', bytes: 34604 },
      { path: 'special_tokens_map.json', sha256: 'e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691', bytes: 2194 },
      { path: 'onnx/encoder_model.onnx', sha256: 'c0908c1ef2326f5487d1f77e56c6925f910ae56c87fa269ed885682ac851e588', bytes: 352791798 },
      { path: 'onnx/decoder_model_merged_q4.onnx', sha256: '333bf5560a548e89b03abab5c4d33a7057129b08782707cebcbdf25b63588915', bytes: 233421212 },
    ],
    dtypeRecipe: WHISPER_DTYPE_RECIPE,
    approxBytes: 591_000_000,
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    attribution: 'OpenAI Whisper weights converted by onnx-community (Apache-2.0)',
    tierHint: 'T1',
    runtimeWasm: ORT_RUNTIME_WASM,
    enOnly: false,
    deviceHint: 'webgpu',
  },
  'whisper-tiny_timestamped@51724429': {
    id: 'whisper-tiny_timestamped@51724429',
    engine: 'transformers-whisper',
    repo: 'onnx-community/whisper-tiny_timestamped',
    revision: '517244293732ee2d58139af5814231b7e6830a0d',
    files: [
      { path: 'config.json', sha256: '46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d', bytes: 2243 },
      { path: 'generation_config.json', sha256: 'f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1', bytes: 3772 },
      { path: 'preprocessor_config.json', sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d', bytes: 339 },
      { path: 'tokenizer.json', sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566', bytes: 2480466 },
      { path: 'tokenizer_config.json', sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce', bytes: 282683 },
      { path: 'vocab.json', sha256: '50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a', bytes: 1036584 },
      { path: 'merges.txt', sha256: '2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6', bytes: 493869 },
      { path: 'normalizer.json', sha256: 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd', bytes: 52666 },
      { path: 'added_tokens.json', sha256: '9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1', bytes: 34604 },
      { path: 'special_tokens_map.json', sha256: 'e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691', bytes: 2194 },
      { path: 'onnx/encoder_model.onnx', sha256: '8944ec04111e040305cdb07ac97f50363024255bf0bdc67ab93ecb76645f31ae', bytes: 32894434 },
      { path: 'onnx/decoder_model_merged_q4.onnx', sha256: 'a3308674834b99123b32c33e3577b09b6547df8c3cea16b5f1d0c36ebbd02b1f', bytes: 86804581 },
    ],
    dtypeRecipe: WHISPER_DTYPE_RECIPE,
    approxBytes: 125_000_000,
    languages: ['*'],
    punctuation: false,
    confidence: false,
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    attribution: 'OpenAI Whisper weights converted by onnx-community (Apache-2.0)',
    tierHint: 'T2', // spike row measured on device:wasm (settings.yml wasm best-effort tier)
    runtimeWasm: ORT_RUNTIME_WASM,
    enOnly: false,
    deviceHint: 'wasm',
  },
  'sherpa-zipformer-en-int8@11a70a47': {
    id: 'sherpa-zipformer-en-int8@11a70a47',
    engine: 'sherpa-wasm',
    repo: 'csukuangfj/sherpa-onnx-zipformer-en-2023-06-26',
    revision: '11a70a47ec5fd969c17b8d0818681d222a147781',
    files: [
      { path: 'encoder-epoch-99-avg-1.int8.onnx', sha256: '52a48f46c17b19a36fe3927c4d59479bb16eeb2493313ed82c4bf775c2cb8bc8', bytes: 68778564 },
      { path: 'decoder-epoch-99-avg-1.int8.onnx', sha256: '783cd6b23b8db8e14a43804ecf972ae96e71499cce799e334ab95c961800d797', bytes: 1307236 },
      { path: 'joiner-epoch-99-avg-1.int8.onnx', sha256: '48de5d6467a2ab1e72cb5c4d828330be06524d877bc458118b6a4198ca031357', bytes: 259335 },
      { path: 'tokens.txt', sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb', bytes: 5048 },
    ],
    approxBytes: 71_000_000,
    languages: ['en'], // en-2023-06-26 checkpoint — English only (US-1.1.2 `enOnly` badge)
    punctuation: false,
    confidence: false,
    languageDetect: false, // spike row `lang: false`
    timestampMode: 'word-native', // transducer per-token starts, ends estimated (spike note)
    license: 'Apache-2.0',
    attribution: 'k2-fsa sherpa-onnx Zipformer-en 2023-06-26 (Apache-2.0)',
    tierHint: 'T2', // spike recommendation CC-02.11: T2 default
    runtimeWasm: SHERPA_RUNTIME_WASM,
    enOnly: true,
    deviceHint: 'wasm',
  },
  'cactus-whistle@b358ddad': {
    id: 'cactus-whistle@b358ddad',
    engine: 'cactus-whistle',
    repo: 'Cactus-Compute/whistle',
    revision: 'b358ddadd89b7a713b5aa131f23032d3cca1b251',
    files: [{ path: 'whistle.cact', sha256: 'b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb', bytes: 16919407 }],
    approxBytes: 17_000_000,
    languages: ['*'], // "7 langs" per the spike row; the list is not enumerated in the report → multilingual + languageDetect
    punctuation: true, // spike row `punct: true`
    confidence: true, // spike row `conf: true`
    languageDetect: true,
    timestampMode: 'word-native',
    license: 'Apache-2.0',
    attribution: 'Cactus-Compute Whistle (Apache-2.0)',
    tierHint: 'T3', // spike recommendation CC-02.11: T3 default (measured on the T2 profile, chosen for the limited tier)
    runtimeWasm: NEEDLE_RUNTIME_WASM,
    enOnly: false,
    deviceHint: 'wasm',
  },
}

/** Spike recommendation (unit-02 CC-02.11): T1 whisper-base, T2 sherpa-zipformer, T3 whistle. */
export const TIER_DEFAULT_MODEL: Record<'T1' | 'T2' | 'T3', string> = {
  T1: 'whisper-base_timestamped@608c49e6',
  T2: 'sherpa-zipformer-en-int8@11a70a47',
  T3: 'cactus-whistle@b358ddad',
}

export function getModel(id: string): ModelSpec | undefined {
  return MODEL_REGISTRY[id]
}

/** `https://huggingface.co/<repo>/resolve/<revision>/<path>` — never `resolve/main/` (FR-03.6). */
export function modelFileUrl(spec: ModelSpec, file: ModelFile): string {
  return `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file.path}`
}
