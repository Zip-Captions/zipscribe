// CC-301.3 (L4) — dedicated vite server for the unit-301 translation
// harness (spec-owned server doctrine; mirrors e2e/asr/fixtures/
// vite.harness.config.ts; no COOP/COEP needed — no SharedArrayBuffer here).
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export default defineConfig({
  root: repoRoot,
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
    headers: {},
  },
})
