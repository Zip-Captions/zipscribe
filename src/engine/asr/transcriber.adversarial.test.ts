// Adversary suite (unit-05 review): the windowed ASR pipeline at contract
// boundaries derived from FR-05.2 / FR-05.5 / FR-05.9 / US-1.2.2 / CC-05.9 —
// resumeFromSec exactly at window boundaries (recycle determinism), the
// exactly-0.35 s internal silence cut, the long-form recipe at exactly 28 s,
// hallucination-guard boundaries (n-gram copies at 3 vs 4, VAD speech at
// exactly 0.5 s), per-batch sorting, and explicit-language forcing.
import { describe, expect, test } from 'vitest'
import { transcribe, type EngineSession, type WindowCallOptions, type WindowOutput } from '@engine/asr/transcriber'
import type { AsrEvent, PcmChunk, RawSegment, VadSegment } from '@engine/protocol'

const SAMPLE_RATE = 16_000

function pcmStream(seconds: number): AsyncIterable<PcmChunk> {
  return (async function* () {
    for (let s = 0; s < seconds; s++) {
      await Promise.resolve()
      yield { startSec: s, samples: new Float32Array(SAMPLE_RATE) }
    }
  })()
}

interface EngineCall {
  start: number
  end: number
  audioLength: number
  options: WindowCallOptions
}

function scriptedSession(outputs: Map<string, WindowOutput | 'repeat-3' | 'repeat-4'>, defaultText = 'hello world'): { session: EngineSession; calls: EngineCall[] } {
  const calls: EngineCall[] = []
  const session: EngineSession = {
    transcribeWindow(start, end, audio, options) {
      calls.push({ start, end, audioLength: audio.length, options })
      const key = `${start.toFixed(6)}|${end.toFixed(6)}`
      const scripted = outputs.get(key)
      if (scripted === 'repeat-3' || scripted === 'repeat-4') {
        const copies = scripted === 'repeat-4' ? 4 : 3
        const words = Array.from({ length: copies }, (_, i) => ({ text: 'la', start: 0.1 + i * 0.3, end: 0.3 + i * 0.3, timing: 'asr' as const }))
        return Promise.resolve({ segments: [{ start: 0.1, end: 0.3 * copies, text: words.map((w) => w.text).join(' '), words }] })
      }
      if (scripted !== undefined) return Promise.resolve(scripted)
      const seg: RawSegment = { start: 0.05, end: Math.min(0.85, end - start), text: defaultText, words: [{ text: defaultText, start: 0.05, end: Math.min(0.85, end - start), timing: 'asr' }] }
      return Promise.resolve({ segments: [seg] })
    },
  }
  return { session, calls }
}

const spec = (language: string | null, languageDetect = false) => ({
  modelId: 'whisper-tiny-timestamped@5172442937' as const,
  device: 'wasm' as const,
  language,
  engineFlags: { confidence: false, punctuation: false, languageDetect },
})

async function run(seconds: number, vad: readonly VadSegment[], session: EngineSession, overrides: { resumeFromSec?: number; language?: string | null } = {}) {
  const events: AsrEvent[] = []
  const outcome = await transcribe(pcmStream(seconds), spec(overrides.language ?? 'en'), { vad, createSession: () => Promise.resolve(session), ...(overrides.resumeFromSec !== undefined ? { resumeFromSec: overrides.resumeFromSec } : {}) }, (e) => events.push(e))
  return { outcome, events }
}

