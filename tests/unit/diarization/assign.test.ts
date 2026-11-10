// CC-06.4 CC-06.6 (L1): the pure speaker-assignment + mutation APIs of
// `src/engine/diarize/assign.ts` (FR-06.3 word-time majority with 0.25 s
// hysteresis, US-1.3.2 rename/reassign/merge/split, FR-06.5 palette) — frozen
// shapes in ./unit06-api-contract.d.ts, majority/reassignWords semantics
// frozen by src/state/commands/deps.ts:14-25 + src/state/CONTRACT.md § speaker-*
// family. The module does not exist yet: every test resolves it through a
// DYNAMIC import and fails with the module-resolution error (sanctioned
// unit-05 RED precedent). In/out GOLDENS are test-authored under
// fixtures/golden/diarization/ (CC-06.4 "golden-tested").
//
// Gates-child run: skipped under ZIPSCRIBE_CHILD=1 (builder owns
// vitest.config.ts; in-file guard per gates.test.ts:31 precedent).
//
// SECURITY-03: word texts here are synthetic placeholders authored for this
// test — no ground-truth content; failure messages cite indices only.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { REPO_ROOT, isChildRun } from '../../helpers/repo'
import type { CaptionBlock, Project, WordToken } from '@engine/model@06'
import type { DiarFrames } from '@engine/protocol@06'

const gated = isChildRun() ? describe.skip : describe

type AssignModule = typeof import('@engine/diarize/assign')

async function loadAssign(): Promise<AssignModule> {
  return (await import('@engine/diarize/assign')) as AssignModule
}

function golden<T>(name: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures/golden', 'diarization', name), 'utf8')) as T
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  }
  return value
}

/** blockize mints `crypto.randomUUID()` ids for split parts (unit-05 contract) —
 *  non-deterministic by design, so split goldens compare position-normalized ids. */
function normalizeBlockIds(blocks: CaptionBlock[]): CaptionBlock[] {
  return blocks.map((block, index) => ({ ...block, id: `ID#${index}` }))
}

function checkInvariants1to3(blocks: CaptionBlock[]): void {
  for (const block of blocks) {
    expect(block.start, `block start < end (invariant 1, index ${blocks.indexOf(block)})`).toBeLessThan(block.end)
    for (let i = 0; i < block.words.length; i++) {
      const w = block.words[i]!
      expect(w.start, 'word start ≤ word end (invariant 1)').toBeLessThanOrEqual(w.end)
      if (i > 0) expect(block.words[i - 1]!.start <= w.start, 'words sorted (invariant 1)').toBe(true)
      expect(w.start + 1e-9, 'words within block bounds (invariant 1)').toBeGreaterThanOrEqual(block.start)
      expect(w.end - 1e-9, 'words within block bounds (invariant 1)').toBeLessThanOrEqual(block.end)
    }
    const joined = block.words.map((w, i) => (i > 0 ? (block.words[i - 1]!.breakAfter === true ? '\n' : ' ') : '') + w.text).join('')
    expect(block.text, 'text == words joined (invariant 2)').toBe(joined)
  }
  for (let i = 0; i + 1 < blocks.length; i++) {
    expect(blocks[i]!.end, 'blocks ordered & non-overlapping (invariant 1)').toBeLessThanOrEqual(blocks[i + 1]!.start)
  }
}

