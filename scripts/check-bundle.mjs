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
const staticImport = /(?:^|[\s;()])(?:import|export)\s*(?:[^'"]*?from\s*)?['"]([^'"]+\.js)['"]/g

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

for (const { chunk, gzip } of counted) {
  console.log(`  ${chunk}  ${(gzip / 1024).toFixed(1)} KB gzip`)
}
console.log(`check-bundle: initial JS ${(total / 1024).toFixed(1)} KB gzip / budget ${(limit / 1024).toFixed(0)} KB (${counted.length} chunks)`)
if (total > limit) {
  fail(`initial JS ${(total / 1024).toFixed(1)} KB gzip exceeds the ${(limit / 1024).toFixed(0)} KB budget`)
}
