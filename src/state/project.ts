// Minimal shell-side project view — the canonical project slice is unit-102's
// (it must keep these members). Shapes are the unit-101 frozen contract
// (tests/unit/workbench/unit101-api-contract.d.ts § @state/project).

import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'
import type { CaptionBlock, CaptionStyle, MediaAsset, Project } from '../engine/model'
import type { CaptionImportResult } from './services/intake'
import { newProjectId } from './ids'

export type { CaptionBlock }

interface ProjectState {
  project: Project | null
}

/** Minimal shell-side view (unit-102 owns the full slice; it must keep these members). */
export interface ProjectStore {
  getState(): { project: Project | null }
  subscribe(listener: () => void): () => void
  /**
   * Creates the project from a probed asset; when a caption import came in the
   * same drop, the source track is the IMPORTED blocks (captionOrigin
   * 'imported', transcription 'none') — US-2.0.2 media+captions together.
   */
  createProject(asset: MediaAsset, captionImport?: CaptionImportResult): void
  /** True once ≥ 1 block exists (Export enabled state, FR-2.0.2 — display only in 101). */
  hasBlocks(): boolean
  setProjectName(name: string): void
}

// Neutral broadcast defaults; Intent 3 owns the styling surface (FR-2.0.3
// Style tab placeholder). Colors mirror the design token palette.
const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: 'Inter',
  fontWeight: 400,
  fontSizePct: 8,
  textTransform: 'none',
  color: '#e8eaed',
  highlightColor: '#4c8dff',
  outlineColor: '#0d0f12',
  outlineWidth: 2,
  backgroundOpacity: 0,
  position: 'bottom',
  marginVPct: 6,
  alignment: 'center',
  maxLinesPerBlock: 2,
  highlightMode: 'none',
  showSpeakerBar: false,
}

function defaultProjectName(assetName: string): string {
  const dot = assetName.lastIndexOf('.')
  return dot > 0 ? assetName.slice(0, dot) : assetName
}

export function createProjectStore(deps: { clock: { now(): number } }): ProjectStore {
  const store = createStore<ProjectState>()(immer(() => ({ project: null })))

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    createProject(asset: MediaAsset, captionImport?: CaptionImportResult): void {
      const blocks = captionImport ? [...captionImport.blocks] : []
      const project: Project = {
        id: newProjectId(),
        name: defaultProjectName(asset.name),
        schemaVersion: 1,
        asset,
        blocks,
        captionOrigin: blocks.length > 0 ? 'imported' : 'none',
        translations: [],
        speakers: [],
        speakerSource: 'none',
        language: null,
        modelId: null,
        style: structuredClone(DEFAULT_CAPTION_STYLE),
        outputAspect: 'source',
        transcription: 'none',
        updatedAt: deps.clock.now(),
      }
      store.setState((state) => {
        state.project = project
      })
    },
    hasBlocks(): boolean {
      const project = store.getState().project
      return project !== null && project.blocks.length >= 1
    },
    setProjectName(name: string): void {
      store.setState((state) => {
        if (state.project === null) return
        state.project.name = name
        state.project.updatedAt = deps.clock.now()
      })
    },
  }
}
