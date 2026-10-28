import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyRuntimeWasm } from './scripts/copy-wasm.ts'

// Product configuration (the test-only config is vitest.config.ts).
// vite 7 specifics verified against official docs — docs-mcp indexes vite only
// at 6.4.4, so vite.dev is the authority here:
//   ?worker imports + worker.format — https://vite.dev/guide/workers
//   preview.headers — https://vite.dev/config/preview-options
//   define / publicDir — https://vite.dev/config/shared-options

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function gitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// FR-1.0.9: runtime wasm (onnxruntime-web) is self-hosted under /wasm — the
// pinned files are copied out of node_modules into public/wasm before dev and
// build, so a production build never asks a CDN for wasm.
function selfHostedWasm(): Plugin {
  return {
    name: 'zipscribe:self-hosted-wasm',
    buildStart() {
      copyRuntimeWasm()
    },
    configureServer() {
      copyRuntimeWasm()
    },
  }
}

export default defineConfig({
  plugins: [react(), selfHostedWasm()],
  define: {
    __ZIP_VERSION__: JSON.stringify(`${pkg.version}+${gitHash()}`),
  },
  resolve: {
    alias: {
      '@engine': new URL('./src/engine', import.meta.url).pathname,
      '@state': new URL('./src/state', import.meta.url).pathname,
      '@ui': new URL('./src/ui', import.meta.url).pathname,
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  preview: {
    // FR-1.0.10: COOP/COEP only for the isolated memory-gate preview
    // (`pnpm preview:isolated`); default preview and production (Cloudflare
    // Pages) never send them — `public/_headers` carries no COOP/COEP either.
    headers: process.env.ZIPSCRIBE_ISOLATED
      ? {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        }
      : {},
  },
})
