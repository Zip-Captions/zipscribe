// FR-102.8 mock worker harness — deterministic scripted event streams for ALL
// downstream units (no real inference per-PR). Lineage: the scripted-envelope
// design of `src/test-support/fake-workers.ts` `FakeWorkerSession` (record
// requests, replay scripted events per request tag), typed over the FULL
// MediaEvent/AsrEvent/DiarizeEvent/ExportEvent unions like unit-101's
// `FakeEnginePort`. Plus the fake `TranslationEngine` (Intent 4 reuse):
// architecture § Translation engine / zip-captions ADR-013 shape.
import type { AsrEvent, DiarizeEvent, EngineError, ExportEvent, ExportRequest, ExportSettings, JobEvent, MediaEvent, ModelId } from '@engine/protocol@102'
import type { TranslationEntry } from '@engine/model@102'
import type { ExportWorkerPort } from '@state/services/export'

type Script<TRequest, TEvent> = Map<string, (request: TRequest) => TEvent[]>

function scripted<TRequest extends { t: string }, TEvent>() {
  const responses: Script<TRequest, TEvent> = new Map()
  const requests: TRequest[] = []
  const listeners: ((event: TEvent) => void)[] = []
  return {
    requests,
    respond(t: string, events: TEvent[] | ((request: TRequest) => TEvent[])): void {
      responses.set(t, typeof events === 'function' ? events : () => events)
    },
    post(request: TRequest): void {
      requests.push(request)
      for (const event of responses.get(request.t)?.(request) ?? []) emit(event)
    },
    on(listener: (event: TEvent) => void): () => void {
      listeners.push(listener)
      return () => {
        const i = listeners.indexOf(listener)
        if (i >= 0) listeners.splice(i, 1)
      }
    },
    emit,
    dispose(): void {
      listeners.length = 0
    },
  }
  function emit(event: TEvent): void {
    for (const listener of [...listeners]) listener(event)
  }
}

/** Scripted media/asr/diarize/export engine double (FR-2.0.6 + FR-102.8). */
export class FakeEngineBus {
  readonly media = scripted<{ t: string; jobId?: string }, MediaEvent>()
  readonly asr = scripted<{ t: string; jobId?: string }, AsrEvent>()
  readonly diarize = scripted<{ t: string; jobId?: string }, DiarizeEvent>()
  readonly export = scripted<ExportRequest, ExportEvent>()

  postMedia(request: { t: string; jobId?: string }): void {
    this.media.post(request)
  }
  postAsr(request: { t: string; jobId?: string }): void {
    this.asr.post(request)
  }
  postDiarize(request: { t: string; jobId?: string }): void {
    this.diarize.post(request)
  }
}

/** `ExportWorkerPort` over the scripted export channel (exportService tests). */
export function createFakeExportPort(): ExportWorkerPort & { readonly requests: ExportRequest[]; emit(event: ExportEvent): void } {
  const channel = scripted<ExportRequest, ExportEvent>()
  return {
    get requests() {
      return channel.requests
    },
    postExport: (request) => channel.post(request),
    onExportEvent: (listener) => channel.on(listener),
    emit: (event) => channel.emit(event),
    dispose: () => channel.dispose(),
  }
}

/** `job:progress` ramp helper — n evenly spaced progress events + done. */
export function progressScript(jobId: string, totalSec: number, steps: number, done = true): JobEvent[] {
  const events: JobEvent[] = Array.from({ length: steps }, (_, i) => ({
    t: 'job:progress' as const,
    jobId,
    processedSec: Math.round(((i + 1) * (totalSec / steps)) * 1000) / 1000,
    totalSec,
  }))
  if (done) events.push({ t: 'job:done', jobId })
  return events
}

/** Scripted `TranslationEngine` (Intent 4 reuse; architecture § Translation
 *  engine — zip-captions ADR-013 surface). Deterministic dictionary + canned
 *  failure codes; never touches the network or the real Translator API. */
export interface TranslationEngine {
  availability(language: string): 'available' | 'downloadable' | 'unsupported'
  ensurePair(source: string, target: string): Promise<void>
  translate(texts: readonly string[], target: string): Promise<(TranslationEntry | { error: EngineError })[]>
  detectLanguage(text: string): Promise<string | null>
  dispose(): void
}

export interface FakeTranslationEngine extends TranslationEngine {
  readonly translateCalls: { texts: readonly string[]; target: string }[]
  readonly ensurePairCalls: [string, string][]
  /** When set, the next `translate` answers every entry with this error. */
  nextFailure: EngineError | null
}

export function createFakeTranslationEngine(options: { available?: readonly string[]; unsupported?: readonly string[] } = {}): FakeTranslationEngine {
  const available = new Set(options.available ?? ['fr', 'es'])
  const unsupported = new Set(options.unsupported ?? ['zh-Hant'])
  const translateCalls: { texts: readonly string[]; target: string }[] = []
  const ensurePairCalls: [string, string][] = []
  let nextFailure: EngineError | null = null
  return {
    get translateCalls() {
      return translateCalls
    },
    get ensurePairCalls() {
      return ensurePairCalls
    },
    get nextFailure() {
      return nextFailure
    },
    set nextFailure(value: EngineError | null) {
      nextFailure = value
    },
    availability: (language) => (unsupported.has(language) ? 'unsupported' : available.has(language) ? 'available' : 'downloadable'),
    ensurePair: async (source, target) => {
      ensurePairCalls.push([source, target])
      if (unsupported.has(target)) {
        const error: EngineError = { code: 'ENGINE_INTERNAL', retryable: false, detail: `PAIR_UNSUPPORTED:${target}` }
        throw error
      }
    },
    translate: async (texts, target) => {
      translateCalls.push({ texts, target })
      if (nextFailure !== null) return texts.map(() => ({ error: nextFailure as EngineError }))
      // Deterministic non-content transform: prefixed codes. The result is
      // canned test data — real translation lands with unit-301.
      return texts.map((text) => ({ text: `fr:${text}`.slice(0, 120), status: 'translated' as const, sourceHash: `hash_${text.length}` }))
    },
    detectLanguage: async () => 'en',
    dispose: () => undefined,
  }
}

export type { ExportSettings, ModelId }
