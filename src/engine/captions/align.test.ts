// CC-07.3 / FR-07.4 (L1 seeds for src/engine/captions/align.ts): the frozen
// suites (tests/unit/captions/align.test.ts) pin the happy paths and the
// never-change property; these seeds cover the anchors, collapse and
// report-identity edges the pure transform must hold.
import { expect, test } from 'vitest'
import { alignCaptionsToWords } from './align'
import type { Project, WordToken } from '../model'

function project(blocks: { start: number; end: number; words: WordToken[] }[]): Project {
  return {
    id: 'p1',
    name: 'p1',
    schemaVersion: 1,
    asset: {
      id: 'a1',
      name: 'a.mp4',
      kind: 'video',
      container: 'mp4',
      audioCodec: 'aac',
      videoCodec: 'h264',
      duration: 60,
      width: 1920,
      height: 1080,
      fps: 25,
      fingerprint: { name: 'a.mp4', size: 1, durationMs: 60_000, sampleHashes: ['a', 'b', 'c'] },
    },
    blocks: blocks.map((block, index) => ({ id: `blk-${index}`, start: block.start, end: block.end, text: block.words.map((word) => word.text).join(' '), words: block.words, speakerId: 'SPK_1' })),
    captionOrigin: 'imported',
    translations: [],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
    speakerSource: 'none',
    language: 'en',
    modelId: null,
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
    transcription: 'none',
    updatedAt: 0,
  }
}

function word(text: string, start: number, end: number, extra: Partial<WordToken> = {}): WordToken {
  return { text, start, end, timing: 'estimated', ...extra }
}

test('CC-07.3: empty track reports 0/0/0 and leaves the project alone', () => {
  const project0 = project([])
  const { project: aligned, report } = alignCaptionsToWords(project0, [{ text: 'x', start: 0, end: 1 }])
  expect(report).toEqual({ wordsTotal: 0, wordsAligned: 0, alignedRatio: 0 })
  expect(aligned.blocks).toEqual([])
  expect(aligned).not.toBe(project0)
})

test('CC-07.3: punctuation-only tokens never match each other', () => {
  const project0 = project([{ start: 0, end: 2, words: [word('…', 0, 1), word('alpha', 1, 2)] }])
  const { project: aligned, report } = alignCaptionsToWords(project0, [
    { text: '!', start: 0.1, end: 0.2 },
    { text: 'alpha', start: 1.2, end: 1.8 },
  ])
  expect(report.wordsAligned, 'normalized-to-empty does not match').toBe(1)
  expect(aligned.blocks[0]!.words[0]!.timing).toBe('estimated')
  expect(aligned.blocks[0]!.words[1]!.timing).toBe('aligned')
})

test('CC-07.3: unmatched words re-anchor to the block bounds at the edges', () => {
  const project0 = project([{ start: 10, end: 14, words: [word('alpha', 10, 11), word('beta', 11, 12), word('gamma', 12, 13), word('delta', 13, 14)] }])
  const { project: aligned } = alignCaptionsToWords(project0, [
    { text: 'beta', start: 11.1, end: 11.6 },
    { text: 'gamma', start: 12.1, end: 12.6 },
  ])
  const words = aligned.blocks[0]!.words
  expect(words[0]!.start, 'leading run starts at block start').toBe(10)
  expect(words[0]!.end).toBe(11.1)
  expect(words[3]!.end, 'trailing run ends at block end').toBe(14)
  expect(words[3]!.start).toBe(12.6)
  expect(words.map((w) => w.timing)).toEqual(['estimated', 'aligned', 'aligned', 'estimated'])
})

test('CC-07.3: inverted aligned neighbours collapse the in-between run (invariant 1 preserved)', () => {
  const project0 = project([{ start: 0, end: 5, words: [word('alpha', 0, 1), word('beta', 1, 2), word('gamma', 2, 3)] }])
  const { project: aligned } = alignCaptionsToWords(project0, [
    { text: 'gamma', start: 0.2, end: 0.3 },
    { text: 'alpha', start: 0.1, end: 0.15 },
  ])
  const words = aligned.blocks[0]!.words
  // alpha matched (0.1–0.15) and gamma (0.2–0.3) — alignment is non-crossing
  // so only ONE of them pairs; whichever result, beta keeps start ≤ end.
  expect(words[1]!.end, 'invariant 1 after align').toBeGreaterThanOrEqual(words[1]!.start)
  expect(words[0]!.start).toBeLessThanOrEqual(words[1]!.start)
})

