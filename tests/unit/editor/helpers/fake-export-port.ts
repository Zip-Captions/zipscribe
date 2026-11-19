// FR-102.8 mock worker harness — deterministic scripted event streams for ALL
// downstream units (no real inference per-PR). Lineage: the scripted-envelope
// design of `src/test-support/fake-workers.ts` `FakeWorkerSession` (record
// requests, replay scripted events per request tag), typed over the FULL
// MediaEvent/AsrEvent/DiarizeEvent/ExportEvent unions like unit-101's
// `FakeEnginePort`. Plus the fake `TranslationEngine` (Intent 4 reuse):
// architecture § Translation engine / zip-captions ADR-013 shape.
import type { AsrEvent, DiarizeEvent, EngineError, ExportEvent, ExportRequest, ExportSettings, JobEvent, MediaEvent, ModelId } from '@engine/protocol@102'
import type { TranslationEngine } from '@engine/translate/engine'

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

/** Scripted `TranslationEngine` (unit-301 alignment: implements the canonical
 *  seam in `src/engine/translate/engine.ts` — architecture § Translation
 *  engine, zip-captions ADR-013 surface). Deterministic dictionary + canned
 *  failure codes; never touches the network or the real Translator API. */
export interface FakeTranslationEngine extends TranslationEngine {
  readonly translateCalls: { texts: readonly string[]; target: string }[]
  readonly ensurePairCalls: [string, string, boolean][]
  /** When set, `translate` rejects with this error until cleared. */
  nextFailure: EngineError | null
  /** When set, `ensurePair` resolves 'downloadable' for this target. */
  downloadableTarget: string | null
  readonly disposed: boolean
}

export function createFakeTranslationEngine(options: { available?: readonly string[]; unsupported?: readonly string[]; detectedLanguage?: string | null; detectConfidence?: number; availableApi?: boolean } = {}): FakeTranslationEngine {
  const available = new Set(options.available ?? ['fr', 'es'])
  const unsupported = new Set(options.unsupported ?? ['zh-Hant'])
  const translateCalls: { texts: readonly string[]; target: string }[] = []
  const ensurePairCalls: [string, string, boolean][] = []
  let nextFailure: EngineError | null = null
  let downloadableTarget: string | null = null
  let disposed = false
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
    get downloadableTarget() {
      return downloadableTarget
    },
    set downloadableTarget(value: string | null) {
      downloadableTarget = value
    },
    get disposed() {
      return disposed
    },
    isAvailable: () => (options.availableApi === false ? { available: false as const, reason: 'browser' as const } : { available: true as const }),
    availability: async (_source, target) => (unsupported.has(target) ? ('unavailable' as const) : downloadableTarget === target ? ('downloadable' as const) : available.has(target) ? ('available' as const) : ('downloadable' as const)),
    ensurePair: async (source, target, opts) => {
      ensurePairCalls.push([source, target, opts.userInitiated])
      if (unsupported.has(target)) {
        throw { code: 'PAIR_UNAVAILABLE', retryable: false, detail: `PAIR_UNSUPPORTED:${target}` } satisfies EngineError
      }
      if (downloadableTarget === target) {
        // zip-captions pattern: background request neither downloads nor throws.
        if (!opts.userInitiated) return 'downloadable' as const
        opts.onProgress?.(100)
        downloadableTarget = null
        return 'ready' as const
      }
      return 'ready' as const
    },
    translate: async (source, target, text, _signal) => {
      translateCalls.push({ texts: [text], target })
      if (nextFailure !== null) throw nextFailure
      return `${target[0] ?? 'x'}:${text}`.slice(0, 120)
    },
    detectLanguage: async () => (options.detectedLanguage === undefined || options.detectedLanguage === null ? null : { language: options.detectedLanguage, confidence: options.detectConfidence ?? 0.95 }),
    dispose: () => {
      disposed = true
    },
  }
}

export type { ExportSettings, ModelId }
