// FR-07.3 / FR-07.5 / FR-07.6 / FR-07.7 / US-07.2 (L1 seeds for
// src/engine/captions/import.ts): the frozen suites pin the headline flows;
// these seeds pin the typed-failure guards, the sniff tie-breaker, the
// translation-mode edges and the detector-seam contracts at this module's
// own level (and carry their coverage while the frozen errors suite is
// blocked on its unresolvable import — see the unit report BLOCKERS).
import { expect, test } from 'vitest'
import { importCaptions, parseSpeakerPrefix, speakerPrefixStats } from './import'
import type { Project } from '../model'

const utf8 = new TextEncoder()

function srt(cues: { start: number; end: number; text: string }[]): Uint8Array {
  const clock = (sec: number): string => {
    const ms = Math.round(sec * 1000)
    const pad = (v: number, w: number): string => String(v).padStart(w, '0')
    return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`
  }
  const lines: string[] = []
  cues.forEach((cue, index) => {
    lines.push(`${index + 1}`, `${clock(cue.start)} --> ${clock(cue.end)}`, cue.text, '')
  })
  return utf8.encode(lines.join('\n'))
}

function baseProject(): Project {
  const project = {
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
      duration: 600,
      width: 1920,
      height: 1080,
      fps: 25,
      fingerprint: { name: 'a.mp4', size: 1, durationMs: 600_000, sampleHashes: ['a', 'b', 'c'] },
    },
    blocks: [],
    captionOrigin: 'none',
    translations: [],
    speakers: [],
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
  } as unknown as Project
  return project
}

test('CC-07.6 / FR-07.7: 20 MiB + 1 byte → FILE_TOO_LARGE before any processing', async () => {
  let yields = 0
  await expect(
    importCaptions(
      baseProject(),
      { name: 'huge.srt', bytes: new Uint8Array(20 * 1024 * 1024 + 1) },
      {
        as: 'source',
        scheduleYield: () => {
          yields += 1
          return Promise.resolve()
        },
      },
    ),
  ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  expect(yields).toBe(0)
})

test('CC-07.6 / FR-07.1: bytes outside UTF-8/UTF-16/windows-1252 → ENCODING (codes only, no content)', async () => {
  const bytes = new Uint8Array([0x81, 0x8d, 0x8f, 0x90, 0x9d]) // undefined cp1252 positions
  const error = await importCaptions(baseProject(), { name: 'bin.srt', bytes }, { as: 'source' }).catch((error: unknown) => error)
  expect(error).toMatchObject({ code: 'ENCODING', name: 'CaptionFailure' })
  const message = JSON.stringify((error as Error).message) + JSON.stringify((error as { detail?: string }).detail)
  expect(message).not.toContain('\u0081')
})

test('CC-07.6 / FR-07.2: prose matching no format → UNRECOGNIZED_FORMAT', async () => {
  await expect(importCaptions(baseProject(), { name: 'prose.txt', bytes: utf8.encode('just prose here\nand more prose\n') }, { as: 'source' })).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
})

test('CC-07.6: the extension is only a tie-breaker — an .srt with no cues is still UNRECOGNIZED_FORMAT', async () => {
  await expect(importCaptions(baseProject(), { name: 'empty.srt', bytes: utf8.encode('nothing that parses here') }, { as: 'source' })).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
})

test('CC-07.6: valid JSON that violates the sidecar shape → UNRECOGNIZED_FORMAT, not a raw SyntaxError', async () => {
  await expect(importCaptions(baseProject(), { name: 'x.zipscribe.json', bytes: utf8.encode('{"blocks": [{"start": "nope", "end": 1, "text": "x"}]}') }, { as: 'source' })).rejects.toMatchObject({
    code: 'UNRECOGNIZED_FORMAT',
  })
})

test('FR-07.7: > 100 000 cues → TOO_MANY_CUES; 100 000 cues import fine', async () => {
  const many = (count: number): Uint8Array => srt(Array.from({ length: count }, (_, index) => ({ start: index, end: index + 0.5, text: 'a b' })))
  await expect(importCaptions(baseProject(), { name: 'over.srt', bytes: many(100_001) }, { as: 'source', scheduleYield: () => Promise.resolve() })).rejects.toMatchObject({ code: 'TOO_MANY_CUES' })
  const { report } = await importCaptions(baseProject(), { name: 'exact.srt', bytes: many(100_000) }, { as: 'source', scheduleYield: () => Promise.resolve() })
  expect(report.cues).toBe(100_000)
})

test("FR-07.5: parseSpeakerPrefix accepts A–Z 0–9 space . ' - runs and trims bracket names; rejects lowercase", () => {
  expect(parseSpeakerPrefix("[O'Brien]: Hello there")).toEqual({ speaker: "O'Brien", text: 'Hello there' })
  expect(parseSpeakerPrefix('[ Alex ]: Hello')).toEqual({ speaker: 'Alex', text: 'Hello' })
  expect(parseSpeakerPrefix('DR. WHO 2: Hello')).toEqual({ speaker: 'DR. WHO 2', text: 'Hello' })
  expect(parseSpeakerPrefix('lower: x'), 'lowercase is prose').toBeNull()
  expect(parseSpeakerPrefix('- '), 'bare dash yields the literal dash label').toEqual({ speaker: '-', text: '' })
})

test('FR-07.5: stats on an empty file default to 0 / disabled', () => {
  expect(speakerPrefixStats([])).toEqual({ matchRatio: 0, suggestEnabled: false })
})

test('FR-07.5: explicit "on" applies the heuristic below the 30 % auto threshold', async () => {
  const bytes = srt([
    { start: 0, end: 1, text: '[Alex]: One two three' },
    { start: 1, end: 2, text: 'Four five' },
    { start: 2, end: 3, text: 'Six seven' },
    { start: 3, end: 4, text: 'Eight nine' },
  ])
  const auto = await importCaptions(baseProject(), { name: 'low.srt', bytes }, { as: 'source' })
  expect(auto.project.blocks[0]!.text, '25 % < 30 % ⇒ auto OFF keeps the prefix').toBe('[Alex]: One two three')
  const forced = await importCaptions(baseProject(), { name: 'low.srt', bytes }, { as: 'source', speakerPrefixes: 'on' })
  expect(forced.project.blocks[0]!.text).toBe('One two three')
  expect(forced.project.speakerSource).toBe('manual')
})

test('US-07.2: the detector gets one ≤ 2 KB sample; its null answer is reported as null', async () => {
  const bytes = srt(Array.from({ length: 400 }, (_, index) => ({ start: index, end: index + 0.5, text: `cue number ${index} with plenty of words to exceed two kilobytes quickly` })))
  let calls = 0
  let sample = ''
  const { report } = await importCaptions(
    baseProject(),
    { name: 'long.srt', bytes },
    {
      as: 'source',
      scheduleYield: () => Promise.resolve(),
      detectLanguage: (s) => {
        calls += 1
        sample = s
        return Promise.resolve(null)
      },
    },
  )
  expect(calls).toBe(1)
  expect(utf8.encode(sample).byteLength).toBeLessThanOrEqual(2048)
  expect(report.detectedLanguage).toBeNull()
})

test('FR-07.3: translation ties resolve to the first block and other-language tracks survive', async () => {
  const project = baseProject()
  project.blocks = [
    { id: 'blk-x', start: 0, end: 2, text: 'one', words: [], speakerId: 'SPK_1' },
    { id: 'blk-y', start: 2, end: 4, text: 'two', words: [], speakerId: 'SPK_1' },
  ]
  project.translations = [{ language: 'de', origin: 'machine', engine: null, entries: { 'blk-x': { text: 'eins', status: 'translated', sourceHash: 'deadbeef' } } }]
  const vtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhola\n\n00:00:02.000 --> 00:00:04.000\nadios\n`
  const { project: result, report } = await importCaptions(project, { name: 'es.vtt', bytes: utf8.encode(vtt) }, { as: { translation: 'es' } })
  const track = result.translations.find((t) => t.language === 'es')!
  expect(Object.keys(track.entries).sort()).toEqual(['blk-x', 'blk-y'])
  expect(result.translations, 'the de track survives untouched').toHaveLength(2)
  expect(report.blocks, 'translation mode never changes block count').toBe(2)
})

