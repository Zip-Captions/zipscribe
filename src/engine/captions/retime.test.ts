// CC-07.4 (L1, colocated coverage suite for CC-07.7): branches of retimeAll/
// solveRetime beyond the frozen acceptance suite
// (tests/unit/captions/retime.test.ts): metadata preservation on blocks and
// words, untouched project fields, empty tracks, partial option objects,
// word-level clamping and the degenerate solve (kept here so this file
// covers its own error branch). Self-contained builders (src/engine/audio
// colocated-test precedent).
import { describe, expect, test } from 'vitest'
import { retimeAll, solveRetime } from './retime'
import type { CaptionBlock, CaptionStyle, Project, WordToken } from '../model'

function word(text: string, start: number, end: number, extra: Partial<WordToken> = {}): WordToken {
  return { text, start, end, ...extra }
}

function block(id: string, start: number, end: number, words: WordToken[]): CaptionBlock {
  const text = words.map((w) => w.text).join(' ')
  return { id, start, end, text, words, speakerId: 'SPK_1' }
}

const STYLE: CaptionStyle = {
  fontFamily: 'Inter',
  fontWeight: 400,
  fontSizePct: 4,
  textTransform: 'none',
  color: '#FFFFFF',
  highlightColor: '#FFE45C',
  outlineColor: '#000000',
  outlineWidth: 2,
  backgroundOpacity: 0,
  position: 'bottom',
  marginVPct: 8,
  alignment: 'center',
  maxLinesPerBlock: 2,
  highlightMode: 'none',
  showSpeakerBar: false,
}

function project(overrides: { duration?: number; blocks?: CaptionBlock[] } = {}): Project {
  const duration = overrides.duration ?? 100
  const name = 'a.mp4'
  return {
    id: 'p1',
    name: 'P1',
    schemaVersion: 1,
    asset: {
      id: 'a1',
      name,
      kind: 'video',
      container: 'mp4',
      audioCodec: 'aac',
      videoCodec: 'h264',
      duration,
      width: 1920,
      height: 1080,
      fps: 25,
      fingerprint: { name, size: 1_000_000, durationMs: duration * 1000, sampleHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] },
    },
    blocks: overrides.blocks ?? [],
    captionOrigin: 'transcribed',
    translations: [],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
    speakerSource: 'auto-beta',
    language: 'en',
    modelId: null,
    style: STYLE,
    outputAspect: 'source',
    transcription: 'complete',
    updatedAt: 1_700_000_000_000,
  }
}

describe('CC-07.4: retimeAll — preservation and clamping branches', () => {
  test('word and block metadata survive the map untouched (only times move)', () => {
    const source = project({
      blocks: [
        {
          ...block('blk-1', 10, 12, [word('hi', 10, 11, { probability: 0.77, speakerId: 'SPK_1', breakAfter: true, timing: 'estimated' }), word('there', 11, 12)]),
          confidence: 0.9,
          retimeFromWords: true,
        },
      ],
    })
    const result = retimeAll(source, { offsetSec: 5 })
    const moved = result.blocks[0]!
    expect(moved.confidence, 'confidence preserved').toBe(0.9)
    expect(moved.retimeFromWords, 'retimeFromWords preserved').toBe(true)
    expect(moved.speakerId).toBe('SPK_1')
    expect(moved.text, 'text is not re-derived').toBe('hi there')
    const movedWord = moved.words[0]!
    expect(movedWord.probability).toBe(0.77)
    expect(movedWord.speakerId).toBe('SPK_1')
    expect(movedWord.breakAfter).toBe(true)
    expect(movedWord.timing, 'timing provenance is not retimeAll\u2019s to change').toBe('estimated')
    expect([movedWord.start, movedWord.end], 'only the times moved').toEqual([15, 16])
  })

  test('everything outside blocks is untouched, and new arrays are returned', () => {
    const source = project({ blocks: [block('blk-1', 1, 2, [word('a', 1, 2)])] })
    const result = retimeAll(source, { offsetSec: 1 })
    expect(result.updatedAt).toBe(source.updatedAt)
    expect(result.style).toBe(source.style)
    expect(result.asset).toBe(source.asset)
    expect(result.speakers).toBe(source.speakers)
    expect(result.blocks).not.toBe(source.blocks)
    expect(result.blocks[0]!.words).not.toBe(source.blocks[0]!.words)
    expect(source.blocks[0]!.start, 'input frozen').toBe(1)
  })

  test('an empty track maps to an empty track', () => {
    expect(retimeAll(project(), { offsetSec: 3, scale: 2 }).blocks).toEqual([])
  })

  test('partial option objects default the rest to the identity', () => {
    const source = project({ blocks: [block('blk-1', 4, 6, [word('a', 4, 5), word('b', 5, 6)])] })
    const scaled = retimeAll(source, { scale: 0.5 }) // anchor 0, offset 0
    expect(scaled.blocks[0]!.start).toBe(2)
    expect(scaled.blocks[0]!.end).toBe(3)
    expect(scaled.blocks[0]!.words[1]!.end).toBe(3)
  })

  test('words clamp individually into [0, duration] (negative and overflow)', () => {
    const source = project({ blocks: [block('blk-1', 0.2, 0.4, [word('a', 0.2, 0.3), word('b', 0.3, 0.4)])] })
    const back = retimeAll(source, { offsetSec: -1 })
    for (const w of back.blocks[0]!.words) expect(w.start).toBe(0)
    const forward = retimeAll(source, { offsetSec: 99.8 })
    for (const w of forward.blocks[0]!.words) expect(w.end).toBe(100)
  })
})

describe('CC-07.4: solveRetime — branch coverage', () => {
  test('fractional two-point pick solves exactly', () => {
    const solution = solveRetime(1.5, 2.0, 4.5, 5.0) // scale 1, offset 0.5
    expect(solution.anchorSec, 'two-point solve maps about the origin').toBe(0)
    expect(solution.scale).toBeCloseTo(1, 9)
    expect(solution.offsetSec).toBeCloseTo(0.5, 9)
  })

  test('identical source times are the frozen degenerate case (TypeError)', () => {
    expect(() => solveRetime(3, 0, 3, 9)).toThrow(TypeError)
  })
})
