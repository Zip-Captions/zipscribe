import { readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// unit-02 (FR-02.1/FR-02.3): the model-eval spike builds its engine pages
// alongside the app (`ZIPSCRIBE_EVAL=1 corepack pnpm build`). The per-PR
// `pnpm build` is untouched — no eval inputs, no eval aliases — so the bundle
// budget and the shipped app are unaffected by the harness. The 4.x runtime
// for the #1739 leak study comes from the isolated npm install under
// tools/eval/node-4x (its own onnxruntime-web resolves from that tree; its
// wasm binaries are self-hosted under /eval4x/wasm by
// scripts/copy-vendor-assets.ts).
const EVAL = process.env.ZIPSCRIBE_EVAL === '1'
const evalInputs = {
  engineA: 'tools/eval/pages/engine-a.html',
  engineB: 'tools/eval/pages/engine-b.html',
  engineC: 'tools/eval/pages/engine-c.html',
  calibrate: 'tools/eval/pages/gpu-calibration.html',
}
const hf4xPath = join(repoRoot, 'tools', 'eval', 'node-4x', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.web.js')

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
    closeBundle() {
      // The CC-01.4 negative test injects a probe chunk via a REPO_ROOT-
      // relative path derived from dist/index.html's script src; a build-time
      // symlink (`assets` → `dist/assets`, gitignored) makes that mapping
      // resolve to the real chunk so check-bundle sees the injection.
      const link = join(repoRoot, 'assets')
      rmSync(link, { recursive: true, force: true })
      symlinkSync(join('dist', 'assets'), link, 'dir')
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
      ...(EVAL ? { '@hf4x': hf4xPath } : {}),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
    ...(EVAL
      ? {
          rollupOptions: {
            input: {
              main: join(repoRoot, 'index.html'),
              ...Object.fromEntries(Object.entries(evalInputs).map(([name, path]) => [name, join(repoRoot, path)])),
            },
          },
        }
      : {}),
  },
  preview: {
    // Bind IPv4 explicitly: the frozen request-audit + Playwright webServer
    // poll http://127.0.0.1:PORT, and 'localhost' can resolve IPv6-only here.
    host: '127.0.0.1',
    headers: {
      // no-store: without it the COOP/COEP preview navigation is answered
      // with a 304 and Chromium re-commits the cached (header-less) plain
      // response, pinning crossOriginIsolated to its first-load value.
      'Cache-Control': 'no-store',
      // FR-1.0.10: COOP/COEP only for the isolated memory-gate preview
      // (`pnpm preview:isolated`); default preview and production (Cloudflare
      // Pages) never send them — `public/_headers` carries no COOP/COEP either.
      ...(process.env.ZIPSCRIBE_ISOLATED
        ? {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            // Chromium keeps the browsing-context group across same-origin
            // navigations, so a tab that loaded under the plain preview would
            // report crossOriginIsolated === false forever; ?1 swaps the
            // agent cluster so COOP/COEP take effect on navigation.
            'Origin-Agent-Cluster': '?1',
          }
        : {}),
    },
  },
})
