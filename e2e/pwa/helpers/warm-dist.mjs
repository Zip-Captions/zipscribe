// Deterministic OS page-cache warm for the built bytes the Service Worker
// fetches (unit-204 CI-flake doctrine): on disk-starved CI runners with four
// chromium workers, the workbox precache install (47 entries / ~4.9 MiB), the
// registration.update() fetch of /sw.js and the activate-time ORT seeding
// (post-#37, /wasm/**) all read COLD — the 60 s toast budget legitimately
// dies on I/O while the warm retry passes the whole leg in ~7 s. Reading each
// file once here (synchronously, before any trigger) means by the time the
// SW fetches them the OS answers from the page cache.
//
// Used two ways:
//  1. CLI from the root webServer command in playwright.config.ts —
//     `pnpm run build && node e2e/pwa/helpers/warm-dist.mjs && pnpm preview`
//     (dist/** after build, before preview serves it).
//  2. Imported by e2e/pwa/helpers/dual-root-preview.ts after every
//     (re)stage/deploy of the staged build roots under .night/.
//
// Scope = exactly the SW-reachable set (precache manifest + sw.js + the
// activate-time /wasm/** seeding) — NOT all of dist (the hf-cache mirror is
// ~1.6 GiB and is fetched by the model manager, never by the SW).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(HERE, '..', '..', '..')

/** Read one file fully so the OS buffer cache holds its pages. Missing /
 *  unreadable files are skipped (a later fetch surfaces real 404s). */
export function readOnce(file) {
  try {
    const buf = readFileSync(file)
    return buf.byteLength
  } catch {
    return 0
  }
}

/** Read every file under `dir` (recursive). Returns { files, bytes }. */
export function warmDir(dir) {
  let files = 0
  let bytes = 0
  if (!existsSync(dir)) return { files, bytes }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = warmDir(full)
      files += sub.files
      bytes += sub.bytes
    } else {
      const n = readOnce(full)
      if (n > 0) {
        files += 1
        bytes += n
      }
    }
  }
  return { files, bytes }
}

/** Warm the exact set a fresh SW install/update reads from a served root:
 *  sw.js, index.html, the webmanifest, every precache-manifest entry, and
 *  the /wasm/** files the activate-time ORT seeding fetches. */
export function warmSwReachable(root) {
  let files = 0
  let bytes = 0
  const swPath = join(root, 'sw.js')
  for (const f of [swPath, join(root, 'index.html'), join(root, 'manifest.webmanifest')]) {
    const n = readOnce(f)
    if (n > 0) {
      files += 1
      bytes += n
    }
  }
  if (existsSync(swPath)) {
    const match = readFileSync(swPath, 'utf8').match(/self\.__WB_MANIFEST\s*=\s*(\[[\s\S]*?\])/)
    if (match !== null) {
      try {
        for (const entry of JSON.parse(match[1])) {
          if (typeof entry?.url === 'string') {
            const n = readOnce(join(root, entry.url.replace(/^\/+/, '')))
            if (n > 0) {
              files += 1
              bytes += n
            }
          }
        }
      } catch {
        // Unparseable manifest (unexpected for generateSW output): the
        // always-warmed set above still stands; the fetch itself surfaces
        // any real problem.
      }
    }
  }
  const wasm = warmDir(join(root, 'wasm')) // activate-time ORT seeding (#37)
  return { files: files + wasm.files, bytes: bytes + wasm.bytes }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] !== undefined ? join(REPO_ROOT, process.argv[2]) : join(REPO_ROOT, 'dist')
  const { files, bytes } = warmSwReachable(target)
  console.log(`warm-dist: ${files} files / ${(bytes / (1024 * 1024)).toFixed(1)} MiB read into page cache under ${target}`)
}
