// The Intent-3 caption renderer for unit-102's overlay layer (FR-201.1 wiring):
// implements the frozen OverlayRenderer protocol and delegates 100 % of the
// caption painting to `engine/export/overlay.ts` — the SAME entry the export
// worker uses (US-3.1.4 identity). Owns its canvas inside the reserved layer
// host (pointer-events pass-through); never starts its own rAF (the layer
// pumps samples through render()).

import { drawCaptions, safeMargins } from '@engine/export/overlay'
import type { CaptionStyle, Project, Seconds } from '@engine/model'
import type { OverlayRenderer, StageGeometry } from './overlay'

export interface CaptionRendererDeps {
  /** the reserved [data-testid=preview-canvas-layer] host */
  host: HTMLElement
  /** live palette for the speaker bar (--speaker-palette entries) */
  speakerPalette: () => readonly string[]
  /** theme-aware color resolution hook (token remap; identity in tests) */
  resolveStyle?: (style: CaptionStyle) => CaptionStyle
  /** box edge token (--border-subtle resolved) */
  boxEdgeColor?: () => string
  /** preview track override: 'source' (default) or a translation language */
  getTrack?: () => string
  /** test hook: invoked after each fonts.ready re-render */
  onFontsReady?: (render: () => void) => void
}

// Owner decision 2026-11-19: caption colors are palette tokens only. Canvas
// cannot evaluate CSS vars, so known token-resolved dark values are remapped
// per current theme through getComputedStyle.
const TOKEN_REMAP: readonly (readonly [string, string])[] = [
  ['#0d0f12', '--bg-app'],
  ['#15181d', '--bg-panel'],
  ['#4c8dff', '--accent'],
  ['#ffd166', '--gold'],
  ['#e8eaed', '--text-primary'],
  // '#ffffff' deliberately NOT remapped: it is simultaneously the base text
  // color and the karaoke highlight color (highlight must stay on-solid in
  // both themes); resolveStyle cannot tell the two roles apart.
]

function resolveThemeColors(style: CaptionStyle): CaptionStyle {
  if (typeof document === 'undefined') return style
  const cs = getComputedStyle(document.documentElement)
  const map = new Map<string, string>()
  for (const [hex, varName] of TOKEN_REMAP) {
    const v = cs.getPropertyValue(varName).trim()
    if (/^#[0-9a-fA-F]{6}$/.test(v)) map.set(hex, v)
  }
  const remap = (c: string | undefined): string | undefined => (c === undefined ? undefined : (map.get(c.toLowerCase()) ?? c))
  return {
    ...style,
    color: remap(style.color) ?? style.color,
    highlightColor: remap(style.highlightColor) ?? style.highlightColor,
    outlineColor: remap(style.outlineColor) ?? style.outlineColor,
    backgroundColor: remap(style.backgroundColor),
  }
}

export function createCaptionOverlayRenderer(deps: CaptionRendererDeps): OverlayRenderer {
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.pointerEvents = 'none'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset['testid'] = 'caption-canvas'
  deps.host.append(canvas)

  let geometry: StageGeometry | null = null
  let dpr = 1
  let lastPlayhead: Seconds | null = null
  let lastProject: Project | null = null
  let disposed = false

  const renderNow = (): void => {
    if (disposed || geometry === null || lastProject === null || lastPlayhead === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // drawCaptions works in CSS px
    const t = lastPlayhead
    const visible = lastProject.blocks.filter((b) => b.start <= t && t < b.end)
    if (visible.length === 0) return
    const style = deps.resolveStyle?.(lastProject.style) ?? resolveThemeColors(lastProject.style)
    drawCaptions(ctx, {
      blocks: visible,
      time: t,
      style,
      track: deps.getTrack?.() ?? 'source',
      width: geometry.width,
      height: geometry.height,
      speakerPalette: deps.speakerPalette(),
      boxEdgeColor: deps.boxEdgeColor?.(),
      safe: safeMargins(lastProject.outputAspect),
    })
  }

  if (typeof document !== 'undefined' && 'fonts' in document) {
    if (deps.onFontsReady !== undefined) deps.onFontsReady(renderNow)
    else void document.fonts.ready.then(renderNow)
  }

  return {
    resize(nextGeometry, nextDpr) {
      geometry = nextGeometry
      dpr = nextDpr
      canvas.style.left = `${geometry.x}px`
      canvas.style.top = `${geometry.y}px`
      canvas.style.width = `${geometry.width}px`
      canvas.style.height = `${geometry.height}px`
      canvas.width = Math.max(0, Math.round(geometry.width * dpr))
      canvas.height = Math.max(0, Math.round(geometry.height * dpr))
      renderNow()
    },
    render(playhead, project) {
      lastPlayhead = playhead
      lastProject = project
      renderNow()
    },
    dispose() {
      disposed = true
      canvas.remove()
    },
  }
}
