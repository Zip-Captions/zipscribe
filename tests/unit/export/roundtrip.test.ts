// CC-202.1 (L1 property): our own output, parsed by unit-07, round-trips
// text-exact and ± 1 ms (fast-check, grounded surface = ambient stub +
// per-file asyncProperty augmentation, the unit-07 property-test convention).
// Domain notes (documented deviations):
// - SRT/VTT are line containers: edge whitespace trims and blank-line runs
//   collapse (blockText) — the property compares that canonical form, and
//   blank cues are skipped by the serializers (mirrored by the expected list).
// - SRT has no escaping: '<'…'>' would be tag-stripped by our parser, so the
//   SRT/TSV generator alphabet excludes angle brackets (VTT escapes them and
//   gets full coverage).
// - SRT full-timing-line text is entity-escaped (`&#45;`); the SRT parser
//   does not decode (no SRT entity standard) — compare after that documented
//   normalization only.
// - RTL wrap marks (translation tracks) are content: compared as emitted.
import { expect, test } from 'vitest'
import { array, assert, asyncProperty, constantFrom, integer, record } from 'fast-check'
import { toSrt } from '@engine/export/srt'
import { toVtt } from '@engine/export/vtt'
import { toJson } from '@engine/export/json'
import { parseSrt } from '@engine/captions/parse/srt'
import { parseVtt } from '@engine/captions/parse/vtt'
import { parseZipscribeJson } from '@engine/captions/parse/json'
import { vttEscape } from '@engine/export/cue-model'
import type { CaptionBlock, CaptionStyle, MediaAsset, ProjectSnapshot } from '@engine/model'

declare module 'fast-check' {
  export function asyncProperty(...args: unknown[]): unknown
}

