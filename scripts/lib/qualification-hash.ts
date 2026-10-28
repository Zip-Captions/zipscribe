// Shared contentHash for the release-qualification artifacts (conventions
// § Release qualification; CC-02.5 / FR-02.10): SHA-256 over the sorted
// per-file digests of `src/**`, `public/**` (generated, git-ignored asset
// directories excluded — they are build products of `copy-wasm` /
// `copy-vendor-assets`, not source), `package.json`, `pnpm-lock.yaml` and the
// model registries under `models/`. Any one-byte change under `src/` flips
// the hash (the frozen tamper test in tests/unit/model-eval/qualify-runner).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

const GENERATED_PUBLIC_DIRS = new Set(['wasm', 'sherpa', 'eval4x', 'fixtures', 'hf-cache'])

function walk(absoluteDir: string, relativeDir: string, files: string[]): void {
  if (!existsSync(absoluteDir)) return
  for (const entry of readdirSync(absoluteDir).sort()) {
    const absolute = join(absoluteDir, entry)
    const relative = relativeDir === '' ? entry : `${relativeDir}/${entry}`
    if (statSync(absolute).isDirectory()) walk(absolute, relative, files)
    else files.push(relative)
  }
}

export function qualificationInputFiles(repoRoot: string): string[] {
  const files: string[] = []
  walk(join(repoRoot, 'src'), 'src', files)
  if (existsSync(join(repoRoot, 'public'))) {
    for (const entry of readdirSync(join(repoRoot, 'public')).sort()) {
      if (GENERATED_PUBLIC_DIRS.has(entry)) continue
      const absolute = join(repoRoot, 'public', entry)
      if (statSync(absolute).isDirectory()) walk(absolute, `public/${entry}`, files)
      else files.push(`public/${entry}`)
    }
  }
  walk(join(repoRoot, 'models'), 'models', files)
  files.push('package.json', 'pnpm-lock.yaml')
  return files.filter((file) => existsSync(join(repoRoot, file))).sort()
}

export function computeContentHash(repoRoot: string): string {
  const digest = createHash('sha256')
  for (const file of qualificationInputFiles(repoRoot)) {
    const bytes = readFileSync(join(repoRoot, file))
    const fileHash = createHash('sha256').update(bytes).digest('hex')
    digest.update(`${posix.normalize(file)}\0${fileHash}\n`)
  }
  return digest.digest('hex')
}

/** Release-qualification file name for a package version (CC-02.5 contract:
 *  `qualification/0.0.0-spike.json`). Pre-release sentinels (0.0.0 — the
 *  tree has not shipped yet) get the `-spike` suffix so the spike's
 *  qualification never masquerades as a release qualification. */
export function qualificationFileName(version: string): string {
  return version === '0.0.0' ? '0.0.0-spike' : version
}
