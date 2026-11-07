// Preview stage media layer (FR-102.3/FR-102.6, design.md § Layout preview
// stage): mounts the stage element the SyncArbitrator's element clock owns
// (`stage-video`, `object-fit: contain`, muted+playsInline for headless
// autoplay), the transparent canvas overlay layer (101's reserved
// `preview-canvas-layer` host, sized by `letterboxGeometry` — object-fit
// parity; audio projects fit the 16:9 stage hosting unit-107's visualizer
// slot beneath), the FR-102.3 coded stage notice, and the transport bar.
//
// Rules pinned here: components NEVER read the element's `currentTime`
// (CC-102.5 — the clock layer is the only reader); the overlay renders on the
// arbitrator's SINGLE rAF subscription (no second loop); pointer-events pass
// through the overlay; all additions are absolutely positioned (the 101 CLS
// budget stays owned by the streaming rows). SECURITY-03: the notice renders
// CODES only.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { MediaAsset } from '../../engine/model'
import type { EditorApp } from '../../state/history'
import type { StageController, StageNoticeCode } from '../../app/stage'
import { createOverlayLayer, NO_OP_OVERLAY_RENDERER } from '../canvas/overlay'
import type { OverlayRenderer } from '../canvas/overlay'
import { TransportBar } from './TransportBar'
import { cycleRate } from '../commands/useTransportCommands'
import './stage.css'

export interface StageMediaProps {
  app: EditorApp
  stage: StageController
  asset: MediaAsset
  /** The reserved canvas host (unit-101's `[data-testid=preview-canvas-layer]`). */
  canvasHostRef: { current: HTMLDivElement | null }
  /** FR-102.6 pluggable renderer (default no-op; Intent 3 supplies the caption renderer). */
  overlayRenderer?: OverlayRenderer
}

const NOTICE_COPY: Record<StageNoticeCode, string> = {
  PREVIEW_UNSUPPORTED: 'This media cannot be previewed — editing and transcription still work.',
  PLAYBACK_STALL: 'Preview playback stalled — transcription continues in the background.',
}

function useStageValue<T>(stage: StageController, select: () => T): T {
  const [value, setValue] = useState<T>(select)
  useEffect(() => {
    const sync = (): void => {
      const next = select()
      setValue((current) => (Object.is(current, next) ? current : next))
    }
    sync()
    return stage.subscribe(sync)
  }, [stage])
  return value
}

function mediaTypeOf(asset: MediaAsset): string {
  return `${asset.kind}/${asset.container}`
}

export function StageMedia({ app, stage, asset, canvasHostRef, overlayRenderer }: StageMediaProps): ReactNode {
  const mediaUrl = useStageValue(stage, () => stage.getMediaSource())
  const notice = useStageValue(stage, () => stage.getNotice())
  const elementRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const isAudio = asset.kind === 'audio' || asset.width <= 0 || asset.height <= 0

  // Bind the stage element to the deferred element clock + probe playability
  // (FR-102.3: `canPlayType` empty → coded notice; editing/transcription stay
  // functional while shown). Re-runs when the SOURCE changes too: the element
  // remounts with the new src.
  useEffect(() => {
    if (mediaUrl === null) return
    const element = elementRef.current
    if (element === null) return
    stage.attachElement(element)
    if (element.canPlayType(mediaTypeOf(asset)) === '') stage.markError('PREVIEW_UNSUPPORTED')
    return () => {
      stage.attachElement(null)
    }
  }, [mediaUrl, stage, asset])

  // Overlay layer: ONE subscription (the arbitrator's single rAF loop) feeds
  // the pluggable renderer; geometry keeps object-fit: contain parity.
  useEffect(() => {
    if (mediaUrl === null) return
    const host = canvasHostRef.current
    if (host === null) return
    const layer = createOverlayLayer({
      host,
      getProject: () => app.project.getState().project,
      subscribe: (cb) => (app.arbitrator === null ? () => undefined : app.arbitrator.subscribe(cb)),
      renderer: overlayRenderer ?? NO_OP_OVERLAY_RENDERER,
    })
    const content = isAudio ? null : { width: asset.width, height: asset.height }
    const fit = (): void => {
      const box = boxRef.current?.getBoundingClientRect()
      if (box === undefined) return
      layer.fitTo({ width: box.width, height: box.height }, content)
    }
    fit()
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && boxRef.current !== null) {
      observer = new ResizeObserver(fit)
      observer.observe(boxRef.current)
    }
    layer.start()
    return () => {
      observer?.disconnect()
      layer.dispose()
    }
    // `mediaUrl` re-mounts the layer with the stage element (the early return
    // below keeps this effect inert while no source is set).
  }, [mediaUrl, app, asset, canvasHostRef, overlayRenderer, isAudio])

  if (mediaUrl === null) return null

  const sharedProps = {
    ref: (element: HTMLMediaElement | null): void => {
      elementRef.current = element
    },
    src: mediaUrl,
    muted: true,
    playsInline: true,
    preload: 'auto' as const,
    'aria-hidden': true,
    onCanPlay: () => {
      stage.markReady()
    },
    onError: () => {
      stage.markError('PREVIEW_UNSUPPORTED')
    },
    onPlaying: () => {
      stage.markReady()
    },
  }

  return (
    <div ref={boxRef} className="ws-stage-media" data-testid="stage-media">
      {isAudio ? (
        <div data-testid="stage-visualizer-slot" className="ws-visualizer-slot" aria-hidden="true">
          <audio data-testid="stage-video" {...sharedProps} />
        </div>
      ) : (
        <video data-testid="stage-video" {...sharedProps} className="ws-stage-video" />
      )}
      {notice !== null && (
        <div data-testid="stage-notice" role="status" className="ws-stage-notice">
          <span className="ws-stage-notice-code">{notice}</span> {NOTICE_COPY[notice]}
        </div>
      )}
      <div className="ws-transport-wrap">
        <TransportBar editor={app.editor} duration={asset.duration} onCycleRate={() => cycleRate(app)} />
      </div>
    </div>
  )
}
