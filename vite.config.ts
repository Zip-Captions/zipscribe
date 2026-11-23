import { createReadStream, existsSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { copyAllRuntimeWasm } from './scripts/copy-wasm.ts'
import { copySamples } from './scripts/copy-samples.ts'
import { pwaOptions } from './pwa.config.ts'

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
      copyAllRuntimeWasm()
    },
    configureServer() {
      copyAllRuntimeWasm()
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

// unit-101 (CC-101.2 / US-2.0.2): the "Try a sample clip" action fetches
// /samples/speech-2min.mp4 from the app origin — the byte is copied out of
// fixtures/ at dev/build time so fixtures themselves are never served
// (public/samples/ is gitignored build output).
function servedSamples(): Plugin {
  return {
    name: 'zipscribe:served-samples',
    buildStart() {
      copySamples()
    },
    configureServer() {
      copySamples()
    },
  }
}

// unit-102 (CC-102.2/CC-102.6 frozen e2e): the editor playback specs drive a
// REAL `<video data-testid=stage-video>` at `/fixtures/speech-2min.mp4` on
// the preview server (4310). `/fixtures/**` is test-server furniture (the
// same doctrine as `e2e/media/helpers/media.ts`, which route-fulfils the
// identical mapping for the media specs) — the APP itself never fetches it
// (CC-101.2 pins that), and the production build never maps it (this plugin
// runs only in dev/preview middlewares, never in the build output).
// Seekable media needs HTTP Range (206) — `<video>` refuses to seek without
// it, so this is not a plain sendFile.
const FIXTURE_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.json': 'application/json',
}

function fixturesMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/fixtures/')) {
    next()
    return
  }
  const rel = decodeURIComponent(url.pathname.slice('/fixtures/'.length))
  const root = join(repoRoot, 'fixtures')
  const abs = join(root, rel)
  if (!abs.startsWith(root + '/') || !statSyncSafe(abs)?.isFile()) {
    next()
    return
  }
  const size = statSync(abs).size
  const type = FIXTURE_MIME[extname(abs)] ?? 'application/octet-stream'
  res.setHeader('Content-Type', type)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-store')
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (range !== null) {
    const start = range[1] === '' ? 0 : Number(range[1])
    const end = range[2] === '' || Number(range[2]) >= size ? size - 1 : Number(range[2])
    if (Number.isFinite(start) && start < size && start <= end) {
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
      res.setHeader('Content-Length', String(end - start + 1))
      createReadStream(abs, { start, end }).pipe(res)
      return
    }
  }
  res.statusCode = 200
  res.setHeader('Content-Length', String(size))
  createReadStream(abs).pipe(res)
}

