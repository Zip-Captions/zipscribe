// Stage controller (slice C): the composition-root seam between the intake /
// e2e bridge and the preview stage. Holds the media SOURCE URL (blob: for
// production drops, the preview-served /fixtures/… URL for the ziptest
// bridge — SECURITY-03: a URL, never user content) plus the element-readiness
// and coded-notice state the stage renders (FR-102.3). Deliberately NOT the
// frozen editor slice: the playhead/loop truth stays with the SyncArbitrator,
// the undoable project with the command system — this is view plumbing.
// The element attach is forwarded to the deferred MediaClock (its
// `currentTime` home stays under services/playback/** — CC-102.5).

export type StageNoticeCode = 'PREVIEW_UNSUPPORTED' | 'PLAYBACK_STALL'

export interface StageController {
  /** Set/clear the stage media source (resets readiness + notice). */
  setMediaSource(url: string | null): void
  getMediaSource(): string | null
  /** The stage layer mounts `<video data-testid=stage-video>` exactly when a source is set. */
  subscribe(listener: () => void): () => void
  /** Stage-video lifecycle reports (numbers/codes only — never element content). */
  markReady(): void
  markError(code: StageNoticeCode): void
  getNotice(): StageNoticeCode | null
  isVideoReady(): boolean
  /** Bind the stage element to the deferred element clock (null on unmount). */
  attachElement(element: HTMLMediaElement | null): void
}

export function createStageController(deps: { onAttachElement(element: HTMLMediaElement | null): void }): StageController {
  let mediaSource: string | null = null
  let videoReady = false
  let notice: StageNoticeCode | null = null
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  return {
    setMediaSource(url: string | null): void {
      if (url === mediaSource) return
      mediaSource = url
      videoReady = false
      notice = null
      notify()
    },
    getMediaSource: () => mediaSource,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    markReady(): void {
      if (videoReady && notice === null) return
      videoReady = true
      notice = null
      notify()
    },
    markError(code: StageNoticeCode): void {
      if (notice === code && !videoReady) return
      videoReady = false
      notice = code
      notify()
    },
    getNotice: () => notice,
    isVideoReady: () => videoReady,
    attachElement(element: HTMLMediaElement | null): void {
      deps.onAttachElement(element)
    },
  }
}
