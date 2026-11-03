// CC-07.5 (L1, colocated coverage suite for CC-07.7): branches of the QC
// engine beyond the frozen acceptance suites (tests/unit/captions/qc.test.ts
// + qc-incremental.test.ts): every rule-override field, checkGaps off,
// negative gaps, numeric fps, the zero-duration block, translation ordering
// across tracks, sourceTextHash vectors, and the checker's unknown-id,
// neighbour-re-evaluation and cache-invalidation paths. Self-contained
// builders (src/engine/audio colocated-test precedent).
import { describe, expect, test } from 'vitest'
import { checkCaptions, createQcChecker, sourceTextHash } from './qc'
import type { CaptionBlock, CaptionStyle, Project, TranslationTrack, WordToken } from '../model'

function word(text: string, start: number, end: number): WordToken {
  return { text, start, end, timing: 'asr' }
}

function textBlock(id: string, start: number, end: number, text: string): CaptionBlock {
  const tokens = text.split(' ').filter(Boolean)
  const step = tokens.length > 0 ? (end - start) / tokens.length : 0
  return { id, start, end, text, words: tokens.map((token, index) => word(token, start + index * step, start + (index + 1) * step)), speakerId: 'SPK_1' }
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

function project(overrides: { duration?: number; fps?: number; blocks?: CaptionBlock[]; translations?: TranslationTrack[]; maxLines?: number } = {}): Project {
  const duration = overrides.duration ?? 100
  const fps = overrides.fps ?? 25
  const name = 'a.mp4'
  return {
    id: 'p1',
    name: 'P1',
    schemaVersion: 1,
    asset: { id: 'a1', name, kind: 'video', container: 'mp4', audioCodec: 'aac', videoCodec: 'h264', duration, width: 1920, height: 1080, fps, fingerprint: { name, size: 1_000_000, durationMs: duration * 1000, sampleHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] } },
    blocks: overrides.blocks ?? [],
    captionOrigin: 'transcribed',
    translations: overrides.translations ?? [],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
    speakerSource: 'auto-beta',
    language: 'en',
    modelId: null,
    style: { ...STYLE, maxLinesPerBlock: (overrides.maxLines ?? 2) as 1 | 2 | 3 },
    outputAspect: 'source',
    transcription: 'complete',
    updatedAt: 1_700_000_000_000,
  }
}

function codes(list: ReturnType<typeof checkCaptions>): string[] {
  return list.map((issue) => issue.code)
}

describe('CC-07.5: rule overrides (settings with defaults)', () => {
  test('cpsMax / lineCharsMax / minDurationSec / maxDurationSec / minGapFrames overrides change verdicts', () => {
    const fast = project({ blocks: [textBlock('blk-1', 0, 1, 'a'.repeat(25))] })
    expect(codes(checkCaptions(fast))).toContain('CPS_HIGH')
    expect(codes(checkCaptions(fast, { cpsMax: 30 }))).not.toContain('CPS_HIGH')

    const wide = project({ blocks: [textBlock('blk-1', 0, 3, 'x'.repeat(50))] })
    expect(codes(checkCaptions(wide))).toContain('LINE_TOO_LONG')
    expect(codes(checkCaptions(wide, { lineCharsMax: 60 }))).not.toContain('LINE_TOO_LONG')

    const tiny = project({ blocks: [textBlock('blk-1', 0, 0.5, 'hi there')] })
    expect(codes(checkCaptions(tiny, { minDurationSec: 0.3 }))).not.toContain('DURATION_SHORT')
    const longish = project({ blocks: [textBlock('blk-1', 0, 9, 'many words here today again ok now well fine ok now here fine today again ok now well fine ok now here')] })
    expect(codes(checkCaptions(longish))).toContain('DURATION_LONG')
    expect(codes(checkCaptions(longish, { maxDurationSec: 10 }))).not.toContain('DURATION_LONG')

    const tight = project({ fps: 25, blocks: [textBlock('blk-1', 0, 2, 'alpha bravo'), textBlock('blk-2', 2.04, 4, 'charlie delta')] })
    expect(codes(checkCaptions(tight))).toContain('GAP_TINY')
    expect(codes(checkCaptions(tight, { minGapFrames: 1 }))).not.toContain('GAP_TINY')
  })

  test('numeric fps overrides the asset frame rate', () => {
    const gap = project({ fps: 25, blocks: [textBlock('blk-1', 0, 2, 'alpha bravo'), textBlock('blk-2', 2.07, 4, 'charlie delta')] })
    expect(codes(checkCaptions(gap)), '0.07 < 2/25 = 0.08').toContain('GAP_TINY')
    expect(codes(checkCaptions(gap, { fps: 30 })), '0.07 ≥ 2/30 ≈ 0.067').not.toContain('GAP_TINY')
  })

  test('checkGaps false silences the gap rule', () => {
    const tight = project({ fps: 25, blocks: [textBlock('blk-1', 0, 2, 'alpha bravo'), textBlock('blk-2', 2.01, 4, 'charlie delta')] })
    expect(codes(checkCaptions(tight))).toContain('GAP_TINY')
    expect(codes(checkCaptions(tight, { checkGaps: false }))).not.toContain('GAP_TINY')
  })

  test('overlapping blocks (negative gap) never report GAP_TINY (contract: non-negative gaps only)', () => {
    const overlap = project({ fps: 25, blocks: [textBlock('blk-1', 0, 2, 'alpha bravo'), textBlock('blk-2', 1.5, 4, 'charlie delta')] })
    expect(codes(checkCaptions(overlap))).not.toContain('GAP_TINY')
  })

  test('maxLinesPerBlock numeric (1) fires TOO_MANY_LINES for two lines; style default (2) does not', () => {
    const twoLines = project({ blocks: [textBlock('blk-1', 0, 3, 'one two\nthree four')] })
    expect(checkCaptions(twoLines, { maxLinesPerBlock: 1 }).find((i) => i.code === 'TOO_MANY_LINES')!.value).toBe(2)
    expect(codes(checkCaptions(twoLines))).not.toContain('TOO_MANY_LINES')
    const threeLines = project({ blocks: [textBlock('blk-1', 0, 3, 'one two\nthree four\nfive six')], maxLines: 3 })
    expect(codes(checkCaptions(threeLines)), 'style maxLinesPerBlock = 3 honoured').not.toContain('TOO_MANY_LINES')
  })

  test('a zero-duration empty block reports DURATION_SHORT (0) but no CPS_HIGH (0/0 is not a rate)', () => {
    const empty = project({ blocks: [{ id: 'blk-1', start: 5, end: 5, text: '', words: [], speakerId: 'SPK_1' }] })
    const found = codes(checkCaptions(empty))
    expect(found).toContain('DURATION_SHORT')
    expect(found).not.toContain('CPS_HIGH')
    expect(checkCaptions(empty).find((i) => i.code === 'DURATION_SHORT')!.value).toBe(0)
  })
})

