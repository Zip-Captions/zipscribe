// CC-07.3 (L4) browser harness for the caption-align MAE spec —
// test-author-owned (pattern: e2e/asr/fixtures/harness.ts).
//
// Real pipeline end to end: the unit-04 media worker decodes the fixture, the
// unit-05 createAsrWorkerHost drives the REAL src/workers/asr.worker.ts, the
// ref captions go through the real importCaptions, and the produced ASR words
// are fed to the real alignCaptionsToWords — nothing under test is stubbed.
//
// Engine modules load via runtime-computed DYNAMIC imports so the page always
// boots (ready=true) and the spec REDs readably on the run, not as a blank
// page (unit-05 harness doctrine).
//
// SECURITY-03: only numbers, codes and counts cross the page boundary — the
// word TEXTS the spec needs for GT pairing come from the committed
// ground-truth file on the Node side, never from the page.
import type { AsrEvent, MediaEvent, MediaRequest, PcmChunk, RawSegment } from '@engine/protocol@05'
import type { AsrWorkerLike } from '@engine/asr/worker-host'
import type { CaptionBlock, Project, WordToken } from '@engine/model@07'

export interface AlignRunOptions {
  fixture: string
  refCaption: string
  modelId: string
  device: 'wasm' | 'webgpu'
  language: string | null
  tier: 'T1' | 'T2'
}

export interface AlignRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean }
  cancelled: boolean
  decodedSeconds: number
  asrWordCount: number
  captionBlockCount: number
  captionWordCount: number
  alignedWordCount: number
  report: { wordsTotal: number; wordsAligned: number; alignedRatio: number }
  /** Aligned words in caption order — texts are normalized-comparable to the
   *  committed ground truth; the spec pairs index-wise with it. */
  alignedWords: { text: string; start: number; end: number; timing: string }[]
  /** Raw ASR words (model order) — for timing-drift diagnostics; texts stay
   *  in-process, specs log numbers only (SECURITY-03). */
  asrWords: { text: string; start: number; end: number }[]
  eventSummary: { t: string; code?: string }[]
  runWallMs: number
}

interface HarnessGlobal {
  runAlign(options: AlignRunOptions): Promise<AlignRunSummary>
}

