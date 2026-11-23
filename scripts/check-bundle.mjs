// FR-1.0.6 — `pnpm check-bundle`: assert initial JS <= the gzip budget declared
// in bundle-budget.json. The initial set is what the browser loads before the
// app runs: scripts referenced by dist/index.html plus their static (analyzable)
// imports resolved inside dist/. Lazy chunks — workers, transformers/ORT wasm,
// mediabunny, ffmpeg — never enter the set (they are neither referenced from
// index.html nor statically imported by the entry), and excludePatterns is a
// second line of defence.
import { gzipSync } from 'node:zlib'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(repoRoot, 'dist')

function fail(message) {
  console.error(`check-bundle: ${message}`)
  process.exit(1)
}

const budgetPath = join(repoRoot, 'bundle-budget.json')
if (!existsSync(budgetPath)) fail('bundle-budget.json is missing')
const budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
const limit = budget.initialJsGzipBytes ?? budget.maxInitialJsGzipBytes ?? budget.budgetBytes
if (typeof limit !== 'number' || limit <= 0) fail('bundle-budget.json declares no numeric initial-JS gzip budget')
const excludePatterns = budget.excludePatterns ?? []

if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html not found — run `pnpm build` first')
const html = readFileSync(join(dist, 'index.html'), 'utf8')

const initial = new Set()
const queue = []
for (const match of html.matchAll(/<script[^>]*src="([^"]+\.js)"/g)) queue.push(match[1].replace(/^\//, ''))

