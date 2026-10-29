// Copies the pinned onnxruntime-web runtime files out of node_modules into
// public/wasm (FR-1.0.9). Run standalone (`node scripts/copy-wasm.ts`) or
// from the vite plugin in vite.config.ts.
import { createRequire } from 'node:module'
import { copyNeedleRuntime } from './copy-vendor-assets.ts'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Locate the onnxruntime-web dist directory as pinned by
 * `@huggingface/transformers` (~3.8.1) — resolved through the transformers
 * package itself so the copied files always match the runtime actually bundled
 * by the app (version_pins are contract).
 */
export function ortDistDir(): string {
  const transformersEntry = require.resolve('@huggingface/transformers')
  const ortEntry = createRequire(transformersEntry).resolve('onnxruntime-web')
  return dirname(ortEntry)
}

/**
 * Also vendor the cactus-needle browser runtime the T3 whistle row declares
 * in `ModelSpec.runtimeWasm` (`/wasm/needle.*`). It comes from the
 * `cactus-needle` package's vendor manifest, not from onnxruntime-web, so the
 * copy lives in copy-vendor-assets.ts; this wrapper makes the shipping build
 * produce it alongside the ORT pair (unit-03 review round 2, F3: wiring it
 * only into the eval harness left production `ensureOffline` fetching 404s).
 */
export function copyAllRuntimeWasm(): string[] {
  const copied = copyRuntimeWasm()
  const needle = copyNeedleRuntime()
  return [...copied, ...needle]
}

export function copyRuntimeWasm(): string[] {
  const source = ortDistDir()
  const target = join(repoRoot, 'public', 'wasm')
  mkdirSync(target, { recursive: true })
  const copied: string[] = []
  for (const file of readdirSync(source)) {
    if (!/^ort-wasm.*\.(wasm|mjs)$/.test(file)) continue
    copyFileSync(join(source, file), join(target, file))
    copied.push(file)
  }
  if (copied.length === 0) throw new Error(`no ort-wasm files found in ${source}`)
  return copied
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const copied = copyAllRuntimeWasm()
  console.log(`public/wasm: ${copied.join(', ')}`)
}