async function fetchBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(`/${path}`)
  if (!response.ok) throw new Error(`fixture fetch failed for ${path}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** Decode via the REAL unit-04 media worker (unit-05 harness pattern). */
async function decodeToTransfer(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<{ buffer: ArrayBuffer; seconds: number }> {
  const channel = new MessageChannel()
  const mediaWorker = new Worker('/src/workers/media.worker.ts', { type: 'module' })
  try {
    const chunks: PcmChunk[] = []
    const settled = new Promise<void>((resolve, reject) => {
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data as PcmChunk
        if (data && typeof data.startSec === 'number' && data.samples instanceof Float32Array) chunks.push(data)
      }
      mediaWorker.onmessage = (event: MessageEvent<MediaEvent>) => {
        const ev = event.data
        if (ev.t === 'job:done') resolve()
        else if (ev.t === 'job:error') reject(new Error(`media decode failed: ${ev.error.code}`))
      }
      mediaWorker.onerror = (error) => reject(new Error(`media worker error: ${error.message}`))
    })
    const file = new File([bytes], name, { type: 'video/mp4' })
    mediaWorker.postMessage({ t: 'decode', jobId: `captions-harness-decode-${Date.now()}`, file, ports: [channel.port2] } as MediaRequest, [channel.port2])
    await settled
    chunks.sort((a, b) => a.startSec - b.startSec)
    const total = chunks.reduce((sum, chunk) => sum + chunk.samples.length, 0)
    const buffer = new ArrayBuffer(total * 4)
    const view = new Float32Array(buffer)
    let at = 0
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      view.set(chunk.samples, at)
      at += chunk.samples.length
      if (i % 256 === 255) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { buffer, seconds: total / 16_000 }
  } finally {
    mediaWorker.terminate()
    channel.port1.close()
  }
}

function wrapWorker(worker: Worker): AsrWorkerLike {
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer ? { transfer } : undefined),
    onMessage: (listener) => {
      const handler = (event: MessageEvent<AsrEvent>) => listener(event.data)
      worker.addEventListener('message', handler)
      return () => worker.removeEventListener('message', handler)
    },
    terminate: () => worker.terminate(),
  }
}

const WHISPER_TINY_ENGINE_FLAGS = { confidence: false, punctuation: false, languageDetect: true }

function emptyProject(duration: number): Project {
  return {
    id: 'align-harness-project',
    name: 'align-harness',
    schemaVersion: 1,
    asset: {
      id: 'align-harness-asset',
      name: 'speech-2min.mp4',
      kind: 'video',
      container: 'mp4',
      audioCodec: 'aac',
      videoCodec: 'h264',
      duration,
      width: 1920,
      height: 1080,
      fps: 25,
      fingerprint: { name: 'speech-2min.mp4', size: 1_000_000, durationMs: Math.round(duration * 1000), sampleHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)] },
    },
    blocks: [],
    captionOrigin: 'none',
    translations: [],
    speakers: [],
    speakerSource: 'none',
    language: 'en',
    modelId: null,
    style: { fontFamily: 'Inter', fontWeight: 400, fontSizePct: 4, textTransform: 'none', color: '#FFFFFF', highlightColor: '#FFE45C', outlineColor: '#000000', outlineWidth: 2, backgroundOpacity: 0, position: 'bottom', marginVPct: 8, alignment: 'center', maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false },
    outputAspect: 'source',
    transcription: 'none',
    updatedAt: 1_700_000_000_000,
  }
}

async function runAlign(options: AlignRunOptions): Promise<AlignRunSummary> {
  // Runtime-computed specifiers: not-yet-existing engine modules fail the RUN
  // (readable RED) instead of 500-ing the vite transform of the page.
  const workerHostUrl = new URL('../../../src/engine/asr/worker-host.ts', import.meta.url).href
  const importUrl = new URL('../../../src/engine/captions/import.ts', import.meta.url).href
  const alignUrl = new URL('../../../src/engine/captions/align.ts', import.meta.url).href
  const { createAsrWorkerHost } = (await import(/* @vite-ignore */ workerHostUrl)) as typeof import('@engine/asr/worker-host')
  const { importCaptions } = (await import(/* @vite-ignore */ importUrl)) as typeof import('@engine/captions/import')
  const { alignCaptionsToWords } = (await import(/* @vite-ignore */ alignUrl)) as typeof import('@engine/captions/align')

  const started = Date.now()
  const [audioBytes, captionBytes] = await Promise.all([fetchBytes(options.fixture), fetchBytes(options.refCaption)])
  const { buffer, seconds } = await decodeToTransfer(audioBytes, options.fixture.split('/').pop() ?? 'fixture')

  const events: AsrEvent[] = []
  const host = createAsrWorkerHost({
    createWorker: () => wrapWorker(new Worker('/src/workers/asr.worker.ts', { type: 'module' })),
    tiers: { T1: { modelId: options.modelId, device: options.device }, T2: { modelId: options.modelId, device: 'wasm' } },
    initialTier: options.tier,
    onEvent: (event) => events.push(event),
  })
  const result = await host.transcribe({
    jobId: `captions-align-${Math.random().toString(36).slice(2)}`,
    pcm: { kind: 'transfer', buffer },
    sampleRate: 16_000,
    language: options.language,
    engineFlags: WHISPER_TINY_ENGINE_FLAGS,
  })
  host.dispose()
  if (result.error) {
    return {
      ok: false,
      error: result.error,
      cancelled: result.cancelled,
      decodedSeconds: seconds,
      asrWordCount: 0,
      captionBlockCount: 0,
      captionWordCount: 0,
      alignedWordCount: 0,
      report: { wordsTotal: 0, wordsAligned: 0, alignedRatio: 0 },
      alignedWords: [],
      asrWords: [],
      eventSummary: events.map((event) => ({ t: event.t, ...(event.t === 'job:error' ? { code: event.error.code } : {}) })),
      runWallMs: Date.now() - started,
    }
  }

  const segments: RawSegment[] = result.segments
  const asrWords: { text: string; start: number; end: number }[] = segments.flatMap((segment: RawSegment) => segment.words.map((word: WordToken) => ({ text: word.text, start: word.start, end: word.end })))

  const { project: imported, report: importReport } = await importCaptions(emptyProject(seconds), { name: 'ref.srt', bytes: captionBytes }, { as: 'source' })
  const { project: alignedProject, report } = alignCaptionsToWords(imported, asrWords)
  const alignedBlocks: CaptionBlock[] = alignedProject.blocks

  return {
    ok: true,
    cancelled: result.cancelled,
    decodedSeconds: seconds,
    asrWordCount: asrWords.length,
    captionBlockCount: importReport.blocks,
    captionWordCount: alignedBlocks.reduce((sum, block) => sum + block.words.length, 0),
    alignedWordCount: alignedBlocks.reduce((sum, block) => sum + block.words.filter((word) => word.timing === 'aligned').length, 0),
    asrWords,
    report,
    alignedWords: alignedBlocks.flatMap((block) => block.words.map((word) => ({ text: word.text, start: word.start, end: word.end, timing: word.timing ?? 'estimated' }))),
    eventSummary: events.map((event) => ({ t: event.t, ...(event.t === 'job:error' ? { code: event.error.code } : {}) })),
    runWallMs: Date.now() - started,
  }
}

const harness: HarnessGlobal = { runAlign }
;(globalThis as unknown as Record<string, unknown>).__zipscribeCaptionsHarness = harness
;(globalThis as unknown as Record<string, unknown>).__zipscribeCaptionsHarnessReady = true
