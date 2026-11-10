// CC-06.1/CC-06.2/CC-06.5 (L4) — dedicated vite server for the unit-06
// diarization harness (spec-owned by the test author; the product config stays
// untouched). Mirrors e2e/asr/fixtures/vite.harness.config.ts (that file is
// never import-edited — same doctrine). Port 4315 is owned by the
// e2e/diarization specs (4313 = unit-05, 4314 = memory project); the spec owns
// spawn/kill (unit-02 orphan-server doctrine).
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const isolated = process.env.ZIPSCRIBE_ISOLATED === '1'

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
    headers: isolated
      ? {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
          'Origin-Agent-Cluster': '?1',
        }
      : {},
  },
})
