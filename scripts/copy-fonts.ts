// Bundled font assets for FR-201.4 (unit-201): OFL subsets materialized from
// @fontsource devDependencies into public/fonts/ (committed — offline render
// must not depend on node_modules). Default set (FR-201.4 budget ≤ 200 KB):
// Inter, Archivo and JetBrains Mono at 400/700, latin+latin-ext merged per
// face (scripts/merge-fonts.py, fontTools — approved dev tool). Display faces
// (lazy, SW-precached by unit-204): Anton, Bebas Neue, Oswald 500, Poppins 700.
// Re-run: `corepack pnpm fonts` (idempotent).
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const run = spawnSync('python3', [join(ROOT, 'scripts', 'merge-fonts.py')], { stdio: 'inherit', cwd: ROOT })
if (run.status !== 0) {
  console.error('copy-fonts: fontTools merge failed (is python3 + fontTools installed? settings.yml dev list)')
  process.exit(run.status ?? 1)
}
const size = (dir: string): number => readdirSync(join(ROOT, 'public', 'fonts', dir)).reduce((a, f) => a + statSync(join(ROOT, 'public', 'fonts', dir, f)).size, 0)
console.log(`copy-fonts: default ${(size('default') / 1024).toFixed(1)} KB (budget 200), display ${(size('display') / 1024).toFixed(1)} KB lazy`)
