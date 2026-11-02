// CC-05.4 (VAD-gate half), CC-05.11, FR-05.2/FR-05.5, US-05.1, US-1.2.2 (L1):
// the engine-agnostic `transcribe(stream, spec, opts, onEvent)` driven through
// its contract-declared DI seams — an injected scripted `EngineSession` and
// injected VAD segments. Nothing of the thing under test is mocked: the
// windowing → per-window-call → offset → guard → event-stream pipeline is the
// real code; only the SDK boundary (the engine session) is faked, exactly as
// conventions § Mocks and fakes prescribes.
//
// Binding unit-02 finding: transformers.js 3.8.1 silently truncates > 30 s
// audio when chunking is off — the `chunk_length_s: 30, stride_length_s: 5`
// recipe MUST be passed for windows > 28 s (docs/overnight-reports/unit-2.md
// "3.8.1 silent >30 s truncation"; pipeline option names verified against the
// pinned 3.8.1 source, src/pipelines.js, and
// https://huggingface.co/docs/transformers.js/main/en/api/pipelines/automatic-speech-recognition).
import { expect, test } from 'vitest'
import { transcribe, type EngineSession, type TranscribeOutcome, type WindowCallOptions, type WindowOutput } from '@engine/asr/transcriber'
import type { AsrEvent, PcmChunk, RawSegment, VadSegment } from '@engine/protocol@05'

const SAMPLE_RATE = 16_000
const EPS = 1e-6

interface SessionCall {
  start: number
  end: number
  options: WindowCallOptions
}

interface FakeSession {
  session: EngineSession
  calls: SessionCall[]
}

function makeSession(
  plan: (start: number, end: number) => WindowOutput,
  detect?: (audio: Float32Array) => Promise<string>,
): FakeSession {
  const calls: SessionCall[] = []
  const session: EngineSession = {
    async transcribeWindow(start, end, audio, options) {
      calls.push({ start, end, options })
      return plan(start, end)
    },
  }
  if (detect) session.detectLanguage = async (audio) => detect(audio)
  return { session, calls }
}

async function* pcmStream(seconds: number, startSec = 0): AsyncGenerator<PcmChunk> {
  for (let at = startSec; at < startSec + seconds; at += 1) {
    const samples = new Float32Array(SAMPLE_RATE)
    for (let i = 0; i < samples.length; i++) samples[i] = ((i % 97) - 48) / 97 // deterministic filler, no content
    yield { startSec: at, samples }
  }
}

const NO_FLAGS = { confidence: false, punctuation: false, languageDetect: false }

function spec(language: string | null, languageDetect = false) {
  return { modelId: 'whisper-tiny-timestamped@5172442937', device: 'wasm' as const, language, engineFlags: { ...NO_FLAGS, languageDetect } }
}

/** A plausible window output: three words with WINDOW-RELATIVE times. */
function windowOutput(prefix: string, start: number, end: number): WindowOutput {
  const span = end - start
  const mk = (text: string, from: number, to: number): RawSegment['words'][number] => ({
    text: `${prefix}-${text}`,
    start: from * span,
    end: to * span,
    timing: 'asr',
  })
  return {
    segments: [
      { start: 0.1 * span, end: 0.9 * span, text: `${prefix} alpha bravo charlie`, words: [mk('alpha', 0.1, 0.3), mk('bravo', 0.35, 0.6), mk('charlie', 0.65, 0.9)] },
    ],
  }
}

function collectedSegments(events: readonly AsrEvent[]): RawSegment[] {
  const out: RawSegment[] = []
  for (const event of events) if (event.t === 'job:segments') out.push(...event.segments)
  return out
}

async function runTranscribe(
  seconds: number,
  vad: readonly VadSegment[],
  fake: FakeSession,
  options: { language?: string | null; languageDetect?: boolean } = {},
): Promise<{ outcome: TranscribeOutcome; events: AsrEvent[] }> {
  const events: AsrEvent[] = []
  const outcome = await transcribe(pcmStream(seconds), spec(options.language ?? 'en', options.languageDetect ?? false), { vad, createSession: async () => fake.session }, (event) => events.push(event))
  return { outcome, events }
}

test('FR-05.2 / US-1.2.2: one engine call per window with { return_timestamps:"word", language, task:"transcribe" } and NO chunk recipe ≤ 28 s', async () => {
  const fake = makeSession((start, end) => windowOutput('w', start, end))
  const { outcome, events } = await runTranscribe(12, [{ start: 1, end: 11 }], fake)
  expect(fake.calls).toHaveLength(1)
  const call = fake.calls[0]!
  expect(call.options).toMatchObject({ return_timestamps: 'word', language: 'en', task: 'transcribe' })
  expect(call.options.chunk_length_s, '≤ 28 s windows must NOT request chunking (FR-05.2)').toBeUndefined()
  expect(call.options.stride_length_s).toBeUndefined()
  expect(outcome.ok, JSON.stringify(outcome.error)).toBe(true)
  expect(events.some((e) => e.t === 'job:done')).toBe(true)
})