test('FR-07.3: source import with no cues still replaces blocks and marks the origin imported', async () => {
  const project = baseProject()
  project.blocks = [{ id: 'blk-old', start: 0, end: 1, text: 'stale', words: [], speakerId: 'SPK_1' }]
  const { project: result, report } = await importCaptions(project, { name: 'empty.json', bytes: utf8.encode('{"blocks": []}') }, { as: 'source' })
  expect(result.blocks).toEqual([])
  expect(result.captionOrigin).toBe('imported')
  expect(report.cues).toBe(0)
  expect(report.adjustments).toEqual([])
})

test('invariant 11: a clamp that pushes the earlier cue below its own start also counts the zero-duration fix', async () => {
  const bytes = srt([
    { start: 4.2, end: 5, text: 'later one' },
    { start: 4, end: 4.5, text: 'earlier start' },
  ])
  const { report } = await importCaptions(baseProject(), { name: 'weird.srt', bytes }, { as: 'source' })
  expect(report.adjustments).toEqual([
    { code: 'OVERLAP_CLAMPED', count: 1 },
    { code: 'ZERO_DURATION_FIXED', count: 1 },
  ])
})

test('FR-07.2 scan: a 4-digit-hour VTT timing with cue settings counts POSITION_DROPPED (scan mirrors the parser hours quantifier)', async () => {
  // The parser accepts 4+ digit hours (vtt.ts \d+ per W3C webvtt1 §4.1, no
  // cap); the settings scan must not cap them shorter or the position setting
  // goes unreported on exactly the cues the parser accepts.
  const bytes = utf8.encode('WEBVTT\n\n1234:00:00.000 --> 1234:00:02.000 position:50%\nlate hour\n')
  const { report } = await importCaptions(baseProject(), { name: 'long-hour.vtt', bytes }, { as: 'source' })
  expect(report.cues, 'the parser accepts the 4-digit-hour cue').toBe(1)
  expect(report.adjustments).toEqual([{ code: 'POSITION_DROPPED', count: 1 }])
})
