// Adversarial round (MALFORMED/STATEFUL-INTERLEAVING category): call/order
// statefulness of `importCaptions`. Contract: unit-07 FR-07.3 (line 45, pure
// `{ project, report }` mapping — "nothing here mutates it", import.ts:20-21),
// FR-07.5 (line 47, speaker-prefix dialog default "on when ≥ 30 % of cues
// match"), US-07.2 (line 26, detector "sample of cue text … ≤ 2 KB" — only
// for files "with no language metadata"), FR-07.2 (line 44, declared
// language from VTT `Language:`), frozen d.ts:143-148 (keepTranslations /
// "Called at most once, with a ≤ 2 KB cue-text sample"), import.ts:92-96
// (module-level `idSalt` counter behind the non-crypto id fallback) and
// d.ts:36-38 (ids are `crypto.randomUUID()`, golden normalization positional).
import { expect, test, vi } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { Project } from '@engine/model@07'
import { canonical, canonicalGolden } from '../canonical'
import { makeProject } from '../project-support'

const enc = new TextEncoder()
const NO_YIELD = async (): Promise<void> => undefined

const p2 = (value: number, width: number): string => String(value).padStart(width, '0')
const srtTime = (totalMs: number): string => `${p2(Math.floor(totalMs / 3_600_000), 2)}:${p2(Math.floor(totalMs / 60_000) % 60, 2)}:${p2(Math.floor(totalMs / 1_000) % 60, 2)},${p2(totalMs % 1_000, 3)}`

/** SRT from plain-text cue specs (index lines included, invariant 12 keeps order). */
function srtFile(name: string, cues: { start: number; end: number; text: string }[]): { name: string; bytes: Uint8Array } {
  const body = cues.map((cue, index) => `${index + 1}\n${srtTime(Math.round(cue.start * 1000))} --> ${srtTime(Math.round(cue.end * 1000))}\n${cue.text}`).join('\n\n')
  return { name, bytes: enc.encode(body) }
}

function sequentialFile(): { name: string; bytes: Uint8Array } {
  return srtFile('crossrun.srt', [
    { start: 0, end: 1, text: 'alpha one' },
    { start: 1.2, end: 2, text: 'beta two' },
    { start: 3, end: 4, text: 'gamma three' },
  ])
}

/** canonicalGolden normalizes block ids/speakerId REFERENCES but keeps speakers[].id raw (crypto.randomUUID) — compare speakers structurally (degenerate-round precedent). */
function comparableProject(project: Project): string {
  return canonicalGolden({ ...project, speakers: project.speakers.map((speaker) => ({ label: speaker.label, color: speaker.color })) })
}

test('ADVERSARIAL (stateful): importCaptions twice with the SAME file object and SAME source project — reports deep-equal, projects canonical-equal (ids normalized), every block/speaker id from run 1 is disjoint from run 2 (module-level idSalt/counter may not leak or reset across calls, import.ts:92-96 + d.ts:36-38), and neither the input project nor file.bytes is mutated (FR-07.3, import.ts:20-21 "nothing here mutates it")', async () => {
  const base = makeProject()
  const file = sequentialFile()
  const baseSnapshot = canonical(base)
  const bytesSnapshot = canonical(Array.from(file.bytes))

  const first = await importCaptions(base, file, { as: 'source', scheduleYield: NO_YIELD })
  const second = await importCaptions(base, file, { as: 'source', scheduleYield: NO_YIELD })

  expect(second.report, 'no state leaked into the second report').toEqual(first.report)
  expect(comparableProject(second.project), 'no state leaked into the second project').toBe(comparableProject(first.project))
  expect(first.project === second.project, 'distinct new project objects').toBe(false)
  expect(first.project === base, 'input never returned aliased').toBe(false)

  const idsOf = (outcome: { project: { blocks: { id: string }[]; speakers: { id: string }[] } }) => new Set<string>([...outcome.project.blocks.map((block) => block.id), ...outcome.project.speakers.map((speaker) => speaker.id)])
  const run1 = idsOf(first)
  const run2 = idsOf(second)
  for (const id of run2) expect(run1.has(id), `block/speaker id "${id}" reused across runs — cross-call counter leak`).toBe(false)
  expect(run1.size, 'run 1 ids unique').toBe(first.project.blocks.length + first.project.speakers.length)
  expect(run2.size, 'run 2 ids unique').toBe(second.project.blocks.length + second.project.speakers.length)

  expect(canonical(base), 'input project byte-identical after both calls').toBe(baseSnapshot)
  expect(canonical(Array.from(file.bytes)), 'input bytes untouched (decode never writes through)').toBe(bytesSnapshot)
})