gated('FR-06.3 assignSpeakers: word-time majority, hysteresis, boundary-snapped splits', () => {
  test('CC-06.4 CC-06.6: a two-run block splits at the word boundary, never mid-word (golden)', async () => {
    const { assignSpeakers } = await loadAssign()
    const input = golden<{ blocks: CaptionBlock[]; frames: DiarFrames }>('assign-speakers.in.json')
    const expected = golden<CaptionBlock[]>('assign-speakers.out.json')
    const frozen = deepFreeze(structuredClone(input))
    const out = assignSpeakers(frozen.blocks, frozen.frames)
    expect(normalizeBlockIds(out)).toEqual(expected)
    checkInvariants1to3(out)
    expect(out).toHaveLength(2)
    const splitWordTexts = out.map((b) => b.words.map((w) => w.text))
    expect(splitWordTexts, 'the speaker run boundary is a WORD boundary — no word is shared or split').toEqual([['one', 'two', 'three'], ['four', 'five', 'six']])
    expect(out[0]!.end, 'boundary snapped between words (part1 ends before the first part-2 word starts)').toBeLessThanOrEqual(out[1]!.words[0]!.start)
  })

  test('CC-06.4 CC-06.6: an untouched block passes through with its id preserved (golden)', async () => {
    const { assignSpeakers } = await loadAssign()
    const input = golden<{ blocks: CaptionBlock[]; frames: DiarFrames }>('assign-no-split.in.json')
    const expected = golden<CaptionBlock[]>('assign-no-split.out.json')
    const out = assignSpeakers(deepFreeze(structuredClone(input)).blocks, structuredClone(input.frames))
    expect(out).toEqual(expected)
    expect(out[0]!.id, 'no split → the stable block id survives (invariant: ids are durable)').toBe(input.blocks[0]!.id)
    checkInvariants1to3(out)
  })

  test('CC-06.4: 0.25 s hysteresis suppresses a boundary flap (golden)', async () => {
    const { assignSpeakers, DIAR_HYSTERESIS_SEC } = await loadAssign()
    expect(DIAR_HYSTERESIS_SEC, 'FR-06.3 hysteresis constant').toBe(0.25)
    const input = golden<{ blocks: CaptionBlock[]; frames: DiarFrames }>('assign-hysteresis.in.json')
    const expected = golden<CaptionBlock[]>('assign-hysteresis.out.json')
    const out = assignSpeakers(deepFreeze(structuredClone(input)).blocks, structuredClone(input.frames))
    expect(normalizeBlockIds(out)).toEqual(expected)
    expect(out[0]!.words[1]!.speakerId, 'the flap word (margin < 0.25 s over the previous speaker) carries the previous speaker').toBe('SPK_1')
    checkInvariants1to3(out)
  })

  test('CC-06.4: word without frame overlap keeps its existing speakerId; block majority uses frozen semantics', async () => {
    const { assignSpeakers } = await loadAssign()
    const words: WordToken[] = [
      { text: 'aa', start: 0.5, end: 1.0, speakerId: 'SPK_2' },
      { text: 'bb', start: 1.2, end: 1.7 },
    ]
    const blocks: CaptionBlock[] = [{ id: 'blk_x', start: 0.5, end: 1.7, text: 'aa bb', words, speakerId: 'SPK_2' }]
    const frames: DiarFrames = { speakers: 1, frames: [{ start: 0.4, end: 1.1, speaker: 0, prob: 0.8 }] }
    const out = assignSpeakers(structuredClone(blocks), structuredClone(frames))
    expect(out, 'one assigned speaker → single run → no split (pass-through block)').toHaveLength(1)
    expect(out[0]!.words[0]!.speakerId, 'overlapping word takes the frame cluster id').toBe('SPK_1')
    expect(out[0]!.words[1]!.speakerId, 'no overlapping frames → untouched (contract-pinned)').toBeUndefined()
    expect(out[0]!.speakerId, 'block.speakerId = majority over the word speakerIds').toBe('SPK_1')
    expect(out[0]!.start, 'no split → bounds pass through untouched').toBe(0.5)
    expect(out[0]!.id).toBe('blk_x')
  })

  test('CC-06.4 CC-06.6: assignSpeakers is pure and synchronous (project/blocks never mutated)', async () => {
    const { assignSpeakers } = await loadAssign()
    const input = golden<{ blocks: CaptionBlock[]; frames: DiarFrames }>('assign-speakers.in.json')
    const frozen = deepFreeze(structuredClone(input))
    const before = structuredClone(input)
    const out = assignSpeakers(frozen.blocks, frozen.frames)
    expect(input, 'input deep-equal after the call').toEqual(before)
    expect(out, 'result is not a Promise (zero async)').not.toBeInstanceOf(Promise)
    expect(Array.isArray(out)).toBe(true)
  })

  test('CC-06.4 CC-06.6: frame cluster ids map onto durable SPK_<n> word ids', async () => {
    const { assignSpeakers } = await loadAssign()
    const words: WordToken[] = [{ text: 'go', start: 0.2, end: 0.8 }]
    const blocks: CaptionBlock[] = [{ id: 'blk_c', start: 0.2, end: 0.8, text: 'go', words, speakerId: '' }]
    const frames: DiarFrames = { speakers: 3, frames: [{ start: 0.0, end: 1.0, speaker: 2, prob: 0.95 }] }
    const out = assignSpeakers(blocks, frames)
    expect(out[0]!.words[0]!.speakerId, 'cluster 2 → SPK_3 (0-based cluster → 1-based durable id)').toBe('SPK_3')
  })
})

