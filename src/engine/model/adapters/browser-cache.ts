// Browser-side `zipscribe-models` configuration (FR-204.2 / CC-204.5).
//
// unit-03's `createModelCache` is the ONE verification owner (fetch+SHA-256
// on write, re-hash on read); this module only supplies the browser-specific
// dependency set BOTH the page (context/ports, the Offline models panel) and
// `src/workers/asr.worker.ts` share, so the model cache is consistent across
// threads:
//
// - same-origin keys: cache entries are stored under the app origin
//   (`/<MODEL_CACHE_KEY_SEGMENT>/<encoded original URL>`) even though the
//   logical key is the pinned `resolve/<revision>` URL — FR-204.2 forbids ANY
//   CacheStorage entry pointing at a model host (cache-policy audit scans all
//   caches), while unit-03's `matchCached`/`listCached` still address entries
//   by their canonical `modelFileUrl` through this store's key map.
// - same-origin weights mirror: large `*.onnx` downloads prefer
//   `/.cache/models/<dir>/<file>` (the `models:fetch` mirror, served by the
//   dev server / preview mirror middleware / the future CI mirror) and fall
//   back to the pinned HF URL — the same routing the whisper adapter's
//   `cacheDir` rewrite performs, so the download is honest (cache.ts still
//   re-hashes every byte against the registry pin). Small files (config /
//   tokenizer JSONs) keep the HF resolve URL: they are KB-scale and the
//   request audit expects the model-host traffic on a real download.
//
// Engine purity: pure TypeScript over injected deps / `globalThis` only.
// SECURITY-03: nothing logged; codes only.

import { createModelCache, MODEL_CACHE_NAME, sha256Hex } from '../cache'
import type { CacheLike, ModelCache, ModelCacheDeps } from '../cache'
import { MODEL_REGISTRY, modelFileUrl } from '../registry'
import type { ModelSpec } from '../registry'

/** Path segment the canonical same-origin mirror keys live under. */
export const MODEL_CACHE_KEY_SEGMENT = '__model-cache__'

const MODEL_HOSTS = (hostname: string): boolean => hostname === 'huggingface.co' || hostname.endsWith('.hf.co') || hostname.endsWith('.huggingface.co')

/** `https://<model host>/<org>/<repo>/resolve/<40-hex rev>/<file>` — every
 *  pinned file URL, not only `*.onnx` (mirrorFetch decides which suffixes to
 *  actually re-route). */
export const MODEL_FILE_URL = /^https:\/\/[^/]+\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/(.+)$/

function originOf(): string {
  const location = (globalThis as unknown as { location?: { origin?: string } }).location
  return location?.origin ?? 'http://localhost'
}

/** Map a logical cache key to its canonical same-origin storage key
 *  (model-host URLs move under the app origin; anything else is stored as
 *  given — runtimeWasm URLs are already same-origin). */
export function canonicalModelCacheKey(url: string, origin = originOf()): string {
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  } catch {
    return url
  }
  return MODEL_HOSTS(hostname) ? `${origin}/${MODEL_CACHE_KEY_SEGMENT}/${encodeURIComponent(url)}` : url
}

/** The same-origin weights mirror URL for one pinned file URL: the repo's
 *  last path segment with `_` → `-` is the `models:fetch` cache directory
 *  (`.cache/models/<dir>/<file>`). Returns null when `url` is not a pinned
 *  model-host URL. */
export function mirrorUrl(url: string): string | null {
  const match = MODEL_FILE_URL.exec(url)
  const file = match?.[1]
  if (file === undefined) return null
  const segments = new URL(url).pathname.split('/')
  const repo = segments[2] ?? ''
  if (repo === '') return null
  return `/.cache/models/${repo.replace(/_/g, '-')}/${file}`
}

/** Production fetch for `createModelCache`: large ONNX weights try the
 *  same-origin mirror first (Playwright-route fulfills of ~100 MB bodies are
 *  out of the question — the unit-05 adapter comment records the browser
 *  dying on them), everything else (and every mirror miss) uses the pinned
 *  URL. */
export function createMirrorFetch(): NonNullable<ModelCacheDeps['fetchImpl']> {
  return async (url, init) => {
    if (/\.onnx$/u.test(url)) {
      const mirror = mirrorUrl(url)
      if (mirror !== null) {
        try {
          const mirrored = await globalThis.fetch(mirror, init)
          if (mirrored.ok) return mirrored
        } catch {
          // mirror unreachable (production has no /.cache) — pinned URL next.
        }
      }
    }
    return globalThis.fetch(url, init)
  }
}

