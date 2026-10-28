// tools/eval/pin-models.mjs — unit-02 (FR-02.9): pin every evaluated model to
// its HF commit SHA (`x-repo-commit` on the resolve endpoint, per
// discovery.md § Verified during spec review) and record per-file SHA-256.
// Writes `models/eval-registry.json` in the shape scripts/models-fetch.ts
// consumes (`--registry models/eval-registry.json` verifies every byte).
//
// Network: huggingface.co only (settings.yml operations.model_hosts allowlist,
// same policy as scripts/models-fetch.ts). This is a setup step, never a test.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CACHE = join(repoRoot, '.cache', 'models')

function allowedHost(host) {
  return host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')
}

// The evaluated model set (unit spec Candidates table + the pinned dtype
// recipe encoder:fp32 / decoder_merged:q4, discovery.md § Whisper on WebGPU).
const WHISPER_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'normalizer.json',
  'added_tokens.json',
  'special_tokens_map.json',
  'onnx/encoder_model.onnx',
  'onnx/decoder_model_merged_q4.onnx',
]

const SHERPA_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
const ZIPFORMER_FILES = ['encoder-epoch-99-avg-1.int8.onnx', 'decoder-epoch-99-avg-1.int8.onnx', 'joiner-epoch-99-avg-1.int8.onnx', 'tokens.txt']
// Slice 2C: the engine B runtime is the OFFICIAL k2-fsa browser build of the
// non-streaming wasm/vad-asr path, published by the project as a Hugging Face
// Space (docs-mcp sherpa-onnx: k2-fsa.github.io/sherpa/onnx/wasm — the npm
// `sherpa-onnx` package ships only the node-targeted wasm build; prebuilt
// browser bundles otherwise live on github.com releases, outside the
// settings.yml allowlist). Space files are served from huggingface.co
// (allowlisted); the .wasm SHA-256 equals the LFS oid reported by
// https://huggingface.co/api/spaces/<repo>/tree/main — cross-verified 2026-10-28.
const SHERPA_WASM_FILES = ['sherpa-onnx-wasm-main-vad-asr.js', 'sherpa-onnx-wasm-main-vad-asr.wasm', 'sherpa-onnx-asr.js', 'sherpa-onnx-vad.js']

const MODELS = {
  'whisper-tiny-timestamped': { repo: 'onnx-community/whisper-tiny_timestamped', description: 'Engine A T1/T2 ASR (whisper-tiny, word-timestamp DTW weights)', files: WHISPER_FILES },
  'whisper-base-timestamped': { repo: 'onnx-community/whisper-base_timestamped', description: 'Engine A T1 ASR (whisper-base, CC-02.7 baseline row)', files: WHISPER_FILES },
  'whisper-small-timestamped': { repo: 'onnx-community/whisper-small_timestamped', description: 'Engine A T1 ASR (whisper-small, #1739 leak study + row)', files: WHISPER_FILES },
  'sherpa-parakeet-06b-v3-int8': {
    repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    description: 'Engine B multilingual candidate (Parakeet TDT 0.6B v3 int8, CC-02.8 loadability verdict)',
    files: SHERPA_FILES,
  },
  'sherpa-zipformer-en-int8': {
    repo: 'csukuangfj/sherpa-onnx-zipformer-en-2023-06-26',
    description: 'Engine B reference row (Zipformer-en int8, non-streaming transducer — the vad-asr path has no streaming runtime; documented deviation from the Candidates table)',
    files: ZIPFORMER_FILES,
  },
  'silero-vad': {
    repo: 'deepghs/silero-vad-onnx',
    description: 'VAD for engine B (vad-asr segmentation). v4 onnx (MIT) — the v5 onnx onnx-community host failed to load under build-1\'s vendored browser wasm build (ORT too old); v4 verified working under the official k2-fsa vad-asr build (slice 2C).',
    files: ['silero_vad.onnx'],
    revision: '193243f7d961b15e6de789d3f90cb0ee867e7b62',
  },
  'sherpa-wasm-vad-asr': {
    repo: 'spaces/k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc',
    description: 'Engine B runtime assets — official k2-fsa browser wasm build of the non-streaming wasm/vad-asr path (Emscripten main + asr/vad glue), served from the k2-fsa HF Space; zips the preloaded zh-model .data via Module.getPreloadedPackage, models come from the SHA-256-pinned HF cache',
    files: SHERPA_WASM_FILES,
    revision: '9d5fc71d88ab1222ed1af2274fb194592af48455',
  },
  'cactus-whistle': {
    repo: 'Cactus-Compute/whistle',
    description: 'Engine C speech model (Whistle 16.9 MB, 7 langs, per-word timestamps, keyword biasing)',
    files: ['whistle.cact'],
    revision: 'b358ddadd89b7a713b5aa131f23032d3cca1b251',
  },
}

