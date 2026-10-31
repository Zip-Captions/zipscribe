// scripts/copy-ffmpeg.ts — unit-04 (FR-04.5 / CC-04.3/CC-04.10): the
// ffmpeg.wasm fallback runtime is self-hosted under `/wasm/ffmpeg/` (settings.yml
// operations network allowlist: `self` + model hosts only — ffmpeg.wasm's
// default core URL is the unpkg CDN (`@ffmpeg/ffmpeg` dist/esm/const.js
// CORE_URL), which must never be what the app asks for). Same doctrine as
// scripts/copy-wasm.ts (onnxruntime-web) and scripts/copy-vendor-assets.ts
// (sherpa/needle): copy the pinned files out of node_modules, verify each
// against a committed SHA-256, and fail loudly on drift.
//
// The pinned digests below were recorded from
// `@ffmpeg/core@0.12.10` / `@ffmpeg/ffmpeg@0.12.15` (settings.yml-approved,
// package.json) on 2026-10-30. A version bump must re-record them in the same
// commit — a silent core swap is the exact attack the needle manifest guards
// (copy-vendor-assets.ts) and this mirrors.
//
// Why the ESM dist and not the UMD dist: `@ffmpeg/ffmpeg` 0.12.x always
// creates its class worker as `new Worker(classWorkerURL, { type: 'module' })`
// (dist/esm/classes.js load()), and the worker loads the core through
// `await import(coreURL)` inside that module worker (its `importScripts`
// branch only succeeds in classic workers, where `importScripts` exists —
// dist/esm/worker.js). A module worker has no `importScripts`, so the UMD
// build (no `export default`, see dist/umd/ffmpeg-core.js) fails the
// `createFFmpegCore` check; only the ESM build's default export loads.
// Reference: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.15
// (`classWorkerURL` usage) — same reasoning the project's own pinned
// dist/esm/worker.js encodes.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface PinnedAsset {
  /** File name it lands under in `public/wasm/ffmpeg/`. */
  target: string
  /** Package whose `dist/esm` the file is copied from. */
  pkg: '@ffmpeg/core' | '@ffmpeg/ffmpeg'
  source: string
  sha256: string
}

const PINNED: readonly PinnedAsset[] = [
  {
    target: 'ffmpeg-core.js',
    pkg: '@ffmpeg/core',
    source: 'ffmpeg-core.js',
    sha256: '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
  },
  {
    target: 'ffmpeg-core.wasm',
    pkg: '@ffmpeg/core',
    source: 'ffmpeg-core.wasm',
    sha256: '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
  },
  {
    target: 'worker.js',
    pkg: '@ffmpeg/ffmpeg',
    source: 'worker.js',
    sha256: 'feff0ac937ea225e997e1fae997a74f8b8d572423a526da59eb56624b1f3cde7',
  },
  {
    target: 'const.js',
    pkg: '@ffmpeg/ffmpeg',
    source: 'const.js',
    sha256: '9e3bc9dd84781c81daf459e2c46eeec815edac35089832681d9a9a0f383060d0',
  },
  {
    target: 'errors.js',
    pkg: '@ffmpeg/ffmpeg',
    source: 'errors.js',
    sha256: '619310d7ef5fe5fefa0a31927db862b7c291713cfef4d71753fa8aafd18f4db6',
  },
]

/** Resolve a package's `dist/esm` directory through the app's own dependency
 * tree (version pins are contract: the copied bytes must match what
 * `@ffmpeg/ffmpeg` at runtime is built against). Resolved via the packages'
 * own export maps — `@ffmpeg/core` does not export `./package.json`, and the
 * `import` conditions of both entries land in `dist/esm` (`@ffmpeg/ffmpeg`'s
 * `node` condition is an empty stub in the same directory). */
function distEsmDir(pkg: PinnedAsset['pkg']): string {
  const entry = pkg === '@ffmpeg/ffmpeg' ? import.meta.resolve('@ffmpeg/ffmpeg/worker') : import.meta.resolve('@ffmpeg/core')
  return dirname(fileURLToPath(entry))
}

// `vite preview` serves dist/ — the core must exist in BOTH public/ (source
// of truth for the next build) and dist/ when it exists (the running
// preview), mirroring copy-vendor-assets.ts.
function copyBoth(source: string, target: string): void {
  copyFileSync(source, target)
  const distTarget = target.replace(`${sep}public${sep}`, `${sep}dist${sep}`)
  if (distTarget !== target && existsSync(join(repoRoot, 'dist'))) {
    mkdirSync(dirname(distTarget), { recursive: true })
    copyFileSync(source, distTarget)
  }
}

export function copyFfmpegRuntime(): string[] {
  const target = join(repoRoot, 'public', 'wasm', 'ffmpeg')
  mkdirSync(target, { recursive: true })
  const keep = new Set<string>()
  for (const asset of PINNED) {
    const source = join(distEsmDir(asset.pkg), asset.source)
    const actual = createHash('sha256').update(readFileSync(source)).digest('hex')
    if (actual !== asset.sha256) {
      throw new Error(`copy-ffmpeg: ${asset.pkg}/${asset.source} SHA-256 mismatch (pinned ${asset.sha256}, got ${actual})`)
    }
    copyBoth(source, join(target, asset.target))
    keep.add(asset.target)
  }
  // Prune anything else in the directory (stale artifacts from a downgraded
  // core must not stay servable, copy-vendor-assets.ts doctrine).
  const distTarget = target.replace(`${sep}public${sep}`, `${sep}dist${sep}`)
  for (const dir of [target, distTarget]) {
    for (const file of readdirSafe(dir)) {
      if (!keep.has(file)) rmSync(join(dir, file))
    }
  }
  return [...keep]
}

function readdirSafe(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : []
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const copied = copyFfmpegRuntime()
  console.log(`public/wasm/ffmpeg: ${copied.join(', ')}`)
}
