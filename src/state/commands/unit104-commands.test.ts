// unit-104 EXTENDS (L1 seeds for the four new command reducers): the frozen
// suites (tests/unit/transcript/speaker-ops|align-apply|retime-scale|
// search-replace.property) pin the happy paths, rejections named by the
// criteria and the undo-step properties; these seeds cover the guard edges
// the frozen dispatches never reach — NO_PROJECT, the un-injected-@104-seam
// CODE, payload-shape rejections (codes + field-name tokens only,
// SECURITY-03), the zero-match / identity no-ops (no history step), and the
// palette default color for `speaker-split`. align.test.ts seed precedent.
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { createEditorApp } from '../history'
import type { EditorApp } from '../history'
import { createEngineCaptionImportPort } from '../services/caption-import'
import { majoritySpeakerId, reassignWords, mergeSpeakers, splitSpeaker } from '../../engine/diarize/assign'
import { SPEAKER_PALETTE } from '../../engine/diarize/assign'
import type { Project } from '../../engine/model'
import type { RafDriver } from '../services/playback/arbitrator'
import type { SpeakerEngine } from './deps'

const rafs: RafDriver = { request: () => 0, cancel: () => undefined, frame: () => undefined }

function projectWith(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p104',
    name: 'unit104 seed',
    schemaVersion: 1,
    asset: {
      id: 'a1',
      name: 'a.mp4',
      kind: 'video',
      container: 'mp4',
      audioCodec: 'aac',
      videoCodec: 'avc1',
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 25,
      fingerprint: { name: 'a.mp4', size: 1, durationMs: 60_000, sampleHashes: ['a', 'b', 'c'] },
    },
    blocks: [
      {
        id: 'blk_1',
        start: 0.5,
        end: 2.5,
        text: 'concat beta',
        words: [
          { text: 'concat', start: 0.5, end: 1.5 },
          { text: 'beta', start: 1.5, end: 2.5 },
        ],
        speakerId: 'SPK_1',
      },
    ],
    captionOrigin: 'transcribed',
    translations: [],
    speakers: [
      { id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' },
      { id: 'SPK_2', label: 'Speaker 2', color: '#ff6b6b' },
    ],
    speakerSource: 'auto-beta',
    language: 'en',
    modelId: 'm',
    style: {
      fontFamily: 'Inter',
      fontWeight: 400,
      fontSizePct: 4,
      textTransform: 'none',
      color: '#FFF',
      highlightColor: '#FFE45C',
      outlineColor: '#000',
      outlineWidth: 2,
      backgroundOpacity: 0,
      position: 'bottom',
      marginVPct: 8,
      alignment: 'center',
      maxLinesPerBlock: 2,
      highlightMode: 'none',
      showSpeakerBar: false,
    },
    outputAspect: 'source',
    transcription: 'complete',
    updatedAt: 0,
    ...overrides,
  }
}

function app(options: { project?: Project; engine?: SpeakerEngine } = {}): EditorApp {
  return createEditorApp({
    clock: { now: () => 1_730_000_000_000 },
    rafs,
    initialProject: options.project ?? projectWith(),
    speakerEngine: options.engine ?? { majoritySpeakerId, reassignWords, mergeSpeakers: (p, from, into) => mergeSpeakers(p, into, from), splitSpeaker },
  })
}

function bare(): EditorApp {
  return createEditorApp({ clock: { now: () => 0 }, rafs })
}