const STYLE: CaptionStyle = { fontFamily: 'Inter', fontWeight: 400, fontSizePct: 5, textTransform: 'none', color: '#ffffff', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 0, backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center', maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false }

function snapWith(blocks: CaptionBlock[], speakers: readonly { id: string; label: string; color: string }[] = []): ProjectSnapshot {
  return {
    id: 'p', name: 'p', schemaVersion: 1,
    asset: { id: 'a', name: 'v.mp4', kind: 'video', container: 'mp4', audioCodec: 'aac', videoCodec: 'avc', duration: 60, width: 1280, height: 720, fps: 30, fingerprint: { name: 'v', size: 1, durationMs: 60000, sampleHashes: ['a', 'b', 'c'] } } as MediaAsset,
    blocks, captionOrigin: 'transcribed', translations: [], speakers: [...speakers], speakerSource: 'none',
    language: 'en', modelId: null, style: { ...STYLE }, outputAspect: '16:9', transcription: 'complete', updatedAt: 0, snapshotVersion: 1,
  }
}

/** canonical form shared with the serializers' blockText */
const canon = (t: string): string => t.replace(/\n{2,}/g, '\n').replace(/^[\s\n]+/, '').replace(/[\s\n]+$/, '')
const srtNormalize = (t: string): string => t.replace(/&#45;/g, '-')

interface BlockPlan { s0: number; d: number; text: string }

function mkBlocks(plan: unknown): CaptionBlock[] {
  return (plan as BlockPlan[]).map(p => ({
    id: `b-${String(p.s0)}-${String(p.s0 + p.d)}`, start: p.s0 / 1000, end: (p.s0 + p.d) / 1000, text: p.text, words: [], speakerId: 'SPK_1',
  }))
}

// alphabets: printable ASCII incl. & " -- , : . , tab, newline; SRT/TSV
// exclude angle brackets (SRT passthrough domain); VTT covers them.
const SRT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 &"\',:.-\t\n'.split('')
const VTT_CHARS = 'abcXYZ019 &<>#;"\':,.-\t\n'.split('')
const srtBlocks = array(record({ s0: integer({ min: 0, max: 3_600_000 }), d: integer({ min: 10, max: 30_000 }), text: array(constantFrom(...SRT_CHARS), { minLength: 1, maxLength: 80 }).map(cs => (cs as string[]).join('')) }), { minLength: 1, maxLength: 12 })
const vttBlocks = array(record({ s0: integer({ min: 0, max: 3_600_000 }), d: integer({ min: 10, max: 30_000 }), text: array(constantFrom(...VTT_CHARS), { minLength: 1, maxLength: 80 }).map(cs => (cs as string[]).join('')) }), { minLength: 1, maxLength: 12 })

function check(cue: { text: string; start: number; end: number }, block: CaptionBlock, normalize: (t: string) => string): void {
  expect(cue.text).toBe(normalize(canon(block.text)))
  expect(Math.abs(cue.start - block.start)).toBeLessThanOrEqual(0.0011)
  expect(Math.abs(cue.end - block.end)).toBeLessThanOrEqual(0.0011)
}

test('CC-202.1: SRT → parseSrt text exact (documented normalization) + ±1 ms', async () => {
  await assert(asyncProperty(srtBlocks, async (plan: unknown) => {
    const blocks = mkBlocks(plan)
    const parsed = await parseSrt(toSrt(snapWith(blocks), { track: 'source', speakerLabels: 'off' }))
    const expected = blocks.filter(b => canon(b.text).length > 0)
    expect(parsed.cues.length).toBe(expected.length)
    parsed.cues.forEach((cue, i) => { check(cue, expected[i]!, srtNormalize) })
  }), { numRuns: 60, seed: 20261120 })
})

test('CC-202.1: VTT → parseVtt text exact (entities decode back) + ±1 ms, full char coverage', async () => {
  await assert(asyncProperty(vttBlocks, async (plan: unknown) => {
    const blocks = mkBlocks(plan)
    const parsed = await parseVtt(toVtt(snapWith(blocks), { track: 'source', speakerLabels: 'off' }))
    const expected = blocks.filter(b => canon(b.text).length > 0)
    expect(parsed.cues.length).toBe(expected.length)
    parsed.cues.forEach((cue, i) => { check(cue, expected[i]!, t => t) })
  }), { numRuns: 60, seed: 20261121 })
})

test('CC-202.1: VTT vtt-voice mode — voice extracted, text clean', async () => {
  const block: CaptionBlock = { id: 'b', start: 1, end: 2, text: 'hello <b>world</b> & co', words: [], speakerId: 'SPK_1' }
  const snap = snapWith([block], [{ id: 'SPK_1', label: 'Ann', color: '#fff' }])
  const parsed = await parseVtt(toVtt(snap, { track: 'source', speakerLabels: 'vtt-voice' }))
  expect(parsed.cues[0]?.voice).toBe('Ann')
  expect(parsed.cues[0]?.text).toBe(canon(block.text))
})

// Review R1-M2 (unit-202): speaker labels carry user text. Both label modes
// must survive the round trip — the label is escaped on the way out and the
// parser decodes entities (including inside `<v …>`) on the way back.
const MARKUP_LABEL = 'Guest & <Co> "x"'

test('CC-202.1: VTT vtt-voice round trip with a markup-bearing label', async () => {
  const block: CaptionBlock = { id: 'b', start: 1, end: 2, text: 'ok', words: [], speakerId: 'SPK_2' }
  const snap = snapWith([block], [{ id: 'SPK_2', label: MARKUP_LABEL, color: '#fff' }])
  const parsed = await parseVtt(toVtt(snap, { track: 'source', speakerLabels: 'vtt-voice' }))
  expect(parsed.cues[0]?.voice, 'voice name decodes entities back to the label').toBe(MARKUP_LABEL)
  expect(parsed.cues[0]?.text).toBe('ok')
})

test('CC-202.1: VTT prefix mode — label escaped, no raw markup, text exact after strip', async () => {
  const block: CaptionBlock = { id: 'b', start: 1, end: 2, text: 'plain text', words: [], speakerId: 'SPK_2' }
  const snap = snapWith([block], [{ id: 'SPK_2', label: MARKUP_LABEL, color: '#fff' }])
  const vtt = toVtt(snap, { track: 'source', speakerLabels: 'prefix' })
  expect(vtt).toContain(`[${vttEscape(MARKUP_LABEL)}]: `)
  expect(vtt, 'a label never injects raw markup').not.toContain('<Co>')
  const parsed = await parseVtt(vtt)
  expect(parsed.cues[0]?.text).toBe(`[${MARKUP_LABEL}]: plain text`)
  // the prefix is an export-side convention (not WebVTT spec): strip it and
  // the cue text is byte-exact.
  expect(parsed.cues[0]?.text.replace(/^\[[^\]]*\]: /, '')).toBe('plain text')
})

test('CC-202.1: JSON → parseZipscribeJson blocks exact, language declared', async () => {
  await assert(asyncProperty(srtBlocks, async (plan: unknown) => {
    const blocks = mkBlocks(plan)
    const parsed = await parseZipscribeJson(toJson(snapWith(blocks), { track: 'source', speakerLabels: 'off' }))
    expect(parsed.language).toBe('en')
    expect(parsed.cues.length).toBe(blocks.length)
    parsed.cues.forEach((cue, i) => {
      expect(cue.text).toBe(blocks[i]!.text)
      expect(cue.start).toBe(blocks[i]!.start)
    })
  }), { numRuns: 40, seed: 20261122 })
})