gated('FR-06.3 deps.ts seam: majoritySpeakerId / reassignWords (frozen semantics)', () => {
  function w(text: string, speakerId?: string): WordToken {
    return { text, start: 0, end: 1, ...(speakerId === undefined ? {} : { speakerId }) }
  }

  test('CC-06.4: majority counts occurrences — most wins, ties go earliest-in-word-order, undefined skipped', async () => {
    const { majoritySpeakerId } = await loadAssign()
    expect(majoritySpeakerId([w('a', 'SPK_2'), w('b', 'SPK_2'), w('c', 'SPK_1')], 'SPK_9')).toBe('SPK_2')
    expect(majoritySpeakerId([w('a', 'SPK_2'), w('b', 'SPK_1')], 'SPK_9'), 'tie → earliest in word order').toBe('SPK_2')
    expect(majoritySpeakerId([w('a'), w('b', 'SPK_1'), w('c')], 'SPK_9'), 'speakerId === undefined words are skipped').toBe('SPK_1')
  })

  test('CC-06.4: none at all (or empty input) → fallback', async () => {
    const { majoritySpeakerId } = await loadAssign()
    expect(majoritySpeakerId([], 'SPK_7')).toBe('SPK_7')
    expect(majoritySpeakerId([w('a'), w('b')], 'SPK_7')).toBe('SPK_7')
  })

  test('CC-06.4 CC-06.6: reassignWords moves only from→to, is pure, and preserves everything else', async () => {
    const { reassignWords } = await loadAssign()
    const words: WordToken[] = [
      { text: 'a', start: 0, end: 1, speakerId: 'SPK_1', probability: 0.5 },
      { text: 'b', start: 1, end: 2, speakerId: 'SPK_2' },
      { text: 'c', start: 2, end: 3 },
    ]
    const frozen = deepFreeze(structuredClone(words))
    const before = structuredClone(words)
    const out = reassignWords(frozen, 'SPK_1', 'SPK_2')
    expect(out, 'every SPK_1 word became SPK_2; the untouched words are deep-equal').toEqual([
      { text: 'a', start: 0, end: 1, speakerId: 'SPK_2', probability: 0.5 },
      { text: 'b', start: 1, end: 2, speakerId: 'SPK_2' },
      { text: 'c', start: 2, end: 3 },
    ])
    expect(words, 'input array never mutated').toEqual(before)
    expect(out).not.toBe(words)
    expect(reassignWords(structuredClone(words), 'SPK_404', 'SPK_2'), 'no match → deep-equal copy').toEqual(before)
  })
})

