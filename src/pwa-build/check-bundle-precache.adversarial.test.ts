// ADVERSARY (unit-204, category: boundary values + parser divergence) —
// scripts/check-bundle.mjs FR-204.3 precache gate: "Precache budget: total
// precache ≤ 15 MB; build fails above it … each file ≤ 25 MiB (Cloudflare
// Pages limit)" (unit-204 FR-204.3, CC-204.5).
//
// The gate parses the GENERATED sw.js precache manifest with
// `/self\.__WB_MANIFEST\s*=\s*(\[[\s\S]*?\])/` after the
// `exposePrecacheManifest` re-serialize transform (vite.config.ts) rewrote
// `precacheAndRoute([...])` into `precacheAndRoute((self.__WB_MANIFEST=[…]),…)`.
// These tests drive the REAL script (copied verbatim into a `.night/`
// sandbox — its repoRoot is derived from its own file location) against
// synthetic manifests to pin the boundary semantics and prove the parser
// agrees with the served shape (never a silent pass on a manifest the
// browser would precache over budget).
//
// MB/MiB ASSUMPTIONS: FR-204.3 says "15 MB" for the total and "25 MiB" per
// file; the implementation gates both in MiB (15*1024*1024 / 25*1024*1024)
// and the e2e (cache-policy.spec) asserts the same MiB boundary — minimal
// reading is "MiB for both", which these tests pin.
import { copyFileSync, existsSync, mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = join(REPO, '.night', 'adversarial-check-bundle')

interface CaseSpec {
  name: string
  /** url → size in bytes (file created in dist/, listed in the manifest). */
  entries: Record<string, number>
}

function writeCase(spec: CaseSpec): string {
  const root = join(BASE, spec.name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true })
  copyFileSync(join(REPO, 'scripts', 'check-bundle.mjs'), join(root, 'scripts', 'check-bundle.mjs'))
  writeFileSync(join(root, 'bundle-budget.json'), JSON.stringify({ initialJsGzipBytes: 2_000_000, excludePatterns: [] }))
  // Initial entry graph (satisfies the CC-1.0.6 part of the script).
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html><html><head></head><body><script src="/assets/main.js"></script></body></html>')
  writeFileSync(join(root, 'dist', 'assets', 'main.js'), 'const adversarial = 1\n')
  // CC-202.7 lazy-chunk probes must exist and stay out of the initial graph.
  for (const lazy of ['ExportDialog-lazy.js', 'export-sidecar-lazy.js', 'export.worker-lazy.js']) {
    writeFileSync(join(root, 'dist', 'assets', lazy), 'export {}\n')
  }
  const manifest = Object.entries(spec.entries).map(([url, size]) => {
    const file = join(root, 'dist', url.replace(/^\//, ''))
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '')
    truncateSync(file, size)
    return { url, revision: 'a'.repeat(32) }
  })
  // The EXACT shape exposePrecacheManifest emits (build-time re-serialize).
  writeFileSync(join(root, 'dist', 'sw.js'), `workbox.precaching.precacheAndRoute((self.__WB_MANIFEST=${JSON.stringify(manifest)}),{"cacheName":"workbox-precache-v2"})\n`)
  return join(root, 'scripts', 'check-bundle.mjs')
}

function run(script: string): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr, stdout: result.stdout }
}

const MEBIBYTE = 1024 * 1024

