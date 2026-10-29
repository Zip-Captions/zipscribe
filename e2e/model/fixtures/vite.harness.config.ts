// CC-03.3 (L4) — dedicated vite dev server for the unit-03 model harness.
// Spec-owned (test-author); the product config (vite.config.ts) stays
// untouched. Serves the repo root so `/e2e/model/fixtures/harness.html` can
// import the engine sources under test through the `@engine` alias.
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export default defineConfig({
  root: repoRoot,
  resolve: {
    alias: {
      '@engine': `${repoRoot}/src/engine`,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4311,
    strictPort: true,
  },
})
