// FR-204.1 — regenerate the committed PWA icon set (public/icons/) from the
// unit-200 design-pass SVG sources (knowledge/design.md § Intent 3 surfaces:
// mockups/icons is the input for @vite-pwa/assets-generator) through the
// assets-generator API: https://vite-pwa-org.netlify.app/assets-generator/api
//
// Two passes on purpose: the transparent icons come from the rounded-corner
// app-icon source, the maskable 512 and the apple touch icon come from the
// full-bleed maskable source (safe zone baked into the SVG — padding 0, the
// generator's default 0.3 padding would shrink artwork that already carries
// its own margins).
//
// Run: `corepack pnpm exec node scripts/make-pwa-assets.ts` (committed
// outputs; no network).
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAssets } from '@vite-pwa/assets-generator/api/generate-assets'
import { instructions } from '@vite-pwa/assets-generator/api/instructions'
import type { AssetType, Preset, ResolvedAssetSize } from '@vite-pwa/assets-generator/config'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'public', 'icons')

const assetName = (type: AssetType, size: ResolvedAssetSize): string => {
  if (type === 'maskable') return `maskable-${size.width}x${size.height}.png`
  if (type === 'apple') return 'apple-touch-icon.png'
  return `pwa-${size.width}x${size.height}.png`
}

const empty = { sizes: [], padding: 0 }

const transparentPreset: Preset = {
  transparent: { sizes: [192, 512], padding: 0, favicons: [[48, 'favicon.ico']] },
  maskable: empty,
  apple: empty,
  assetName,
}

const maskablePreset: Preset = {
  transparent: empty,
  maskable: { sizes: [512], padding: 0 },
  apple: { sizes: [180], padding: 0 },
  assetName,
}

async function generate(source: string, preset: Preset): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const buffer = await readFile(join(outDir, source))
  const instruction = await instructions({
    imageResolver: () => buffer,
    imageName: source,
    preset,
    htmlLinks: { xhtml: false, includeId: false },
    basePath: '/',
    resolveSvgName: (name: string) => name,
  })
  await generateAssets(instruction, true, outDir, (message, ignored) => {
    console.log(`[pwa-assets] ${ignored ? 'ignored' : 'wrote'} ${message}`)
  })
}

for (const file of readdirSync(outDir)) {
  if (/\.(png|ico)$/u.test(file) && !file.startsWith('app-icon')) rmSync(join(outDir, file))
}
await generate('app-icon.svg', transparentPreset)
await generate('app-icon-maskable.svg', maskablePreset)
if (!existsSync(join(outDir, 'pwa-512x512.png'))) throw new Error('pwa-512x512.png not generated')
console.log('[pwa-assets] done')
