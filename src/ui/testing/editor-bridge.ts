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
import type { CaptionBlock, MediaAsset, TranslationEntry } from '../../engine/model'
import { applyEntries } from '../../engine/translate/track'
import type { CommandId, CommandPayloads } from '../../state/commands'

interface EditorBridge {
  openProjectWithMedia(asset: MediaAsset, srcUrl: string, blocks?: readonly CaptionBlock[]): void
  /** unit-202 (CC-202.2 e2e): register burn-in input bytes for the project. */
  setExportMedia(bytes: ArrayBuffer, type: string): Promise<void>
  /** unit-202 (CC-202.5 e2e): deterministic project name for golden filenames. */
  setProjectName(name: string): void
  /** unit-202 (CC-202.5 e2e): pin the source language (the probe normally owns it). */
  setProjectLanguage(language: string): void
  /** unit-202 (CC-202.5 e2e): seed a translation track (same engine path the
   *  FR-301.5 apply service uses — applyWithoutHistory, never undo steps). */
  seedTranslation(language: string, entries: Record<string, TranslationEntry>): void
  /** unit-202 (CC-202.5 e2e): install an exact blocks+speakers snapshot for
   *  the serializer golden compare. The committed sidecar fixture carries
   *  reducer-illegal word/text escape-matrix data BY DESIGN (it tests the
   *  serializers, not the reducer), so it rides the same applyWithoutHistory
   *  path the translation seed uses; reducer legality is L1's job. */
  seedBlocks(blocks: readonly unknown[], speakers: readonly unknown[]): void
  /** unit-302 (CC-302.2/.3 e2e): drive the transcript view switcher through the
   *  SAME editor actions the ⌘⇧L handler uses (no synthetic DOM writes). */
  setView(mode: 'source' | 'translation' | 'split', language?: string): void
  /** unit-302 (CC-302.1 e2e): how many entries a translation track holds (the
   *  virtualized transcript only renders visible rows, so row-fill is asserted
   *  through state). */
  getTranslationEntryCount(language: string): number
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
    viewMode: 'source' | 'translation' | 'split'
    activeLanguage: string | null
  }
  scrubTo(time: number): void
  releaseScrub(): void
}

