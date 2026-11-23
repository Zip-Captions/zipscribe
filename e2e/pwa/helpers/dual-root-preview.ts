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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { REPO_ROOT } from '../../../tests/helpers/repo'
import { warmSwReachable } from './warm-dist.mjs'

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
 * plus a byte-differentiator). Same-origin SW update detection is a byte
 * comparison of /sw.js, and workbox's precache serves the response whose
 * MANIFEST REVISION is cached — so B is not just "index.html + a comment":
 * B's index gets the marker INSIDE <body> (so `document.documentElement
 * .innerHTML` — the update.spec witness — actually sees it) AND B's sw.js
 * index.html precache revision is rewritten to the md5 of B's new index
 * bytes. Without the revision rewrite the old SW (and even the new one, if
 * the revision is unchanged) serves A's cached index forever and the update
 * never becomes observable (unit-204 builder finding #4, reproduced).
 * All of this is test-owned manipulation of the STAGED dist copies under
 * .night/ only — never of implementation files or the shared dist/.
 */
export function stageBuilds(): { distA: string; distB: string } {
  const src = join(REPO_ROOT, 'dist')
  if (!existsSync(join(src, 'index.html'))) {
    throw new Error('dist/index.html missing — the root webServer (`pnpm build && pnpm preview -- --port 4310`) must have built first')
  }
  // Unique per worker (process) so parallel files sharing the helper (or an
  // orphaned run) can never rmSync/cpSync race a live sibling's staged roots.
  const stage = process.env.ZIPSCRIBE_STAGE_DIR ?? `${UPDATE_STAGE}-${process.pid}`
  rmSync(stage, { recursive: true, force: true })
  const distA = join(stage, 'dist-a')
  const distB = join(stage, 'dist-b')
  mkdirSync(stage, { recursive: true })
  cpSync(src, distA, { recursive: true })
  cpSync(src, distB, { recursive: true })
  insertMarker(join(distB, 'index.html'))
  syncPrecacheRevision(join(distB, 'sw.js'), join(distB, 'index.html'))
  // Page-cache warm AFTER the final bytes are written (marker + revision):
  // disk-starved CI workers must not pay cold reads inside the 60 s update
  // toast budget (workbox install + update fetch + activate seeding).
  warmSwReachable(distA)
  warmSwReachable(distB)
  return { distA, distB }
}

/** Put the marker inside <body> (fallback </head>), so it lands within
 *  documentElement.innerHTML — a comment after </html> is outside it. */
function insertMarker(file: string): void {
  const html = readFileSync(file, 'utf8')
  const lowered = html.toLowerCase()
  const body = lowered.lastIndexOf('</body>')
  const head = lowered.lastIndexOf('</head>')
  const at = body !== -1 ? body : head !== -1 ? head : html.length
  writeFileSync(file, `${html.slice(0, at)}${BUILD_B_MARKER}${html.slice(at)}`, 'utf8')
}

/** Rewrite the workbox precache entry for index.html to md5(staged B index)
 *  (the md5 hex revision scheme of workbox-build generateSW), making B's
 *  sw.js both byte-different from A's and self-consistent with B's index. */
function syncPrecacheRevision(swFile: string, indexFile: string): void {
  if (!existsSync(swFile)) return
  const md5 = createHash('md5').update(readFileSync(indexFile)).digest('hex')
  const sw = readFileSync(swFile, 'utf8')
  const pattern = /(\{"url":\s*"\/?index\.html",\s*"revision":\s*")[0-9a-f]+(")/
  if (!pattern.test(sw)) throw new Error(`no workbox index.html precache entry found in ${swFile} — cannot stage a consistent build B`)
  writeFileSync(swFile, sw.replace(pattern, `$1${md5}$2`), 'utf8')
}

export interface DualRootServer {
  url: string
  /** Flip the deployed build (the "deployment" of the update flow). */
  deploy(which: 'a' | 'b'): void
  close(): Promise<void>
}
export async function startDualRootServer(port: number, distA: string, distB: string, host = '127.0.0.1'): Promise<DualRootServer> {
  let root = distA
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`)
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
  }
  // Bind the registered port; on EADDRINUSE (an orphaned sibling run holding
  // it) step off by one, then ephemeral — the specs only ever use .url.
  let bound: Server | null = null
  let boundPort = port
  for (const candidate of [port, port + 1, port + 2, 0]) {
    const server = createServer(handler)
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(candidate, host, () => resolve())
      })
    } catch {
      server.close()
      continue
    }
    bound = server
    boundPort = (server.address() as { port: number }).port
    break
  }
  if (bound === null) throw new Error(`no port available near ${port}`)
  const server = bound
  return {
    url: `http://${host}:${boundPort}`,
    deploy(which) {
      root = which === 'a' ? distA : distB
      // The flip is the "deployment": warm the newly served root's
      // SW-reachable bytes synchronously, before any triggerUpdateCheck().
      warmSwReachable(root)
    },
    close() {
      // force-close keep-alives so afterAll cannot hang on a live browser
      // connection left by a failed test, then drop the staged dist copies
      // (they are multi-GB under .night/ and must not accumulate).
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      rmSync(dirname(distA), { recursive: true, force: true })
      return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    },
  }
}

/** Force the browser to re-check /sw.js on the SAME origin (the browser-side
 *  half of a deployment — the update fetch bypasses Playwright routing, so
 *  the server flip above is what the real update check observes). The
 *  registration/update promises have no Playwright evaluate timeout and can
 *  stall after a setOffline flip, so the check is raced against a bound —
 *  the toast assertion in the spec owns the real verdict. */
export async function triggerUpdateCheck(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const settled = Promise.race([
      navigator.serviceWorker.getRegistration().then((registration) => registration?.update()),
      new Promise<undefined>((resolve) => setTimeout(resolve, 20_000)),
    ])
    await settled
  })
}