gated('US-1.3.2 pure mutation APIs (CC-06.4 golden-tested, CC-06.6 pure coverage)', () => {
  test('CC-06.4: renameSpeaker updates the label everywhere — ids untouched (golden)', async () => {
    const { renameSpeaker } = await loadAssign()
    const input = golden<{ project: Project; args: { speakerId: string; label: string } }>('rename-speaker.in.json')
    const expected = golden<Project>('rename-speaker.out.json')
    const project = deepFreeze(structuredClone(input.project))
    const out = renameSpeaker(project, input.args.speakerId, input.args.label)
    expect(out).toEqual(expected)
    expect(out.speakers.map((s) => s.id), 'invariant 4: renaming never touches ids').toEqual(input.project.speakers.map((s) => s.id))
    expect(out.speakerSource, 'FR-06.5/invariant 5: a manual mutation flips speakerSource').toBe('manual')
    expect(out, 'pure: not the same object').not.toBe(project)
  })

  test('CC-06.4: reassign changes ONLY the range words + resulting block majority (golden)', async () => {
    const { reassign } = await loadAssign()
    const input = golden<{ project: Project; args: { blockId: string; wordRange: readonly [number, number]; toId: string } }>('reassign.in.json')
    const expected = golden<Project>('reassign.out.json')
    const out = reassign(deepFreeze(structuredClone(input.project)), input.args.blockId, input.args.wordRange, input.args.toId)
    expect(out).toEqual(expected)
    const target = out.blocks.find((b) => b.id === input.args.blockId)!
    expect(target.words[0]!.speakerId, 'words outside the range are untouched').toBe('SPK_1')
    expect(target.words[2]!.speakerId).toBe('SPK_1')
    expect(target.words[2]!.start, 'word timings never change under reassign').toBe(input.project.blocks[0]!.words[2]!.start)
  })

  test('CC-06.4: mergeSpeakers moves ALL of b to a and removes b (golden)', async () => {
    const { mergeSpeakers } = await loadAssign()
    const input = golden<{ project: Project; args: { a: string; b: string } }>('merge-speakers.in.json')
    const expected = golden<Project>('merge-speakers.out.json')
    const out = mergeSpeakers(deepFreeze(structuredClone(input.project)), input.args.a, input.args.b)
    expect(out).toEqual(expected)
    expect(out.speakers.some((s) => s.id === input.args.b), 'speaker b is removed').toBe(false)
    expect(out.speakers.some((s) => s.id === input.args.a), 'speaker a survives').toBe(true)
    for (const block of out.blocks) {
      for (const word of block.words) expect(word.speakerId, 'no word keeps the merged-away id').not.toBe(input.args.b)
    }
  })

  test('CC-06.4: splitSpeaker moves from-words at/after cutTime to a new speaker (golden)', async () => {
    const { splitSpeaker } = await loadAssign()
    const input = golden<{ project: Project; args: { from: string; cutTime: number; newColor: string } }>('split-speaker.in.json')
    const expected = golden<Project>('split-speaker.out.json')
    const out = splitSpeaker(deepFreeze(structuredClone(input.project)), input.args.from, input.args.cutTime, input.args.newColor)
    expect(out).toEqual(expected)
    const created = out.speakers.at(-1)!
    expect(created.color, 'the new speaker takes the caller-provided color').toBe(input.args.newColor)
    expect(created.label, 'labels stay "Speaker N" over the next free number').toBe('Speaker 3')
    expect(out.speakers).toHaveLength(input.project.speakers.length + 1)
    const target = out.blocks.find((b) => b.id === 'blk_s')!
    for (const word of target.words) {
      if (word.start >= input.args.cutTime) expect(word.speakerId, `word at ${word.start} is at/after cutTime → new speaker`).toBe(created.id)
      else expect(word.speakerId, `word at ${word.start} is before cutTime → stays with from`).toBe(input.args.from)
    }
  })

  test('CC-06.4 CC-06.6: all four mutation APIs are pure project-in/project-out, zero async', async () => {
    const { renameSpeaker, reassign, mergeSpeakers, splitSpeaker } = await loadAssign()
    const input = golden<{ project: Project }>('rename-speaker.in.json')
    const before = structuredClone(input.project)
    for (const result of [renameSpeaker(deepFreeze(structuredClone(input.project)), 'SPK_2', 'Alex'), reassign(structuredClone(input.project), 'blk_a', [0, 0], 'SPK_2'), mergeSpeakers(structuredClone(input.project), 'SPK_1', 'SPK_2'), splitSpeaker(structuredClone(input.project), 'SPK_1', 1.9, '#334455')]) {
      expect(result, 'plain Project, never a Promise').not.toBeInstanceOf(Promise)
      expect(typeof result, 'project in → project out').toBe('object')
    }
    expect(input.project, 'none of the four touched the shared input').toEqual(before)
  })

  test('CC-06.4 CC-06.6: unknown ids are total no-ops at the pure layer (commands own the reject codes)', async () => {
    const { renameSpeaker, mergeSpeakers, splitSpeaker } = await loadAssign()
    const input = golden<{ project: Project }>('rename-speaker.in.json')
    const before = structuredClone(input.project)
    expect(renameSpeaker(structuredClone(input.project), 'SPK_404', 'Ghost'), 'no such speaker → no change').toEqual(before)
    expect(mergeSpeakers(structuredClone(input.project), 'SPK_404', 'SPK_405')).toEqual(before)
    expect(splitSpeaker(structuredClone(input.project), 'SPK_404', 1.5, '#445566'), 'no `from` words → no ghost speaker appended').toEqual(before)
  })
})

gated('FR-06.5 palette + speaker materialization', () => {
  test('CC-06.4 CC-06.6: 8 deterministic distinct palette colors; labels are "Speaker N" (no hex hardcoded in this test)', async () => {
    const { SPEAKER_PALETTE, speakersFromClusters } = await loadAssign()
    expect(SPEAKER_PALETTE).toHaveLength(8)
    expect(new Set(SPEAKER_PALETTE).size, '8 distinct colors').toBe(8)
    for (const color of SPEAKER_PALETTE) expect(color, 'stable #rrggbb shape (values NOT pinned here — determinism only)').toMatch(/^#[0-9a-f]{6}$/)
    expect(speakersFromClusters(0)).toEqual([])
    const three = speakersFromClusters(3)
    expect(three.map((s) => s.label), 'US-1.3.2 labels').toEqual(['Speaker 1', 'Speaker 2', 'Speaker 3'])
    expect(three.map((s) => s.id)).toEqual(['SPK_1', 'SPK_2', 'SPK_3'])
    expect(three.map((s) => s.color), 'colors come from the palette itself').toEqual([SPEAKER_PALETTE[0], SPEAKER_PALETTE[1], SPEAKER_PALETTE[2]])
    expect(speakersFromClusters(3), 'deterministic: same call → same output').toEqual(three)
    expect(speakersFromClusters(9)[8]!.color, 'beyond 8 speakers the palette cycles (8 colors, unbounded speakers)').toBe(SPEAKER_PALETTE[0])
  })
})