// Resolve a chunk reference relative to the referencing chunk's directory
// (vite emits sibling chunks). Nothing else resolves: the initial graph of a
// real vite build has no dangling imports, so an unresolvable one means the
// graph was tampered with or broken — a red flag the CC-01.4 probe relies on.
function resolveChunk(spec, fromDir) {
  const candidate = resolve(dist, fromDir, spec)
  if (candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

function distRelative(absolute) {
  return absolute
    .slice(dist.length + 1)
    .split('\\')
    .join('/')
}

// vite/rollup minified output emits `import{a}from'./x.js'` / `export*from'…'`
// with no whitespace around braces or `from`; the pattern must accept that
// exact emitted form (ground-truthed against vite 7.3.7 builds) while still
// ignoring dynamic `import('./x.js')` (lazy — correctly not in the graph).
const staticImport = /(?:^|[\s;(),{}])(?:import|export)\s*(?:[^'"]*?from\s*)?['"]([^'"]+\.js)['"]/g

while (queue.length > 0) {
  const entry = queue.shift()
  if (initial.has(entry)) continue
  const absolute = resolve(dist, entry)
  if (!absolute.startsWith(dist) || !existsSync(absolute) || !statSync(absolute).isFile()) {
    fail(`initial script not found in dist/: ${entry}`)
  }
  initial.add(entry)
  const source = readFileSync(absolute, 'utf8')
  for (const match of source.matchAll(staticImport)) {
    const spec = match[1]
    if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/')) continue
    const resolved = resolveChunk(spec, dirname(entry))
    if (resolved) queue.push(distRelative(resolved))
    else fail(`initial chunk ${entry} imports "${spec}" which is not present in dist/ — broken or tampered bundle`)
  }
}

const counted = []
let total = 0
for (const chunk of [...initial].sort()) {
  // settings.yml binds exclusion to LAZINESS ("lazy-loaded and excluded").
  // A chunk in the initial graph is by definition not lazy, so name-matching
  // excludePatterns must never exempt it: a lazy-only dependency reached
  // statically is a contract violation, and its bytes count against the
  // budget like any other initial JS.
  if (excludePatterns.some((pattern) => chunk.includes(pattern))) {
    fail(`chunk ${chunk} matches an excludePattern (${JSON.stringify(excludePatterns)}) but is statically reachable from the entry — it is loaded eagerly, violating the lazy-loaded exclusion rule`)
  }
  const bytes = gzipSync(readFileSync(join(dist, chunk)), { level: 9 }).length
  total += bytes
  counted.push({ chunk, gzip: bytes })
}

// CC-202.7 (unit-202): the export surface must exist AS lazy chunks — the
// dialog, the sidecar service and the burn-in worker (mediabunny inside) are
// dynamic imports, never in the initial graph.
const assets = readdirSync(join(dist, 'assets'))
for (const probe of [/^ExportDialog-[^/]+\.js$/, /^export-sidecar-[^/]+\.js$/, /^export\.worker-[^/]+\.js$/]) {
  const found = assets.filter((a) => probe.test(a)).map((a) => `assets/${a}`)
  if (found.length === 0) fail(`CC-202.7: no lazy chunk matching ${probe} — the export surface must be code-split (FR-202.7)`)
  for (const f of found) {
    if (initial.has(f)) fail(`CC-202.7: ${f} is statically reachable from the entry — export must be lazy (FR-202.7)`)
  }
}

for (const { chunk, gzip } of counted) {
  console.log(`  ${chunk}  ${(gzip / 1024).toFixed(1)} KB gzip`)
}
console.log(`check-bundle: initial JS ${(total / 1024).toFixed(1)} KB gzip / budget ${(limit / 1024).toFixed(0)} KB (${counted.length} chunks)`)
if (total > limit) {
  fail(`initial JS ${(total / 1024).toFixed(1)} KB gzip exceeds the ${(limit / 1024).toFixed(0)} KB budget`)
}

// FR-204.3 (unit-204): precache budget — parse the REAL generated sw.js
// precache manifest (workbox generateSW inlines self.__WB_MANIFEST) and
// measure it against dist on disk: total ≤ 15 MiB, each file ≤ 25 MiB
// (Cloudflare Pages). The build FAILS above the budget, matching the e2e
// assertion made against the served sw.js.
// https://developer.chrome.com/docs/workbox/modules/workbox-build#generatesw
const PRECACHE_TOTAL_BUDGET_BYTES = 15 * 1024 * 1024
const PRECACHE_SINGLE_FILE_BUDGET_BYTES = 25 * 1024 * 1024
const swPath = join(dist, 'sw.js')
if (!existsSync(swPath)) fail('dist/sw.js not found — vite-plugin-pwa (generateSW) must emit the service worker (FR-204.1)')
const swSource = readFileSync(swPath, 'utf8')
const manifestMatch = /self\.__WB_MANIFEST\s*=\s*(\[[\s\S]*?\])/.exec(swSource)
if (manifestMatch?.[1] === undefined) fail('dist/sw.js embeds no self.__WB_MANIFEST precache manifest')
const precacheEntries = JSON.parse(manifestMatch[1])
if (precacheEntries.length === 0) fail('precache manifest is empty (FR-204.2: the app shell must precache)')
let precacheTotal = 0
const oversized = []
for (const entry of precacheEntries) {
  const rel = String(entry.url).replace(/^\//, '')
  const file = join(dist, rel)
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    fail(`precache entry ${entry.url} is not present in dist/ — the served URL would 404 (CC-204.5)`)
  }
  const size = statSync(file).size
  if (size > PRECACHE_SINGLE_FILE_BUDGET_BYTES) oversized.push(`${entry.url} (${size} B)`)
  precacheTotal += size
}
if (oversized.length > 0) fail(`precache file(s) exceed the 25 MiB Cloudflare Pages limit (FR-204.3): ${oversized.join(', ')}`)
if (precacheTotal > PRECACHE_TOTAL_BUDGET_BYTES) {
  fail(`precache total ${precacheTotal} B exceeds the 15 MiB budget (FR-204.3) — models/wasm must never be precached`)
}
console.log(
  `check-bundle: precache ${(precacheTotal / 1048576).toFixed(2)} MiB / budget 15 MiB, largest ${(Math.max(...precacheEntries.map((e) => statSync(join(dist, String(e.url).replace(/^\//, ''))).size)) / 1048576).toFixed(2)} MiB (FR-204.3)`,
)