test('ADVERSARIAL (stateful): concurrent importCaptions promises on the SAME project object — two source imports and one interleaved translation import fired unawaited from one untouched project; each outcome equals its sequential outcome (canonical, ids normalized), the source results carry no translation track and the translation result sees NONE of the source imports\' blocks (no cross-call state leak through the shared project object, FR-07.3 purity), and the shared input stays byte-identical', async () => {
  const base = makeProject()
  const baseSnapshot = canonical(base)
  const fileA = srtFile('a.srt', [
    { start: 0, end: 1, text: 'one two' },
    { start: 1.5, end: 2.5, text: 'three four' },
  ])
  const fileB = srtFile('b.srt', [
    { start: 0, end: 1, text: 'five six' },
    { start: 1.5, end: 2.5, text: 'seven eight' },
  ])
  const fileT = srtFile('t.srt', [{ start: 0, end: 1, text: 'uno dos' }])

  const [concurrentA, concurrentB, concurrentT] = await Promise.all([importCaptions(base, fileA, { as: 'source', scheduleYield: NO_YIELD }), importCaptions(base, fileB, { as: 'source', scheduleYield: NO_YIELD }), importCaptions(base, fileT, { as: { translation: 'es' }, scheduleYield: NO_YIELD })])

  const sequentialA = await importCaptions(base, fileA, { as: 'source', scheduleYield: NO_YIELD })
  const sequentialB = await importCaptions(base, fileB, { as: 'source', scheduleYield: NO_YIELD })
  const sequentialT = await importCaptions(base, fileT, { as: { translation: 'es' }, scheduleYield: NO_YIELD })

  expect(comparableProject(concurrentA.project), 'source A unaffected by the interleaved calls').toBe(comparableProject(sequentialA.project))
  expect(comparableProject(concurrentB.project), 'source B unaffected by the interleaved calls').toBe(comparableProject(sequentialB.project))
  expect(comparableProject(concurrentT.project), 'translation unaffected by the interleaved calls').toBe(comparableProject(sequentialT.project))
  expect(concurrentA.project.translations, 'source import never gains a translation from elsewhere').toEqual([])
  expect(concurrentB.project.translations).toEqual([])
  expect(concurrentT.project.blocks, 'the concurrent source imports\' blocks never bled into the translation result').toEqual([])
  expect(concurrentT.report.adjustments.find((adjustment) => adjustment.code === 'CUE_UNMATCHED')?.count, 'every cue unmatched against the untouched (empty) source track').toBe(1)

  expect(canonical(base), 'shared input project byte-identical across all concurrent calls').toBe(baseSnapshot)
})

test('ADVERSARIAL (stateful): speaker-prefix heuristic exactly at the 30 % FR-07.5 boundary — 3/10 matching cues (ratio = 0.3, "on when ≥ 30 %", unit-07 line 47) applies the prefix (labels, stripped text, speakerSource manual), 3/11 (≈ 0.273) does not (texts verbatim, no named speaker)', async () => {
  const cues = (total: number, prefixed: number) => Array.from({ length: total }, (_, index) => ({ start: index, end: index + 0.9, text: index % Math.ceil(total / prefixed) === 0 && index < prefixed * Math.ceil(total / prefixed) ? `ALEX: hello there ${index}` : `plain narration ${index}` }))
  const at30 = cues(10, 3)
  expect(at30.filter((cue) => cue.text.startsWith('ALEX:')).length, 'exactly 3 of 10').toBe(3)
  const on = await importCaptions(makeProject(), srtFile('p30.srt', at30), { as: 'source', scheduleYield: NO_YIELD })
  const labels = on.project.speakers.map((speaker) => speaker.label)
  expect(labels, 'the prefix label became a speaker at exactly 30 %').toContain('ALEX')
  expect(labels, 'unprefixed cues keep the Unknown speaker').toContain('Unknown')
  expect(on.project.speakerSource, 'named speaker seen → manual (invariant 5)').toBe('manual')
  const prefixedBlocks = on.project.blocks.filter((block) => !block.text.startsWith('plain narration'))
  expect(prefixedBlocks.length, 'the 3 matching cues were mapped').toBe(3)
  expect(prefixedBlocks.every((block) => /^hello there \d+$/.test(block.text)), 'prefix stripped from the text').toBe(true)
  expect(new Set(prefixedBlocks.map((block) => block.speakerId)).size, 'same label → same speaker id').toBe(1)

  const below = cues(11, 3)
  expect(below.filter((cue) => cue.text.startsWith('ALEX:')).length, 'exactly 3 of 11 (27.3 %)').toBe(3)
  const off = await importCaptions(makeProject(), srtFile('p27.srt', below), { as: 'source', scheduleYield: NO_YIELD })
  expect(off.project.speakers.map((speaker) => speaker.label), 'below 30 % the default is off — no named speaker').toEqual(['Unknown'])
  expect(off.project.blocks.every((block) => block.text.length > 0 && (block.text.startsWith('plain narration') || block.text.startsWith('ALEX: hello there'))), 'texts verbatim, prefix NOT stripped').toBe(true)
  expect(off.project.speakerSource, 'no named speaker mutation → source untouched (invariant 5)').toBe('none')
})

