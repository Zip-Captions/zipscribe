// CC-05.2/CC-05.3/CC-05.5 (L4/L5) — dedicated vite server for the unit-05
// ASR harness (spec-owned by the test author; the product config stays
// untouched). Mirrors e2e/media/fixtures/vite.harness.config.ts.
//
// `ZIPSCRIBE_ISOLATED=1` adds the COOP/COEP (+Origin-Agent-Cluster) headers
// the `memory` project's `performance.measureUserAgentSpecificMemory()` needs
// — the same switch as scripts/preview.mjs / vite.config.ts § preview.headers
// (settings.yml testing.memory_tests: production never sends them). The port
// is fixed per spec file on the CLI (4313 standard, 4314 isolated); the
// spec owns spawn/kill (unit-02 orphan-server doctrine).
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const isolated = process.env.ZIPSCRIBE_ISOLATED === '1'

export default defineConfig({
  root: repoRoot,
  // public/ carries the self-hosted runtime wasm (/wasm/*) the pinned
  // transformers.js build loads per the settled runtime-wasm-hosting decision.
  publicDir: `${repoRoot}/public`,
  resolve: {
    alias: {
      '@engine': `${repoRoot}/src/engine`,
      '@state': `${repoRoot}/src/state`,
      '@ui': `${repoRoot}/src/ui`,
    },
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    headers: isolated
      ? {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Origin-Agent-Cluster': '?1',
        }
      : {},
  },
})
