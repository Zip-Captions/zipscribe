// Unit-103 FR-103.1/FR-103.5/FR-103.6/FR-103.7 — the Timeline panel. Shape
// frozen by tests/unit/timeline/unit103-api-contract.d.ts §
// '@ui/timeline/Timeline'. Thin render layer (conventions § ui/**): ONE
// canvas painted by the slice-B renderer through the injected `createTarget`
// seam (default: the canvas 2D context); every interaction routes through the
// controller/commands — this component never mutates the store directly and
// never binds keys itself.
//
// The panel is the single owner of the frozen `timeline.*` command surface:
// WHILE MOUNTED it registers a handler for every frozen binding id (the
// unit-102 `useTransportCommands` precedent) and unregisters on unmount. The
// `when: 'timeline-focused'` gate lives in the registry (reads
// document.activeElement inside the data-region="timeline" element).
//
// SECURITY-03: block text reaches the canvas/live region as the user's own
// on-screen content only — this layer logs nothing.

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import type { CaptionBlock } from '../../engine/model'
import type { EditorApp } from '../../state/history'
import type { RafDriver } from '../../state/services/playback/arbitrator'
import type { Selection } from '../../state/editor'
import { registerCommandHandler } from '../commands/registry'
import { TimecodeInput } from '../editable/TimecodeInput'
import { registerTimelinePanel } from './bridge-seam'
import { createBlockIndex, hitEdge } from './hittest'
import type { BlockIndex } from './hittest'
import { createTimelineController } from './controller'
import type { TimelineController } from './controller'
import { DEFAULT_TIMELINE_PALETTE, createTimelineRenderer } from './renderer'
import type { DrawTarget, TimelinePalette, TimelineRenderer, TimelineRenderState } from './renderer'
import { createViewportState, timeToX, xToTime } from './viewport'
import type { TimelineViewport, ViewportState } from './viewport'

const LANES = { ruler: 24, waveform: 48, blocks: 72 } as const
const LANE_HEIGHT_PX = LANES.ruler + LANES.waveform + LANES.blocks
const PLAYHEAD_ZONE_PX = 4
const NO_BLOCKS: readonly CaptionBlock[] = Object.freeze([])
/** ⌘+wheel zoom step per wheel notch (multiplicative, symmetric about 1). */
const WHEEL_ZOOM_STEP = 1.1
/** Chrome's canvas backing-store dimension ceiling — the content-sized
 *  backing store is clamped below it (CSS width keeps the full mapping). */
const BACKING_STORE_MAX_PX = 32000

export interface TimelineProps {
  app: EditorApp
  rafs: RafDriver
  /** devicePixelRatio (default 1) — drives the backing-store scale (FR-103.1). */
  dpr?: number
  /** Explicit CSS size (default falls back to the element's client size). */
  initialSize?: { widthPx: number; heightPx: number }
  initialViewport?: TimelineViewport
  palette?: TimelinePalette
  /** THE seam for the canvas recorder double: the component builds its draw
   *  target through this factory (default: the canvas 2D context). */
  createTarget?: (widthPx: number, heightPx: number, dpr: number) => DrawTarget
  /** Snap toggle initial state (default true); exposes the timeline-snap-toggle control. */
  snapEnabled?: boolean
}

interface Gesture {
  kind: 'ruler' | 'scrub' | 'drag' | 'marquee'
  x0: number
  moved: boolean
  /** Ruler drag turned into a scrub session (FR-103.6: drag scrubs, click seeks). */
  scrub?: boolean
}

interface Bundle {
  viewport: ViewportState
  controller: TimelineController
  snapRef: { current: boolean }
  renderer: TimelineRenderer | null
  frameRequested: boolean
  frameId: number | null
  gesture: Gesture | null
  /** Spatial-index cache keyed on the blocks REFERENCE (CC-103.4: hit-tests
   *  go through the index — no per-event rebuild over the whole project). */
  indexCache: { blocks: readonly CaptionBlock[] | null; index: BlockIndex } | null
  /** Mount-time configuration (stable by contract). */
  size: { widthPx: number; heightPx: number } | null
  createTarget: ((widthPx: number, heightPx: number, dpr: number) => DrawTarget) | undefined
  palette: TimelinePalette | undefined
  dpr: number
}

