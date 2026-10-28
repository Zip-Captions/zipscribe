// scripts/models-fetch.ts — FR-1.0.12 (`pnpm models:fetch`): download the CI
// model tier from the approved hosts only (`settings.yml operations.model_hosts`
// = huggingface.co), verify every file's SHA-256 against the pinned
// `models/ci-registry.json`, and store into the local model cache
// (`.cache/models/`). Any gate that needs models runs this first; tests
// themselves never touch the network (the cache is a setup step, per
// `.agent/AGENTS.md` § Network).
//
// CI caches the result with `hashFiles('models/ci-registry.json')` as the key.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(import.meta.url), '../..')
const CACHE = join(repoRoot, '.cache', 'models')
// mirrors settings.yml operations.model_hosts: huggingface.co + the
// xet/LFS CDN redirect hosts (*.hf.co, *.huggingface.co).
function allowedHost(host: string): boolean {
  return host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co')
}

interface RegistryFile {
  path: string
  sha256: string
}

interface RegistryModel {
  repo: string
  revision: string
  description: string
  files: RegistryFile[]
}

interface Registry {
  models: Record<string, RegistryModel>
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const parsed = new URL(url)
  if (!allowedHost(parsed.hostname)) throw new Error(`blocked host ${parsed.hostname} (allowlist: huggingface.co, *.hf.co, *.huggingface.co)`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const host = new URL(response.url).hostname
  if (!allowedHost(host)) throw new Error(`redirected to blocked host ${host}`)
  return new Uint8Array(await response.arrayBuffer())
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function main(): void {
  const registryPath = join(repoRoot, 'models', 'ci-registry.json')
  if (!existsSync(registryPath)) {
    console.error('models:fetch: models/ci-registry.json missing')
    process.exit(1)
  }
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Registry
  let fetched = 0
  let cached = 0
  for (const [id, model] of Object.entries(registry.models)) {
    for (const file of model.files) {
      const dest = join(CACHE, id, file.path)
      if (existsSync(dest)) {
        const existing = sha256(new Uint8Array(readFileSync(dest)))
        if (existing === file.sha256) {
          cached++
          continue
        }
        rmSync(dest)
      }
      const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`
      process.stdout.write(`  ${id}/${file.path} … `)
      const bytes = await fetchBinary(url)
      const actual = sha256(bytes)
      if (actual !== file.sha256) {
        throw new Error(`SHA-256 mismatch for ${id}/${file.path}: expected ${file.sha256}, got ${actual}`)
      }
      mkdirSync(dirname(dest), { recursive: true })
      const tmp = `${dest}.tmp-${process.pid}`
      writeFileSync(tmp, bytes)
      renameSync(tmp, dest)
      fetched++
      console.log('ok')
    }
  }
  console.log(`models:fetch: ${Object.keys(registry.models).length} model(s) ready — ${fetched} fetched, ${cached} already cached → ${'.cache/models/'}`)
}

main().catch((error: unknown) => {
  console.error(`models:fetch: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
