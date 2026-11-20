// Font manager (FR-201.4 / US-3.1.1). Bundled OFL subsets (public/fonts,
// committed by scripts/copy-fonts.ts) are the DEFAULT and work offline;
// Google-Fonts loading is an explicit per-font opt-in (product privacy rule)
// with font-display: swap semantics (FontFace display:'swap') and a
// measure-after-load re-render: after document.fonts.ready we bump a
// whitelisted <html> data-attribute, which unit-104's transcript re-measure
// MutationObserver already listens on (design § re-measure bus) and the
// overlay layer re-renders from the next arbitrator sample.
//
// Worker parity: `BUNDLED_FONT_FACES` is the single source the export worker
// registers via `new FontFace(...)` + `self.fonts.add` (FR-201.4) so
// OffscreenCanvas uses identical faces.
//
// SECURITY-03: no transcript text crosses this module — faces are keyed by
// family/weight only; coverage hints receive plain strings and return bools.

import { BUNDLED_FONT_FACES, type FontFaceSpec } from '@engine/style/fonts-manifest'

export type { FontFaceSpec }
export { BUNDLED_FONT_FACES }

/** Google-Fonts opt-in targets (remote css2 URL; per-font toggle in settings). */
export const REMOTE_FONT_SOURCES: Readonly<Record<string, string>> = {
  Anton: 'https://fonts.googleapis.com/css2?family=Anton&display=swap',
  'Bebas Neue': 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
  Oswald: 'https://fonts.googleapis.com/css2?family=Oswald:wght@200..700&display=swap',
  Poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap',
}

const registered = new Map<string, FontFace>()

function fontFaceCtor(): typeof FontFace | undefined {
  return typeof FontFace === 'function' ? FontFace : undefined
}

/** latin + latin-ext coverage (the bundled subsets' ranges) — scripts outside
 *  (Arabic, CJK, Devanagari) fall back to system fonts; UI shows a hint. */
export function isInBundledCoverage(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp <= 0x20) continue
    const ok = cp <= 0x24f || (cp >= 0x1e80 && cp <= 0x1eff) || cp === 0x20ac || cp === 0x2122 || (cp >= 0x2000 && cp <= 0x206f)
    if (!ok) return false
  }
  return true
}

function addFace(spec: FontFaceSpec, remoteUrl?: string): Promise<FontFace> | null {
  const Ctor = fontFaceCtor()
  const doc = typeof document !== 'undefined' ? document : undefined
  if (Ctor === undefined || doc === undefined || !('fonts' in doc)) return null
  const key = `${spec.family}:${spec.weight}`
  const existing = registered.get(key)
  if (existing !== undefined && remoteUrl === undefined) return existing.load().then(() => existing)
  if (existing !== undefined && doc !== undefined && 'fonts' in doc) {
    doc.fonts.delete?.(existing)
    registered.delete(key)
  }
  const face = remoteUrl !== undefined
    ? new Ctor(spec.family, `url(${remoteUrl})`, { weight: String(spec.weight), display: 'swap' })
    : new Ctor(spec.family, `url(${spec.url})`, { weight: String(spec.weight) })
  registered.set(key, face)
  return face.load().then(() => {
    doc.fonts.add(face)
    notifyFontsReady()
    return face
  })
}

/** Register the default (non-lazy) bundled set — safe to call repeatedly. */
export async function ensureDefaultFonts(): Promise<void> {
  await Promise.all(BUNDLED_FONT_FACES.filter(f => !f.lazy).map(f => addFace(f) ?? Promise.resolve(null)))
}

/** Lazy display face registration on first use (FR-201.4). */
export async function ensureDisplayFont(family: string): Promise<void> {
  const spec = BUNDLED_FONT_FACES.find(f => f.family === family && f.lazy)
  if (spec === undefined) return
  await (addFace(spec) ?? Promise.resolve(null))
}

/** Explicit remote opt-in per product privacy rule; swap semantics. */
export async function enableRemoteFont(family: string): Promise<boolean> {
  const remote = REMOTE_FONT_SOURCES[family]
  const spec = BUNDLED_FONT_FACES.find(f => f.family === family)
  if (remote === undefined || spec === undefined) return false
  try {
    // FontFace src must be a FONT resource — the css2 stylesheet URL cannot
    // be one (the loader never parses CSS). Fetch the css2 text and resolve
    // the gstatic woff2 binaries its @font-face rules reference.
    const res = await fetch(remote)
    if (!res.ok) return false
    const css = await res.text()
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.woff2)\)/g)]
      .map(m => m[1])
      .filter((u): u is string => u !== undefined)
    if (urls.length === 0) return false
    await addFace({ ...spec, lazy: false }, urls[urls.length - 1])
    return true
  } catch {
    registered.delete(`${spec.family}:${spec.weight}`)
    return false
  }
}

/** Test seam: forget registration bookkeeping (never used in production). */
export function resetFontRegistryForTests(): void {
  registered.clear()
}

/** unit-104 re-measure bus: bump the whitelisted html attribute so the
 *  transcript virtualizer re-measures after a font swap. */
export function notifyFontsReady(): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.setAttribute('data-fonts-rev', String((Number(el.getAttribute('data-fonts-rev') ?? '0') + 1) % 1000))
}

/** True when the family needs the system fallback for `text` (hint source). */
export function needsSystemFallback(family: string, text: string): boolean {
  return !isInBundledCoverage(text) && family !== 'system'
}