describe('FR-204.3 / CC-204.5: check-bundle precache budget boundaries (synthetic manifests)', () => {
  beforeAll(() => {
    rmSync(BASE, { recursive: true, force: true })
  })

  test('total of EXACTLY 15 MiB passes (spec: total precache ≤ 15 MB)', () => {
    const script = writeCase({ name: 'total-at-15mib', entries: { '/big.js': 15 * MEBIBYTE } })
    const { status, stderr } = run(script)
    expect(stderr, `exact-15-MiB total must pass; stderr: ${stderr}`).not.toMatch(/15 MiB budget/)
    expect(status).toBe(0)
  })

  test('total of 15 MiB + 1 byte fails the build (FR-204.3 "build fails above it")', () => {
    const script = writeCase({ name: 'total-over-15mib', entries: { '/big.js': 15 * MEBIBYTE + 1 } })
    const { status, stderr } = run(script)
    expect(status).toBe(1)
    expect(stderr).toMatch(/15 MiB budget/)
  })

  test('a single file of 25 MiB + 1 byte trips the Cloudflare Pages per-file limit', () => {
    const script = writeCase({ name: 'file-over-25mib', entries: { '/huge.js': 25 * MEBIBYTE + 1 } })
    const { status, stderr } = run(script)
    expect(status).toBe(1)
    expect(stderr, 'the per-file rule is reported BEFORE the total rule (loop-then-total order)').toMatch(/25 MiB Cloudflare Pages limit/)
  })

  test('a single file of EXACTLY 25 MiB is within the per-file limit (only the 15 MiB total rejects it)', () => {
    const script = writeCase({ name: 'file-at-25mib', entries: { '/big.js': 25 * MEBIBYTE } })
    const { status, stderr } = run(script)
    expect(status).toBe(1)
    expect(stderr, '25 MiB is ≤ the per-file cap — it must NOT be reported as a Cloudflare violation').not.toMatch(/Cloudflare Pages limit/)
    expect(stderr).toMatch(/15 MiB budget/)
  })

  test('a manifest entry with no file on disk fails LOUDLY (served URL would 404 — CC-204.5)', async () => {
    const script = writeCase({ name: 'entry-missing', entries: { '/present.js': 1024 } })
    // Sneak a second manifest entry whose file is absent.
    const sw = join(BASE, 'entry-missing', 'dist', 'sw.js')
    const source = (await import('node:fs')).readFileSync(sw, 'utf8')
    ;(await import('node:fs')).writeFileSync(sw, source.replace('[{"url":"/present.js"', '[{"url":"/ghost.js","revision":"deadbeef"},{"url":"/present.js"'))
    const { status, stderr } = run(script)
    expect(status).toBe(1)
    expect(stderr).toMatch(/not present in dist/)
  })

  test('a path-traversal manifest entry can never read outside dist/', () => {
    const script = writeCase({ name: 'entry-traversal', entries: { '/../../etc/hosts': 1024 } })
    const { status, stderr } = run(script)
    expect(status).toBe(1)
    expect(stderr).toMatch(/not present in dist/)
  })

  test('an empty precache manifest fails the gate (FR-204.2: the shell must precache)', () => {
    const script = writeCase({ name: 'empty-manifest', entries: {} })
    const { status, stderr } = run(script)
    expect(status).toBe(1)
    expect(stderr).toMatch(/empty/)
  })

  test('a missing sw.js fails the gate (FR-204.1 generateSW must emit it)', () => {
    const script = writeCase({ name: 'no-sw', entries: { '/a.js': 64 } })
    rmSync(join(BASE, 'no-sw', 'dist', 'sw.js'))
    const { status, stderr } = run(script)
    expect(status).toBe(1)
    expect(stderr).toMatch(/sw\.js/)
  })

  test('a manifest URL containing "]" fails LOUDLY, never silently passes (re-serialize vs parser divergence)', async () => {
    // check-bundle extracts the manifest with a NON-GREEDY `\[…\]` regex
    // while the build-time re-serialize transform scans quotes correctly;
    // a `]` inside a URL string truncates the check's capture. Vite chunk
    // names never contain `]`, but if one ever did, the budget gate must
    // FAIL, not under-count to a false green.
    const script = writeCase({ name: 'bracket-url', entries: {} })
    const fs = await import('node:fs')
    const distDir = join(BASE, 'bracket-url', 'dist')
    fs.mkdirSync(join(distDir, 'assets'), { recursive: true })
    fs.writeFileSync(join(distDir, 'assets', 'a]b.js'), 'export {}\n')
    fs.writeFileSync(join(distDir, 'sw.js'), 'workbox.precaching.precacheAndRoute((self.__WB_MANIFEST=[{"url":"/assets/a]b.js","revision":"ab"}]),{"cacheName":"workbox-precache-v2"})\n')
    const { status } = run(script)
    expect(status, 'parser divergence must surface as a NON-ZERO exit (fail loudly), never exit 0 on an unmeasured manifest').not.toBe(0)
    expect(existsSync(join(distDir, 'sw.js'))).toBe(true)
  })
})
