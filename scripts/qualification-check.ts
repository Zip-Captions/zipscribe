// scripts/qualification-check.ts — verification entry point for the
// release-qualification artifact (FR-02.10, conventions § CI/CD: the
// `qualification-check` job on release/*). Accepts the
// `qualification/<version>.json` produced by `pnpm qualify` (exit 0) only
// when:
//   • the file exists and matches the conventions § Release qualification
//     schema (version, contentHash, startedAt, machine, results[], manual[]),
//   • every recorded result passes (a failed criterion never ships),
//   • the contentHash matches a recomputation over src/**, public/**
//     (generated dirs excluded), package.json, pnpm-lock.yaml and models/**
//     — a one-byte change anywhere in the shipped tree is rejected.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeContentHash, qualificationFileName } from './lib/qualification-hash.ts'

const repoRoot = join(fileURLToPath(import.meta.url), '../..')

function fail(message: string): never {
  console.error(`qualification-check: REJECT — ${message}`)
  process.exit(1)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function main(): void {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
  const fileName = qualificationFileName(pkg.version)
  const path = join(repoRoot, 'qualification', `${fileName}.json`)
  if (!existsSync(path)) fail(`qualification/${fileName}.json missing (run \`pnpm qualify\` on reference hardware)`)

  let file: Record<string, unknown>
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    fail(`qualification/${fileName}.json is not valid JSON`)
  }

  if (!isNonEmptyString(file['version'])) fail('version must be a non-empty string')
  if (typeof file['contentHash'] !== 'string' || !/^[0-9a-f]{64}$/.test(file['contentHash'])) fail('contentHash must be a SHA-256 hex digest')
  if (!Number.isFinite(Date.parse(String(file['startedAt'])))) fail('startedAt must be a parseable timestamp')

  const machine = file['machine']
  if (typeof machine !== 'object' || machine === null || Array.isArray(machine)) fail('machine must be an object')
  const machineRecord = machine as Record<string, unknown>
  for (const key of ['browser', 'os', 'cpu', 'gpu']) {
    if (!isNonEmptyString(machineRecord[key])) fail(`machine.${key} must be a non-empty string`)
  }
  if (typeof machineRecord['ramGB'] !== 'number' || !Number.isFinite(machineRecord['ramGB'])) fail('machine.ramGB must be a finite number')

  if (!Array.isArray(file['results'])) fail('results must be an array')
  const results = file['results'] as Array<Record<string, unknown>>
  if (results.length === 0) fail('results must not be empty')
  // conventions.md § Release qualification line 87: the job "fails on
  // mismatch, missing IDs or any pass:false" — a result row DELETED from
  // results[] cannot be shown to pass (Release exit line 79: every [RQ]
  // criterion of every completed unit passes), so the expected ID set from
  // the unit spec's [RQ] criteria is enforced, not just the rows present.
  const expectedRqIds = ['CC-02.1', 'CC-02.2', 'CC-02.3', 'CC-02.4', 'CC-02.7', 'CC-02.8', 'CC-02.9', 'CC-02.11'] as const
  const recordedIds = new Set(results.map((entry) => String(entry['id'])))
  const missingIds = expectedRqIds.filter((id) => !recordedIds.has(id))
  if (missingIds.length > 0) fail(`missing criterion id(s): ${missingIds.join(', ')} (results[] must record every [RQ] criterion)`)
  for (const entry of results) {
    if (!/^CC-/.test(String(entry['id']))) fail(`results entry id must be a CC-ID, got ${String(entry['id'])}`)
    if (typeof entry['pass'] !== 'boolean') fail(`results[${String(entry['id'])}].pass must be boolean`)
    if (!('measured' in entry) || !('threshold' in entry)) fail(`results[${String(entry['id'])}] must record measured + threshold`)
    if (entry['pass'] !== true) fail(`criterion ${String(entry['id'])} did not pass (measured: ${JSON.stringify(entry['measured'])})`)
  }

  if (!Array.isArray(file['manual'])) fail('manual must be an array')
  for (const entry of file['manual'] as Array<Record<string, unknown>>) {
    for (const key of ['by', 'date', 'result']) {
      if (typeof entry[key] !== 'string') fail(`manual[${String(entry['id'])}].${key} must be a string`)
    }
  }
  if (!(file['manual'] as Array<Record<string, unknown>>).some((entry) => String(entry['id']) === 'CC-02.10')) {
    fail('manual[] must record the [MANUAL] license criterion CC-02.10')
  }

  const expected = computeContentHash(repoRoot)
  if (file['contentHash'] !== expected) fail(`contentHash mismatch — tree changed since qualification (file ${String(file['contentHash']).slice(0, 12)}…, recomputed ${expected.slice(0, 12)}…)`)

  console.log(`qualification-check: ACCEPT — qualification/${fileName}.json valid for contentHash ${expected.slice(0, 12)}…`)
  process.exit(0)
}

main()
