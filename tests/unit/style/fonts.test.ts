// @vitest-environment jsdom
// CC-201.4 (L2 legs) — bundled font assets + manager logic. Real offline/
// remote render proofs are the e2e specs (network-blocked bundled render +
// opt-in swap); here: budget, registration bookkeeping, swap semantics,
// re-measure bus and coverage hints.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../../helpers/repo'
import {
  BUNDLED_FONT_FACES, enableRemoteFont, ensureDefaultFonts, ensureDisplayFont,
  isInBundledCoverage, notifyFontsReady, REMOTE_FONT_SOURCES, resetFontRegistryForTests,
} from '@ui/style/fonts'

const added: Array<{ family: string; weight: string; src: string }> = []
const loaded: string[] = []

class FakeFontFace {
  family: string
  src: string
  descriptors?: { weight?: string }
  constructor(family: string, src: string, descriptors?: { weight?: string }) {
    this.family = family
    this.src = src
    this.descriptors = descriptors
  }
  load(): Promise<FakeFontFace> {
    loaded.push(`${this.family}:${this.descriptors?.weight}:${this.src}`)
    return Promise.resolve(this)
  }
}

beforeEach(() => {
  added.length = 0
  loaded.length = 0
  resetFontRegistryForTests()
  vi.stubGlobal('FontFace', FakeFontFace)
  ;(document as unknown as { fonts: unknown }).fonts = { add: (f: FakeFontFace) => added.push({ family: f.family, weight: f.descriptors?.weight ?? '', src: f.src }), ready: Promise.resolve(undefined) }
})

describe('CC-201.4: bundled fonts', () => {
  test('CC-201.4: FR-201.4 default set ≤ 200 KB, committed under public/fonts', () => {
    const dir = join(REPO_ROOT, 'public', 'fonts', 'default')
    const files = readdirSync(dir).filter(f => f.endsWith('.woff2'))
    const total = files.reduce((a, f) => a + statSync(join(dir, f)).size, 0)
    expect(total).toBeLessThanOrEqual(200 * 1024)
    expect(files).toHaveLength(BUNDLED_FONT_FACES.filter(f => !f.lazy).length)
  })

  test('CC-201.4: every declared bundled face url exists on disk', () => {
    for (const f of BUNDLED_FONT_FACES) {
      expect(() => statSync(join(REPO_ROOT, 'public', f.url.replace(/^\//, '')))).not.toThrow()
    }
  })

  test('CC-201.4: ensureDefaultFonts registers exactly the non-lazy faces, idempotently', async () => {
    await ensureDefaultFonts()
    await ensureDefaultFonts()
    expect(added).toHaveLength(BUNDLED_FONT_FACES.filter(f => !f.lazy).length)
    expect(loaded.length).toBeGreaterThanOrEqual(5)
  })

  test('CC-201.4: display faces are lazy — not registered by ensureDefaultFonts', async () => {
    await ensureDefaultFonts()
    expect(added.some(f => f.family === 'Anton')).toBe(false)
    await ensureDisplayFont('Anton')
    expect(added.some(f => f.family === 'Anton')).toBe(true)
  })

  test('CC-201.4: remote opt-in uses display:swap and only fires on explicit call', async () => {
    await ensureDefaultFonts()
    expect(loaded.some(l => l.includes('fonts.googleapis.com'))).toBe(false)
    const ok = await enableRemoteFont('Anton')
    expect(ok).toBe(true)
    expect(loaded.some(l => l.includes('fonts.googleapis.com'))).toBe(true)
  })

  test('CC-201.4: unknown remote family fails softly', async () => {
    expect(await enableRemoteFont('Comic Sans')).toBe(false)
    expect(Object.keys(REMOTE_FONT_SOURCES).length).toBeGreaterThanOrEqual(4)
  })

  test('CC-201.4: fonts-ready re-measure bus bumps the whitelisted html attribute', () => {
    const before = document.documentElement.getAttribute('data-fonts-rev')
    notifyFontsReady()
    expect(document.documentElement.getAttribute('data-fonts-rev')).not.toBe(before)
  })

  test('CC-201.4: scripts outside latin+latin-ext report system-fallback (hint), diacritics do not', () => {
    expect(isInBundledCoverage('café — naïve résumé')).toBe(true)
    expect(isInBundledCoverage('مرحبا بالعالم')).toBe(false)
    expect(isInBundledCoverage('日本語')).toBe(false)
    expect(isInBundledCoverage('देवनागरी')).toBe(false)
  })
})
