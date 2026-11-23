// unit-204 flake fix (CC-204.2): seed the self-hosted ORT runtime pair into
// `zipscribe-wasm` at SW INSTALL — bound to the SW lifecycle (a page reload
// cannot strand it), bounded per file (activation never spans a network
// transition), and earliest (starts before the first boot fetch). With the
// entry present, every later /wasm/ read — including the boot warm — is a
// cache hit and provably zero network (architecture invariant 9). Fetch
// failures never block installation/activation (FR-1.0.9 offline install).
const CACHE_NAME = 'zipscribe-wasm'
const SEED_FILES = ['/wasm/ort-wasm-simd-threaded.jsep.mjs', '/wasm/ort-wasm-simd-threaded.jsep.wasm', '/wasm/ort-wasm-simd-threaded.mjs', '/wasm/ort-wasm-simd-threaded.wasm']
const SEED_TIMEOUT_MS = 6000

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await Promise.all(
        SEED_FILES.map(async (file) => {
          try {
            if ((await cache.match(file)) !== undefined) return
            const response = await fetch(file, { cache: 'force-cache', signal: AbortSignal.timeout(SEED_TIMEOUT_MS) })
            if (!response.ok) return
            await cache.put(file, response)
          } catch {
            // A failed seed must never block install/activation — the runtime
            // route (CacheFirst) and the page-side warm self-heal later.
          }
        }),
      )
    })(),
  )
})

// The renderer's `navigator.onLine` can be stale for the first instant of a
// fresh navigation (the flake window); the SW process tracks it live, so the
// boot warm asks instead of trusting the renderer.
self.addEventListener('message', (event) => {
  const data = event.data
  if (data && data.type === 'zipscribe:online-query' && event.ports[0]) {
    event.ports[0].postMessage({ type: 'zipscribe:online-reply', online: self.navigator.onLine !== false })
  }
})
