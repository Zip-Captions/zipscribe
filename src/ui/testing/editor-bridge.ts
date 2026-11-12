// Test-only editor bridge (unit-102 frozen contract § Window
// __zipEditorBridge). App.tsx imports this module ONLY when the URL query
// carries `ziptest=1` (lazy import → out of the initial bundle; sibling of
// unit-101's __zipWorkbenchBridge, which stays installed untouched). Every
// method dispatches into the SAME receivers the real UI flows use: the
// command system (`EditorApp.dispatch` — transport semantics NEVER write the
// element directly), the arbitrator (scrub sessions), the project slice
// (open/seed) and the stage controller (source + readiness). STRICT gate:
// nothing installs itself on import; without the query flag this module is
// never loaded. SECURITY-03: only protocol objects, synthetic blocks and
// diagnostic NUMBERS cross here; nothing logs content.

import { getAppContext } from '../../app/context'
import type { CaptionBlock, MediaAsset } from '../../engine/model'
import type { CommandId, CommandPayloads } from '../../state/commands'

interface EditorBridge {
  openProjectWithMedia(asset: MediaAsset, srcUrl: string, blocks?: readonly CaptionBlock[]): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): {
    playhead: number
    playing: boolean
    loop: [number, number] | null
    rate: number
    blockCount: number
    clockTime: number
    seekCount: number
    videoReady: boolean
  }
  scrubTo(time: number): void
  releaseScrub(): void
}

export function installEditorBridge(): void {
  const { editorApp, stage, mediaClock } = getAppContext()
  let scrubbing = false

  const bridge: EditorBridge = {
    openProjectWithMedia(asset: MediaAsset, srcUrl: string, blocks?: readonly CaptionBlock[]): void {
      editorApp.project.createProject(asset)
      if (blocks !== undefined && blocks.length > 0) {
        // The same `captions-import` path the intake uses; speaker ids the
        // synthetic blocks reference are registered alongside (the reducer
        // validates against `speakers` ∪ payload `speakers`).
        const speakerIds = [...new Set(blocks.map((block) => block.speakerId))]
        const speakers = speakerIds.map((id, index) => ({ id, label: `Speaker ${index + 1}`, color: '#4c8dff' }))
        const rejection = editorApp.dispatch('captions-import', { blocks, speakers, replace: true })
        if (rejection !== null) throw new Error(`bridge seed rejected: ${rejection.code}`)
      }
      scrubbing = false
      mediaClock.resetSeekCount()
      stage.setMediaSource(srcUrl)
    },
    command(id: string, payload?: unknown): { code: string } | null {
      // `captions-import` convenience (perf-seed chunking): speaker ids the
      // payload blocks reference but the payload never declares are
      // registered alongside — exactly what `openProjectWithMedia`'s seed
      // path does, keeping the strict production reducer (DANGLING_SPEAKER_REF
      // on unknown ids, frozen CC-102.3) untouched.
      let effective = payload as CommandPayloads[CommandId] | undefined
      if (id === 'captions-import') {
        const p = (payload ?? {}) as { blocks?: readonly CaptionBlock[]; speakers?: readonly { id: string }[]; replace?: boolean }
        const declared = new Set((p.speakers ?? []).map((speaker) => speaker.id))
        const missing = [...new Set((p.blocks ?? []).map((block) => block.speakerId))].filter((speakerId) => !declared.has(speakerId))
        if (missing.length > 0) {
          const extra = missing.map((speakerId, index) => ({ id: speakerId, label: `Speaker ${String(index + 1)}`, color: '#4c8dff' }))
          effective = { ...(p as object), speakers: [...(p.speakers ?? []), ...extra] } as CommandPayloads[CommandId]
        }
      }
      const rejection = editorApp.dispatch(id as CommandId, effective)
      return rejection === null ? null : { code: rejection.code }
    },
    getEditorState() {
      const editor = editorApp.editor.getState()
      const project = editorApp.project.getState().project
      return {
        playhead: editor.playhead,
        playing: editor.playing,
        loop: editor.loop,
        rate: editor.rate,
        blockCount: project?.blocks.length ?? 0,
        // Element truth through the sanctioned reader (CC-102.5 guard:
        // `.currentTime` outside services/playback/** is a contract break).
        clockTime: editorApp.arbitrator === null ? 0 : editorApp.arbitrator.clockTime(),
        seekCount: mediaClock.seekCount,
        videoReady: stage.isVideoReady(),
      }
    },
    scrubTo(time: number): void {
      const arbitrator = editorApp.arbitrator
      if (arbitrator === null) return
      if (!scrubbing) {
        scrubbing = true
        arbitrator.beginScrub()
      }
      arbitrator.scrubTo(time)
    },
    releaseScrub(): void {
      const arbitrator = editorApp.arbitrator
      if (arbitrator === null || !scrubbing) return
      scrubbing = false
      arbitrator.endScrub()
    },
  }
  ;(window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge = bridge
}
