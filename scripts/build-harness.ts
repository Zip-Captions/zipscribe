// scripts/build-harness.ts — unit-04 (CC-04.1…CC-04.13, L4): prebuild the
// browser harness pages into `public/harness/` so they are served by the
// product build + `vite preview` exactly like the rest of the app.
//
// Why a separate build instead of a second webServer: playwright.config.ts
// owns ONE webServer (`pnpm build && pnpm preview`, 4310) and the frozen
// unit-01/02/03 suites depend on its command line verbatim. A harness-only
// second server would need a config edit that touches those suites. Bundling
// the harness into the public dir keeps the single-server contract: the specs
// navigate to `/harness/media.html` on the very same origin as the app, so
// the network audit and the CI e2e job stay untouched.
//
// Runs before `vite build`, so the copy is in `public/` when the product build
// snapshots publicDir into `dist/`. mediabunny (the SDK under test) resolves
// from node_modules through the harness bundle; `@engine/*` resolves via the
// same alias as the product config.
import { build, type Plugin } from 'vite'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Resolve `@engine/audio/x` to a real source file if the builder has written one. */
function resolveSource(specifier: string): string {
  const base = join(repoRoot, 'src', 'engine', 'audio', specifier.slice('@engine/audio/'.length))
  for (const candidate of [base, ...BUILDABLE.map((ext) => `${base}${ext}`), ...BUILDABLE.map((ext) => join(base, `index${ext}`))]) {
    if (existsSync(candidate)) return candidate
  }
  return base
}
const outDir = join(repoRoot, 'public', 'harness')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// The harness imports the not-yet-written `@engine/audio/*` modules by
// design (RED phase): a failed load resolves to a stub module that throws on
// use, so `media.html` still builds and the e2e specs fail with a readable
// "module not implemented" runtime error instead of a build-time ENOENT.
const BUILDABLE = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx']

/**
 * Every value a unit-04 consumer imports from a not-yet-written module. `type`
 * imports are erased before this hook sees them; these are the runtime names
 * the harness page and the L1 suites destructure.
 */
const STUBBED_MODULES: Record<string, string[]> = {
  '@engine/audio/worker-core': ['decodeAudio', 'decodeForPlayback', 'handleMediaRequest', 'referenceMeter', 'teePcm', 'PcmChunkStream', 'transferSource'],
  '@engine/audio/fingerprint': ['FINGERPRINT_SLICE_BYTES', 'fingerprintFile'],
  '@engine/audio/peaks': ['bucketSecFor', 'computePeaks', 'createPeaksAccumulator', 'DEFAULT_BUCKET_SEC', 'TARGET_PEAK_BUCKETS'],
  '@engine/audio/resample': ['createResampler', 'resample', 'TARGET_SAMPLE_RATE'],
  '@engine/audio/resample/film': ['resampleFilm'],
  '@engine/audio/adapters/probe': ['ALL_FORMAT_HINTS', 'createSupportMatrix', 'formatSignature', 'sniffContainer'],
}

function redPhaseStub(): Plugin {
  return {
    name: 'zipscribe:unit04-red-phase-stub',
    enforce: 'pre',
    config(config) {
      const resolve = config.resolve ?? {}
      const aliases = Array.isArray(resolve.alias) ? [...resolve.alias] : []
      aliases.push({ find: '@engine', replacement: join(repoRoot, 'src', 'engine') })
      return { resolve: { alias: aliases } }
    },
    // Match the aliased absolute path too: some Vite builds resolve the
    // alias before this hook (the object form does, `alias[]` does not), so
    // accept both shapes.
    resolveId(source) {
      const marker = '/src/engine/audio/'
      const aliasedAt = source.indexOf(marker)
      const name = source.startsWith('@engine/audio/') ? source : aliasedAt >= 0 ? `@engine/audio/${source.slice(aliasedAt + marker.length).replace(/\.tsx?$/, '')}` : null
      if (name === null) return null
      if (existsSync(resolveSource(name))) return null
      return `\0stub:${name}`
    },
    load(id) {
      if (!id.startsWith('\0stub:')) return null
      // The builder will delete this stub by writing the real modules; until
      // then emit a module whose every named export throws on use, so the
      // page still loads and the specs fail on behaviour (not on a bundler
      // "not exported" error). The export list is the frozen one the tests
      // and harness import (see the exports assertions in report).
      const names = STUBBED_MODULES[id.slice('\0stub:'.length)] ?? []
      const fail = `() => { throw new Error(${JSON.stringify(`unit-04 module ${id.slice('\0stub:'.length)} is not implemented yet (RED phase)`)}) }`
      return `${names.map((name) => `export const ${name} = ${fail};`).join('\n')}\nexport default new Proxy({}, { get: () => ${fail} });\n`
    },
  }
}

await build({
  root: repoRoot,
  configFile: false,
  logLevel: 'warn',
  plugins: [redPhaseStub()],
  publicDir: false,
  resolve: {
    alias: {
      '@engine': join(repoRoot, 'src', 'engine'),
      '@state': join(repoRoot, 'src', 'state'),
      '@ui': join(repoRoot, 'src', 'ui'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    emptyOutDir: false,
    outDir,
    rollupOptions: {
      input: join(repoRoot, 'e2e', 'media', 'fixtures', 'harness.html'),
      output: {
        entryFileNames: 'media.js',
        chunkFileNames: 'media-[name].js',
        assetFileNames: 'media-[name][extname]',
      },
    },
  },
})

// Rollup keeps the input's path under outDir; flatten the page to
// `/harness/media.html` (its script tag already points at the sibling
// built chunk) and drop the nested copy.
const page = join(outDir, 'e2e', 'media', 'fixtures', 'harness.html')
writeFileSync(join(outDir, 'media.html'), readFileSync(page, 'utf8').replaceAll('src="/', 'src="/harness/').replaceAll('href="/', 'href="/harness/'))
rmSync(join(outDir, 'e2e'), { recursive: true, force: true })

console.log('public/harness: media.html + media.js')
