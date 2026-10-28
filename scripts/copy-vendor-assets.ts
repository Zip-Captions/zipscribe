// scripts/copy-vendor-assets.ts — unit-02 (FR-02.2/US-02.2): the eval
// harness's third-party runtimes must load from `self` (never a CDN), so the
// sherpa-onnx official WASM build (npm `sherpa-onnx`, Apache-2.0) and the
// transformers.js 4.x leak-study runtime (isolated install under
// tools/eval/node-4x, per unit-02 brief) are copied out of node_modules into
// gitignored public/ directories before the eval build. Same pattern as
// scripts/copy-wasm.ts for onnxruntime-web (FR-1.0.9).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// `vite preview` serves dist/ — vendor assets must exist in BOTH public/
// (source of truth for the next build) and dist/ when it exists (the running
// preview), or a rebuild-before-copy race serves a stale worker script.
function copyBoth(source: string, target: string): void {
  copyFileSync(source, target)
  const distTarget = target.replace(`${sep}public${sep}`, `${sep}dist${sep}`)
  if (distTarget !== target && existsSync(join(repoRoot, 'dist'))) {
    mkdirSync(dirname(distTarget), { recursive: true })
    copyFileSync(source, distTarget)
  }
}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function copyMatching(source: string, target: string, pattern: RegExp, label: string): string[] {
  mkdirSync(target, { recursive: true })
  const copied: string[] = []
  for (const file of readdirSync(source)) {
    if (!pattern.test(file)) continue
    copyBoth(join(source, file), join(target, file))
    copied.push(file)
  }
  if (copied.length === 0) throw new Error(`no ${label} files found in ${source}`)
  return copied
}

export function copyVendorAssets(): { sherpa: string[]; eval4x: string[] } {
  // Engine B: official sherpa-onnx WASM (Emscripten build + JS glue modules).
  // The npm `sherpa-onnx` package ships the NODE wasm build (top-level
  // require("path") — browser-hostile). speech-asr@1.1.6 (npm) republishes the
  // official k2-fsa BROWSER wasm build: sherpa-onnx-wasm-main-asr.{js,wasm}
  // plus the same vad/asr class wrappers used by the official wasm/vad-asr
  // reference (https://github.com/k2-fsa/sherpa-onnx/tree/master/wasm/vad-asr).
  const sherpaDir = dirname(require.resolve('speech-asr/dist/lib/sherpa-onnx-wasm-main-asr.js'))
  const sherpa = copyMatching(sherpaDir, join(repoRoot, 'public', 'sherpa'), /^sherpa-onnx-.*\.(js|wasm)$/, 'sherpa-onnx wasm')

  // Engine B worker (classic worker hosted under /sherpa so importScripts of
  // the sherpa files resolves same-origin).
  const workerSrc = join(repoRoot, 'tools', 'eval', 'pages', 'engine-b.worker.js')
  copyBoth(workerSrc, join(repoRoot, 'public', 'sherpa', 'engine-b.worker.js'))

  // Corpus clips: the harness feeds unit-01 fixtures through the same
  // preview server (self origin) — copied into public/ for eval builds.
  const fixturesTarget = join(repoRoot, 'public', 'fixtures')
  mkdirSync(fixturesTarget, { recursive: true })
  // Ground truth is read by the harness from fixtures/ directly; only the
  // media files need to be served.
  const fixtureFiles = readdirSync(join(repoRoot, 'fixtures')).filter((f) => /\.(mp4|wav|m4a)$/.test(f))
  for (const entry of fixtureFiles) {
    copyBoth(join(repoRoot, 'fixtures', entry), join(fixturesTarget, entry))
  }

  // FR-02.9 model serving: the SHA-256-verified local cache (.cache/models,
  // populated by scripts/models-fetch.ts from models/eval-registry.json) is
  // mirrored under public/hf-cache/<repo>/<path> so the pages fetch models
  // from `self` (no giant route-intercepted bodies; route interception over
  // CDP crashes Chrome at ~300 MB). Transformers.js points its
  // env.localModelPath at /hf-cache/.
  const registryPath = join(repoRoot, 'models', 'eval-registry.json')
  if (existsSync(registryPath)) {
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as { models: Record<string, { repo: string; files: Array<{ path: string }> }> }
    for (const [id, model] of Object.entries(registry.models)) {
      for (const file of model.files) {
        const source = join(repoRoot, '.cache', 'models', id, file.path)
        if (!existsSync(source)) continue
        const target = join(repoRoot, 'public', 'hf-cache', model.repo, file.path)
        mkdirSync(dirname(target), { recursive: true })
        copyBoth(source, target)
      }
    }
    console.log('public/hf-cache: eval model cache mirrored (self-origin serving)')
  }

  // Leak study: the 4.x copy's ORT wasm (its JS is vite-bundled from
  // tools/eval/node-4x, its runtime binaries must be self-hosted like the
  // 3.8.1 pair under /wasm).
  const require4x = createRequire(join(repoRoot, 'tools', 'eval', 'node-4x', 'noop.js'))
  const ort4xDir = dirname(require4x.resolve('onnxruntime-web'))
  let eval4x: string[] = []
  try {
    eval4x = copyMatching(ort4xDir, join(repoRoot, 'public', 'eval4x', 'wasm'), /^ort-wasm.*\.(wasm|mjs)$/, 'onnxruntime-web 4.x wasm')
  } catch {
    // tools/eval/node-4x not installed (leak study not run) — not fatal for
    // the rest of the eval; the harness reports the leak rows as blockers.
    console.warn('copy-vendor-assets: tools/eval/node-4x onnxruntime-web not installed — eval4x wasm skipped')
  }
  return { sherpa, eval4x }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { sherpa, eval4x } = copyVendorAssets()
  console.log(`public/sherpa: ${sherpa.length} file(s)`)
  console.log(`public/eval4x/wasm: ${eval4x.length} file(s)`)
}