test('CC-07.3: ambiguous repeats align exactly one occurrence (deterministic)', () => {
  const project0 = project([{ start: 0, end: 2, words: [word('a', 0, 1), word('a', 1, 2)] }])
  const first = alignCaptionsToWords(project0, [{ text: 'a', start: 0.4, end: 0.6 }])
  const second = alignCaptionsToWords(project0, [{ text: 'a', start: 0.4, end: 0.6 }])
  expect(first.report.wordsAligned).toBe(1)
  expect(JSON.stringify(first.project.blocks)).toBe(JSON.stringify(second.project.blocks))
})

test('CC-07.3: multi-block alignment reads each block from its own flat word offset', () => {
  const project0 = project([
    { start: 0, end: 2, words: [word('alpha', 0, 1), word('beta', 1, 2)] },
    { start: 3, end: 5, words: [word('gamma', 3, 4), word('delta', 4, 5)] },
  ])
  const { project: aligned, report } = alignCaptionsToWords(project0, [
    { text: 'alpha', start: 0.1, end: 0.5 },
    { text: 'beta', start: 1.1, end: 1.5 },
    { text: 'gamma', start: 3.2, end: 3.6 },
    { text: 'delta', start: 4.3, end: 4.8 },
  ])
  expect(report.wordsAligned).toBe(4)
  expect(aligned.blocks[1]!.words.map((w) => [w.start, w.end])).toEqual([
    [3.2, 3.6],
    [4.3, 4.8],
  ])
})

test('CC-07.3: word metadata (probability, speakerId, breakAfter) survives alignment', () => {
  const project0 = project([{ start: 0, end: 2, words: [word('alpha', 0, 1, { probability: 0.9, speakerId: 'SPK_9', breakAfter: true }), word('beta', 1, 2)] }])
  const { project: aligned } = alignCaptionsToWords(project0, [
    { text: 'alpha', start: 0.05, end: 0.5 },
    { text: 'beta', start: 1.05, end: 1.5 },
  ])
  const alpha = aligned.blocks[0]!.words[0]!
  expect(alpha).toMatchObject({ probability: 0.9, speakerId: 'SPK_9', breakAfter: true, timing: 'aligned' })
  expect(aligned.blocks[0]!.id, 'block identity untouched').toBe('blk-0')
  expect(aligned.blocks[0]!.speakerId).toBe('SPK_1')
})

test('CC-07.3: overlapping ASR times on consecutive matches (off-contract input) keep invariant 1 — the later match is treated as unmatched', () => {
  // unit-05 supplies monotone words, so this is defence in depth: an
  // overlapping pair must never be copied verbatim into adjacent words
  // (domain.md:56 invariant 1 — word[i].end ≤ word[i+1].start). The later
  // match is dropped to interpolation instead of clamped, so accepted
  // matched words still carry their ASR times verbatim (no fabrication).
  const project0 = project([{ start: 0, end: 5, words: [word('alpha', 0, 1), word('beta', 1, 2)] }])
  const { project: aligned, report } = alignCaptionsToWords(project0, [
    { text: 'alpha', start: 0.2, end: 1.4 },
    { text: 'beta', start: 1.2, end: 2.4 },
  ])
  const words = aligned.blocks[0]!.words
  expect(report.wordsAligned, 'the backward-overlapping match is not counted aligned').toBe(1)
  expect(words[0]).toMatchObject({ start: 0.2, end: 1.4, timing: 'aligned' })
  expect(words[1]!.timing, 'beta re-interpolates instead of copying an overlapping time').toBe('estimated')
  expect(words[1]!.start, 'invariant 1 after align').toBeGreaterThanOrEqual(words[0]!.end)
})
