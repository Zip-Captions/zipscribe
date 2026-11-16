// CC-107.7 (golden doctrine): one-shot generator for the committed
// visualizer goldens in fixtures/golden/visualizer/. Provenance: runs the
// capture INSIDE the pinned linux playwright image (mcr.microsoft.com/
// playwright:v1.64.1-noble — the CI-equivalent engine, matching the
// playwright version pinned in package.json) so the PNGs are byte-stable
// across the macOS dev box and the linux CI runner. Never re-blessed from
// an unpinned environment (fixtures/golden/README doctrine).
//
// Usage: corepack pnpm exec node scripts/make-visualizer-goldens.ts
// (docker required; the script builds + previews the app inside the
// container, captures both DPRs, writes the PNGs back to the checkout.)

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const IMAGE = 'mcr.microsoft.com/playwright:v1.64.1-noble'
// The pinned image ships node without corepack; install the repo's pnpm
// version (package.json packageManager — contract pin) so lockfile
// semantics match the host toolchain.
import { readFileSync } from 'node:fs'
const declared = (JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string }).packageManager ?? ''
const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(declared)
if (match === null) {
  console.error(`package.json packageManager must be pnpm@x.y.z (got ${declared || 'none'})`)
  process.exit(1)
}
const PACKAGE_MANAGER = match[1]
const OUTPUT_DIR = 'fixtures/golden/visualizer'

if (!existsSync(join(REPO_ROOT, 'pnpm-lock.yaml'))) {
  console.error('run from the repository root')
  process.exit(1)
}

const docker = spawnSync('docker', ['info'], { stdio: 'ignore' })
if (docker.status !== 0) {
  console.error('docker is required for pinned-engine golden generation')
  process.exit(1)
}

// The container works in a COPY (/tmp/goldenwork) — a linux node_modules
// install must never land on the host checkout's volume.
const cmd = [
  'mkdir -p /tmp/goldenwork',
  "tar -C /work --exclude=node_modules --exclude=.git --exclude=dist --exclude='coverage*' -cf - . | tar -C /tmp/goldenwork -xf -",
  'cd /tmp/goldenwork',
  `npm i -g pnpm@${PACKAGE_MANAGER}`,
  'pnpm install --frozen-lockfile --prefer-offline',
  'pnpm run build',
  '(pnpm run preview -- --port 4310 --strictPort >/tmp/preview.log 2>&1 &)',
  'for i in $(seq 1 60); do curl -sf http://127.0.0.1:4310 >/dev/null && break; sleep 1; done',
  'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright GOLDEN_OUT=/work/fixtures/golden/visualizer node scripts/lib/capture-visualizer-golden.mjs',
].join(' && ')

const run = spawnSync('docker', ['run', '--rm', '-v', `${REPO_ROOT}:/work`, '-v', 'zipscribe-pnpm-store:/root/.local/share/pnpm', '-w', '/work', '-e', 'CI=1', IMAGE, 'bash', '-lc', cmd], { stdio: 'inherit' })
if (run.status !== 0) {
  console.error(`golden capture failed (exit ${String(run.status)})`)
  process.exit(run.status ?? 1)
}

for (const dpr of [1, 2]) {
  const file = join(REPO_ROOT, OUTPUT_DIR, `spectrum-overlay-dpr${String(dpr)}.png`)
  if (!existsSync(file)) {
    console.error(`missing output ${file}`)
    process.exit(1)
  }
}
console.log('visualizer goldens written to fixtures/golden/visualizer/ (commit them; regeneration needs the pinned engine)')