describe('adversary: resumeFromSec exactly at window boundaries (CC-05.9 block-for-block, FR-05.3)', () => {
  const vad: VadSegment[] = [{ start: 0, end: 10 }, { start: 20, end: 30 }]
  // FR-05.1 packing: two clusters (10 s silence between), pad 0.2 both sides
  // clamped to silence midpoints → windows [0, 10.2] and [19.8, 30.2].
  test('resume at exactly the first window end skips ONLY that window and reproduces the tail block-for-block', async () => {
    const full = scriptedSession(new Map())
    const fullRun = await run(31, vad, full.session)
    const resumed = scriptedSession(new Map())
    const resumedRun = await run(31, vad, resumed.session, { resumeFromSec: 10.2 })

    expect(resumed.calls).toHaveLength(1)
    expect(resumed.calls[0]!.start).toBeCloseTo(19.8, 9)
    expect(resumed.calls[0]!.end).toBeCloseTo(30.2, 9)
    const fullTail = fullRun.outcome.segments.filter((s) => s.start >= 19.7)
    expect(resumedRun.outcome.segments).toEqual(fullTail) // block-for-block (CC-05.9)
    expect(resumedRun.outcome.ok).toBe(true)
    expect(resumed.calls[0]!.options).toEqual(full.calls[1]!.options) // identical engine options
  })

  test('resume just below the boundary re-runs the window it still overlaps (only fully-behind windows are skipped)', async () => {
    const { session, calls } = scriptedSession(new Map())
    const { outcome } = await run(31, vad, session, { resumeFromSec: 10.199 })
    expect(calls).toHaveLength(2) // window 1 ends at 10.2 > resume → re-run
    expect(outcome.ok).toBe(true)
  })

  test('resume past every window commits nothing but completes honestly (zero ASR calls)', async () => {
    const { session, calls } = scriptedSession(new Map())
    const { outcome, events } = await run(31, vad, session, { resumeFromSec: 30.2 })
    expect(calls).toHaveLength(0)
    expect(outcome.ok).toBe(true)
    expect(outcome.segments).toEqual([])
    expect(events.some((e) => e.t === 'job:done')).toBe(true)
  })

  test('zero VAD segments → zero engine calls (US-1.2.2: 45 s silence issues zero ASR calls)', async () => {
    const { session, calls } = scriptedSession(new Map())
    const { outcome } = await run(45, [], session)
    expect(calls).toHaveLength(0)
    expect(outcome.ok).toBe(true)
    expect(outcome.windowsCommitted).toBe(0)
  })
})

describe('adversary: the exactly-0.35 s internal silence cut (FR-05.1 legal cut / US-1.2.2 cut in silence)', () => {
  test('a 0.35 s gap is a legal cut: two engine calls, boundary ≥ 0.1 s from any speech, midpoint-clamped pads', async () => {
    const vad: VadSegment[] = [{ start: 0, end: 2 }, { start: 2.35, end: 4.35 }]
    const { session, calls } = scriptedSession(new Map())
    await run(5, vad, session)
    expect(calls).toHaveLength(2)
    // Pads clamp to the silence midpoint: pad = min(0.2, 0.35/2) = 0.175.
    expect(calls[0]!.end).toBeCloseTo(2.175, 9)
    expect(calls[1]!.start).toBeCloseTo(2.175, 9)
    // "no speech within ±0.1 s of a cut" (US-1.2.2): every VAD segment stays
    // at least 0.1 s clear of the shared boundary at 2.175.
    const cut = calls[0]!.end
    for (const s of vad) {
      expect(s.end <= cut - 0.1 || s.start >= cut + 0.1, `speech ${s.start}–${s.end} within 0.1 s of cut ${cut}`).toBe(true)
    }
    for (const c of calls) {
      expect(c.options.chunk_length_s, 'windows well under 28 s never carry the long-form recipe (FR-05.2)').toBeUndefined()
      expect(c.options.return_timestamps).toBe('word')
    }
  })
})

