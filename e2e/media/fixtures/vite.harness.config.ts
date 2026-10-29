// CC-04.1…CC-04.13 (L4) — dedicated vite dev server for the unit-04 media
// harnesses (audio matrix, playback, real-worker contract, forced fallback).
// Spec-owned (test-author); the product config (vite.config.ts) stays
// untouched. Serves the repo root so
// `/e2e/media/fixtures/{harness,worker-harness}.html` can import the engine
// sources under test through the `@engine` alias.
//
// `publicDir` points at `fixtures/`: the product build copies fixtures into
// `dist/fixtures/` (scripts/copy-vendor-assets.ts), so both the dev harness
// and the Playwright `webServer` (build + preview, 4310) serve the same
// `/fixtures/**` URLs and the same specs run unchanged.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export default defineConfig({
  root: repoRoot,
  publicDir: `${repoRoot}/fixtures`,
  resolve: {
    alias: {
      '@engine': `${repoRoot}/src/engine`,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4311,
    strictPort: true,
    // COOP/COEP for the memory-gate preview parity: the harness never needs
    // SharedArrayBuffer (single-threaded ffmpeg policy), and the real worker
    // must work without cross-origin isolation — so they stay OFF here too.
  },
})