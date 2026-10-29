// tools/eval/pages/engine-c.ts — page controller for engine C (cactus-needle
// 0.3.0 browser build: needle.wasm runtime + Whistle speech model). The
// package manages its own inference worker ("load each engine in a worker",
// FR-02.1 — satisfied by the package's resident Whistle worker); the page
// keeps audio decode + JS-heap sampling on this thread (FR-02.2).
//
// API verified against the pinned package's own shipped types
// (node_modules/cactus-needle/dist/speech.d.ts): createWhistle(options) →
// Whistle.transcribe(AudioInput, {language?, keywords?, wordTimestamps?}) →
// { text, language, durationInSeconds, words:[{word,start,end,probability}],
// timeToFirstTokenMs, tokensPerSecond }. `language` omitted = auto-detect;
// `keywords` = Aho-Corasick keyword biasing (FR-02.5 future-feature evidence).
import { createWhistle, type Whistle } from 'cactus-needle/browser'
import { decodeClip, peakJsMemory, webgpuAvailable, type EnginePageApi } from './common'

let whistle: Whistle | null = null

const api: EnginePageApi = {
  async ready() {
    return { ok: true, webgpu: webgpuAvailable(), isolated: window.crossOriginIsolated === true }
  },
  async load(options) {
    const began = performance.now()
    try {
      whistle = await createWhistle({
        // Pinned whistle.cact from the package manifest (Hugging Face
        // origin, allowlisted + SHA-256-verified by the package itself).
        // cache:false keeps every measurement run's request log complete for
        // the US-02.2 network audit.
        cache: false,
        model: typeof options.model === 'string' ? options.model : undefined,
      })
      return { ok: true, ms: performance.now() - began }
    } catch (error) {
      return { ok: false, ms: performance.now() - began, error: error instanceof Error ? `${error.name}:${error.message.slice(0, 200)}` : 'load-failed' }
    }
  },
  async run(clipUrl, options) {
    if (!whistle) return { ok: false, wallMs: 0, error: 'engine-c: not loaded' }
    try {
      const { result, peakJsHeapBytes, isolated } = await peakJsMemory(async () => {
        const began = performance.now()
        const clip = await decodeClip(clipUrl)
        const decodeMs = performance.now() - began
        // cactus whistle.transcribe rejects >30 s of audio — transcribe in
        // <=28 s windows and re-base word timestamps onto clip time.
        const language = (options.language as 'en' | undefined) ?? undefined
        const keywords = Array.isArray(options.keywords) ? (options.keywords as string[]) : undefined
        const WINDOW = Math.min(28, Math.max(1, (options.maxWindowSeconds as number | undefined) ?? 28)) * clip.sampleRate
        const merged: { text: string; language: string; durationInSeconds: number; words: Array<{ word: string; start: number; end: number; probability: number }> } = {
          text: '',
          language: '',
          durationInSeconds: 0,
          words: [],
        }
        for (let offset = 0; offset < clip.samples.length; offset += WINDOW) {
          const slice = clip.samples.subarray(offset, Math.min(offset + WINDOW, clip.samples.length))
          const transcription = await whistle!.transcribe({ samples: slice, sampleRate: clip.sampleRate }, { language, keywords, wordTimestamps: true })
          const offsetSeconds = offset / clip.sampleRate
          if (transcription.text && transcription.text.trim().length > 0) {
            merged.text += (merged.text.length > 0 ? ' ' : '') + transcription.text.trim()
          }
          if (!merged.language && transcription.language) merged.language = transcription.language
          merged.durationInSeconds = Math.max(merged.durationInSeconds, offsetSeconds + transcription.durationInSeconds)
          for (const w of transcription.words ?? []) {
            merged.words.push({ ...w, start: w.start + offsetSeconds, end: w.end + offsetSeconds })
          }
        }
        const wallMs = performance.now() - began
        return { transcription: merged, decodeMs, wallMs, durationSeconds: clip.durationSeconds }
      })
      const transcription = result.transcription as {
        text: string
        language: string
        durationInSeconds: number
        words?: Array<{ word: string; start: number; end: number; probability: number }>
      }
      const words = transcription.words ?? []
      return {
        ok: true,
        wallMs: Number(result.wallMs),
        decodeMs: Number(result.decodeMs ?? 0),
        durationSeconds: Number(result.durationSeconds ?? clipDur(result)),
        output: {
          text: transcription.text,
          language: transcription.language,
          chunks: words.map((w) => ({ text: w.word, timestamp: [w.start, w.end] as [number, number] })),
          hasScores: words.some((w) => Number.isFinite(w.probability) && w.probability > 0),
        },
        peakJsHeapBytes,
        isolated,
      }
    } catch (error) {
      return { ok: false, wallMs: 0, error: error instanceof Error ? `${error.name}:${error.message.slice(0, 200)}` : 'run-failed' }
    }
  },
  async dispose() {
    try {
      await whistle?.close()
      whistle = null
      return { ok: true }
    } catch {
      return { ok: false }
    }
  },
}

function clipDur(result: { durationSeconds?: number }): number {
  return Number(result.durationSeconds ?? 0)
}

;(window as unknown as Record<string, unknown>).__zipscribeEval = api
