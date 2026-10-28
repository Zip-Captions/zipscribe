// Adversarial suite (fresh-session red-team of unit-01): `models:fetch` is the
// SHA-256-verified cache step every gate depends on (FR-1.0.12: "SHA-256-
// verified, .cache/models/"; intent CC-I1.11's discipline: "the partial file is
// not left in cache; retry resumes cleanly").
//
// All cases run the REAL script with `fetch` stubbed via --import, so no
// network is touched (AGENTS.md § Network) while the verification, cache-write
// and failure paths of scripts/models-fetch.ts are exercised.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { REPO_ROOT, runIn, scratchDir, removeScratch } from '../../helpers/repo'

interface Registry {
  models: Record<string, { repo: string; revision: string; files: { path: string; sha256: string }[] }>
}

const CACHE = join(REPO_ROOT, '.cache', 'models')
const registryPath = join(REPO_ROOT, 'models', 'ci-registry.json')
const registry: Registry | null = existsSync(registryPath) ? (JSON.parse(readFileSync(registryPath, 'utf8')) as Registry) : null
const model = registry?.models['whisper-tiny']
const targetFile = model?.files.find((f) => f.path.endsWith('config.json')) ?? null
const usable = registry !== null && model !== null && targetFile !== null

const scratch = scratchDir('models-fetch')
const stubPath = join(scratch, 'fetch-stub.mjs')
const payloadPath = join(scratch, 'payload.bin')
const wrongPath = join(scratch, 'wrong.bin')

function writeStub(): void {
  // Minimal fetch stand-in: the script only reads `ok`, `url` and
  // `arrayBuffer()`. Any URL outside the expected one is refused outright so a
  // real network call can never happen from these tests.
  writeFileSync(
    stubPath,
    `import { readFileSync } from 'node:fs'
globalThis.fetch = async (u) => {
  const href = String(u)
  const expected = process.env.ZIPSCRIBE_STUB_URL
  if (expected && href !== expected) throw new Error('NETWORK-BLOCKED for ' + href)
  if (process.env.ZIPSCRIBE_STUB_MODE === 'drop') throw Object.assign(new Error('socket hang up'), { cause: 'ECONNRESET' })
  const file = process.env.ZIPSCRIBE_STUB_FILE
  const bytes = new Uint8Array(readFileSync(file))
  return { ok: true, status: 200, url: href, arrayBuffer: async () => bytes.buffer }
}
`,
  )
}

const dest = targetFile ? join(CACHE, 'whisper-tiny', targetFile.path) : ''
const expectedUrl = registry && model && targetFile ? `https://huggingface.co/${model.repo}/resolve/${model.revision}/${targetFile.path}` : ''
let original: Buffer | null = null

beforeAll(() => {
  if (!usable) return
  writeStub()
  if (existsSync(dest)) original = readFileSync(dest)
  writeFileSync(payloadPath, original ?? Buffer.alloc(0))
  writeFileSync(wrongPath, Buffer.from('{"tampered":true}'))
})

afterAll(() => {
  if (usable && original && existsSync(dirname(dest))) writeFileSync(dest, original)
  removeScratch(scratch)
})

function cacheBytes(): Buffer | null {
  // null = environment lacks the registry entry or the populated model cache
  // (`pnpm models:fetch` is a setup step per AGENTS.md § Network).
  return usable ? original : null
}

function runStubbed(mode: 'ok' | 'drop' | 'mismatch'): ReturnType<typeof runIn> {
  return runIn(REPO_ROOT, 'node', ['--import', `file://${stubPath}`, 'scripts/models-fetch.ts'], 60_000, {
    ZIPSCRIBE_STUB_MODE: mode,
    ZIPSCRIBE_STUB_URL: expectedUrl,
    ZIPSCRIBE_STUB_FILE: mode === 'drop' ? '' : mode === 'mismatch' ? wrongPath : payloadPath,
  })
}

function strays(): string[] {
  const dir = dirname(dest)
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.includes('.tmp-')) : []
}

describe('adversarial: models:fetch cache integrity', () => {
  test('ADVERSARIAL FR-1.0.12: clean fetch writes the verified file into the cache', () => {
    const bytes = cacheBytes()
    if (!bytes) return
    rmSync(dest, { force: true })
    const run = runStubbed('ok')
    expect(run.status, `stubbed fetch run failed\n${run.output.slice(-2000)}`).toBe(0)
    expect(existsSync(dest), 'fetched file must land in the cache').toBe(true)
    expect(readFileSync(dest).equals(bytes), 'fetched bytes must equal the registry-pinned content').toBe(true)
    expect(strays(), 'no .tmp- residue may persist after a successful fetch').toEqual([])
  })

  test('ADVERSARIAL FR-1.0.12 / CC-I1.11 discipline: a corrupted cache entry is refetched, never trusted', () => {
    const bytes = cacheBytes()
    if (!bytes) return
    writeFileSync(dest, Buffer.from('{"poisoned":1}'))
    const run = runStubbed('ok')
    expect(run.status, `poisoned cache must be refetched successfully\n${run.output.slice(-2000)}`).toBe(0)
    expect(readFileSync(dest).equals(bytes), 'poisoned bytes must be replaced with the verified payload').toBe(true)
  })

  test('ADVERSARIAL FR-1.0.12 / CC-I1.11: network drop mid-fetch exits non-zero and leaves NO file at the cache path', () => {
    const bytes = cacheBytes()
    if (!bytes) return
    writeFileSync(dest, Buffer.from('{"poisoned":1}'))
    const run = runStubbed('drop')
    expect(run.status, 'a network drop must fail the run').not.toBe(0)
    expect(existsSync(dest), 'the removed corrupt entry must not be repopulated partially (CC-I1.11: "the partial file is not left in cache")').toBe(false)
    expect(strays(), 'a dropped fetch must leave no .tmp- residue').toEqual([])
  })

  test('ADVERSARIAL FR-1.0.12: a SHA-256 mismatch aborts, leaves neither the file nor a stray tmp artifact', () => {
    const bytes = cacheBytes()
    if (!bytes) return
    rmSync(dest, { force: true })
    const run = runStubbed('mismatch')
    expect(run.status, 'a SHA-256 mismatch must fail the run').not.toBe(0)
    expect(/SHA-256 mismatch/.test(run.output), `the failure must report the SHA-256 mismatch\n${run.output.slice(-2000)}`).toBe(true)
    expect(existsSync(dest), 'no unverified file may be placed at the cache path').toBe(false)
    expect(strays(), `no .tmp- residue may be left behind (resume-clean cache): ${strays().join(', ')}`).toEqual([])
  })
})
