// Bundled font assets for FR-201.4 (unit-201): OFL subsets materialized from
// @fontsource devDependencies into public/fonts/ (committed — offline render
// must not depend on node_modules). Default set (FR-201.4 budget ≤ 200 KB):
// Inter, Archivo and JetBrains Mono at 400/700, latin+latin-ext merged per
// face (scripts/merge-fonts.py, fontTools — approved dev tool). Display faces
// (lazy, SW-precached by unit-204): Anton, Bebas Neue, Oswald 500, Poppins 700.
// Re-run: `corepack pnpm fonts` (idempotent).
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const run = spawnSync('python3', [join(ROOT, 'scripts', 'merge-fonts.py')], { stdio: 'inherit', cwd: ROOT })
if (run.status !== 0) {
  console.error('copy-fonts: fontTools merge failed (is python3 + fontTools installed? settings.yml dev list)')
  process.exit(run.status ?? 1)
}
// OFL requires the license text to accompany the redistributed (subset)
// fonts: copy each @fontsource package LICENSE next to the committed faces.
const PACKAGES = ['inter', 'archivo', 'jetbrains-mono', 'anton', 'bebas-neue', 'oswald', 'poppins'] as const
const licenseDir = join(ROOT, 'public', 'fonts', 'licenses')
mkdirSync(licenseDir, { recursive: true })
for (const pkg of PACKAGES) {
  const src = join(ROOT, 'node_modules', '@fontsource', pkg, 'LICENSE')
  copyFileSync(src, join(licenseDir, `${pkg}.txt`))
}
writeFileSync(join(ROOT, 'public', 'fonts', 'README.md'), `# Bundled font faces (FR-201.4)

Committed OFL subsets materialized by \`scripts/copy-fonts.ts\` from
\`@fontsource/*\` devDependencies (regenerate: \`corepack pnpm fonts\`).
\`default/\` is registered at app boot (≤ 200 KB budget, asserted in
\`tests/unit/style/fonts.test.ts\`); \`display/\` is lazy-loaded on demand.
License texts (SIL Open Font License 1.1) are in \`licenses/\` — the OFL
requires them to accompany these redistributed subsets.
`)
console.log(`copy-fonts: licenses mirrored (${PACKAGES.length})`)

const size = (dir: string): number => readdirSync(join(ROOT, 'public', 'fonts', dir)).reduce((a, f) => a + statSync(join(ROOT, 'public', 'fonts', dir, f)).size, 0)
console.log(`copy-fonts: default ${(size('default') / 1024).toFixed(1)} KB (budget 200), display ${(size('display') / 1024).toFixed(1)} KB lazy`)
