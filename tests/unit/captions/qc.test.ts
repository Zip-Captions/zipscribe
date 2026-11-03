// CC-07.5 (L1) / US-07.5: checkCaptions returns QcIssue[] for every rule at
// the US-07.5 DEFAULT thresholds (20 CPS, 42 chars, style maxLinesPerBlock,
// 0.7/7 s, 2-frame gap, out-of-media, TRANSLATION_STALE/MISSING) — one test
// per code — plus the settings-override behaviour and boundary strictness.
// The incremental ≤ 5 ms half is qc-incremental.test.ts.
import { expect, test } from 'vitest'
import { checkCaptions, sourceTextHash } from '@engine/captions/qc'
import type { QcIssue, QcIssueCode } from '@engine/captions/contract@07'
import type { CaptionBlock, TranslationTrack, WordToken } from '@engine/model@07'
import { makeBlock, makeProject } from './project-support'

function blockWithText(start: number, end: number, text: string, id: string): CaptionBlock {
  const tokens = text.split(/\s+/).filter(Boolean)
  const step = tokens.length > 0 ? (end - start) / tokens.length : 0
  const words: WordToken[] = tokens.map((token, index) => ({ text: token, start: start + index * step, end: start + (index + 1) * step, timing: 'asr' }))
  return makeBlock(start, end, words, 'SPK_1', id)
}

function codes(issues: QcIssue[]): QcIssueCode[] {
  return issues.map((issue) => issue.code)
}

test('CC-07.5 / US-07.5: CPS_HIGH over the 20 CPS default — value is the measured rate, boundary is strict', () => {
  const clean = makeProject({ blocks: [blockWithText(0, 1, 'a'.repeat(20), 'blk-1')] }) // exactly 20 CPS → not over
  expect(codes(checkCaptions(clean))).not.toContain('CPS_HIGH')
  const hot = makeProject({ blocks: [blockWithText(0, 1, 'a'.repeat(21), 'blk-1')] })
  const issues = checkCaptions(hot)
  const issue = issues.find((i) => i.code === 'CPS_HIGH')
  expect(issue, '21 chars / 1 s = 21 CPS > 20').toBeDefined()
  expect(issue!.blockId).toBe('blk-1')
  expect(issue!.track).toBe('source')
  expect(issue!.value, 'value = characters (excluding line breaks) / duration').toBeCloseTo(21, 3)
})

test('CC-07.5: line over 42 characters → LINE_TOO_LONG with the measured length', () => {
  const clean = makeProject({ blocks: [blockWithText(0, 3, 'x'.repeat(42), 'blk-1')] })
  expect(codes(checkCaptions(clean))).not.toContain('LINE_TOO_LONG')
  const long = makeProject({ blocks: [blockWithText(0, 3, 'x'.repeat(43), 'blk-1')] })
  const issue = checkCaptions(long).find((i) => i.code === 'LINE_TOO_LONG')
  expect(issue).toBeDefined()
  expect(issue!.value).toBe(43)
})

test('CC-07.5: line breaks are separate lines — 42 chars each stays clean, three lines exceed the style default', () => {
  const twoLines = makeProject({ blocks: [blockWithText(0, 3, `${'x'.repeat(42)}\n${'y'.repeat(42)}`, 'blk-1')] })
  expect(codes(checkCaptions(twoLines))).not.toContain('LINE_TOO_LONG') // per-LINE length, not total
  const threeLines = makeProject({ blocks: [blockWithText(0, 3, 'one two\nthree four\nfive six', 'blk-1')] })
  const issue = checkCaptions(threeLines).find((i) => i.code === 'TOO_MANY_LINES')
  expect(issue, 'project.style.maxLinesPerBlock = 2 by default').toBeDefined()
  expect(issue!.value).toBe(3)
})

test('CC-07.5: DURATION_SHORT under 0.7 s and DURATION_LONG over 7 s (0.7/7 are the defaults)', () => {
  const short = makeProject({ blocks: [blockWithText(0, 0.69, 'hi there', 'blk-1')] })
  const issues = checkCaptions(short)
  expect(codes(issues)).toContain('DURATION_SHORT')
  expect(issues.find((i) => i.code === 'DURATION_SHORT')!.value).toBeCloseTo(0.69, 3)
  const exactlyMin = makeProject({ blocks: [blockWithText(0, 0.7, 'hi there', 'blk-1')] })
  expect(codes(checkCaptions(exactlyMin))).not.toContain('DURATION_SHORT')

  const longProject = makeProject({ blocks: [blockWithText(0, 7.01, 'many words here today again ok now well', 'blk-1')] })
  expect(codes(checkCaptions(longProject))).toContain('DURATION_LONG')
  const exactlyMax = makeProject({ blocks: [blockWithText(0, 7, 'many words here today again ok now well', 'blk-1')] })
  expect(codes(checkCaptions(exactlyMax))).not.toContain('DURATION_LONG')
})

test('CC-07.5: GAP_TINY under 2 frames of the asset fps — value is the gap in seconds', () => {
  // 25 fps asset: 2 frames = 0.08 s.
  const tight = makeProject({
    fps: 25,
    blocks: [blockWithText(0, 2, 'alpha bravo', 'blk-1'), blockWithText(2.04, 4, 'charlie delta', 'blk-2')], // 0.04 s gap
  })
  const issue = checkCaptions(tight).find((i) => i.code === 'GAP_TINY')
  expect(issue, '0.04 s < 2/25 s').toBeDefined()
  expect(issue!.blockId, 'reported on the later block').toBe('blk-2')
  expect(issue!.value).toBeCloseTo(0.04, 3)

  const spaced = makeProject({
    fps: 25,
    blocks: [blockWithText(0, 2, 'alpha bravo', 'blk-1'), blockWithText(2.1, 4, 'charlie delta', 'blk-2')], // 0.1 s ≥ 0.08
  })
  expect(codes(checkCaptions(spaced))).not.toContain('GAP_TINY')
})