test('ADVERSARIAL (stateful): the LanguageDetector sample at exactly 2 048 UTF-8 bytes — three 682-char cues joined by "\\n" fill the ≤ 2 KB budget exactly (682×3 + 2 = 2048, US-07.2 line 26 / d.ts:146 "≤ 2 KB") and the fourth cue is excluded; the detector is called exactly once and its verdict lands in the report', async () => {
  const long682 = 'ab '.repeat(227) + 'c'
  expect(enc.encode(long682).byteLength).toBe(682)
  const cues = [
    { start: 0, end: 1, text: long682 },
    { start: 1, end: 2, text: long682 },
    { start: 2, end: 3, text: long682 },
    { start: 3, end: 4, text: 'tail cue' },
  ]
  const samples: string[] = []
  const outcome = await importCaptions(makeProject(), srtFile('det2048.srt', cues), { as: 'source', scheduleYield: NO_YIELD, detectLanguage: async (sample) => { samples.push(sample); return 'fr' } })
  expect(samples.length, 'called at most once (d.ts:146)').toBe(1)
  expect(enc.encode(samples[0]!).byteLength, 'exactly the 2 048-byte budget is admitted').toBe(2_048)
  expect(samples[0], 'the three fitting cues, newline-joined; the fourth excluded').toBe([long682, long682, long682].join('\n'))
  expect(outcome.report.detectedLanguage, 'detector verdict surfaces in the report').toBe('fr')
})

test('ADVERSARIAL (stateful): declared metadata wins over the detector when both are present — a VTT `Language:` header (FR-07.2 line 44) makes US-07.2 (line 26: detection is for files "with no language metadata") not fire the detector at all; translation-mode imports never invoke the detector either (import.ts:323)', async () => {
  const vtt = 'WEBVTT\nLanguage: es\n\n00:00:01.000 --> 00:00:02.000\nhola amigos\n'
  const calls: string[] = []
  const source = await importCaptions(makeProject(), { name: 'meta.vtt', bytes: enc.encode(vtt) }, { as: 'source', scheduleYield: NO_YIELD, detectLanguage: async (sample) => { calls.push(sample); return 'fr' } })
  expect(calls.length, 'metadata present → detector never invoked').toBe(0)
  expect(source.report.detectedLanguage, 'declared language wins').toBe('es')

  const translationCalls: string[] = []
  const seeded = await importCaptions(makeProject(), srtFile('seed.srt', [{ start: 0, end: 2, text: 'hola amigos' }]), { as: 'source', scheduleYield: NO_YIELD })
  const translation = await importCaptions(seeded.project, { name: 't.vtt', bytes: enc.encode(vtt.replace('Language: es\n', '')) }, { as: { translation: 'de' }, scheduleYield: NO_YIELD, detectLanguage: async (sample) => { translationCalls.push(sample); return 'fr' } })
  expect(translationCalls.length, 'translation mode never detects (US-07.2 is the source pre-selection)').toBe(0)
  expect(translation.report.detectedLanguage).toBeNull()
})

test('ADVERSARIAL (stateful): the non-crypto id fallback (import.ts:95) keeps the module-level idSalt monotonic ACROSS calls — two imports with `crypto.randomUUID` unavailable mint zero colliding block/speaker ids and speakers keep the SPK_ prefix (d.ts:36-38: golden normalization assumes durable, never-reused ids)', async () => {
  vi.stubGlobal('crypto', {})
  try {
    const base = makeProject()
    const file = sequentialFile()
    const first = await importCaptions(base, file, { as: 'source', scheduleYield: NO_YIELD })
    const second = await importCaptions(base, file, { as: 'source', scheduleYield: NO_YIELD })
    const firstIds = [...first.project.blocks.map((block) => block.id), ...first.project.speakers.map((speaker) => speaker.id)]
    const secondIds = [...second.project.blocks.map((block) => block.id), ...second.project.speakers.map((speaker) => speaker.id)]
    expect(first.project.speakers.every((speaker) => speaker.id.startsWith('SPK_')), 'fallback speaker ids keep the SPK_ prefix').toBe(true)
    const collisions = secondIds.filter((id) => firstIds.includes(id))
    expect(collisions, 'no id minted twice across the two fallback runs (idSalt never resets)').toEqual([])
    expect(new Set([...firstIds, ...secondIds]).size, 'all ids unique across both runs').toBe(firstIds.length + secondIds.length)
  } finally {
    vi.unstubAllGlobals()
  }
})
