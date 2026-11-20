// CC-202.1 (L1): the escape/feature matrix as deterministic unit assertions
// (the goldens pin bytes; these pin the RULES and the filename contract).
import { describe, expect, test } from 'vitest'
import { toSrt } from '@engine/export/srt'
import { toVtt } from '@engine/export/vtt'
import { toTsv } from '@engine/export/tsv'
import { toJson } from '@engine/export/json'
import { exportFileName } from '@engine/export/cue-model'
import { sidecarSnapshot } from './helpers/sidecar-fixture'

const snap = sidecarSnapshot()
const TIMING_OK = /^\d{2}:\d{2}:\d{2}[.,]\d{3} --> \d{2}:\d{2}:\d{2}[.,]\d{3}$/

describe('CC-202.1: VTT escape matrix', () => {
  const out = toVtt(snap, { track: 'source', speakerLabels: 'off' })
  test('raw & and < never survive in cue text; only escape forms remain', () => {
    const body = out.split('\n').filter(l => !TIMING_OK.test(l) && l !== 'WEBVTT' && !/^cue-/.test(l))
    for (const line of body) {
      expect(line.includes('<'), line).toBe(false)
      expect(/&(?!amp;|lt;|gt;|#45;)/.test(line), line).toBe(false)
    }
    expect(out).toContain('&amp;')
    expect(out).toContain('&lt;line&gt;')
  })
  test('`-->` only appears on timing lines (spec: never in cue text)', () => {
    for (const line of out.split('\n')) {
      if (line.includes('-->')) expect(TIMING_OK.test(line), line).toBe(true)
    }
  })
  test('vtt-voice mode emits <v Name>; prefix mode emits [Name]:; off omits both', () => {
    expect(toVtt(snap, { track: 'source', speakerLabels: 'vtt-voice' })).toContain('<v Host>')
    expect(toVtt(snap, { track: 'source', speakerLabels: 'prefix' })).toContain('[Host]: ')
    const off = toVtt(snap, { track: 'source', speakerLabels: 'off' })
    expect(off).not.toContain('<v ')
    expect(off).not.toContain('[Host]')
  })
})

describe('CC-202.1: SRT', () => {
  const out = toSrt(snap, { track: 'source', speakerLabels: 'off' })
  test('numbering from 1, CRLF-free, trailing newline, blank-line separated blocks', () => {
    expect(out.startsWith('1\n')).toBe(true)
    expect(out).not.toContain('\r')
    expect(out.endsWith('\n')).toBe(true)
    expect(out.split('\n\n')[0]).toContain(' --> ')
  })
  test('the full-timing-line text is entity-escaped (parse-safety guard)', () => {
    expect(out).toContain('00:00:09,000 &#45;-> 00:00:11,000')
  })
  test('single \\n inside a cue is preserved', () => {
    expect(out).toContain('tab\there\nsecond <line>')
  })
})

describe('CC-202.1: TSV quoting', () => {
  const out = toTsv(snap, { track: 'source', speakerLabels: 'off' })
  test('header row + quoted fields for quote/tab/newline carriers', () => {
    expect(out.split('\n')[0]).toBe('start\tend\tspeaker\ttext')
    expect(out).toContain('"tab\there\nsecond <line>"')
    expect(out).toContain('"quote ""and"" comma"')
  })
})

describe('CC-202.1: JSON canonical subset', () => {
  test('source track carries blocks+words+speakers, no track member', () => {
    const doc = JSON.parse(toJson(snap, { track: 'source', speakerLabels: 'off' })) as Record<string, unknown>
    expect(Array.isArray(doc.blocks)).toBe(true)
    expect(Array.isArray(doc.speakers)).toBe(true)
    expect(doc.track).toBeUndefined()
  })
  test('translation track carries ALL entries incl. status (JSON is lossless; SRT/VTT skip failed)', () => {
    const doc = JSON.parse(toJson(snap, { track: 'fr', speakerLabels: 'off' })) as { track: { language: string; entries: Record<string, { status: string }> } }
    expect(doc.track.language).toBe('fr')
    expect(doc.track.entries.b1?.status).toBe('translated')
    expect(doc.track.entries.b4?.status, 'JSON keeps failed entries (status carried, consumers decide)').toBe('failed')
  })
})

describe('CC-202.1: tracks and RTL', () => {
  test('unknown track ⇒ empty output (header-only VTT)', () => {
    expect(toVtt(snap, { track: 'de', speakerLabels: 'off' })).toBe('WEBVTT\n\n')
    expect(toSrt(snap, { track: 'de', speakerLabels: 'off' })).toBe('')
  })
  test('RTL translation tracks wrap cue text in RLE…PDF; source does not', () => {
    const ar = toSrt(snap, { track: 'ar', speakerLabels: 'off' })
    expect(ar).toContain('\u202Bمرحبا\u202C')
    expect(toSrt(snap, { track: 'source', speakerLabels: 'off' })).not.toContain('\u202B')
    const fr = toSrt(snap, { track: 'fr', speakerLabels: 'off' })
    expect(fr).not.toContain('\u202B')
  })
})

describe('US-3.2.1: filename contract {slug}[.{lang}].{ext}', () => {
  test('slugifies the project name; lang suffix only for translations', () => {
    expect(exportFileName(snap.name, 'source', 'srt')).toBe('veterans-q-a-part-2.srt')
    expect(exportFileName(snap.name, 'fr', 'vtt')).toBe('veterans-q-a-part-2.fr.vtt')
    expect(exportFileName('!!!', 'source', 'json')).toBe('captions.json')
    expect(exportFileName('Ünïcode — Café', 'ar', 'tsv')).toBe('n-code-caf.ar.tsv')
  })
})