/** Default DrawTarget: the canvas 2D context, props delegated to ctx/canvas. */
function createCanvasDrawTarget(canvas: HTMLCanvasElement, widthPx: number, heightPx: number, dpr: number): DrawTarget {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('TIMELINE_CANVAS_2D_UNAVAILABLE')
  const target: DrawTarget = {
    get width(): number {
      return canvas.width
    },
    set width(value: number) {
      canvas.width = value
    },
    get height(): number {
      return canvas.height
    },
    set height(value: number) {
      canvas.height = value
    },
    // The renderer only ever assigns color token STRINGS; the typeof guard
    // narrows the CanvasGradient/CanvasPattern members of the ctx type.
    get fillStyle(): string {
      return typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '#000000'
    },
    set fillStyle(value: string) {
      ctx.fillStyle = value
    },
    get strokeStyle(): string {
      return typeof ctx.strokeStyle === 'string' ? ctx.strokeStyle : '#000000'
    },
    set strokeStyle(value: string) {
      ctx.strokeStyle = value
    },
    get font(): string {
      return ctx.font
    },
    set font(value: string) {
      ctx.font = value
    },
    beginLayer: () => undefined,
    endLayer: () => undefined,
    setTransform: (a, b, c, d, e, f) => ctx.setTransform(a, b, c, d, e, f),
    clearRect: (x, y, w, h) => ctx.clearRect(x, y, w, h),
    fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
    strokeRect: (x, y, w, h) => ctx.strokeRect(x, y, w, h),
    fillText: (text, x, y) => ctx.fillText(text, x, y),
    beginPath: () => ctx.beginPath(),
    moveTo: (x, y) => ctx.moveTo(x, y),
    lineTo: (x, y) => ctx.lineTo(x, y),
    stroke: () => ctx.stroke(),
    measureText: (text) => ctx.measureText(text),
  }
  canvas.width = Math.round(widthPx * dpr)
  canvas.height = Math.round(heightPx * dpr)
  return target
}

/**
 * Store → React binding (Workbench precedent): the frozen L2 suites assert the
 * DOM synchronously after store calls outside `act()`, so the subscription
 * flushes the render before returning.
 */
function useSnapshot<T>(store: { getState(): T; subscribe: (listener: () => void) => () => void }): T {
  const [snapshot, setSnapshot] = useState<T>(() => store.getState())
  useEffect(() => {
    const sync = (): void => {
      const next = store.getState()
      setSnapshot((current) => (Object.is(current, next) ? current : next))
    }
    sync()
    return store.subscribe(() => {
      flushSync(sync)
    })
  }, [store])
  return snapshot
}

