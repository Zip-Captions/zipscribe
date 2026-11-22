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
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith('/wasm/'),
        handler: 'CacheFirst',
        options: {
          cacheName: 'zipscribe-wasm',
          expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      },
    ],
  },
}
