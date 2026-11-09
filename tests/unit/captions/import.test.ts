// CC-07.1 (US-07.1 speakers/invariants) / FR-07.3 / FR-07.5 / FR-07.7 (L1):
// importCaptions behaviour through the public seam — source replacement,
// voices→speakers, translation-track mapping (max overlap, space-join,
// CUE_UNMATCHED, origin/status), the FR-07.5 speaker-prefix heuristic and its
// 30 % dialog default, the US-07.2 LanguageDetector seam, and the FR-07.7
// 2 000-cue yield contract. Goldens cover blocks+report (golden.test.ts);
// this file covers the PROJECT half.
import { expect, test } from 'vitest'
import { importCaptions, parseSpeakerPrefix, speakerPrefixStats } from '@engine/captions/import'
import type { Project } from '@engine/model@07'
import { canonical } from './canonical'
import { captionFile, makeBlock, makeProject, makeWord } from './project-support'

const utf8 = new TextEncoder()

function vttFile(name: string, cues: { start: number; end: number; text: string; voice?: string }[]): { name: string; bytes: Uint8Array } {
  const body = ['WEBVTT', '']
  for (const cue of cues) {
    const clock = (sec: number): string => {
      const ms = Math.round(sec * 1000)
      const pad = (v: number, w: number): string => String(v).padStart(w, '0')
      return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`
    }
    const text = cue.voice ? `<v ${cue.voice}>${cue.text}</v>` : cue.text
    body.push(`${clock(cue.start)} --> ${clock(cue.end)}`, text, '')
  }
  return { name, bytes: utf8.encode(`${body.join('\n')}\n`) }
}

// --- FR-07.3: source mode ---------------------------------------------------

test('FR-07.3 / US-07.1: source import replaces blocks, sets captionOrigin, keeps cue segmentation (invariant 12)', async () => {
  const existing = makeProject({
    blocks: [makeBlock(0, 5, [makeWord('stale', 0, 2), makeWord('transcript', 2, 5)])],
    speakers: [{ id: 'SPK_OLD', label: 'Old', color: '#fff' }],
    captionOrigin: 'transcribed',
  })
  const before = canonical(existing)
  const { project, report } = await importCaptions(existing, captionFile('captions/simple.srt'), { as: 'source' })
  expect(project.blocks).toHaveLength(2)
  expect(project.blocks[0]!.text).toBe('Hi there friends')
  expect(project.captionOrigin, 'US-07.1').toBe('imported')
  expect(report.blocks).toBe(2)
  expect(canonical(project.blocks.map((b) => b.id)), 'new block ids (replacement)').not.toBe(canonical(existing.blocks.map((b) => b.id)))
  expect(canonical(existing), 'input project object untouched — a new project is returned').toBe(before)
})

test('FR-07.3: existing translations are DROPPED on source replacement unless the user confirms keeping them', async () => {
  const withTranslations = (): Project => {
    const block = makeBlock(0, 5, [makeWord('stale', 0, 2), makeWord('transcript', 2, 5)], 'SPK_1', 'blk-old')
    return makeProject({
      blocks: [block],
      translations: [{ language: 'fr', origin: 'machine', engine: null, entries: { 'blk-old': { text: 'vieux', status: 'translated', sourceHash: 'a'.repeat(8) } } }],
    })
  }
  const dropped = await importCaptions(withTranslations(), captionFile('captions/simple.srt'), { as: 'source' })
  expect(dropped.project.translations, 'all entry keys would be unmatched → dropped by default').toEqual([])

  const kept = await importCaptions(withTranslations(), captionFile('captions/simple.srt'), { as: 'source', keepTranslations: true })
  expect(kept.project.translations).toHaveLength(1)
  expect(kept.project.translations[0]!.entries['blk-old'], 'confirmed keep leaves the entries as they were').toEqual({ text: 'vieux', status: 'translated', sourceHash: 'a'.repeat(8) })
})

test('US-07.1 / FR-07.3: VTT <v> voices become speakers — labels kept, stable distinct ids, speakerSource manual', async () => {
  const project = makeProject({ duration: 30 })
  const { project: imported, report } = await importCaptions(project, captionFile('captions/voices.vtt'), { as: 'source' })
  const labels = imported.speakers.map((speaker) => speaker.label)
  expect(labels, 'voices surface as speaker labels').toEqual(expect.arrayContaining(['Alex', 'Jo']))
  expect(imported.speakerSource, 'invariant 5: speaker mutation ⇒ manual').toBe('manual')
  const [first, second] = imported.blocks
  expect(first!.speakerId, 'cue 1 (Alex)').not.toBe(second!.speakerId)
  const alexBlocks = imported.blocks.filter((block) => block.speakerId === first!.speakerId)
  expect(alexBlocks).toHaveLength(1)
  for (const block of imported.blocks) {
    expect(imported.speakers.map((s) => s.id), 'every block.speakerId resolves').toContain(block.speakerId)
  }
  expect(report.blocks).toBe(2)
})

test('invariant 11: imported blocks are ordered and non-overlapping after clamping', async () => {
  const { project } = await importCaptions(makeProject({ duration: 30 }), captionFile('captions/overlap-zero-empty.srt'), { as: 'source' })
  for (let index = 1; index < project.blocks.length; index++) {
    expect(project.blocks[index]!.start, 'blocks ordered & non-overlapping').toBeGreaterThanOrEqual(project.blocks[index - 1]!.end - 1e-9)
  }
  const zero = project.blocks.find((block) => block.text === 'Tiny')
  expect(zero, 'zero-duration cue became 0.1 s (invariant 11)').toBeDefined()
  expect(zero!.end - zero!.start, 'zero-duration cue became 0.1 s (invariant 11)').toBeCloseTo(0.1, 3)
})

// --- FR-07.3: translation mode ----------------------------------------------

function translatedInto(): Project {
  return makeProject({
    duration: 30,
    blocks: [
      makeBlock(0, 2, [makeWord('alpha', 0, 1), makeWord('bravo', 1, 2)], 'SPK_1', 'blk-a'),
      makeBlock(3, 5, [makeWord('charlie', 3, 4), makeWord('delta', 4, 5)], 'SPK_1', 'blk-b'),
    ],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
  })
}

test('FR-07.3: translation cues map to the maximum-overlap source block; several cues space-join; unmatched are counted', async () => {
  const project = translatedInto()
  const { project: result, report } = await importCaptions(project, vttFile('fr.vtt', [
    { start: 1, end: 2, text: 'un deux' }, // overlaps blk-a [0,2] only
    { start: 3.2, end: 3.8, text: 'premier' }, // blk-b
    { start: 4.1, end: 4.6, text: 'deuxieme' }, // also blk-b → space-join
    { start: 20, end: 21, text: 'loin' }, // overlaps nothing → CUE_UNMATCHED
  ]), { as: { translation: 'fr' } })

  expect(result.blocks, 'source blocks untouched').toBe(project.blocks)
  expect(result.translations).toHaveLength(1)
  const track = result.translations[0]!
  expect(track.language).toBe('fr')
  expect(track.origin, 'human-authored import').toBe('imported')
  expect(Object.keys(track.entries).sort()).toEqual(['blk-a', 'blk-b'])
  expect(track.entries['blk-a']!.text).toBe('un deux')
  expect(track.entries['blk-b']!.text, 'several cues on one block space-join').toBe('premier deuxieme')
  expect(track.entries['blk-b']!.status, 'imported translation is human text, not machine').toBe('edited')
  expect(track.entries['blk-a']!.sourceHash).toBeTruthy()
  const unmatched = report.adjustments.find((a) => a.code === 'CUE_UNMATCHED')
  expect(unmatched?.count, 'cue overlapping no block is dropped and COUNTED (never silent)').toBe(1)
  expect(report.cues).toBe(4)
})

test('FR-07.3: at most one translation track per language — a second import replaces it', async () => {
  const first = await importCaptions(translatedInto(), vttFile('fr1.vtt', [{ start: 0, end: 2, text: 'un' }]), { as: { translation: 'fr' } })
  const second = await importCaptions(first.project, vttFile('fr2.vtt', [{ start: 0, end: 2, text: 'deux' }]), { as: { translation: 'fr' } })
  expect(second.project.translations).toHaveLength(1)
  expect(Object.values(second.project.translations[0]!.entries)[0]!.text).toBe('deux')
})

// --- US-07.2: language detection seam ---------------------------------------

test('US-07.2: without file metadata the injected detector is called once on a ≤ 2 KB sample', async () => {
  const samples: string[] = []
  const { report } = await importCaptions(makeProject({ duration: 30 }), captionFile('captions/simple.srt'), {
    as: 'source',
    detectLanguage: async (sample) => {
      samples.push(sample)
      return 'en'
    },
  })
  expect(samples, 'detection runs on a sample of cue text').toHaveLength(1)
  expect(new TextEncoder().encode(samples[0]!).byteLength, 'sample is ≤ 2 KB (US-07.2)').toBeLessThanOrEqual(2048)
  expect(report.detectedLanguage).toBe('en')
})

test('US-07.2 / FR-07.2: declared file language wins — the detector is not consulted', async () => {
  let detectorCalls = 0
  const { report } = await importCaptions(makeProject({ duration: 30 }), captionFile('captions/voices.vtt'), {
    as: 'source',
    detectLanguage: async () => {
      detectorCalls += 1
      return 'de'
    },
  })
  expect(detectorCalls, 'VTT Language: header already declares the language').toBe(0)
  expect(report.detectedLanguage).toBe('en')
})

test('US-07.2: no metadata and no detector (no LanguageDetector API) → detectedLanguage null, dialog asks', async () => {
  const { report } = await importCaptions(makeProject({ duration: 30 }), captionFile('captions/simple.srt'), { as: 'source' })
  expect(report.detectedLanguage).toBeNull()
})

// --- FR-07.5: speaker-prefix heuristic ---------------------------------------

test('FR-07.5: parseSpeakerPrefix recognizes [Name]:, NAME: and the "- " dialogue dash; rejects prose', () => {
  expect(parseSpeakerPrefix('[Alex]: Ready now go')).toEqual({ speaker: 'Alex', text: 'Ready now go' })
  expect(parseSpeakerPrefix('NARRATOR: Okay fine yes')).toEqual({ speaker: 'NARRATOR', text: 'Okay fine yes' })
  expect(parseSpeakerPrefix('- Ready now go')).toEqual({ speaker: '-', text: 'Ready now go' })
  expect(parseSpeakerPrefix('just ordinary caption prose'), 'plain text has no prefix').toBeNull()
  expect(parseSpeakerPrefix('MiXeD Case: not a name'), 'mixed case is not the NAME pattern').toBeNull()
  expect(parseSpeakerPrefix(''), 'empty line').toBeNull()
})

test('FR-07.5: the ≥ 30 % match ratio drives the dialog default', () => {
  const cues = (count: number, withPrefix: number) => Array.from({ length: count }, (_, index) => ({ start: index, end: index + 0.5, text: index < withPrefix ? `[Alex]: word ${index}` : `plain words ${index}`, lines: [] }))
  expect(speakerPrefixStats(cues(4, 3)), '3/4 matched').toEqual({ matchRatio: 0.75, suggestEnabled: true })
  expect(speakerPrefixStats(cues(4, 1)).suggestEnabled, '1/4 = 25 % below the 30 % default').toBe(false)
  expect(speakerPrefixStats(cues(10, 3)).suggestEnabled, 'exactly 30 % enables (≥)').toBe(true)
})

test('FR-07.5: with the heuristic on, prefixes are stripped from text and become speakers; off keeps the text', async () => {
  const on = await importCaptions(makeProject({ duration: 30 }), captionFile('captions/speakers-brackets.srt'), { as: 'source' })
  expect(on.project.blocks[0]!.text, 'auto ON at 75 % — prefix stripped').toBe('Ready now go')
  const labels = on.project.speakers.map((speaker) => speaker.label)
  expect(labels).toEqual(expect.arrayContaining(['Alex', 'Jo']))
  expect(on.project.speakerSource).toBe('manual')

  const off = await importCaptions(makeProject({ duration: 30 }), captionFile('captions/speakers-brackets.srt'), { as: 'source', speakerPrefixes: 'off' })
  expect(off.project.blocks[0]!.text, 'explicit off keeps the raw cue text').toBe('[Alex]: Ready now go')
})

// --- FR-07.7: yield every 2 000 cues ------------------------------------------

function bigSrt(cueCount: number): Uint8Array {
  const lines: string[] = []
  for (let index = 0; index < cueCount; index++) {
    const start = index
    lines.push(`${index + 1}`, `${padTime(start)} --> ${padTime(start + 0.5)}`, 'cue words here', '')
  }
  return utf8.encode(lines.join('\n'))
}
function padTime(sec: number): string {
  const ms = Math.round(sec * 1000)
  const pad = (v: number, w: number): string => String(v).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`
}

test('FR-07.7: parsing yields to the event loop at least once per 2 000 cues', async () => {
  let yields = 0
  const { report } = await importCaptions(makeProject({ duration: 60_000 }), { name: 'big.srt', bytes: bigSrt(4_500) }, { as: 'source', scheduleYield: async () => { yields += 1 } })
  expect(report.cues).toBe(4_500)
  expect(yields, '≥ one macrotask yield per completed 2 000-cue chunk (FR-07.7 no-main-thread-hang)').toBeGreaterThanOrEqual(2)
})