test('CC-07.5: audio projects (fps 0) fall back to a 25 fps gap rule', () => {
  const audio = makeProject({
    fps: 0,
    blocks: [blockWithText(0, 2, 'alpha bravo', 'blk-1'), blockWithText(2.04, 4, 'charlie delta', 'blk-2')],
  })
  expect(codes(checkCaptions(audio))).toContain('GAP_TINY')
})

test('CC-07.5: block beyond the media duration → OUT_OF_MEDIA with the overflow', () => {
  const beyond = makeProject({ duration: 10, blocks: [blockWithText(9.5, 10.5, 'trailing words here', 'blk-1')] })
  const issue = checkCaptions(beyond).find((i) => i.code === 'OUT_OF_MEDIA')
  expect(issue).toBeDefined()
  expect(issue!.value, 'value = end − duration').toBeCloseTo(0.5, 3)
  const inside = makeProject({ duration: 10.5, blocks: [blockWithText(9.5, 10.5, 'trailing words here', 'blk-1')] })
  expect(codes(checkCaptions(inside))).not.toContain('OUT_OF_MEDIA')
})

test('CC-07.5: TRANSLATION_STALE when the source text changed after translating', () => {
  const block = blockWithText(0, 2, 'alpha bravo', 'blk-1')
  const project = makeProject({
    blocks: [block],
    translations: [
      {
        language: 'fr',
        origin: 'machine',
        engine: null,
        entries: { 'blk-1': { text: 'alpha bravo en français', status: 'translated', sourceHash: 'deadbeef00000000' } },
      },
    ],
  })
  const issues = checkCaptions(project)
  const stale = issues.find((i) => i.code === 'TRANSLATION_STALE')
  expect(stale).toBeDefined()
  expect(stale!.blockId).toBe('blk-1')
  expect(stale!.track, 'track is the language code', ).toBe('fr')
  expect(issues.find((i) => i.code === 'TRANSLATION_MISSING'), 'entry exists → not missing').toBeUndefined()
})

test('CC-07.5: a fresh sourceHash (sourceTextHash) is NOT stale — the stale rule cannot fire vacuously', () => {
  const block = blockWithText(0, 2, 'alpha bravo', 'blk-1')
  const project = makeProject({
    blocks: [block],
    translations: [
      {
        language: 'fr',
        origin: 'machine',
        engine: null,
        entries: { 'blk-1': { text: 'ok', status: 'translated', sourceHash: sourceTextHash(block.text) } },
      },
    ],
  })
  expect(codes(checkCaptions(project))).not.toContain('TRANSLATION_STALE')
})

test('CC-07.5: TRANSLATION_MISSING for every source block without an entry', () => {
  const project = makeProject({
    blocks: [blockWithText(0, 2, 'alpha bravo', 'blk-1'), blockWithText(3, 5, 'charlie delta', 'blk-2')],
    translations: [
      {
        language: 'de',
        origin: 'imported',
        engine: null,
        entries: { 'blk-1': { text: 'alpha bravo deutsch', status: 'edited', sourceHash: sourceTextHash('alpha bravo') } },
      },
    ],
  })
  const missing = checkCaptions(project).filter((i) => i.code === 'TRANSLATION_MISSING')
  expect(missing.map((i) => i.blockId)).toEqual(['blk-2'])
  expect(missing[0]!.track).toBe('de')
})

test('CC-07.5: thresholds are settings — overrides silence the default findings', () => {
  const project = makeProject({ blocks: [blockWithText(0, 1, 'a'.repeat(21), 'blk-1')] })
  expect(codes(checkCaptions(project))).toContain('CPS_HIGH')
  expect(codes(checkCaptions(project, { cpsMax: 30 }))).not.toContain('CPS_HIGH')
  const lines = makeProject({ blocks: [blockWithText(0, 3, 'one two\nthree four\nfive six', 'blk-1')] })
  expect(codes(checkCaptions(lines, { maxLinesPerBlock: 3 }))).not.toContain('TOO_MANY_LINES')
})

test('CC-07.5: a compliant project reports NOTHING (no vacuous findings)', () => {
  const project = makeProject({
    duration: 30,
    blocks: [blockWithText(0.5, 3, 'hello there friends', 'blk-1'), blockWithText(4, 6.5, 'ready set go now', 'blk-2')],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
  })
  expect(checkCaptions(project)).toEqual([])
})

test('CC-07.5: one block can raise several distinct issues (per-(block,code) reporting)', () => {
  // 60 chars in 1 s: CPS 60 > 20 AND one line of 60 > 42.
  const project = makeProject({ blocks: [blockWithText(0, 1, 'z'.repeat(60), 'blk-1')] })
  const issues = checkCaptions(project)
  expect(codes(issues).filter((code) => code === 'CPS_HIGH')).toHaveLength(1)
  expect(codes(issues).filter((code) => code === 'LINE_TOO_LONG')).toHaveLength(1)
})