function statSyncSafe(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

// unit-204 (FR-204.2 / CC-204.2): the same-origin weights mirror. In dev,
// vite already serves the repo root, so `/.cache/models/**` (the `models:fetch`
// cache, `.agent/AGENTS.md` § Network) resolves natively. `vite preview`
// serves `dist/` only, so the mirror must be mapped EXPLICITLY — otherwise
// the offline path degrades to the pinned HF resolve URL (and the e2e route
// spy would try to `route.fulfill` multi-hundred-MB ONNX bodies, which
// crashes Chromium — the unit-05 adapter comment). This is test-server
// furniture on the same doctrine as `servedFixtures`: the APP never depends
// on it existing (a miss falls through to the pinned URL in production), and
// the model hosts stay fully BYPASSED by the SW (FR-204.2 / cache-policy).
const MODEL_MIRROR_ROOT = join(repoRoot, '.cache', 'models')
const CI_REGISTRY_FILE = join(repoRoot, 'models', 'ci-registry.json')

function modelMirrorMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/.cache/ci-registry.json') {
    // The panel's seeding seed-set (which mirror dirs the local model cache
    // guarantees). 404 (no file) → the app's seeding simply no-ops.
    const stat = statSyncSafe(CI_REGISTRY_FILE)
    if (stat === null || !stat.isFile()) {
      next()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.statusCode = 200
    res.setHeader('Content-Length', String(stat.size))
    createReadStream(CI_REGISTRY_FILE).pipe(res)
    return
  }
  if (!url.pathname.startsWith('/.cache/models/')) {
    next()
    return
  }
  const rel = decodeURIComponent(url.pathname.slice('/.cache/models/'.length))
  const abs = join(MODEL_MIRROR_ROOT, rel)
  if (!abs.startsWith(MODEL_MIRROR_ROOT + '/') || !statSyncSafe(abs)?.isFile()) {
    // Honest miss (review r1, finding 8): a 404, NOT `next()` — on the
    // preview server a fall-through is answered by vite's SPA-fallback HTML
    // with status 200, and `createMirrorFetch` adopts any `ok` mirror
    // response: the pinned-URL fallback then never runs and cache.ts rejects
    // the HTML as CACHE_CORRUPT. 404 keeps that fallthrough honest in the
    // env that exercises it (browser-cache mirror misses).
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain')
    res.end('model mirror miss')
    return
  }
  const size = statSync(abs).size
  res.setHeader('Content-Type', extname(abs) === '.json' ? 'application/json' : 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-store')
  res.statusCode = 200
  res.setHeader('Content-Length', String(size))
  createReadStream(abs).pipe(res)
}

function servedModelMirror(): Plugin {
  return {
    name: 'zipscribe:served-model-mirror',
    configureServer(server) {
      server.middlewares.use(modelMirrorMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(modelMirrorMiddleware)
    },
  }
}

function servedFixtures(): Plugin {
  return {
    name: 'zipscribe:served-fixtures',
    configureServer(server) {
      server.middlewares.use(fixturesMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(fixturesMiddleware)
    },
  }
}

// CC-204.5 / FR-204.3 — name the precache manifest on the SW global so the
// e2e budget/audit (`self.__WB_MANIFEST`) reads the REAL manifest the SW
// precaches. workbox-build's generateSW template inlines the manifest array
// directly into precacheAndRoute(<json>, …) without ever assigning it to the
// conventional `self.__WB_MANIFEST` handle, and minification unquotes the
// JSON keys (https://developer.chrome.com/docs/workbox/reference/workbox-build/#generateSW),
// so we parse the literal back and emit it as canonical JSON: the SW's own
// precache list, re-serialized — the audit then reads exactly what precaches.
function exposePrecacheManifest(): Plugin {
  return {
    name: 'zipscribe:expose-precache-manifest',
    apply: 'build',
    // AFTER vite-plugin-pwa writes sw.js in its own (sequential) closeBundle.
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const swPath = join(repoRoot, 'dist', 'sw.js')
        if (!existsSync(swPath)) return
        let source = readFileSync(swPath, 'utf8')
        if (source.includes('self.__WB_MANIFEST')) return
        const marker = 'precacheAndRoute(['
        const call = source.indexOf(marker)
        if (call === -1) return // no manifest — the check-bundle precache gate fails loudly
        const start = call + marker.length - 1
        let depth = 0
        let end = -1
        for (let i = start; i < source.length; i++) {
          const char = source[i]
          if (char === '[') depth++
          else if (char === ']') {
            depth--
            if (depth === 0) {
              end = i + 1
              break
            }
          } else if (char === '"' || char === "'") {
            const quote = char
            i++
            while (i < source.length && source[i] !== quote) {
              if (source[i] === '\\') i++
              i++
            }
          }
        }
        if (end === -1) return
        const entries = runInNewContext(`(${source.slice(start, end)})`, Object.create(null)) as unknown
        source = `${source.slice(0, start)}(self.__WB_MANIFEST=${JSON.stringify(entries)})${source.slice(end)}`
        writeFileSync(swPath, source, 'utf8')
      },
    },
  }
}

// FR-204.6 (verification half, CC-204.4): `vite preview` of the production
// build must answer the paths this unit self-provides in public/_headers with
// the same cache contract — /sw.js and /manifest.webmanifest revalidate
// (`public, max-age=0, must-revalidate`), never the global no-store the
// preview sends for everything. The catch-all `/*` entry (CSP etc.) is NOT
// wired here: it belongs to the Cloudflare deploy and unit-203 (this preview
// keeps its current behavior — "keep other behaviors as-is").
// https://vite.dev/config/preview-options (preview.headers is global; path
// rules need the preview-server middleware below).
interface HeadersEntry {
  path: string
  headers: Record<string, string>
}

function parseHeadersFile(content: string): HeadersEntry[] {
  const entries: HeadersEntry[] = []
  let current: HeadersEntry | null = null
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd()
    if (line === '' || line.trimStart().startsWith('#')) continue
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      current = { path: line.trim(), headers: {} }
      entries.push(current)
    } else if (current !== null) {
      const match = /^\s*([^:]+):\s*(.*)$/.exec(line)
      if (match?.[1] !== undefined && match[2] !== undefined) current.headers[match[1].trim().toLowerCase()] = match[2].trim()
    }
  }
  return entries
}

function previewHeaders(): Plugin {
  const entries = parseHeadersFile(readFileSync(join(repoRoot, 'public', '_headers'), 'utf8')).filter((entry) => entry.path !== '/*')
  return {
    name: 'zipscribe:preview-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
        const entry = entries.find((candidate) => (candidate.path.endsWith('/*') ? pathname.startsWith(candidate.path.slice(0, -1)) : pathname === candidate.path))
        if (entry !== undefined) {
          // vite's static handler re-applies `preview.headers` (no-store) via
          // sirv `setHeaders` AFTER this middleware — pin the matched values
          // so they win over the global no-store.
          type SetHeaderLike = (name: string, value: string) => void
          const original = res.setHeader.bind(res) as SetHeaderLike
          res.setHeader = ((name: Parameters<typeof res.setHeader>[0], value?: Parameters<typeof res.setHeader>[1]) => {
            if (typeof name === 'string') {
              const forced = entry.headers[name.toLowerCase()]
              if (forced !== undefined) return original(name, forced)
            }
            ;(original as (name: unknown, value: unknown) => void)(name, value)
            return res
          }) as typeof res.setHeader
          for (const [name, value] of Object.entries(entry.headers)) original(name, value)
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), selfHostedWasm(), servedSamples(), servedFixtures(), servedModelMirror(), previewHeaders(), VitePWA(pwaOptions), exposePrecacheManifest()],
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
    rollupOptions: {
      output: {
        // FR-204.2 names "mediabunny" as a first-class precache unit; split
        // it out of the worker bundles under its own chunk name so it is a
        // separately precached, separately auditable file (CC-204.5 asserts
        // the precache manifest contains it).
        manualChunks: (id: string) => (id.includes('node_modules/mediabunny') ? 'mediabunny' : undefined),
      },
    },
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
