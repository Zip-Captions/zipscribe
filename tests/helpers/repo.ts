// Process/gate helpers shared by the scaffold tests.
//
// These drive the *contract commands* named by the unit spec
// (`.ai-dlc/local-transcribe-engine/unit-01-scaffold-quality-gates.md`):
// `package.json` scripts, `scripts/*.mjs|ts`, `eslint.config.js`,
// `playwright.config.ts`, `fixtures/`, `.github/workflows/*`. A test calling
// one of them fails today because the command does not exist yet — that is the
// intended RED state for a scaffold unit.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
export const SCAFFOLD_SPECIMEN = join(REPO_ROOT, 'tests/fixtures/scaffold-app')

export interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
  output: string
  slug: string
}

export function runPnpm(script: string, args: string[] = [], timeoutMs = 30_000): CommandResult {
  if (!(script in packageScripts())) {
    throw new Error(`package.json has no "${script}" script`)
  }
  return runTool('corepack', ['pnpm', 'run', '--silent', script, ...args], timeoutMs, REPO_ROOT)
}

export function runCommand(command: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): CommandResult {
  return runTool(command, args, opts.timeoutMs ?? 30_000, opts.cwd ?? REPO_ROOT)
}

function runTool(command: string, args: string[], timeoutMs: number, cwd: string, extraEnv: Record<string, string | undefined> = {}): CommandResult {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', ZIPSCRIBE_CHILD: '1', ...extraEnv }
  for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key]
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    env,
    maxBuffer: 32 * 1024 * 1024,
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const output = `${stdout}\n${stderr}`
  return {
    status: result.status,
    stdout,
    stderr,
    output,
    slug: `${command} ${args.join(' ')}`,
  }
}

/** Remove a repo-relative path a test created (never anything outside it). */
export function removeRepoPath(path: string): void {
  rmSync(join(REPO_ROOT, path), { recursive: true, force: true })
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as T
}

export function exists(path: string): boolean {
  return existsSync(join(REPO_ROOT, path))
}

export function readText(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

export interface PackageManifest {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

export function packageScripts(): Record<string, string> {
  const pkg = readJson<PackageManifest>('package.json')
  return pkg.scripts ?? {}
}

/** A script is "missing" when it is absent, empty, or only an echo stub. */
export function isPlaceholderScript(script: string | undefined): boolean {
  if (!script || script.trim() === '') return true
  return script.includes('exit 1') && script.includes('not implemented')
}

export function walkFiles(dir: string, options: { skip?: string[] } = {}): string[] {
  const absolute = join(REPO_ROOT, dir)
  if (!existsSync(absolute)) return []
  const skip = new Set([...COMMON_SKIP, ...(options.skip ?? [])])
  const found: string[] = []
  const stack = [absolute]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      const rel = relative(REPO_ROOT, full)
      if ([...skip].some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) found.push(rel)
    }
  }
  return found.sort()
}

export const COMMON_SKIP = ['node_modules', 'dist', 'build', 'coverage', '.git', 'playwright-report', 'test-results', '.cache', 'reports', 'logs']

export function totalBytes(paths: string[]): number {
  return paths.reduce((sum, rel) => sum + statSync(join(REPO_ROOT, rel)).size, 0)
}

/** Fresh directory for a gate run, outside the repo tree. */
export function scratchDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `zipscribe-${label}-`))
}

/** Copy `from` (repo-relative dir) to `to`, skipping build output. */
export function copyTree(from: string, to: string, options: { skip?: string[] } = {}): void {
  cpSync(join(REPO_ROOT, from), to, {
    recursive: true,
    filter: (source) => {
      const rel = relative(REPO_ROOT, source)
      const skip = ['node_modules', 'dist', 'coverage', '.git', 'playwright-report', 'test-results', ...(options.skip ?? [])]
      return !skip.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))
    },
  })
}

/** Run a tool in an arbitrary working directory (scratch trees). */
export function runIn(cwd: string, command: string, args: string[], timeoutMs = 30_000, extraEnv: Record<string, string | undefined> = {}): CommandResult {
  return runTool(command, args, timeoutMs, cwd, extraEnv)
}

/** Write a file (repo-relative or absolute) creating parent directories. */
export function writeFixtureFile(path: string, contents: string | Uint8Array): string {
  const absolute = path.startsWith('/') || path.startsWith('/var/') ? path : join(REPO_ROOT, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents)
  return absolute
}

/** Remove a scratch directory (temp dirs only; never inside the repo). */
export function removeScratch(path: string): void {
  if (path.startsWith(tmpdir())) rmSync(path, { recursive: true, force: true })
}

export function existsIn(dir: string, path: string): boolean {
  return existsSync(join(dir, path))
}

/**
 * True when this vitest process was spawned by another scaffold test (the
 * gate commands inherit `ZIPSCRIBE_CHILD=1` from `runTool`). Tests that would
 * recursively re-run the whole suite return early in that case — the parent
 * test measures the child's exit code, the child must not re-spawn.
 */
export function isChildRun(): boolean {
  return process.env.ZIPSCRIBE_CHILD === '1'
}

/**
 * Make `dir` behave like a checkout of this repo for `pnpm exec` runs:
 * a `package.json` stub plus a `node_modules` symlink into the real one, so
 * scratch-tree probes resolve `vitest` and the repo bin without a second
 * install.
 */
export function linkScratchToolchain(dir: string, scripts: Record<string, string> = {}): void {
  if (!existsSync(join(dir, 'package.json'))) {
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'zipscribe-scratch', private: true, type: 'module', scripts }, null, 2)}\n`)
  }
  if (!existsSync(join(dir, 'node_modules'))) {
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
  }
}
