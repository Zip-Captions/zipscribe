// scripts/license-check.ts — FR-1.0.12: every (transitive) production
// dependency must carry an approved open-source license. GPL/AGPL/LGPL-style
// copyleft never ships in the browser bundle except as a documented
// exception (see EXCEPTIONS below): build-time-only tooling, or runtime
// assets explicitly owner-approved in .ai-dlc/settings.yml
// (approved_dependencies) — every exception must also appear in
// fixtures/LICENSES.md.
// Run by `pnpm license-check` and by CI L0.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..')
const nodeModules = join(repoRoot, 'node_modules')

// Licenses safe to ship to users' browsers.
const APPROVED = [
  /^MIT(\s+OR\s+.+)?$/,
  /^Apache-?2\.0$/,
  /^BSD([- ]?[-\d.]*(Clause|License)?|(\d-Clause)?)$/i,
  /^ISC$/,
  /^0BSD$/,
  /^CC0(-1\.0)?$/,
  /^CC-BY(-4\.0)?$/,
  /^Public Domain$/i,
  /^Unlicen[cs]e$/,
  /^BlueOak-1\.0\.0$/,
  /^Python-2\.0$/,
  /^Zlib$/,
  /^WTFPL$/,
  /^MPL-2\.0$/, // weak copyleft: file-level, fine for consuming unmodified
  /^Artistic-2\.0$/,
]

// name -> { license, reason }: copyleft or unusual licenses permitted only
// for build/fixture-time tooling, or as owner-approved runtime assets
// (settings.yml approved_dependencies) redistributed unmodified with source
// available.
const EXCEPTIONS: Record<string, { license: string; reason: string }> = {
  'ffmpeg-static': {
    license: 'GPL-3.0-or-later (bundled ffmpeg build)',
    reason: 'devDependency used only by scripts/make-fixtures.ts at fixture-authoring time; never imported by app code, never shipped in dist. Documented in fixtures/LICENSES.md.',
  },
  '@ffmpeg/core': {
    license: 'GPL-2.0-or-later (official ffmpeg.wasm core build)',
    reason:
      'Owner-approved runtime dependency: .ai-dlc/settings.yml approved_dependencies.runtime + tech-stack fallback_media ("@ffmpeg/ffmpeg + @ffmpeg/core single-threaded (lazy-loaded, self-hosted; no COOP/COEP in production)"). Redistributed unmodified from the pinned @ffmpeg/core@0.12.10 package, self-hosted under /wasm/ffmpeg via scripts/copy-ffmpeg.ts (SHA-pinned), lazy-loaded as the fallback decoder only when WebCodecs cannot open a container; source publicly available (ffmpeg.org / ffmpegwasm/ffmpeg.wasm). Owner decision 2026-10-30 overnight run. Documented in fixtures/LICENSES.md. Follow-up: LGPL-built core replacement.',
  },
}

interface PackageJson {
  name?: string
  license?: string | { type?: string; [k: string]: unknown }
  licenses?: unknown[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function licenseOf(pkg: PackageJson): string {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses)) {
    const parts = pkg.licenses.map((l) => (typeof l === 'string' ? l : l && typeof l === 'object' && 'type' in l ? String((l as { type?: unknown }).type) : '')).filter(Boolean)
    if (parts.length > 0) return parts.join(' OR ')
  }
  return ''
}

function isApproved(expression: string): boolean {
  const normalized = expression.replace(/[()]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.split(/\s+(?:OR|or|AND|and)\s+/).every((clause) => APPROVED.some((pattern) => pattern.test(clause.trim())))
}

function packageDir(name: string, fromDir?: string): string | null {
  const candidates: string[] = []
  if (fromDir) {
    candidates.push(join(fromDir, 'node_modules', name))
    const real = realpathSafe(fromDir)
    if (real) {
      // pnpm virtual store: siblings live two levels above the package dir
      // (node_modules/.pnpm/<pkg>/node_modules/<name>), one level up for unscoped.
      candidates.push(join(real, '..', '..', name), join(real, '..', name))
    }
  }
  candidates.push(join(nodeModules, name))
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return null
}

function realpathSafe(dir: string): string | null {
  try {
    return realpathSync(dir)
  } catch {
    return null
  }
}

function walk(name: string, dir: string, seen: Set<string>, found: Map<string, string>): void {
  if (seen.has(name)) return
  seen.add(name)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson
  found.set(name, licenseOf(pkg))
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    const depDir = packageDir(dep, dir) ?? packageDir(dep)
    if (depDir) walk(dep, depDir, seen, found)
  }
}

function main(): void {
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as PackageJson
  const prodDeps = Object.keys(root.dependencies ?? {})
  const seen = new Set<string>()
  const found = new Map<string, string>()
  const missing: string[] = []
  for (const name of prodDeps) {
    const dir = packageDir(name)
    if (!dir) {
      missing.push(name)
      continue
    }
    walk(name, dir, seen, found)
  }
  const violations: string[] = []
  for (const [name, license] of [...found.entries()].sort()) {
    const exception = EXCEPTIONS[name]
    if (exception) {
      const licensesDoc = join(repoRoot, 'fixtures', 'LICENSES.md')
      if (!existsSync(licensesDoc) || !readFileSync(licensesDoc, 'utf8').includes(name)) {
        violations.push(`${name}: exception declared but not documented in fixtures/LICENSES.md`)
      }
      continue
    }
    if (!license) {
      violations.push(`${name}: no license field`)
    } else if (!isApproved(license)) {
      violations.push(`${name}: license "${license}" not in approved list`)
    }
  }
  if (missing.length > 0) violations.push(...missing.map((m) => `${m}: not installed (run pnpm install)`))
  if (violations.length > 0) {
    for (const v of violations) console.error(`license-check: ${v}`)
    console.error(`license-check: ${violations.length} violation(s)`)
    process.exit(1)
  }
  const exceptions = Object.keys(EXCEPTIONS).filter((n) => found.has(n) || Object.keys(root.dependencies ?? {}).includes(n))
  console.log(
    `license-check: OK — ${found.size} production package(s) across ${prodDeps.length} direct dependenc${prodDeps.length === 1 ? 'y' : 'ies'}` +
      (exceptions.length > 0 ? `; ${exceptions.length} documented exception(s): ${exceptions.join(', ')}` : ''),
  )
}

main()
