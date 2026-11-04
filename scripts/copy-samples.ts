// Copies the app-served sample clips from fixtures/ into public/samples/
// (CC-101.2 / US-2.0.2 "Try a sample clip": the app fetches
// /samples/speech-2min.mp4 — the fixtures/ directory itself is NEVER served).
// Run standalone (`node scripts/copy-samples.ts`) or from the vite plugin in
// vite.config.ts, mirroring scripts/copy-wasm.ts. The generated files are
// build output — public/samples/ is gitignored.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SAMPLES: readonly { source: string; target: string }[] = [{ source: 'fixtures/speech-2min.mp4', target: 'public/samples/speech-2min.mp4' }]

export function copySamples(): string[] {
  const copied: string[] = []
  for (const sample of SAMPLES) {
    const from = join(repoRoot, sample.source)
    const to = join(repoRoot, sample.target)
    if (!existsSync(from)) throw new Error(`sample source missing: ${sample.source} (run pnpm fixtures?)`)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    copied.push(sample.target)
  }
  return copied
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`public/samples: ${copySamples().join(', ')}`)
}