test('FR-05.2 / US-1.2.2: continuous speech > 28 s uses the vendored chunk_length_s:30 stride_length_s:5 recipe', async () => {
  // 3.8.1 silently truncates > 30 s without the recipe — binding unit-02
  // finding; see the header citation. The golden "no duplicated words at
  // stride seams" half is exercised end-to-end by the e2e tiny smoke.
  const fake = makeSession((start, end) => windowOutput('c', start, end))
  const { outcome } = await runTranscribe(35, [{ start: 0, end: 35 }], fake)
  expect(fake.calls.length).toBeGreaterThanOrEqual(1)
  const longCall = fake.calls.find((c) => c.end - c.start > 28)
  expect(longCall, 'the 35 s continuous stretch must be processed').toBeDefined()
  expect(longCall!.options.chunk_length_s, 'long-form recipe: chunk_length_s 30').toBe(30)
  expect(longCall!.options.stride_length_s, 'long-form recipe: stride_length_s 5').toBe(5)
  expect(outcome.ok).toBe(true)
})

test('CC-05.4 / US-1.2.2: 45 s of silence issues zero ASR calls (VAD-gate counter)', async () => {
  // Silence-only stream: the engine is never called at all.
  const silent = makeSession(() => ({ segments: [] }))
  const silentRun = await runTranscribe(45, [], silent)
  expect(silent.calls, 'no window may be issued for 45 s of silence').toHaveLength(0)
  expect(silentRun.outcome.windowsCommitted).toBe(0)

  // Silence BETWEEN two speech regions: no call may reach into [10, 55].
  const padded = makeSession((start, end) => windowOutput('p', start, end))
  await runTranscribe(60, [{ start: 0, end: 10 }, { start: 55, end: 60 }], padded)
  for (const call of padded.calls) {
    const overlap = Math.min(call.end, 55) - Math.max(call.start, 10)
    expect(overlap, `call ${call.start}–${call.end} reaches into the 45 s silence`).toBeLessThanOrEqual(2 * 0.2 + EPS)
  }
})

test('FR-05.2: word times are offset by the window start → absolute seconds', async () => {
  const fake = makeSession((start, end) => windowOutput('o', start, end))
  const { events } = await runTranscribe(30, [{ start: 20, end: 30 }], fake)
  const call = fake.calls[0]!
  const emitted = collectedSegments(events)
  expect(emitted.length).toBeGreaterThan(0)
  const firstWord = emitted[0]!.words[0]!
  // The fake returns window-relative times (0.1 × span …); the engine must
  // hand back media-absolute times: windowStart + 0.1 × span.
  const expected = call.start + 0.1 * (call.end - call.start)
  expect(Math.abs(firstWord.start - expected), `word at ${firstWord.start} expected near ${expected}`).toBeLessThan(0.05)
  expect(firstWord.start, 'times are absolute media seconds').toBeGreaterThanOrEqual(19)
  for (const segment of emitted) expect(segment.start, 'segment start absolute').toBeGreaterThanOrEqual(call.start - 0.25)
})

test('FR-05.5: job:segments are streamed per completed window and sorted', async () => {
  // The fake returns deliberately UNSORTED segments inside each window.
  const fake: FakeSession = {
    calls: [],
    session: {
      async transcribeWindow(start, end, _audio, options) {
        fake.calls.push({ start, end, options })
        const a = { start: start + 0.6, end: start + 0.9, text: 'late', words: [{ text: 'late', start: start + 0.6, end: start + 0.9, timing: 'asr' as const }] }
        const b = { start: start + 0.1, end: start + 0.4, text: 'early', words: [{ text: 'early', start: start + 0.1, end: start + 0.4, timing: 'asr' as const }] }
        return { segments: [a, b] }
      },
    },
  }
  const { events } = await runTranscribe(24, [{ start: 0, end: 10 }, { start: 12, end: 22 }], fake)
  const batches = events.filter((e): e is Extract<AsrEvent, { t: 'job:segments' }> => e.t === 'job:segments')
  expect(batches.length, 'one batch per completed window').toBeGreaterThanOrEqual(2)
  for (const batch of batches) {
    for (let i = 1; i < batch.segments.length; i++) {
      expect(batch.segments[i]!.start, 'segments sorted within a batch').toBeGreaterThanOrEqual(batch.segments[i - 1]!.start)
    }
  }
})

