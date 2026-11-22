// Spec-owned two-build static server for CC-204.4 / CC-204.8 (the SW update
// flow). WHY a server and not Playwright routing: the updated Service Worker
// *main-script* fetch cannot be intercepted via route() (Playwright "Known
// limitations", https://playwright.dev/docs/service-workers — microsoft/
// playwright#14711), and interception that replaced SW behaviour would mock
// away the unit under test. So the two builds are staged on disk under
// <repo>/.night/ and one real HTTP origin serves whichever is "deployed" —
// registration, update check, waiting worker, skipWaiting and reload all run
// the REAL machinery against the REAL build bytes.
//
// The server is created IN-PROCESS in the spec's beforeAll and closed in
// afterAll (unit-03/06 spec-owned-server doctrine — same worker as the file's
// tests under fullyParallel:false, so no orphan across workers and no port
// contention with the root webServer 4310 / model 4311 / memory 4312 / asr
// 4313-4314 / diar 4315).
import { createServer, type Server } from 'node:http'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { REPO_ROOT } from '../../../tests/helpers/repo'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
}

export const UPDATE_STAGE = join(REPO_ROOT, '.night', 'pwa-update')
export const BUILD_B_MARKER = '<!-- zipscribe-e2e-build-B -->'

/**
 * Stage build A (a copy of the root webServer's `dist/`) and build B (a copy
 * plus an appended byte-differentiator in `sw.js` and `index.html`). Same-
 * origin SW update detection is a byte comparison of /sw.js, so the copies
 * must differ; the marker is test-owned fixture manipulation of the STAGED
 * dist copies only — never of implementation files or the shared dist/.
 */
export function stageBuilds(): { distA: string; distB: string } {
  const src = join(REPO_ROOT, 'dist')
  if (!existsSync(join(src, 'index.html'))) {
    throw new Error('dist/index.html missing — the root webServer (`pnpm build && pnpm preview -- --port 4310`) must have built first')
  }
  rmSync(UPDATE_STAGE, { recursive: true, force: true })
  const distA = join(UPDATE_STAGE, 'dist-a')
  const distB = join(UPDATE_STAGE, 'dist-b')
  mkdirSync(UPDATE_STAGE, { recursive: true })
  cpSync(src, distA, { recursive: true })
  cpSync(src, distB, { recursive: true })
  appendMarker(join(distB, 'index.html'))
  const swB = join(distB, 'sw.js')
  if (existsSync(swB)) appendMarker(swB)
  return { distA, distB }
}

function appendMarker(file: string): void {
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n${BUILD_B_MARKER}\n`, 'utf8')
}

export interface DualRootServer {
  url: string
  /** Flip the deployed build (the "deployment" of the update flow). */
  deploy(which: 'a' | 'b'): void
  close(): Promise<void>
}

export async function startDualRootServer(port: number, distA: string, distB: string, host = '127.0.0.1'): Promise<DualRootServer> {
  let root = distA
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/index.html'
    const file = join(root, normalize(pathname).replace(/^([/\\])+/, ''))
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
      return
    }
    // no-store everywhere mirrors vite preview (`preview.headers`) and keeps
    // the update check authoritative: the browser must re-read /sw.js from
    // THIS server on every registration.update() (FR-204.6 semantics).
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(readFileSync(file))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
  return {
    url: `http://${host}:${port}`,
    deploy(which) {
      root = which === 'a' ? distA : distB
    },
    close() {
      return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    },
  }
}

/** Force the browser to re-check /sw.js on the SAME origin (the browser-side
 *  half of a deployment — the update fetch bypasses Playwright routing, so
 *  the server flip above is what the real update check observes). */
export async function triggerUpdateCheck(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration?.update()))
}