/** The real Cache-API store with canonical same-origin keys (FR-204.2: no
 *  CacheStorage entry may point at a model host). */
export function createCanonicalCacheStore(): CacheLike {
  const caches = (globalThis as unknown as { caches?: { open: (name: string) => Promise<Cache> } }).caches
  let opening: Promise<Cache | undefined> | undefined
  const open = (): Promise<Cache | undefined> => {
    if (caches === undefined) return Promise.resolve(undefined)
    opening ??= caches.open(MODEL_CACHE_NAME).catch(() => undefined)
    return opening
  }
  return {
    match: async (key) => (await open())?.match(canonicalModelCacheKey(key)),
    put: async (key, body) => {
      const cache = await open()
      if (cache !== undefined) await cache.put(canonicalModelCacheKey(key), new Response(body))
    },
    delete: async (key) => (await open())?.delete(canonicalModelCacheKey(key)) ?? false,
  }
}

/** The ONE browser configuration of unit-03's model cache — shared by the
 *  composition root (ports/context, the Offline models panel) and the ASR
 *  worker so both threads read and write the same verified entries. */
export function createZipscribeModelCache(): ModelCache {
  return createModelCache({
    registry: MODEL_REGISTRY,
    fetchImpl: createMirrorFetch(),
    cacheStore: createCanonicalCacheStore(),
  })
}

/** Presence-only check (no re-hash) for the fast-fail preflight: every
 *  planned file AND runtimeWasm entry of `spec` is in the store. Corruption
 *  is still caught by `matchCached` on the load read; this answers the
 *  offline question "is anything there at all" in O(1) cache lookups. */
export async function modelSpecPresence(spec: ModelSpec): Promise<boolean> {
  const caches = (globalThis as unknown as { caches?: { open: (name: string) => Promise<Cache> } }).caches
  if (caches === undefined) return false
  const cache = await caches.open(MODEL_CACHE_NAME).catch(() => undefined)
  if (cache === undefined) return false
  for (const file of spec.files) {
    if ((await cache.match(canonicalModelCacheKey(modelFileUrl(spec, file)))) === undefined) return false
  }
  for (const path of spec.runtimeWasm) {
    if ((await cache.match(path)) === undefined) return false
  }
  return true
}

/**
 * Import a model from the SAME-ORIGIN model mirror (`/.cache/models/<dir>`)
 * with no model-host traffic at all — the Offline models panel's seeding
 * path for models `models:fetch` has already verified locally (the CI/local
 * model cache, `.agent/AGENTS.md` § Network: "tests never touch the
 * network"). Every planned byte is re-hashed against the registry pin
 * before ANY put (unit-03 doctrine), so a mirror serving wrong — or
 * SPA-fallback HTML — silently imports nothing. `false` (miss/mismatch/
 * absent mirror) is a normal outcome, not an error: the pinned-URL
 * `ensureOffline` path remains available to the user.
 */
export async function seedSpecFromMirror(cache: ModelCache, spec: ModelSpec): Promise<boolean> {
  const origin = originOf()
  interface Planned {
    key: string
    mirror: string
    sha256?: string
    bytes?: number
  }
  const planned: Planned[] = spec.files.map((file) => {
    const key = modelFileUrl(spec, file)
    return { key, mirror: mirrorUrl(key) ?? key, sha256: file.sha256, bytes: file.bytes }
  })
  for (const path of spec.runtimeWasm) {
    const key = new URL(path, origin).href
    planned.push({ key, mirror: key })
  }
  let fetched: { key: string; bytes: Uint8Array<ArrayBuffer> }[]
  try {
    fetched = await Promise.all(
      planned.map(async (entry) => {
        const response = await globalThis.fetch(entry.mirror)
        if (!response.ok) throw new Error('MIRROR_MISS')
        return { key: entry.key, bytes: new Uint8Array(await response.arrayBuffer()) }
      }),
    )
  } catch {
    return false
  }
  for (let i = 0; i < fetched.length; i += 1) {
    const entry = planned[i]
    const item = fetched[i]
    if (entry === undefined || item === undefined) return false
    if (entry.sha256 !== undefined) {
      if (entry.bytes !== undefined && item.bytes.byteLength !== entry.bytes) return false
      if ((await sha256Hex(item.bytes)) !== entry.sha256.toLowerCase()) return false
    }
  }
  try {
    for (const item of fetched) await cache.putCached(item.key, item.bytes)
  } catch {
    return false
  }
  return true
}