describe('CC-07.5 / CC-07.4: sourceTextHash (canonical TranslationEntry.sourceHash)', () => {
  test('FNV-1a 32-bit: pinned vectors, 8 lowercase hex digits, determinism', () => {
    expect(sourceTextHash('')).toBe('811c9dc5')
    expect(sourceTextHash('a')).toBe('e40c292c')
    expect(sourceTextHash('hello world')).toMatch(/^[0-9a-f]{8}$/)
    expect(sourceTextHash('alpha bravo')).toBe(sourceTextHash('alpha bravo'))
    expect(sourceTextHash('alpha bravo.')).not.toBe(sourceTextHash('alpha bravo'))
  })
})

describe('CC-07.5: translation tracks', () => {
  test('stale and missing coexist across blocks and tracks, in block order', () => {
    const subject = project({
      blocks: [textBlock('blk-1', 0, 2, 'alpha bravo'), textBlock('blk-2', 3, 5, 'charlie delta')],
      translations: [
        { language: 'fr', origin: 'machine', engine: null, entries: { 'blk-1': { text: 'x', status: 'translated', sourceHash: 'ffffffffffffffff' } } },
        { language: 'de', origin: 'machine', engine: null, entries: { 'blk-1': { text: 'y', status: 'translated', sourceHash: sourceTextHash('alpha bravo') }, 'blk-2': { text: 'z', status: 'translated', sourceHash: sourceTextHash('charlie delta') } } },
      ],
    })
    const issues = checkCaptions(subject)
    expect(issues.filter((i) => i.code === 'TRANSLATION_STALE')).toEqual([{ code: 'TRANSLATION_STALE', blockId: 'blk-1', track: 'fr', value: 1 }])
    expect(issues.filter((i) => i.code === 'TRANSLATION_MISSING')).toEqual([{ code: 'TRANSLATION_MISSING', blockId: 'blk-2', track: 'fr', value: 1 }])
  })
})

describe('CC-07.5: incremental checker branches', () => {
  test('changedBlock on an unknown id returns no issues', () => {
    const subject = project({ blocks: [textBlock('blk-1', 0, 2, 'alpha bravo')] })
    expect(createQcChecker(subject).changedBlock('blk-nope')).toEqual([])
  })

  test('changedBlock re-evaluates the NEIGHBOUR gap and matches the filtered full pass', () => {
    const subject = project({ fps: 25, blocks: [textBlock('blk-1', 0, 2, 'alpha bravo'), textBlock('blk-2', 2.5, 4, 'charlie delta')] })
    const checker = createQcChecker(subject)
    expect(checker.all()).toEqual([])
    const changed = subject.blocks[0]!
    changed.end = 2.45 // encroaches: gap 0.05 < 0.08 → GAP_TINY on blk-2
    const incremental = checker.changedBlock('blk-1')
    expect(incremental.map((i) => i.code), 'the later neighbour is re-checked').toEqual(['GAP_TINY'])
    expect(incremental[0]!.blockId).toBe('blk-2')
    const expected = checker.all().filter((i) => ['blk-1', 'blk-2'].includes(i.blockId))
    expect(incremental).toEqual(expected)
  })

  test('the checker follows block-array replacement (cache invalidates on identity)', () => {
    const subject = project({ blocks: [textBlock('blk-1', 0, 2, 'alpha bravo')] })
    const checker = createQcChecker(subject)
    expect(checker.changedBlock('blk-1')).toEqual([])
    subject.blocks = [textBlock('blk-9', 0, 2, 'x'.repeat(44))]
    expect(checker.changedBlock('blk-9').map((i) => i.code).sort()).toEqual(['CPS_HIGH', 'LINE_TOO_LONG'])
  })
})
