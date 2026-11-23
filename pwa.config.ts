// FR-204.1 — vite-plugin-pwa options for the Zipscribe PWA (unit-204).
// Pinned vite-plugin-pwa 2.x (settings.yml version_pins; peer vite 3–8,
// workbox 7.4). API verified against the versioned docs:
//   generateSW workbox options: https://vite-pwa-org.netlify.app/workbox/generate-sw
//   precache/globPatterns:      https://vite-pwa-org.netlify.app/guide/static-assets
//   prompt + manual register:   https://vite-pwa-org.netlify.app/guide/prompt-for-update
//   devOptions (no SW in dev):  https://vite-pwa-org.netlify.app/guide/development
// Registered by src/ui/pwa/register.ts via workbox-window (slice B) — hence
// `injectRegister: false`; `devOptions.enabled: false` keeps `pnpm dev`
// SW-free (conventions § Other rules).
import type { VitePWAOptions } from 'vite-plugin-pwa'

// knowledge/design.md design tokens — --bg-app (US-204.1).
const THEME_COLOR = '#0d0f12'

// architecture.md § Supported media (video + native audio + ffmpeg long tail)
// + US-204.5 caption/project files. MPEG-TS ships both spellings (.ts, .m2ts)
// — ASSUMPTIONS in the unit report.
const FILE_ACCEPT: Record<string, string[]> = {
  'video/mp4': ['.mp4', '.m4v'],
  'video/quicktime': ['.mov'],
  'video/x-matroska': ['.mkv'],
  'video/webm': ['.webm'],
  'video/mp2t': ['.ts', '.m2ts'],
  'audio/mpeg': ['.mp3'],
  'audio/mp4': ['.m4a', '.m4b'],
  'audio/aac': ['.aac'],
  'audio/wav': ['.wav'],
  'audio/flac': ['.flac'],
  'audio/ogg': ['.ogg', '.oga'],
  'audio/opus': ['.opus'],
  'audio/webm': ['.weba'],
  'audio/x-matroska': ['.mka'],
  'audio/aiff': ['.aiff', '.aif'],
  'audio/x-ms-wma': ['.wma'],
  'audio/amr': ['.amr'],
  'video/3gpp': ['.3gp'],
  'audio/x-caf': ['.caf'],
  'text/plain': ['.srt', '.vtt', '.sbv', '.ass'],
  'application/ttml+xml': ['.ttml'],
  'application/json': ['.zipscribe.json'],
}

export const pwaOptions: Partial<VitePWAOptions> = {
  // US-204.4: never auto-reload — the update toast is the only path to
  // skipWaiting (knowledge/design.md § Offline & install).
  registerType: 'prompt',
  // Registration lives in src/ui/pwa/register.ts (workbox-window), not in an
  // injected snippet (FR-204.1).
  injectRegister: false,
  // Service worker is disabled in `pnpm dev` (conventions § Other rules).
  devOptions: { enabled: false },
  manifest: {
    id: '/',
    name: 'Zipscribe',
    short_name: 'Zipscribe',
    description: 'Zero-server, on-device video & audio transcription and caption editor',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: THEME_COLOR,
    background_color: THEME_COLOR,
    icons: [
      { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    screenshots: [
      { src: '/screenshots/wide-1920x1080.png', sizes: '1920x1080', type: 'image/png', form_factor: 'wide', label: 'Zipscribe caption studio on a desktop' },
      { src: '/screenshots/narrow-780x1688.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Zipscribe on a phone' },
    ],
    // US-204.5: OS "Open with Zipscribe" (Chromium); unsupported browsers
    // simply ignore the member.
    file_handlers: [{ action: '/', accept: FILE_ACCEPT }],
    launch_handler: { client_mode: 'focus-existing' },
  },
  // FR-204.2 — generateSW (no custom handler needed). The precache manifest
  // is EXPLICIT because public/ carries multi-GB deployment furniture (model
  // cache, fixtures, /wasm) that must never be globbed into the shell cache;
  // globPatterns is therefore the allowlist of the 15 MB shell budget.
  workbox: {
    // unit-204 flake fix (CC-204.2): the ORT runtime pair is seeded into
    // `zipscribe-wasm` at SW INSTALL by this extra script (SW-lifecycle
    // bound, per-file bounded) — offline boots then answer every /wasm/ read
    // from cache with provably zero network (invariant 9), and no seed fetch
    // can straddle the online→offline transition (the observed flake: an
    // unbounded page-started seed request killed by the harness's offline
    // toggle fired requestfailed on the audited context).
    importScripts: ['/sw-seed.js'],
    globPatterns: ['index.html', 'manifest.webmanifest', 'assets/*.js', 'assets/*.css', 'fonts/**/*.woff2', 'icons/*.png', 'samples/*.mp4'],
    // Assets fail loudly instead of returning the app shell (FR-204.2); only
    // navigations fall back to the precached shell.
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/wasm\//, /^\/assets\//],
    // FR-204.3 single-file limit (Cloudflare Pages); the 15 MB TOTAL budget
    // is gated by scripts/check-bundle.mjs on this same manifest.
    maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
    // FR-204.2: engine wasm (ORT/ffmpeg) self-hosted under /wasm is cached on
    // FIRST USE, never precached (size). Model hosts are BYPASSED entirely —
    // there is deliberately no rule whose urlPattern can match an off-origin
    // request (unit-03's verified `zipscribe-models` cache owns models).
    // Measured (unit-204): the activate handler cleanupOutdatedCaches()
    // registers never settles once the app page holds IndexedDB activity —
    // skipWaiting() then hangs forever and the update toast's Reload click
    // strands the user on the stale build. Outdated PRECACHE ENTRIES are
    // still pruned at install by the precache controller (entries not in the
    // manifest); this only skips the cross-workbox-version cache sweep.
    cleanupOutdatedCaches: false,
    // NOTE: clientsClaim is deliberately NOT enabled — with the app's live
    // fetches in flight, an activating worker's clients.claim() never
    // settles (measured Chromium), which deadlocks skipWaiting() and
    // strands the update toast's Reload click (unit-204 finding).
    runtimeCaching: [
      {
        // FR-204.2 denylist doctrine: `/wasm/` is denylisted for NAVIGATION
        // (navigateFallbackDenylist), but a runtime route is evaluated for
        // EVERY matching request — and a navigation is a request. Without the
        // mode/destination guard a `GET /wasm/<missing>.wasm` navigation hits
        // the server's SPA fallback, and CacheFirst caches/serves that HTML
        // as "wasm" (poisoned offline). The urlPattern callback receives
        // RouteMatchCallbackOptions ({url, request, sameOrigin}):
        // https://developer.chrome.com/docs/workbox/reference/workbox-routing/#type-routematchcallback
        urlPattern: ({ sameOrigin, url, request }) => sameOrigin && url.pathname.startsWith('/wasm/') && request.mode !== 'navigate' && request.destination !== 'document',
        handler: 'CacheFirst',
        options: {
          cacheName: 'zipscribe-wasm',
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
    ],
  },
}
