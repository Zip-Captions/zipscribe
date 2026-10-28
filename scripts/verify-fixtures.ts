// scripts/verify-fixtures.ts — CC-01.2: fixture verification (`pnpm
// fixtures:verify`, run as `pretest` and by the CI `fixtures-verify` job).
//
// Checks, failing loudly (exit 1) with the checksum diff on drift and a
// license record complaint when a fixture lacks its LICENSES.md row:
//   1. every non-generated manifest entry exists (fixtures/audio/<name> or
//      fixtures/<name>) and hashes to its recorded SHA-256;
//   2. every manifest entry names a license recorded in fixtures/LICENSES.md;
//   3. every committed file under fixtures/ is known to the manifest.
// `--quiet` prints nothing unless something fails (pretest mode).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(import.meta.url), '../..')
const FIXTURES = join(repoRoot, 'fixtures')
const quiet = process.argv.includes('--quiet')

interface ManifestEntry {
  sha256: string
  generated: boolean
  license: string
}

interface Manifest {
  files: Record<string, ManifestEntry>
}

const failures: string[] = []

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function locate(name: string): string | null {
  for (const dir of [join(FIXTURES, 'audio'), FIXTURES]) {
    const candidate = join(dir, name)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function main(): void {
  const manifestPath = existsSync(join(FIXTURES, 'harness', 'manifest.json'))
    ? join(FIXTURES, 'harness', 'manifest.json')
    : join(FIXTURES, 'manifest.json')
  if (!existsSync(manifestPath)) {
    console.error(`fixtures:verify: no manifest at ${relative(repoRoot, manifestPath)} — run \`pnpm fixtures\``)
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest
  const licensesPath = join(FIXTURES, 'LICENSES.md')
  const licensesText = existsSync(licensesPath) ? readFileSync(licensesPath, 'utf8') : null
  if (licensesText === null) {
    failures.push('fixtures/LICENSES.md is missing — every fixture needs a license record')
  }

  let checked = 0
  for (const [name, entry] of Object.entries(manifest.files)) {
    const file = locate(name)
    if (file === null) {
      if (!entry.generated) failures.push(`missing fixture ${name} — run \`pnpm fixtures\` (setup step)`)
      continue
    }
    const actual = sha256(file)
    if (actual !== entry.sha256) {
      failures.push(`checksum drift ${name}:\n    expected ${entry.sha256}\n    actual   ${actual}`)
    } else {
      checked++
    }
    if (!entry.license) {
      failures.push(`${name}: manifest entry has no license`)
    } else if (licensesText !== null && !licensesText.includes(entry.license)) {
      failures.push(`${name}: license "${entry.license}" has no record in fixtures/LICENSES.md`)
    }
  }

  // every committed file must be known (manifest, license doc, harness files)
  const known = new Set(Object.keys(manifest.files).map((name) => name.replace(/^(\.\.\/)+/, '')))
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name)
      if (item.isDirectory()) {
        walk(full)
        continue
      }
      const rel = relative(FIXTURES, full)
      const base = rel.startsWith('audio/') ? rel.slice('audio/'.length) : rel
      if (rel === 'LICENSES.md' || rel.startsWith('harness/')) continue
      if (!known.has(base)) failures.push(`unlicensed fixture ${rel} — not in manifest/LICENSES.md`)
    }
  }
  if (existsSync(FIXTURES)) walk(FIXTURES)

  if (failures.length > 0) {
    for (const failure of failures) console.error(`fixtures:verify: ${failure}`)
    console.error(`fixtures:verify: FAILED (${failures.length} problem(s))`)
    process.exit(1)
  }
  if (!quiet) console.log(`fixtures:verify: OK — ${checked} fixture(s) checksummed, licenses recorded`)
}

main()
