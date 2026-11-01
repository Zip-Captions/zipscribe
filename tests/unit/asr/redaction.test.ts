// CC-05.12 (SECURITY-03 / FR-05.8): transcript text never enters logs,
// telemetry, or error `detail` fields — codes only. Uses the shared canary
// redaction harness (src/test-support/redaction.ts, unit-01): every asr code
// path runs with CANARY_MARKER-bearing engine output; a leak into a thrown
// EngineError, a Notice, or any console channel fails the run. The marker is
// never echoed into assertion messages (the harness records hash+length only).
//
// Note what is NOT scanned: `job:segments` payloads legitimately carry
// transcript text (the worker protocol's purpose) — FR-05.8 bans LOGS,
// telemetry and error/notice details.
import { expect, test } from 'vitest'
import { CANARY_MARKER, createRedactionSpy, scanError } from '../../../src/test-support/redaction'
import { transcribe, type EngineSession, type WindowOutput } from '@engine/asr/transcriber'
import { createAsrWorkerHost, type AsrWorkerLike } from '@engine/asr/worker-host'
import type { AsrEvent, AsrRequest, PcmChunk, RawSegment } from '@engine/protocol@05'

// Canary content (repo-local only — never sent to any tool or log, SECURITY-03).
const CANARY_WORDS = ['the', CANARY_MARKER, 'keeper', 'spoke', 'softly']

function canaryWindowOutput(): WindowOutput {
  return {
    segments: [
      {
        start: 0.1,
        end: 2.5,
        text: CANARY_WORDS.join(' '),
        words: CANARY_WORDS.map((text, i) => ({ text, start: 0.1 + i * 0.4, end: 0.3 + i * 0.4, timing: 'asr' as const })),
      },
    ],
  }
}

async function* silentStream(seconds: number): AsyncGenerator<PcmChunk> {
  for (let at = 0; at < seconds; at++) yield { startSec: at, samples: new Float32Array(16_000) }
}

const SPEC = {
  modelId: 'whisper-tiny-timestamped@5172442937',
  device: 'wasm' as const,
  language: 'en',
  engineFlags: { confidence: false, punctuation: false, languageDetect: false },
}

function collect(errors: unknown[], notices: unknown[]): (event: AsrEvent) => void {
  return (event) => {
    if (event.t === 'job:error') errors.push(event.error)
    if (event.t === 'notice') notices.push(event.notice)
  }
}

test('CC-05.12 / FR-05.8: a canary transcript stays out of logs, errors and notices (transcriber happy path)', async () => {
  const spy = createRedactionSpy()
  const errors: unknown[] = []
  const notices: unknown[] = []
  try {
    const session: EngineSession = { async transcribeWindow() { return canaryWindowOutput() } }
    const outcome = await transcribe(
      silentStream(10),
      SPEC,
      { vad: [{ start: 0, end: 10 }], createSession: async () => session },
      collect(errors, notices),
    )
    // Sanity: the transcript really did flow through the pipeline (a vacuous
    // redaction pass on an empty run would prove nothing).
    expect(outcome.segments.length, 'canary text reached the segment stream (the run is not vacuous)').toBeGreaterThan(0)
    expect(outcome.segments[0]!.text, 'canary flows as DATA').toContain(CANARY_MARKER)

    const verdict = spy.settle()
    expect(verdict.clean, `console leaked canary content: ${JSON.stringify(verdict.leaks)}`).toBe(true)
    for (const error of errors) expect(scanError(error), 'EngineError carries no content').toHaveLength(0)
    for (const notice of notices) expect(JSON.stringify(notice)).not.toContain(CANARY_MARKER)
    if (outcome.error) expect(scanError(outcome.error), 'outcome error detail stays codes-only').toHaveLength(0)
  } finally {
    spy.restore()
  }
})

test('CC-05.12 / FR-05.8: guard-dropped and failing canary windows leak nothing when mapped to errors/notices', async () => {
  const spy = createRedactionSpy()
  const errors: unknown[] = []
  const notices: unknown[] = []
  try {
    let windowIndex = 0
    const session: EngineSession = {
      async transcribeWindow(start) {
        windowIndex++
        if (start < 11) {
          // Repeated canary n-gram → hallucination-guard path.
          const words = Array.from({ length: 24 }, (_, i) => ({ text: CANARY_WORDS[i % CANARY_WORDS.length]!, start: 0.1 + i * 0.3, end: 0.3 + i * 0.3, timing: 'asr' as const }))
          return { segments: [{ start: 0.1, end: 7.3, text: words.map((w) => w.text).join(' '), words }] }
        }
        // Failing window: the engine surfaces a CODED error mid-run; the
        // pipeline sees this window's canary text and must not launder it into
        // the error it produces.
        throw Object.assign(new Error('decode stall'), { code: 'DECODE_STALL' })
      },
    }
    const outcome = await transcribe(
      silentStream(22),
      SPEC,
      { vad: [{ start: 0, end: 10 }, { start: 12, end: 22 }], createSession: async () => session },
      collect(errors, notices),
    )
    const verdict = spy.settle()
    expect(verdict.clean, `console leaked canary content on failure paths: ${JSON.stringify(verdict.leaks)}`).toBe(true)
    for (const error of errors) expect(scanError(error), 'mapped EngineError carries no content').toHaveLength(0)
    for (const notice of notices) expect(JSON.stringify(notice)).not.toContain(CANARY_MARKER)
    if (outcome.error) {
      expect(scanError(outcome.error), 'outcome error detail stays codes-only on DECODE_STALL').toHaveLength(0)
      expect(outcome.error.code, 'errors are identified by code').toBeTypeOf('string')
    }
    expect(windowIndex, 'both windows were attempted').toBeGreaterThanOrEqual(1)
  } finally {
    spy.restore()
  }
})

