// Canvas overlay layer (FR-102.6) — shapes frozen by
// tests/unit/editor/unit102-api-contract.d.ts § '@ui/canvas/overlay'.
//
// `letterboxGeometry` is the pure `object-fit: contain` parity math: the
// `<video>` paints with `object-fit: contain`, and the overlay canvas is
// sized/positioned to the EXACT painted content box (aspect fit, centered
// letterbox/pillarbox offsets) so caption rendering lines up with pixels on
// screen. Audio projects (asset 0×0) fit the 16:9 stage box that hosts
// unit-107's visualizer layer beneath the same overlay.
//
// The renderer is PLUGGABLE: the FR-102.6 default is `NO_OP_OVERLAY_RENDERER`
// (Intent 3 supplies the caption renderer via `setRenderer`). Rendering runs
// on the SINGLE rAF loop — the layer never starts its own
// `requestAnimationFrame`; it renders from `SyncArbitrator.subscribe` samples
// (every flushed frame while playing, plus synchronously on seek). The canvas
// is pointer-events pass-through (clicks reach the stage/video underneath).

import type { Project, Seconds } from '../../engine/model'

export interface Box {
  width: number
  height: number
}
export interface StageGeometry {
  x: number
  y: number
  width: number
  height: number
}

/** The audio-project stage is a 16:9 dark canvas (design.md § Audio projects — unit-107 hosts the visualizer on it). */
const STAGE_ASPECT: Box = { width: 16, height: 9 }

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/** `object-fit: contain` parity: aspect-fit `content` into `contentBox`, centered (letterbox/pillarbox offsets). Degenerate boxes (non-finite / ≤ 0) degrade to the full box or a zero rect — never NaN. */
export function letterboxGeometry(contentBox: Box, content: Box): StageGeometry {
  if (!positiveFinite(contentBox.width) || !positiveFinite(contentBox.height)) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  if (!positiveFinite(content.width) || !positiveFinite(content.height)) {
    return { x: 0, y: 0, width: contentBox.width, height: contentBox.height }
  }
  const scale = Math.min(contentBox.width / content.width, contentBox.height / content.height)
  const width = content.width * scale
  const height = content.height * scale
  return {
    x: (contentBox.width - width) / 2,
    y: (contentBox.height - height) / 2,
    width,
    height,
  }
}

export interface OverlayRenderer {
  resize(geometry: StageGeometry, dpr: number): void
  render(playhead: Seconds, project: Project): void
  dispose(): void
}

/** FR-102.6 default (Intent 3 supplies the caption renderer). Stateless — safe to share. */
export const NO_OP_OVERLAY_RENDERER: OverlayRenderer = {
  resize: () => undefined,
  render: () => undefined,
  dispose: () => undefined,
}

/**
 * Layer contract: transparent, sized to `letterboxGeometry`,
 * `pointer-events: none` (pass-through), rAF-rendered via the injected
 * renderer — which is fed by the arbitrator subscription (ONE rAF loop,
 * FR-102.3/FR-102.6). The DOM node itself is unit-101's reserved
 * `[data-testid=preview-canvas-layer]` host; the layer mounts its canvas
 * inside it.
 */
export interface OverlayLayer {
  setRenderer(renderer: OverlayRenderer): void
  fitTo(contentBox: Box, content: Box | null): StageGeometry
  start(): void
  stop(): void
  dispose(): void
}

export interface OverlayLayerDeps {
  /** The stage's reserved canvas-layer host (position: relative/absolute container). */
  host: HTMLElement
  /** Current project for renderer.render — null (no project) skips rendering. */
  getProject(): Project | null
  /** The SyncArbitrator subscription — the ONE rAF source for this layer. */
  subscribe(cb: (playhead: Seconds) => void): () => void
  /** Initial renderer (default FR-102.6 no-op). */
  renderer?: OverlayRenderer
  /** Device pixel ratio source (injected for tests; default window.devicePixelRatio). */
  devicePixelRatio?: () => number
}

export function createOverlayLayer(deps: OverlayLayerDeps): OverlayLayer {
  const dprOf = deps.devicePixelRatio ?? (() => (typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1)))
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.pointerEvents = 'none'
  canvas.style.width = '0'
  canvas.style.height = '0'
  canvas.setAttribute('aria-hidden', 'true')
  deps.host.append(canvas)

  let renderer = deps.renderer ?? NO_OP_OVERLAY_RENDERER
  let geometry: StageGeometry | null = null
  let unsubscribe: (() => void) | null = null
  let disposed = false

  const stop = (): void => {
    unsubscribe?.()
    unsubscribe = null
  }

  const apply = (): void => {
    const dpr = dprOf()
    if (geometry === null) return
    canvas.style.left = `${geometry.x}px`
    canvas.style.top = `${geometry.y}px`
    canvas.style.width = `${geometry.width}px`
    canvas.style.height = `${geometry.height}px`
    canvas.width = Math.max(0, Math.round(geometry.width * dpr))
    canvas.height = Math.max(0, Math.round(geometry.height * dpr))
    renderer.resize(geometry, dpr)
  }

  return {
    setRenderer(next: OverlayRenderer): void {
      if (disposed) return
      if (next === renderer) return
      renderer.dispose()
      renderer = next
      apply()
    },
    fitTo(contentBox: Box, content: Box | null): StageGeometry {
      if (disposed) return { x: 0, y: 0, width: 0, height: 0 }
      geometry = letterboxGeometry(contentBox, content ?? STAGE_ASPECT)
      apply()
      return geometry
    },
    start(): void {
      if (disposed || unsubscribe !== null) return
      unsubscribe = deps.subscribe((playhead) => {
        const project = deps.getProject()
        if (project !== null) renderer.render(playhead, project)
      })
    },
    stop,
    dispose(): void {
      if (disposed) return
      disposed = true
      stop()
      renderer.dispose()
      canvas.remove()
    },
  }
}