export function installEditorBridge(): void {
  const appContext = getAppContext()
  const { editorApp, stage, mediaClock } = appContext
  let scrubbing = false
  // A synchronous seedBlocks call in the same open sequence (the unit-202
  // export harness) owns the block state — a pending async ground-truth
  // seed must never land after it (unit-204).
  let explicitBlockSeed = false

  async function seedFromGroundTruth(srcUrl: string): Promise<void> {
    const base = (srcUrl.split('/').pop() ?? '').replace(/\.[^.]+$/u, '')
    const dispatchSeed = (blocks: CaptionBlock[]): void => {
      if (explicitBlockSeed) return
      // Validated path only — a rejection leaves the project block-less (the
      // honest absence), never a hand-forced draft.
      editorApp.dispatch('captions-import', { blocks, speakers: [{ id: 'spk_source', label: 'Speaker 1', color: '#4c8dff' }], replace: true })
    }
    if (base !== '' && srcUrl.startsWith('/fixtures/')) {
      try {
        const response = await fetch(`/fixtures/harness/ground-truth/${base}.json`)
        if (response.ok) {
          const ground = (await response.json()) as { transcript?: string; words?: { text: string; start: number; end: number }[] }
          const words = ground.words ?? []
          const first = words[0]
          const last = words[words.length - 1]
          if (typeof ground.transcript === 'string' && first !== undefined && last !== undefined) {
            dispatchSeed([
              {
                id: 'blk_bridge_ground_truth',
                start: first.start,
                end: last.end,
                text: ground.transcript,
                words: words.map((word) => ({ text: word.text, start: word.start, end: word.end, timing: 'asr' as const })),
                speakerId: 'spk_source',
              },
            ])
            return
          }
        }
      } catch {
        // origin without the fixture route (dual-root preview stand-ins) —
        // the synthetic seed below keeps the bridge contract total.
      }
    }
    // Deterministic synthetic seed (bridge furniture of the same class as
    // the scripted ASR events the 108 doctrine uses): one reducer-legal
    // block so `blockCount > 0` and the dirty-tracking mutation follow a
    // REAL validated dispatch. No user-derived text (SECURITY-03).
    const project = editorApp.project.getState().project
    if (project === null) return
    const end = project.asset.duration > 5 ? 3.5 : Math.max(1.6, project.asset.duration - 0.5)
    if (end <= 1.5) return
    const texts = ['offline', 'seeded', 'caption']
    const step = (end - 0.5) / texts.length
    dispatchSeed([
      {
        id: 'blk_bridge_seed',
        start: 0.5,
        end,
        text: texts.join(' '),
        words: texts.map((text, index) => ({ text, start: 0.5 + index * step, end: 0.5 + (index + 1) * step - 0.02, timing: 'asr' as const })),
        speakerId: 'spk_source',
      },
    ])
  }

  const bridge: EditorBridge = {
    openProjectWithMedia(asset: MediaAsset, srcUrl: string, blocks?: readonly CaptionBlock[]): void {
      editorApp.project.createProject(asset)
      explicitBlockSeed = false
      if (blocks !== undefined && blocks.length > 0) {
        // The same `captions-import` path the intake uses; speaker ids the
        // synthetic blocks reference are registered alongside (the reducer
        // validates against `speakers` ∪ payload `speakers`).
        const speakerIds = [...new Set(blocks.map((block) => block.speakerId))]
        const speakers = speakerIds.map((id, index) => ({ id, label: `Speaker ${index + 1}`, color: '#4c8dff' }))
        const rejection = editorApp.dispatch('captions-import', { blocks, speakers, replace: true })
        if (rejection !== null) throw new Error(`bridge seed rejected: ${rejection.code}`)
      } else if (blocks === undefined && srcUrl.startsWith('/fixtures/')) {
        // unit-204 (frozen pwa harness): a media-url open seeds the project
        // from the fixture's committed eval ground truth (the honest caption
        // bytes that media produces), through the SAME validated
        // captions-import path — so blockCount>0 and the autosave dirty flag
        // follow a real reducer mutation. No adjacent JSON (or a rejected
        // payload) simply leaves the project block-less, as before.
        void seedFromGroundTruth(srcUrl)
      }
      scrubbing = false
      mediaClock.resetSeekCount()
      stage.setMediaSource(srcUrl)
    },
    async setExportMedia(bytes: ArrayBuffer, type: string): Promise<void> {
      const id = editorApp.project.getState().project?.id
      if (id === undefined) throw new Error('setExportMedia: no project')
      await appContext.setSourceBlob(id, new Blob([bytes], { type }))
    },
    setProjectName(name: string): void {
      editorApp.project.setProjectName(name)
    },
    setProjectLanguage(language: string): void {
      editorApp.applyWithoutHistory((draft) => {
        if (draft.project !== null) draft.project.language = language
      })
    },
    seedBlocks(blocks: readonly unknown[], speakers: readonly unknown[]): void {
      explicitBlockSeed = true
      editorApp.applyWithoutHistory((draft) => {
        if (draft.project === null) return
        draft.project.blocks = blocks as never
        draft.project.speakers = speakers as never
      })
    },
    setView(mode: 'source' | 'translation' | 'split', language?: string): void {
      editorApp.editor.setViewMode(mode)
      if (language !== undefined) editorApp.editor.setActiveLanguage(language)
    },
    getTranslationEntryCount(language: string): number {
      const track = editorApp.project.getState().project?.translations.find((t) => t.language === language)
      return track === undefined ? 0 : Object.keys(track.entries).length
    },
    seedTranslation(language: string, entries: Record<string, TranslationEntry>): void {
      const updates = Object.entries(entries).map(([blockId, entry]) => ({ blockId, entry }))
      editorApp.applyWithoutHistory((draft) => {
        if (draft.project !== null) applyEntries(draft.project, language, updates)
      })
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
        viewMode: editor.viewMode,
        activeLanguage: editor.activeLanguage,
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