// --- worker-host side -------------------------------------------------------

class CanaryWorker implements AsrWorkerLike {
  readonly sent: AsrRequest[] = []
  terminated = false
  private listeners: ((event: AsrEvent) => void)[] = []

  postMessage(message: AsrRequest): void {
    this.sent.push(message)
    void this.handle(message)
  }

  onMessage(listener: (event: AsrEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  private emit(event: AsrEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }

  private async handle(request: AsrRequest): Promise<void> {
    if (request.t === 'loadModel') {
      this.emit({ t: 'model:ready', model: request.model, device: request.device })
      return
    }
    if (request.t !== 'transcribe') return
    const { jobId } = request
    const start = request.resumeFromSec ?? 0
    if (start === 0) {
      // First epoch: canary segments, then the GPU OOM (FR-05.3/US-1.2.7 path).
      const segments: RawSegment[] = [{ start: 0.2, end: 4.5, text: CANARY_WORDS.join(' '), words: CANARY_WORDS.map((text, i) => ({ text, start: 0.2 + i * 0.8, end: 0.6 + i * 0.8, timing: 'asr' as const })) }]
      this.emit({ t: 'job:segments', jobId, segments })
      this.emit({ t: 'job:error', jobId, error: { code: 'GPU_OOM', retryable: true } })
      return
    }
    for (let second = Math.floor(start); second < 20; second++) {
      const segStart = Math.max(start, second)
      const segEnd = Math.min(20, second + 0.9)
      if (segEnd <= segStart) continue
      this.emit({ t: 'job:segments', jobId, segments: [{ start: segStart, end: segEnd, text: `tok ${second}`, words: [{ text: `tok${second}`, start: segStart, end: segEnd, timing: 'asr' as const }] }] })
      await new Promise((resolve) => setTimeout(resolve, 1))
      if (this.terminated) return
    }
    this.emit({ t: 'job:done', jobId })
  }
}

test('CC-05.12 / FR-05.8: the worker-host canary + GPU_OOM + downgrade path leaks nothing', async () => {
  const spy = createRedactionSpy()
  const errors: unknown[] = []
  const notices: unknown[] = []
  try {
    const workers: CanaryWorker[] = []
    const host = createAsrWorkerHost({
      createWorker: () => {
        const worker = new CanaryWorker()
        workers.push(worker)
        return worker
      },
      tiers: { T1: { modelId: 'whisper-base-timestamped@608c49e6', device: 'webgpu' }, T2: { modelId: 'whisper-tiny-timestamped@5172442937', device: 'wasm' } },
      initialTier: 'T1',
      onEvent: (event) => {
        if (event.t === 'job:error') errors.push(event.error)
        if (event.t === 'notice') notices.push(event.notice)
      },
    })
    const result = await host.transcribe({
      jobId: 'job-redact',
      pcm: { kind: 'transfer', buffer: new ArrayBuffer(16_000 * 4 * 20) },
      sampleRate: 16_000,
      language: 'en',
      engineFlags: { confidence: false, punctuation: false, languageDetect: false },
    })
    // The canary genuinely transited the host (non-vacuous).
    expect(result.segments.some((s) => s.text.includes(CANARY_MARKER)), 'canary text flowed through the host as data').toBe(true)
    expect(result.downgraded, 'the GPU_OOM downgrade path ran').toBe(true)

    const verdict = spy.settle()
    expect(verdict.clean, `console leaked canary content across recycle/downgrade: ${JSON.stringify(verdict.leaks)}`).toBe(true)
    expect(notices.length, 'downgrade emits coded notices').toBeGreaterThan(0)
    for (const notice of notices) {
      const n = notice as { code?: string; params?: Record<string, unknown> }
      expect(n.code, 'notices are coded').toBeTypeOf('string')
      expect(JSON.stringify(n.params ?? {}), 'notice params carry codes/numbers only').not.toContain(CANARY_MARKER)
    }
    for (const error of errors) expect(scanError(error), 'EngineError from the host path stays content-free').toHaveLength(0)
    if (result.error) expect(scanError(result.error), 'run error detail stays codes-only').toHaveLength(0)
    host.dispose()
  } finally {
    spy.restore()
  }
})
