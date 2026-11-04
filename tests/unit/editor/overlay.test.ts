// FR-102.6 (L2, jsdom): the canvas overlay layer — letterbox geometry
// (object-fit: contain parity), pointer-events pass-through, the NO-OP
// default renderer, and the SINGLE-rAF rule (the layer renders from the
// injected subscription — the arbitrator's loop — never its own rAF).
// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
// Relative import (not the `@ui/…` alias): the frozen ambient d.ts types the
// public contract surface (letterboxGeometry/OverlayRenderer/NO_OP…/OverlayLayer);
// the layer FACTORY is implementation-side, so the builder L2 imports it from
// the real module (the same pattern as the slice-B L1 sibling).
import { createOverlayLayer, NO_OP_OVERLAY_RENDERER, letterboxGeometry } from '../../../src/ui/canvas/overlay'
import type { OverlayRenderer } from '../../../src/ui/canvas/overlay'
import { sampleProject } from './helpers/fixture-project'
import type { Project, Seconds } from '@engine/model@102'

interface Fixture {
  host: HTMLDivElement
  layer: ReturnType<typeof createOverlayLayer>
  /** Deliver a sample to every still-subscribed sink (honors stop()). */
  emit(t: Seconds): void
  unsubscribed: number
  renderer: OverlayRenderer & {
    renders: { playhead: Seconds; project: Project }[]
    resizes: { geometry: unknown; dpr: number }[]
    disposes: number
  }
}

function recordingRenderer(): Fixture['renderer'] {
  const renderer = {
    renders: [] as Fixture['renderer']['renders'],
    resizes: [] as Fixture['renderer']['resizes'],
    disposes: 0,
    resize(geometry: unknown, dpr: number): void {
      renderer.resizes.push({ geometry, dpr })
    },
    render(playhead: Seconds, project: Project): void {
      renderer.renders.push({ playhead, project })
    },
    dispose(): void {
      renderer.disposes += 1
    },
  }
  return renderer
}

function fixture(project: Project | null = sampleProject(), renderer = recordingRenderer()): Fixture {
  const host = document.createElement('div')
  document.body.append(host)
  const active = new Set<(t: Seconds) => void>()
  const state = { unsubscribed: 0 }
  const layer = createOverlayLayer({
    host,
    getProject: () => project,
    subscribe: (cb) => {
      active.add(cb)
      return () => {
        active.delete(cb)
        state.unsubscribed += 1
      }
    },
    renderer,
    devicePixelRatio: () => 2,
  })
  return {
    host,
    layer,
    emit: (t: Seconds) => {
      for (const cb of [...active]) cb(t)
    },
    renderer,
    get unsubscribed(): number {
      return state.unsubscribed
    },
  }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('FR-102.6: letterboxGeometry (object-fit: contain parity)', () => {
  test('FR-102.6: 16:9 content in a square box is width-bound, vertically centered (letterboxed)', () => {
    expect(letterboxGeometry({ width: 1000, height: 1000 }, { width: 1280, height: 720 })).toEqual({ x: 0, y: 218.75, width: 1000, height: 562.5 })
  })

  test('FR-102.6: a portrait video in a 16:9 stage is height-bound, horizontally centered (pillarboxed)', () => {
    expect(letterboxGeometry({ width: 1280, height: 720 }, { width: 720, height: 1280 })).toEqual({ x: 437.5, y: 0, width: 405, height: 720 })
  })

  test('FR-102.6: matching aspects fill the box exactly (zero offsets)', () => {
    expect(letterboxGeometry({ width: 1920, height: 1080 }, { width: 1280, height: 720 })).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  test('FR-102.6: degenerate content (audio 0×0) and degenerate boxes never produce NaN', () => {
    expect(letterboxGeometry({ width: 1000, height: 600 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 1000, height: 600 })
    expect(letterboxGeometry({ width: 0, height: 100 }, { width: 16, height: 9 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('FR-102.6: the overlay layer', () => {
  test('FR-102.6: the NO-OP default renderer is inert on all three hooks', () => {
    expect(() => {
      NO_OP_OVERLAY_RENDERER.resize({ x: 0, y: 0, width: 1, height: 1 }, 1)
      NO_OP_OVERLAY_RENDERER.render(0, sampleProject())
      NO_OP_OVERLAY_RENDERER.dispose()
    }).not.toThrow()
  })

  test('FR-102.6: fitTo sizes/positions the canvas at the letterbox geometry with a dpr-scaled backing store', () => {
    const f = fixture()
    const canvas = f.host.querySelector('canvas')
    expect(canvas, 'the layer mounts its canvas inside the 101-reserved host').not.toBeNull()
    const geometry = f.layer.fitTo({ width: 1000, height: 1000 }, { width: 1280, height: 720 })
    expect(geometry).toEqual({ x: 0, y: 218.75, width: 1000, height: 562.5 })
    expect(canvas?.style.left).toBe('0px')
    expect(canvas?.style.top).toBe('218.75px')
    expect(canvas?.style.width).toBe('1000px')
    expect(canvas?.style.height).toBe('562.5px')
    expect(canvas?.width).toBe(2000)
    expect(canvas?.height).toBe(1125)
    expect(f.renderer.resizes.at(-1)).toEqual({ geometry, dpr: 2 })
    f.layer.dispose()
  })

  test('FR-102.6: the canvas is pointer-events pass-through (clicks reach the stage)', () => {
    const f = fixture()
    expect(f.host.querySelector('canvas')?.style.pointerEvents).toBe('none')
    f.layer.dispose()
  })

  test('FR-102.6: start() renders from the injected subscription ONLY (no second rAF); stop() detaches', () => {
    let rafsRequested = 0
    const originalRaf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = ((_cb: FrameRequestCallback): number => {
      rafsRequested += 1
      return 0
    }) as typeof globalThis.requestAnimationFrame
    const f = fixture()
    f.layer.start()
    expect(rafsRequested, 'the layer NEVER requests its own animation frame (single-rAF rule, FR-102.3)').toBe(0)
    f.emit(12.3)
    f.emit(12.5)
    expect(f.renderer.renders.map((r) => r.playhead)).toEqual([12.3, 12.5])
    expect(f.renderer.renders[0]?.project).not.toBeNull()
    f.layer.stop()
    expect(f.unsubscribed).toBe(1)
    f.emit(13)
    expect(f.renderer.renders.length, 'stop() detaches the sample sink').toBe(2)
    globalThis.requestAnimationFrame = originalRaf
    f.layer.dispose()
  })

  test('FR-102.6: a null project skips rendering (nothing to draw, no throw)', () => {
    const f = fixture(null)
    f.layer.start()
    f.emit(1)
    expect(f.renderer.renders.length).toBe(0)
    f.layer.dispose()
  })

  test('FR-102.6: setRenderer swaps live — old renderer disposed, new one resized to the current geometry', () => {
    const f = fixture()
    f.layer.fitTo({ width: 640, height: 360 }, { width: 640, height: 360 })
    const fresh = recordingRenderer()
    f.layer.setRenderer(fresh)
    expect(f.renderer.disposes, 'the replaced renderer is disposed').toBe(1)
    expect(fresh.resizes.at(-1)?.dpr, 'the live renderer receives the CURRENT geometry at the layer dpr').toBe(2)
    f.layer.dispose()
    expect(fresh.disposes, 'dispose() releases the live renderer').toBe(1)
  })

  test('FR-102.6: dispose removes the canvas from the 101-reserved host', () => {
    const f = fixture()
    expect(f.host.querySelector('canvas')).not.toBeNull()
    f.layer.dispose()
    expect(f.host.querySelector('canvas')).toBeNull()
  })
})