export function Timeline(props: TimelineProps): ReactElement {
  const { app, rafs, initialViewport, snapEnabled = true } = props
  const editorState = useSnapshot(app.editor)
  const projectState = useSnapshot(app.project)
  const [snapState, setSnapState] = useState(snapEnabled)
  const [announce, setAnnounce] = useState('')
  // Viewport changes are app state like any store commit — the panel's
  // DOM-derived surface (the content-sized canvas host) re-renders
  // synchronously, the same flushSync-on-notify doctrine the shell's store→React
  // bindings use (Workbench/Timeline useSnapshot). Keeps input→render latency
  // honest under the INP-style perf contract (CC-103.4).
  const [, bumpViewportRender] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const bundleRef = useRef<Bundle | null>(null)
  if (bundleRef.current === null) {
    // Default production zoom 200 px/s: at the 10 000-block density (10 ms
    // blocks) every block is ≥ 2 CSS px (≥ the frozen perf spec's 1.5 px
    // block-width floor) and the 8 px trim handles stay grabbable.
    const viewport = createViewportState(initialViewport ?? { t0: 0, pxPerSec: 200 })
    const snapRef = { current: snapEnabled }
    const controller = createTimelineController({
      app,
      rafs,
      viewport,
      widthPx: props.initialSize?.widthPx ?? 800,
      snapEnabled: () => snapRef.current,
      onAnnounce: (summary) => {
        setAnnounce(`${summary.speakerLabel}, ${summary.timecode}, ${summary.text}`)
        // Focus moved (controller-internal state — no store commit): the
        // focus border/handles are block-layer visuals, dirty them.
        invalidateVisual(['blocks', 'handles'])
      },
    })
    bundleRef.current = {
      viewport,
      controller,
      snapRef,
      renderer: null,
      frameRequested: false,
      frameId: null,
      gesture: null,
      indexCache: null,
      size: props.initialSize ?? null,
      createTarget: props.createTarget,
      palette: props.palette,
      dpr: props.dpr ?? 1,
    }
  }
  const bundle = bundleRef.current

  // rAF-coalesced repaint (FR-103.1): any number of store/gesture changes in
  // one frame flush ONE scheduled frame (CC-103.4). Function declarations so
  // the mount-time controller callback can reference them.
  function buildRenderState(): TimelineRenderState {
    const project = app.project.getState().project
    const editor = app.editor.getState()
    const drag = bundle.controller.dragState()
    return {
      viewport: bundle.viewport.get(),
      blocks: project?.blocks ?? NO_BLOCKS,
      selection: editor.selection,
      focusBlockId: bundle.controller.focusedBlockId(),
      playhead: editor.playhead,
      loop: editor.loop,
      waveform: [], // PeaksData wiring is outside the frozen slice-C surface
      silence: [],
      snapIndicator: drag?.snappedTo ?? null,
      ghost: drag === null ? null : { blockId: drag.blockId, start: drag.start, end: drag.end },
    }
  }

  function requestFrame(): void {
    if (bundle.frameRequested) return
    bundle.frameRequested = true
    bundle.frameId = rafs.request(() => {
      bundle.frameRequested = false
      bundle.frameId = null
      bundle.renderer?.renderNow(buildRenderState())
    })
  }

  function invalidateVisual(layers: ('blocks' | 'handles' | 'snap')[] | 'all'): void {
    if (layers === 'all') bundle.renderer?.invalidate()
    else for (const layer of layers) bundle.renderer?.invalidate(layer)
    requestFrame()
  }

  /** Spatial index over the CURRENT blocks, rebuilt only when the project reference changes (immer keeps it for untouched subtrees). */
  function blockIndex(): BlockIndex {
    const b = bundle
    const blocks = app.project.getState().project?.blocks ?? NO_BLOCKS
    const cached = b.indexCache
    if (cached !== null && cached.blocks === blocks) return cached.index
    const index = createBlockIndex(blocks)
    b.indexCache = { blocks, index }
    return index
  }

  useEffect(() => {
    const b = bundle
    const el = rootRef.current
    const canvas = canvasRef.current
    const browserSized = b.size === null
    const size = b.size ?? { widthPx: el?.clientWidth ?? 800, heightPx: LANE_HEIGHT_PX }
    let target: DrawTarget | null = null
    try {
      target = b.createTarget !== undefined ? b.createTarget(size.widthPx, size.heightPx, b.dpr) : canvas !== null ? createCanvasDrawTarget(canvas, size.widthPx, size.heightPx, b.dpr) : null
    } catch {
      // Canvas-less environments (jsdom): no 2D context — the panel keeps
      // working through the controller (interactions, commands, bridge);
      // there is simply nothing to paint. The frozen L2 suites exercise
      // drawing through the injected `createTarget` seam.
      target = null
    }
    b.renderer = target === null ? null : createTimelineRenderer({ target, rafs, palette: b.palette ?? DEFAULT_TIMELINE_PALETTE, laneHeights: LANES })

    // Browser path: the canvas is CONTENT-sized (duration × pxPerSec CSS px,
    // clamped below the backing-store ceiling) inside the overflow-hidden
    // lane host — blocks paint at (t − t0)·pxPerSec, so the panel window
    // shows [t0, t0 + host/pxPerSec]. L2 path: the frozen initialSize drives
    // one resize, exactly as before.
    const syncCanvasSize = (): void => {
      if (!browserSized || canvas === null) return
      const pps = b.viewport.get().pxPerSec
      const duration = app.project.getState().project?.asset.duration ?? 0
      const hostPx = Math.max(1, el?.clientWidth ?? 800)
      const cap = Math.max(1, Math.floor(BACKING_STORE_MAX_PX / (b.dpr || 1)))
      const next = Math.max(1, Math.min(cap, Math.max(hostPx, Math.ceil(duration * pps))))
      // The backing store is (re)derived from the viewport on EVERY viewport
      // change — the dpr-scaled reallocation is the canvas truth-reset the
      // next coalesced paint renders into (the perf spec pins a measurably
      // real input→state round-trip per interaction; an identical-dimension
      // assign is the cheap honest path when only t0 moved).
      canvas.style.width = `${next}px`
      b.renderer?.resize(next, LANE_HEIGHT_PX, b.dpr)
    }
    if (browserSized) syncCanvasSize()
    else b.renderer?.resize(size.widthPx, size.heightPx, b.dpr)

    // Dirty-layer-only invalidation (CC-103.4): the ONE root-store
    // subscription diffs the slice references and dirties ONLY the layers the
    // change can move; playhead ticks never repaint the block layers.
    interface Snapshot {
      blocks: readonly CaptionBlock[] | null
      playhead: number
      selection: Selection
      loop: readonly [number, number] | null
    }
    const readSnapshot = (): Snapshot => {
      const project = app.project.getState().project
      const editor = app.editor.getState()
      return { blocks: project?.blocks ?? null, playhead: editor.playhead, selection: editor.selection, loop: editor.loop }
    }
    let prev = readSnapshot()
    const onStore = (): void => {
      const next = readSnapshot()
      let dirty = false
      if (next.blocks !== prev.blocks || next.selection !== prev.selection) {
        b.renderer?.invalidate('blocks')
        b.renderer?.invalidate('handles')
        if (next.blocks !== prev.blocks) syncCanvasSize()
        dirty = true
      }
      if (next.playhead !== prev.playhead) {
        b.renderer?.invalidate('playhead')
        dirty = true
      }
      if (next.loop !== prev.loop) {
        b.renderer?.invalidate('ruler')
        dirty = true
      }
      prev = next
      if (dirty) requestFrame()
    }
    // Viewport changes move EVERYTHING (ruler ticks, blocks, playhead) and
    // the zoom re-sizes the content canvas; one coalesced frame covers all.
    const onViewport = (): void => {
      syncCanvasSize()
      b.renderer?.invalidate()
      requestFrame()
      flushSync(() => bumpViewportRender((n) => n + 1))
    }
    const unsubscribes = [app.project.subscribe(onStore), b.viewport.subscribe(onViewport)]
    requestFrame() // initial paint (all layers dirty)

    // ⌘+wheel zoom (anchor under the cursor) / wheel pan — a NON-passive
    // native listener so the page never scrolls/zooms under the timeline.
    const onWheel = (event: WheelEvent): void => {
      if (canvas === null) return
      if (event.cancelable) event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      if (event.ctrlKey) b.controller.zoomAtPixel(x, event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP)
      else b.controller.panByPixels(event.deltaY)
    }
    canvas?.addEventListener('wheel', onWheel, { passive: false })

    // The E2E bridge's read surface (src/ui/timeline/bridge-seam.ts).
    const unregisterPanel = registerTimelinePanel({
      viewport: b.viewport,
      controller: b.controller,
      isSnapping: () => b.snapRef.current,
    })

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && el !== null) {
      observer = new ResizeObserver(() => {
        syncCanvasSize()
        requestFrame()
      })
      observer.observe(el)
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
      canvas?.removeEventListener('wheel', onWheel)
      observer?.disconnect()
      unregisterPanel()
      if (b.frameId !== null) rafs.cancel(b.frameId)
      b.frameRequested = false
      b.frameId = null
      b.renderer?.dispose()
      b.renderer = null
    }
  }, [app, rafs, bundle])

  // The frozen timeline.* command surface — owned by the mounted panel
  // (useTransportCommands precedent), unregistered on unmount.
  useEffect(() => {
    const c = bundle.controller
    const unsubscribes = [
      registerCommandHandler('timeline.split', () => {
        c.splitAtPlayhead()
      }),
      registerCommandHandler('timeline.merge', () => {
        c.mergeSelected()
      }),
      registerCommandHandler('timeline.merge-ctrl', () => {
        c.mergeSelected()
      }),
      registerCommandHandler('timeline.trim-start', () => {
        c.trimStartToPlayhead()
      }),
      registerCommandHandler('timeline.trim-end', () => {
        c.trimEndToPlayhead()
      }),
      registerCommandHandler('timeline.zoom-in', () => {
        c.zoomIn()
      }),
      registerCommandHandler('timeline.zoom-out', () => {
        c.zoomOut()
      }),
      registerCommandHandler('timeline.zoom-fit', () => {
        c.zoomFit()
      }),
      registerCommandHandler('timeline.focus-next', () => {
        c.focusNext()
      }),
      registerCommandHandler('timeline.focus-prev', () => {
        c.focusPrev()
      }),
      registerCommandHandler('timeline.select', () => {
        c.selectFocused()
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
      bundle.controller.dispose()
    }
  }, [bundle])

  function localXY(event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.button !== 0) return
    const b = bundle
    const { x, y } = localXY(event)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Untrusted synthetic pointers (the e2e INP-style sampler dispatches
      // PointerEvents with no active pointer) make setPointerCapture throw
      // NotFoundError — the gesture machine never hinges on capture (the
      // frozen L2 suites even stub it), so the interaction stays live.
    }
    const v = b.viewport.get()
    if (y < LANES.ruler) {
      b.gesture = { kind: 'ruler', x0: x, moved: false }
      return
    }
    const playheadX = timeToX(app.editor.getState().playhead, v)
    if (Math.abs(x - playheadX) <= PLAYHEAD_ZONE_PX) {
      b.gesture = { kind: 'scrub', x0: x, moved: false }
      b.controller.beginPlayheadDrag(x) // scrub through the SyncArbitrator (FR-103.6)
      return
    }
    if (y < LANES.ruler + LANES.waveform) {
      b.gesture = { kind: 'ruler', x0: x, moved: false }
      return
    }
    const block = blockIndex().hit(xToTime(x, v))
    if (block === null) {
      b.gesture = { kind: 'marquee', x0: x, moved: false }
      return
    }
    const edge = hitEdge(block, x, v)
    b.controller.beginDrag(block.id, edge ?? 'body', x, { altKey: event.altKey, shiftKey: event.shiftKey })
    b.gesture = { kind: 'drag', x0: x, moved: false }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const b = bundle
    const gesture = b.gesture
    if (gesture === null) return
    const { x } = localXY(event)
    if (x !== gesture.x0) gesture.moved = true
    if (gesture.kind === 'drag') {
      b.controller.moveDrag(x) // ghost data only — no command until release
      invalidateVisual(['blocks', 'handles', 'snap'])
    } else if (gesture.kind === 'scrub') {
      b.controller.dragPlayheadTo(x)
    } else if (gesture.kind === 'ruler') {
      // FR-103.6: a ruler DRAG scrubs through the SyncArbitrator (a ruler
      // CLICK seeks — see onPointerUp). The session starts on first move.
      if (gesture.scrub !== true) {
        gesture.scrub = true
        b.controller.beginPlayheadDrag(gesture.x0)
      }
      b.controller.dragPlayheadTo(x)
    } else if (gesture.kind === 'marquee') {
      b.controller.marqueeSelect(gesture.x0, x)
      invalidateVisual(['blocks', 'handles'])
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const b = bundle
    const gesture = b.gesture
    b.gesture = null
    if (gesture === null) return
    const { x } = localXY(event)
    if (gesture.kind === 'ruler') {
      if (gesture.scrub === true) b.controller.endPlayheadDrag() // drag = scrub, release adds NO second seek (US-2.1.5)
      else b.controller.rulerClick(x) // FR-103.6: ruler click seeks via transport-seek
    } else if (gesture.kind === 'scrub') {
      b.controller.endPlayheadDrag()
    } else if (gesture.kind === 'drag') {
      b.controller.endDrag() // EXACTLY ONE block-retime on release
      if (!gesture.moved) {
        if (event.shiftKey) b.controller.shiftClickBlock(x)
        else b.controller.clickBlock(x)
      }
    } else if (gesture.kind === 'marquee') {
      if (!gesture.moved) b.controller.clickBlock(x)
      else b.controller.marqueeSelect(gesture.x0, x)
    }
    invalidateVisual(['blocks', 'handles', 'snap'])
  }

  const selection = editorState.selection
  const targetId = selection.focusBlockId ?? selection.anchorBlockId ?? bundle.controller.focusedBlockId()
  const target = projectState.project?.blocks.find((block) => block.id === targetId) ?? null

  return (
    <div ref={rootRef} data-testid="timeline-root" data-region="timeline" role="region" aria-label="timeline" tabIndex={0} className="tl-root">
      <div className="tl-lanes" style={{ position: 'relative', overflow: 'hidden', width: '100%', height: `${LANE_HEIGHT_PX}px` }}>
        <canvas
          ref={canvasRef}
          data-testid="timeline-canvas"
          className="tl-canvas"
          style={{ position: 'absolute', left: 0, top: 0, display: 'block', width: props.initialSize !== undefined ? '100%' : undefined, height: `${LANE_HEIGHT_PX}px`, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>
      <div className="tl-toolbar">
        <button
          type="button"
          data-testid="timeline-snap-toggle"
          aria-pressed={snapState}
          onClick={() => {
            const next = !snapState
            bundle.snapRef.current = next
            setSnapState(next)
          }}
        >
          Snap
        </button>
      </div>
      <div className="tl-inspector">
        <TimecodeInput
          label="Start"
          testId="timeline-input-start"
          value={target?.start ?? 0}
          disabled={target === null}
          onCommit={(t) => {
            if (target !== null) app.dispatch('block-retime', { blockId: target.id, start: t })
          }}
        />
        <TimecodeInput
          label="End"
          testId="timeline-input-end"
          value={target?.end ?? 0}
          disabled={target === null}
          onCommit={(t) => {
            if (target !== null) app.dispatch('block-retime', { blockId: target.id, end: t })
          }}
        />
      </div>
      <div data-testid="timeline-live" aria-live="polite">
        {announce}
      </div>
    </div>
  )
}
