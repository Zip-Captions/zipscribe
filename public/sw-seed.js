// unit-204 (CC-204.2 + CC-204.4) — seed the self-hosted ORT runtime pair into
// `zipscribe-wasm`, gated on the SW's FIRST ACTIVATION — never `install`:
// workbox-window fires `waiting` (the update-toast trigger, FR-204.4) only
// after the waiting worker's install handlers settle, and a 33 MB install-time
// seed pushed `waiting` past the prompt-toast budget on slow-disk CI runners
// (measured: 60 s toast timeout vs 7.1 s retry — CI run 45191628622).
// Activation gating keeps the offline-boot contract (CC-204.2):
// `navigator.serviceWorker.ready` (and every first-visit boot) only proceeds
// after activate settles, so the entries are in `zipscribe-wasm` before any
// boot can race them offline (cached ⇒ provably zero network, invariant 9);
// the update flow's PARKED worker never reaches activate, so its install is
// precache-only and `waiting` — hence the toast — is prompt. Bounded per-file
// fetch (never spans a network transition) and failure-swallowed (FR-1.0.9
// offline install must still complete); the CacheFirst route self-heals.
const CACHE_NAME = 'zipscribe-wasm'
const SEED_FILES = ['/wasm/ort-wasm-simd-threaded.jsep.mjs', '/wasm/ort-wasm-simd-threaded.jsep.wasm', '/wasm/ort-wasm-simd-threaded.mjs', '/wasm/ort-wasm-simd-threaded.wasm']
const SEED_TIMEOUT_MS = 6000

self.addEventListener('activate', (event) => {
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
            // A failed seed must never block activation — the runtime route
            // (CacheFirst) and the page-side warm self-heal later.
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
