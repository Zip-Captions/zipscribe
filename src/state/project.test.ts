// US-2.0.2 / FR-2.0.2 (L1, node): the minimal shell-side project view —
// media-alone vs media+captions (imported source track), hasBlocks (Export
// enablement) and the inline-edit name commit. Frozen L2 counterpart:
// tests/unit/workbench/workbench-shell.test.tsx / drop-zone.test.tsx.
import { describe, expect, test } from 'vitest'
import { createProjectStore } from './project'
import type { CaptionBlock, MediaAsset } from '../engine/model'
import type { CaptionImportResult } from './services/intake'

const CLOCK_NOW = 1_730_000_000_000
const clock = { now: () => CLOCK_NOW }

const ASSET: MediaAsset = {
  id: 'ASSET_test_video_1',
  name: 'speech-2min.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'avc1',
  duration: 121.44,
  width: 1280,
  height: 720,
  fps: 25,
  fingerprint: { name: 'speech-2min.mp4', size: 2_000_000, durationMs: 121_440, sampleHashes: ['h1', 'h2', 'h3'] },
}

const IMPORTED_BLOCKS: CaptionBlock[] = [
  {
    id: 'blk_import_1',
    start: 0.2,
    end: 2.4,
    text: 'hello world',
    words: [
      { text: 'hello', start: 0.2, end: 1.2, timing: 'estimated' },
      { text: 'world', start: 1.3, end: 2.4, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
  {
    id: 'blk_import_2',
    start: 2.5,
    end: 4.8,
    text: 'tail block',
    words: [
      { text: 'tail', start: 2.5, end: 3.4, timing: 'estimated' },
      { text: 'block', start: 3.5, end: 4.8, timing: 'estimated' },
    ],
    speakerId: 'SPK_1',
  },
]

const CANNED_IMPORT: CaptionImportResult = {
  report: {
    format: 'vtt',
    encoding: 'utf-8',
    cues: 42,
    blocks: 40,
    detectedLanguage: 'en',
    adjustments: [{ code: 'OVERLAP_CLAMPED', count: 3 }],
  },
  blocks: IMPORTED_BLOCKS,
}

describe('US-2.0.2: project store — minimal shell-side view', () => {
  test('US-2.0.2: media alone creates a project with no blocks and captionOrigin none', () => {
    const project = createProjectStore({ clock })
    expect(project.getState().project).toBeNull()
    expect(project.hasBlocks(), 'Export stays disabled without blocks (FR-2.0.2)').toBe(false)

    project.createProject(ASSET)
    const created = project.getState().project
    expect(created).not.toBeNull()
    expect(created?.asset).toEqual(ASSET)
    expect(created?.blocks).toEqual([])
    expect(created?.captionOrigin, 'media alone → nothing imported yet').toBe('none')
    expect(created?.transcription).toBe('none')
    expect(created?.updatedAt, 'injected clock keeps project creation deterministic').toBe(CLOCK_NOW)
    expect(project.hasBlocks()).toBe(false)
  })

  test('US-2.0.2: media + captions in one drop creates the imported source track', () => {
    const project = createProjectStore({ clock })
    project.createProject(ASSET, CANNED_IMPORT)
    const created = project.getState().project
    expect(created?.blocks.length, 'the source track is the IMPORTED blocks (unit-07 seam)').toBe(IMPORTED_BLOCKS.length)
    expect(created?.captionOrigin).toBe('imported')
    expect(created?.transcription, 'no transcription happened').toBe('none')
    expect(project.hasBlocks(), '≥ 1 block enables Export').toBe(true)
  })

  test('FR-2.0.2: setProjectName commits the inline edit (display name from the asset otherwise)', () => {
    const project = createProjectStore({ clock })
    project.setProjectName('ignored without a project')
    expect(project.getState().project, 'renaming without a project is a no-op, never a throw').toBeNull()

    project.createProject(ASSET)
    expect(project.getState().project?.name, 'default display name strips the extension').toBe('speech-2min')
    project.setProjectName('Interview — Q1')
    expect(project.getState().project?.name).toBe('Interview — Q1')
    expect(project.getState().project?.updatedAt).toBe(CLOCK_NOW)
  })
})