async function fetchWithCommit(url) {
  const parsed = new URL(url)
  if (!allowedHost(parsed.hostname)) throw new Error(`blocked host ${parsed.hostname}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const finalHost = new URL(response.url).hostname
  if (!allowedHost(finalHost)) throw new Error(`redirected to blocked host ${finalHost}`)
  const commit = response.headers.get('x-repo-commit') ?? response.headers.get('x-revision') ?? ''
  return { bytes: new Uint8Array(await response.arrayBuffer()), commit }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function main() {
  const registry = {
    $comment: 'unit-02 eval-model pins (FR-02.9): HF commit SHA + per-file SHA-256. Generated by tools/eval/pin-models.mjs; verified by scripts/models-fetch.ts --registry models/eval-registry.json.',
    models: {},
  }
  for (const [id, model] of Object.entries(MODELS)) {
    const revisions = new Set()
    const files = []
    for (const path of model.files) {
      const url = `https://huggingface.co/${model.repo}/resolve/${model.revision ?? 'main'}/${path}`
      const dest = join(CACHE, id, path)
      let bytes
      let commit = ''
      try {
        const cached = readFileSync(dest)
        bytes = new Uint8Array(cached)
        // HEAD still resolves through the allowlisted hosts; x-repo-commit is
        // the pinned revision even for cache hits.
        const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
        commit = head.headers.get('x-repo-commit') ?? head.headers.get('x-revision') ?? model.revision ?? ''
        process.stdout.write(`  ${id}/${path} … cached\n`)
      } catch {
        process.stdout.write(`  ${id}/${path} … `)
        const fetched = await fetchWithCommit(url)
        bytes = fetched.bytes
        commit = fetched.commit || model.revision || ''
        mkdirSync(dirname(dest), { recursive: true })
        const tmp = `${dest}.tmp-${process.pid}`
        writeFileSync(tmp, bytes)
        renameSync(tmp, dest)
        console.log(`${(bytes.length / 1024 / 1024).toFixed(1)} MB`)
      }
      if (commit) revisions.add(commit)
      files.push({ path, sha256: sha256(bytes), sizeBytes: bytes.length })
    }
    if (revisions.size > 1) throw new Error(`${id}: inconsistent x-repo-commit across files: ${[...revisions].join(', ')}`)
    const revision = [...revisions][0]
    if (!revision || !/^[0-9a-f]{40}$/.test(revision)) throw new Error(`${id}: missing/invalid x-repo-commit (${revision}) — files served from cache without a pinned revision`)
    registry.models[id] = { repo: model.repo, revision, description: model.description, files }
    console.log(`${id}: ${model.repo} @ ${revision}`)
  }
  const out = join(repoRoot, 'models', 'eval-registry.json')
  writeFileSync(out, `${JSON.stringify(registry, null, 2)}\n`)
  console.log(`wrote ${out}`)
}

main().catch((error) => {
  console.error(`pin-models: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