describe('adversary: the long-form recipe at exactly 28 s (FR-05.2 "only for windows > 28 s")', () => {
  test('a window of exactly 28.0 s does NOT carry chunk_length_s/stride_length_s', async () => {
    // Continuous single-cluster block [0.4, 28.0] (27.6 s) + 0.2 s pads both
    // sides (back pad clamped by the 0.4 s leading silence) → [0.2, 28.2].
    const vad: VadSegment[] = [{ start: 0.4, end: 28 }]
    const { session, calls } = scriptedSession(new Map())
    await run(29, vad, session)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.end - calls[0]!.start).toBeCloseTo(28, 9)
    expect(calls[0]!.options.chunk_length_s, 'window exactly at the ceiling is not > 28 s').toBeUndefined()
  })

  test('a hair past 28.0 s carries the vendored recipe', async () => {
    const vad: VadSegment[] = [{ start: 0.4, end: 28.001 }]
    const { session, calls } = scriptedSession(new Map())
    await run(29, vad, session)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options).toMatchObject({ chunk_length_s: 30, stride_length_s: 5 })
  })
})

describe('adversary: hallucination-guard boundaries (FR-05.9)', () => {
  test('exactly 4 copies of the same 1-gram is dropped; 3 copies are kept (boundary of "≥ 4 times")', async () => {
    const vad: VadSegment[] = [{ start: 0, end: 10 }]
    const bad = scriptedSession(new Map([['0.000000|10.200000', 'repeat-4' as const]]))
    const badRun = await run(11, vad, bad.session)
    expect(badRun.outcome.guardStats.repeatedNgramDropped).toBe(1)
    expect(badRun.outcome.segments).toEqual([])
    expect(badRun.outcome.windowsCommitted).toBe(0)
    expect(badRun.events.some((e) => e.t === 'job:segments')).toBe(false)

    const ok = scriptedSession(new Map([['0.000000|10.200000', 'repeat-3' as const]]))
    const okRun = await run(11, vad, ok.session)
    expect(okRun.outcome.guardStats.repeatedNgramDropped).toBe(0)
    expect(okRun.outcome.windowsCommitted).toBe(1)
  })

  test('VAD speech of exactly 0.5 s is kept; 0.49 s is dropped (boundary of "< 0.5 s")', async () => {
    const at = scriptedSession(new Map())
    const atRun = await run(3, [{ start: 1, end: 1.5 }], at.session)
    expect(atRun.outcome.guardStats.shortWindowDropped).toBe(0)
    expect(atRun.outcome.windowsCommitted).toBe(1)

    const below = scriptedSession(new Map())
    const belowRun = await run(3, [{ start: 1, end: 1.49 }], below.session)
    expect(belowRun.outcome.guardStats.shortWindowDropped).toBe(1)
    expect(belowRun.outcome.windowsCommitted).toBe(0)
  })
})

describe('adversary: per-batch ordering and language forcing (FR-05.5 / US-05.1)', () => {
  test('engine segments arriving out of order inside a window are emitted sorted (FR-05.5 "sorted")', async () => {
    const outOfOrder: WindowOutput = {
      segments: [
        { start: 0.7, end: 0.9, text: 'beta', words: [{ text: 'beta', start: 0.7, end: 0.9, timing: 'asr' }] },
        { start: 0.1, end: 0.3, text: 'alpha', words: [{ text: 'alpha', start: 0.1, end: 0.3, timing: 'asr' }] },
      ],
    }
    const { session } = scriptedSession(new Map([['0.000000|10.200000', outOfOrder]]))
    const { events } = await run(11, [{ start: 0, end: 10 }], session)
    const batch = events.find((e) => e.t === 'job:segments')
    if (batch === undefined || batch.t !== 'job:segments') throw new Error('no batch')
    expect(batch.segments.map((s) => s.start)).toEqual([0.1, 0.7]) // window-relative order fixed up
    // absolute offsets applied (FR-05.2)
    expect(batch.segments[0]!.start).toBeGreaterThan(0)
  })

  test('an explicit language stays forced on every call even when the engine can detect', async () => {
    const { session, calls } = scriptedSession(new Map())
    session.detectLanguage = () => Promise.resolve('de')
    const { outcome } = await run(11, [{ start: 0, end: 10 }], session, { language: 'fr' })
    expect(outcome.ok).toBe(true)
    for (const c of calls) expect(c.options.language, 'US-05.1: explicit language forces the engine').toBe('fr')
  })
})
