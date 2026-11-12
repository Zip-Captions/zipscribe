// Test-only transcript bridge (unit-104 frozen contract § Window
// __zipTranscriptBridge, tests/unit/transcript/unit104-api-contract.d.ts).
// App.tsx imports this module ONLY when the URL query carries `ziptest=1`
// (lazy import → out of the initial bundle; sibling of the unit-101/102/103
// bridges, which stay installed untouched). STRICT gate: nothing installs
// itself on import; without the query flag this module is never loaded. The
// bridge is DIAGNOSTICS ONLY — keyboard/mouse/scroll go through REAL trusted
// input, never through this bridge. SECURITY-03: everything crossing here is
// numbers, protocol enums, generated synthetic block ids and booleans — never
// user text; nothing logs content. `issueCount` is DERIVED on demand through
// the engine QC pure checker (never stored, domain glossary "QC issue").

import { getAppContext } from '../../app/context'
import { getTranscriptPanel } from '../transcript/bridge-seam'
import { checkCaptions } from '../../engine/captions/qc'

interface TranscriptBridgeState {
  renderedRows: number
  totalRows: number
  scrollTop: number
  scrollHeight: number
  viewportHeightPx: number
  searchOpen: boolean
  matchCount: number
  currentMatchIndex: number
  activeBlockId: string | null
  editingBlockId: string | null
  skeletonRows: number
  issueCount: number
  focusedRowBlockId: string | null
  hiddenSpeakerIds: string[]
  runningJobKind: 'transcribe' | 'align' | null
  runningJobId: string | null
}

interface TranscriptBridge {
  getTranscriptState(): TranscriptBridgeState
  getHistory(): { undoCount: number; redoCount: number }
  getWordTimings(blockId: string): Array<{ timing: 'asr' | 'aligned' | 'estimated' | 'manual'; start: number; end: number }> | null
  getBlockTimes(blockId: string): { start: number; end: number } | null
}

export function installTranscriptBridge(): void {
  const { editorApp, jobs } = getAppContext()

  const bridge: TranscriptBridge = {
    getTranscriptState(): TranscriptBridgeState {
      const panel = getTranscriptPanel()
      const read = panel?.read()
      const project = editorApp.project.getState().project
      const running = jobs.getState().running
      return {
        renderedRows: read?.renderedRows ?? 0,
        totalRows: project?.blocks.length ?? 0,
        scrollTop: read?.scrollTop ?? 0,
        scrollHeight: read?.scrollHeight ?? 0,
        viewportHeightPx: read?.viewportHeightPx ?? 0,
        searchOpen: read?.searchOpen ?? editorApp.editor.getState().searchOpen,
        matchCount: read?.matchCount ?? 0,
        currentMatchIndex: read?.currentMatchIndex ?? -1,
        activeBlockId: read?.activeBlockId ?? null,
        editingBlockId: read?.editingBlockId ?? null,
        skeletonRows: read?.skeletonRows ?? 0,
        // Derived, never stored: the engine QC rule set over the CURRENT project.
        issueCount: project === null ? 0 : checkCaptions(project).length,
        focusedRowBlockId: read?.focusedRowBlockId ?? null,
        hiddenSpeakerIds: read?.hiddenSpeakerIds ?? [],
        runningJobKind: running?.kind ?? null,
        runningJobId: running?.jobId ?? null,
      }
    },
    getHistory(): { undoCount: number; redoCount: number } {
      // SECURITY-03: counters only. The frozen EditorHistoryApi types
      // redoCount() void (zundo 2.3.0 jumpless surface — CONTRACT.md §
      // history); the bridge reports the observable undo depth and a
      // defensive 0 redo (the number contract field stays wired for slice
      // D's one-undo-step assertions).
      return { undoCount: editorApp.history.undoCount(), redoCount: 0 }
    },
    getWordTimings(blockId: string): Array<{ timing: 'asr' | 'aligned' | 'estimated' | 'manual'; start: number; end: number }> | null {
      const block = editorApp.project.getState().project?.blocks.find((candidate) => candidate.id === blockId)
      if (block === undefined) return null
      return block.words.map((word) => ({ timing: word.timing ?? 'asr', start: word.start, end: word.end }))
    },
    getBlockTimes(blockId: string): { start: number; end: number } | null {
      const block = editorApp.project.getState().project?.blocks.find((candidate) => candidate.id === blockId)
      if (block === undefined) return null
      return { start: block.start, end: block.end }
    },
  }
  ;(window as unknown as { __zipTranscriptBridge?: TranscriptBridge }).__zipTranscriptBridge = bridge
}
