// Bundled font manifest (FR-201.4) — data only (engine-safe: no DOM). The
// browser FontFace registration lives in ui/style/fonts.ts; the export worker
// registers the SAME faces via self.fonts.add from this table, so preview and
// OffscreenCanvas burn-in use identical faces.
export interface FontFaceSpec {
  family: string
  weight: number
  url: string
  /** display faces load lazily on first use (FR-201.4) */
  lazy?: boolean
}

export const BUNDLED_FONT_FACES: readonly FontFaceSpec[] = [
  { family: 'Inter', weight: 400, url: '/fonts/default/inter-latin-all-400.woff2' },
  { family: 'Inter', weight: 700, url: '/fonts/default/inter-latin-all-700.woff2' },
  { family: 'Archivo', weight: 400, url: '/fonts/default/archivo-latin-all-400.woff2' },
  { family: 'Archivo', weight: 700, url: '/fonts/default/archivo-latin-all-700.woff2' },
  { family: 'JetBrains Mono', weight: 400, url: '/fonts/default/jetbrains-mono-latin-all-400.woff2' },
  { family: 'Anton', weight: 400, url: '/fonts/display/anton-latin-all-400.woff2', lazy: true },
  { family: 'Bebas Neue', weight: 400, url: '/fonts/display/bebas-neue-latin-all-400.woff2', lazy: true },
  { family: 'Oswald', weight: 500, url: '/fonts/display/oswald-latin-all-500.woff2', lazy: true },
  { family: 'Poppins', weight: 700, url: '/fonts/display/poppins-latin-all-700.woff2', lazy: true },
]