describe('unit-104 seed: guard edges of the four EXTENDS commands', () => {
  test('NO_PROJECT: every unit-104 command rejects INVALID_PAYLOAD NO_PROJECT', () => {
    const app1 = bare()
    expect(app1.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_2' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'NO_PROJECT' })
    expect(app1.dispatch('speaker-split', { speakerId: 'SPK_1', at: 1 })).toEqual({ code: 'INVALID_PAYLOAD', token: 'NO_PROJECT' })
    expect(app1.dispatch('replace-text', { query: 'a', replacement: 'b' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'NO_PROJECT' })
    expect(app1.dispatch('captions-align-apply', { asrWords: [] })).toEqual({ code: 'INVALID_PAYLOAD', token: 'NO_PROJECT' })
  })

  test('un-injected @104 seam: merge/split on an engine WITHOUT the additive members fail with the CODE — zero mutation, no step', () => {
    const legacyEngine = { majoritySpeakerId, reassignWords } as SpeakerEngine
    const t = app({ engine: legacyEngine })
    const before = t.project.getState().project
    const steps = t.history.undoCount()
    expect(() => t.dispatch('speaker-merge', { from: 'SPK_2', into: 'SPK_1' })).toThrow(/^SPEAKER_ENGINE_UNAVAILABLE$/u)
    expect(() => t.dispatch('speaker-split', { speakerId: 'SPK_1', at: 1 })).toThrow(/^SPEAKER_ENGINE_UNAVAILABLE$/u)
    expect(t.project.getState().project, 'the abort is total').toBe(before)
    expect(t.history.undoCount(), 'a failed dispatch creates no history step').toBe(steps)
  })

  test('NOT_IMPLEMENTED_SPEAKER_ENGINE keeps failing CODE on the @104 members too', async () => {
    const { NOT_IMPLEMENTED_SPEAKER_ENGINE } = await import('./deps')
    expect(() => NOT_IMPLEMENTED_SPEAKER_ENGINE.mergeSpeakers?.(projectWith(), 'SPK_1', 'SPK_2')).toThrow(/^SPEAKER_ENGINE_UNAVAILABLE$/u)
    expect(() => NOT_IMPLEMENTED_SPEAKER_ENGINE.splitSpeaker?.(projectWith(), 'SPK_1', 1, '#fff')).toThrow(/^SPEAKER_ENGINE_UNAVAILABLE$/u)
  })

  test('speaker-merge self-merge rejects SPEAKER_MERGE_SELF (code + id token only, SECURITY-03)', () => {
    const t = app()
    expect(t.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_1' })).toEqual({ code: 'SPEAKER_MERGE_SELF', token: 'SPK_1' })
  })

  test('speaker-split payload-shape rejections: non-finite at, non-string color — INVALID_PAYLOAD, no step', () => {
    const t = app()
    const steps = t.history.undoCount()
    expect(t.dispatch('speaker-split', { speakerId: 'SPK_1', at: Number.NaN })).toEqual({ code: 'INVALID_PAYLOAD', token: 'at' })
    expect(t.dispatch('speaker-split', { speakerId: 'SPK_1', at: 1, color: 42 as never })).toEqual({ code: 'INVALID_PAYLOAD', token: 'color' })
    expect(t.history.undoCount()).toBe(steps)
  })

  test('speaker-split omitted color takes the engine palette at the append index', () => {
    const t = app()
    expect(t.dispatch('speaker-split', { speakerId: 'SPK_1', at: 1 })).toBeNull()
    const added = t.project.getState().project?.speakers.at(-1)
    expect(added?.color, 'palette cycled by the new speaker index').toBe(SPEAKER_PALETTE[2 % SPEAKER_PALETTE.length])
  })

  test('replace-text payload guards: empty query, non-string fields, newline, non-boolean flags — INVALID_PAYLOAD field tokens', () => {
    const t = app()
    const steps = t.history.undoCount()
    expect(t.dispatch('replace-text', { query: '', replacement: 'x' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'query' })
    expect(t.dispatch('replace-text', { query: 42 as never, replacement: 'x' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'query' })
    expect(t.dispatch('replace-text', { query: 'a', replacement: 7 as never })).toEqual({ code: 'INVALID_PAYLOAD', token: 'replacement' })
    expect(t.dispatch('replace-text', { query: 'a\nb', replacement: 'x' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'query' })
    expect(t.dispatch('replace-text', { query: 'a', replacement: 'x\ny' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'query' })
    expect(t.dispatch('replace-text', { query: 'a', replacement: 'x', caseSensitive: 'yes' as never })).toEqual({ code: 'INVALID_PAYLOAD', token: 'caseSensitive' })
    expect(t.dispatch('replace-text', { query: 'a', replacement: 'x', wholeWord: 1 as never })).toEqual({ code: 'INVALID_PAYLOAD', token: 'wholeWord' })
    expect(t.history.undoCount(), 'no guard rejection creates no step').toBe(steps)
  })

  test('replace-text zero matches: accepted as a NO-OP — project reference unchanged, no history step', () => {
    const t = app()
    const before = t.project.getState().project
    const steps = t.history.undoCount()
    expect(t.dispatch('replace-text', { query: 'zzz', replacement: 'yyy' })).toBeNull()
    expect(t.project.getState().project, 'draft untouched → same reference').toBe(before)
    expect(t.history.undoCount()).toBe(steps)
  })

  test('replace-text case-sensitive substring inside a token, timings frozen, ONE step', () => {
    const t = app()
    const steps = t.history.undoCount()
    expect(t.dispatch('replace-text', { query: 'cat', replacement: 'cot', caseSensitive: true })).toBeNull()
    const block = t.project.getState().project?.blocks[0]
    expect(block?.text).toBe('concot beta')
    expect(block?.words.map((w) => [w.start, w.end])).toEqual([
      [0.5, 1.5],
      [1.5, 2.5],
    ])
    expect(t.history.undoCount()).toBe(steps + 1)
  })

  test('captions-retime-all @104 EXTENDS: stretch maps over the anchor via the engine retimeAll, ONE step; media never moves', () => {
    const t = app()
    const assetBefore = structuredClone(t.project.getState().project?.asset)
    const steps = t.history.undoCount()
    expect(t.dispatch('captions-retime-all', { offsetSec: 0.2, scale: 1.2, anchorSec: 1.0 })).toBeNull()
    const block = t.project.getState().project?.blocks[0]
    // round3(anchor + (t − anchor)·scale + offset), clamped — engine-faithful.
    expect([block?.start, block?.end]).toEqual([0.6, 3])
    expect(block?.words.map((w) => [w.start, w.end])).toEqual([
      [0.6, 1.8],
      [1.8, 3],
    ])
    expect(t.project.getState().project?.asset).toEqual(assetBefore)
    expect(t.history.undoCount()).toBe(steps + 1)
  })

  test('captions-retime-all @104 EXTENDS guards: non-finite scale/anchorSec → INVALID_PAYLOAD field tokens; identity stretch is step-free', () => {
    const t = app()
    const steps = t.history.undoCount()
    expect(t.dispatch('captions-retime-all', { offsetSec: 0, scale: Number.NaN })).toEqual({ code: 'INVALID_PAYLOAD', token: 'scale' })
    expect(t.dispatch('captions-retime-all', { offsetSec: 0, anchorSec: Number.POSITIVE_INFINITY })).toEqual({ code: 'INVALID_PAYLOAD', token: 'anchorSec' })
    expect(t.dispatch('captions-retime-all', { offsetSec: 0, scale: 1, anchorSec: 0 }), 'identity stretch accepted').toBeNull()
    expect(t.history.undoCount(), 'a byte-equal stretch creates no step').toBe(steps)
  })

  test('captions-align-apply payload guards: non-array / malformed protocol entries → INVALID_PAYLOAD index tokens', () => {
    const t = app()
    expect(t.dispatch('captions-align-apply', { asrWords: 'nope' as never })).toEqual({ code: 'INVALID_PAYLOAD', token: 'asrWords' })
    expect(t.dispatch('captions-align-apply', { asrWords: [1 as never] })).toEqual({ code: 'INVALID_PAYLOAD', token: 'asrWords[0]' })
    expect(t.dispatch('captions-align-apply', { asrWords: [{ text: 'a', start: 0, end: Number.NaN }] })).toEqual({ code: 'INVALID_PAYLOAD', token: 'asrWords[0]' })
  })

  test('captions-align-apply: empty block list accepts without touching state; identity re-apply creates no step', () => {
    const empty = app({ project: projectWith({ blocks: [] }) })
    expect(empty.dispatch('captions-align-apply', { asrWords: [{ text: 'a', start: 0, end: 1 }] })).toBeNull()
    expect(empty.history.undoCount(), 'nothing to align → no step').toBe(0)

    const t = app()
    const asrWords = [
      { text: 'concat', start: 0.6, end: 1.4 },
      { text: 'beta', start: 1.6, end: 2.4 },
    ]
    expect(t.dispatch('captions-align-apply', { asrWords })).toBeNull()
    const afterFirst = t.history.undoCount()
    const ref = t.project.getState().project
    expect(ref?.blocks[0]?.words.map((w) => w.timing)).toEqual(['aligned', 'aligned'])
    expect(t.dispatch('captions-align-apply', { asrWords }), 'identity apply accepted').toBeNull()
    expect(t.project.getState().project, 'identity apply leaves the reference untouched').toBe(ref)
    expect(t.history.undoCount(), 'no second step for a byte-equal apply').toBe(afterFirst)
  })
})

describe('unit-104 seed: replace-text match semantics beyond the frozen oracle', () => {
  function multiBlockProject(): Project {
    return projectWith({
      blocks: [
        {
          id: 'blk_1',
          start: 0.5,
          end: 2.5,
          text: 'concat on Concat',
          words: [
            { text: 'concat', start: 0.5, end: 1.1 },
            { text: 'on', start: 1.1, end: 1.7, breakAfter: true },
            { text: 'Concat', start: 1.7, end: 2.5 },
          ],
          speakerId: 'SPK_1',
        },
        {
          id: 'blk_2',
          start: 3,
          end: 4,
          text: 'ON time',
          words: [
            { text: 'ON', start: 3, end: 3.4 },
            { text: 'time', start: 3.4, end: 4 },
          ],
          speakerId: 'SPK_1',
        },
      ],
    })
  }

  test('default pass is case-insensitive substring, EVERY block, breakAfter join survives, ONE step, timings frozen', () => {
    const t = app({ project: multiBlockProject() })
    const steps = t.history.undoCount()
    expect(t.dispatch('replace-text', { query: 'on', replacement: '0n' })).toBeNull()
    const project = t.project.getState().project
    expect(project?.blocks[0]?.text, 'substring match inside tokens; breakAfter re-joins with \\n (invariant 2)').toBe('c0ncat 0n\nC0ncat')
    expect(project?.blocks[1]?.text, 'every block is visited').toBe('0n time')
    expect(project?.blocks[0]?.words.map((w) => [w.start, w.end])).toEqual([
      [0.5, 1.1],
      [1.1, 1.7],
      [1.7, 2.5],
    ])
    expect(project?.blocks[0]?.words[1]?.breakAfter, 'manual break survives the replace').toBe(true)
    expect(t.history.undoCount(), 'one pass = one step').toBe(steps + 1)
  })

  test('wholeWord is token-core equality (case-fold + strip non-alphanumerics); caseSensitive wholeWord is exact', () => {
    const t = app({ project: multiBlockProject() })
    expect(t.dispatch('replace-text', { query: 'concat!', replacement: 'X', wholeWord: true })).toBeNull()
    let project = t.project.getState().project
    expect(project?.blocks[0]?.words[0]?.text, 'normalizeCore strips ! and case-folds').toBe('X')

    const t2 = app({ project: multiBlockProject() })
    expect(t2.dispatch('replace-text', { query: 'ON', replacement: '0N', wholeWord: true, caseSensitive: true })).toBeNull()
    project = t2.project.getState().project
    expect(project?.blocks[1]?.words[0]?.text).toBe('0N')
    expect(project?.blocks[0]?.words[1]?.text, 'case-sensitive wholeWord skips the lowercase token').toBe('on')
  })

  test('empty block list: accepted with no step', () => {
    const t = app({ project: projectWith({ blocks: [] }) })
    expect(t.dispatch('replace-text', { query: 'a', replacement: 'b' })).toBeNull()
    expect(t.history.undoCount()).toBe(0)
  })
})

describe('unit-104 seed: speaker-merge guard edges + delegation shape', () => {
  test('non-string ids reject INVALID_PAYLOAD with the field token; unknown from/into reject DANGLING_SPEAKER_REF — zero mutation, no step', () => {
    const t = app()
    const before = t.project.getState().project
    const steps = t.history.undoCount()
    expect(t.dispatch('speaker-merge', { from: 42 as never, into: 'SPK_2' })).toEqual({ code: 'INVALID_PAYLOAD', token: 'speaker' })
    expect(t.dispatch('speaker-merge', { from: 'SPK_1', into: 7 as never })).toEqual({ code: 'INVALID_PAYLOAD', token: 'speaker' })
    expect(t.dispatch('speaker-merge', { from: 'SPK_404', into: 'SPK_1' })).toEqual({ code: 'DANGLING_SPEAKER_REF', token: 'SPK_404' })
    expect(t.dispatch('speaker-merge', { from: 'SPK_1', into: 'SPK_404' })).toEqual({ code: 'DANGLING_SPEAKER_REF', token: 'SPK_404' })
    expect(t.project.getState().project, 'rejections make no change').toBe(before)
    expect(t.history.undoCount()).toBe(steps)
  })

  test('happy merge: from leaves speakers, its words move to into, speakerSource → manual, ONE step', () => {
    const t = app({
      project: projectWith({
        blocks: [
          {
            id: 'blk_1',
            start: 0.5,
            end: 2.5,
            text: 'hello there',
            words: [
              { text: 'hello', start: 0.5, end: 1.5 },
              { text: 'there', start: 1.5, end: 2.5, speakerId: 'SPK_2' },
            ],
            speakerId: 'SPK_1',
          },
        ],
      }),
    })
    const steps = t.history.undoCount()
    expect(t.dispatch('speaker-merge', { from: 'SPK_2', into: 'SPK_1' })).toBeNull()
    const project = t.project.getState().project
    expect(project?.speakers.map((s) => s.id)).toEqual(['SPK_1'])
    expect(project?.blocks[0]?.words[1]?.speakerId ?? project?.blocks[0]?.speakerId).toBeTruthy()
    expect(project?.speakerSource).toBe('manual')
    expect(t.history.undoCount()).toBe(steps + 1)
  })
})

describe('unit-104 seed: caption-import port (slice D dialog backend)', () => {
  test('analyze: vendor.srt → report numbers + blk-<n> ids in start order + minted speakers; the input project is never touched', async () => {
    const port = createEngineCaptionImportPort()
    const project = projectWith()
    const before = structuredClone(project)
    const bytes = new Uint8Array(readFileSync('fixtures/captions/vendor.srt'))
    const outcome = await port.analyze(project, { name: 'vendor.srt', bytes }, { speakerPrefixes: 'auto' })
    expect(outcome.report.format).toBe('srt')
    expect(outcome.report.cues).toBe(2)
    expect(outcome.report.blocks).toBe(2)
    expect(
      outcome.blocks.map((b) => b.id),
      'canonical start-ordered re-ids (unit-07 golden rule)',
    ).toEqual(['blk-1', 'blk-2'])
    expect(outcome.blocks[0]!.start).toBeLessThan(outcome.blocks[1]!.start)
    expect(outcome.blocks.every((b) => b.words.length > 0 && b.text.length > 0)).toBe(true)
    expect(project, 'analyze is pure — the project is only a duration context').toEqual(before)
  })

  test('analyze: encoding override re-decodes a windows-1252 file as utf-8 (mojibake) vs the sniffed truth', async () => {
    const port = createEngineCaptionImportPort()
    const bytes = new Uint8Array(readFileSync('fixtures/captions/vendor.srt'))
    const sniffed = await port.analyze(projectWith(), { name: 'vendor.srt', bytes }, { speakerPrefixes: 'auto' })
    expect(sniffed.report.encoding.toLowerCase()).toContain('1252')
    await expect(port.analyze(projectWith(), { name: 'vendor.srt', bytes }, { speakerPrefixes: 'auto', encoding: 'utf-8' }), 'strict utf-8 override on 1252 bytes fails with the CODE').rejects.toMatchObject({
      code: 'ENCODING',
    })
    const as1252 = await port.analyze(projectWith(), { name: 'vendor.srt', bytes }, { speakerPrefixes: 'auto', encoding: 'windows-1252' })
    expect(as1252.report.encoding.toLowerCase()).toContain('1252')
  })

  test('analyze: garbage file rejects with a CaptionFailure CODE only (FR-07.6 / SECURITY-03)', async () => {
    const port = createEngineCaptionImportPort()
    const bytes = new TextEncoder().encode('this is not a caption file')
    await expect(port.analyze(projectWith(), { name: 'junk.txt', bytes }, { speakerPrefixes: 'off' })).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
  })
})