test('CC-05.11 / FR-05.9: a window repeating the same n-gram ≥ 4× is dropped and counted', async () => {
  const phrase = ['thank', 'you', 'so', 'much']
  const words = Array.from({ length: 24 }, (_, i) => ({ text: phrase[i % 4]!, start: 0.1 + i * 0.3, end: 0.3 + i * 0.3, timing: 'asr' as const }))
  const fake = makeSession(() => ({ segments: [{ start: 0.1, end: 7.3, text: words.map((w) => w.text).join(' '), words }] }))
  const { outcome, events } = await runTranscribe(8, [{ start: 0, end: 8 }], fake)
  expect(outcome.guardStats.repeatedNgramDropped, 'repeated n-gram window counted in guard stats').toBeGreaterThanOrEqual(1)
  const emittedText = collectedSegments(events).map((s) => s.text).join(' ')
  expect(emittedText, 'the hallucinated window must not reach the transcript').not.toContain('thank')
})

test('CC-05.11 / FR-05.9: text for a window the VAD marked < 0.5 s speech is dropped and counted', async () => {
  const fake = makeSession(() => ({
    segments: [{ start: 0.05, end: 0.35, text: 'phantom whisper', words: [{ text: 'phantom', start: 0.05, end: 0.2, timing: 'asr' as const }, { text: 'whisper', start: 0.22, end: 0.35, timing: 'asr' as const }] }],
  }))
  const { outcome, events } = await runTranscribe(6, [{ start: 5, end: 5.3 }], fake)
  expect(outcome.guardStats.shortWindowDropped, 'sub-0.5 s window counted').toBeGreaterThanOrEqual(1)
  expect(collectedSegments(events).some((s) => s.text.includes('phantom')), 'sub-0.5 s window text dropped').toBe(false)
})

test('CC-05.11 / FR-05.9: a window whose decoder hit max tokens is dropped and counted', async () => {
  const fake = makeSession(() => ({ ...windowOutput('mx', 0, 10), maxTokensHit: true }))
  const { outcome, events } = await runTranscribe(10, [{ start: 0, end: 10 }], fake)
  expect(outcome.guardStats.maxTokensDropped, 'max-tokens window counted').toBeGreaterThanOrEqual(1)
  expect(collectedSegments(events), 'max-tokens window output dropped').toHaveLength(0)
})

test('CC-05.11 / FR-05.9: job:done carries the guard counts as numbers only', async () => {
  const phrase = ['la', 'la', 'la', 'la']
  const words = Array.from({ length: 20 }, (_, i) => ({ text: phrase[i % 4]!, start: 0.1 + i * 0.3, end: 0.3 + i * 0.3, timing: 'asr' as const }))
  const fake = makeSession((start, end) =>
    start < 12
      ? { segments: [{ start: 0.1, end: 6.1, text: words.map((w) => w.text).join(' '), words }] }
      : windowOutput('ok', start, end),
  )
  const { events } = await runTranscribe(24, [{ start: 0, end: 10 }, { start: 14, end: 24 }], fake)
  const done = events.find((e) => e.t === 'job:done')
  expect(done, 'job:done emitted').toBeDefined()
  // Proposed protocol addition (unit report "Contract changes"): the terminal
  // event carries numeric-only guard stats.
  const stats = (done as { stats?: { guard?: { repeatedNgramDropped?: unknown } } } | undefined)?.stats
  expect(stats?.guard?.repeatedNgramDropped, 'numeric guard counter on job:done').toBe(1)
  expect(JSON.stringify(done), 'job:done stays content-free (SECURITY-03)').not.toContain('la la')
})

test('US-05.1 / FR-05.2: language:"fr" is forced on the engine calls', async () => {
  const fake = makeSession((start, end) => windowOutput('fr', start, end))
  await runTranscribe(10, [{ start: 0, end: 10 }], fake, { language: 'fr' })
  expect(fake.calls.length).toBeGreaterThan(0)
  for (const call of fake.calls) expect(call.options.language, 'French forced').toBe('fr')
})

test('US-05.1: language:null on a detecting engine auto-detects and reports the detected language', async () => {
  const fake = makeSession(
    (start, end) => windowOutput('ld', start, end),
    async () => 'fr',
  )
  const { outcome, events } = await runTranscribe(10, [{ start: 0, end: 10 }], fake, { language: null, languageDetect: true })
  expect(outcome.detectedLanguage, 'detected language reported (feeds job:done project update)').toBe('fr')
  expect(outcome.ok).toBe(true)
  expect(events.some((e) => e.t === 'job:done')).toBe(true)
})

test('US-05.1: language:null on a non-detecting engine → LANGUAGE_REQUIRED before anything touches the engine', async () => {
  let sessionCreations = 0
  const events: AsrEvent[] = []
  const outcome = await transcribe(
    pcmStream(10),
    spec(null, false),
    {
      vad: [{ start: 0, end: 10 }],
      createSession: () => {
        sessionCreations += 1
        return { async transcribeWindow() { return { segments: [] } } }
      },
    },
    (event) => events.push(event),
  )
  expect(outcome.validation, 'typed validation result so the UI can ask for a language').toBe('LANGUAGE_REQUIRED')
  expect(sessionCreations, 'rejected BEFORE the engine/worker boundary').toBe(0)
  expect(events.filter((e) => e.t === 'job:segments'), 'no segments emitted').toHaveLength(0)
})
