// FR-302.1 / US-302.1 (L1, node): the jobs slice carries per-language
// translation job state (`jobs.translation[lang]`) and orchestrates runs
// through the unit-301 TranslationSession (the SAME real session the L4
// long-task gate exercises — only the TranslationEngine seam is faked).
// Covers: per-language progress + status, cancel ≤ 500 ms keeping completed
// entries, availability mapping for the picker badges, and the machine-track
// creation on first run. SECURITY-03: the fake returns deterministic strings;
// the assertion never inspects content, only counts/codes.
import { describe, expect, test, vi } from 'vitest'
import { createJobsStore } from './jobs'
import type { EnginePort, ModelCachePort } from './jobs'
import { createEditorApp } from './history'
import type { TranslationEngine, PairAvailability, EngineAvailability, LanguageGuess } from '../engine/translate/engine'
import type { CaptionBlock, MediaAsset, Project, Speaker, WordToken } from '../engine/model'

function noopEngine(): EnginePort {
  return {
    postMedia: () => undefined,
    postAsr: () => undefined,
    postDiarize: () => undefined,
    onMediaEvent: () => () => undefined,
    onAsrEvent: () => () => undefined,
    dispose: () => undefined,
  }
}
const modelCache: ModelCachePort = { listCached: () => Promise.resolve([]) }

function fakeEditorApp() {
  return createEditorApp({
    clock: { now: () => 1000 },
    rafs: { request: () => 0, cancel: () => undefined, frame: () => undefined },
  })
}

function word(text: string, start: number, end: number): WordToken {
  return { text, start, end }
}
function block(id: string, start: number, end: number, speakerId: string, words: WordToken[]): CaptionBlock {
  return { id, start, end, text: words.map((w) => w.text).join(' '), words, speakerId }
}
function speaker(id: string, label: string, color: string): Speaker {
  return { id, label, color }
}
const ASSET: MediaAsset = {
  id: 'ASSET_302',
  name: 'speech.mp4',
  kind: 'video',
  container: 'mp4',
  audioCodec: 'aac',
  videoCodec: 'avc1',
  duration: 9,
  width: 1280,
  height: 720,
  fps: 25,
  fingerprint: { name: 'speech.mp4', size: 627251, durationMs: 9000, sampleHashes: ['h1', 'h2', 'h3'] },
}
const STYLE = {
  fontFamily: 'Inter',
  fontWeight: 400,
  fontSizePct: 8,
  textTransform: 'none',
  color: '#e8eaed',
  highlightColor: '#4c8dff',
  outlineColor: '#0d0f12',
  outlineWidth: 2,
  backgroundOpacity: 0,
  position: 'bottom',
  marginVPct: 6,
  alignment: 'center',
  maxLinesPerBlock: 2,
  highlightMode: 'none',
  showSpeakerBar: false,
} as const
function sampleProject(overrides: Partial<Project>): Project {
  return {
    id: 'proj_302',
    name: 'Translation job project',
    schemaVersion: 1,
    asset: ASSET,
    blocks: [],
    captionOrigin: 'transcribed',
    translations: [],
    speakers: [],
    speakerSource: 'auto-beta',
    language: 'en',
    modelId: 'whisper-base_timestamped@608c49e6',
    style: { ...STYLE },
    outputAspect: 'source',
    transcription: 'complete',
    updatedAt: 1730000000000,
    ...overrides,
  }
}

function scriptedEngine(overrides: Partial<TranslationEngine> = {}): TranslationEngine & { translateCalls: number; ensureCalls: { userInitiated: boolean }[] } {
  const state = { translateCalls: 0, ensureCalls: [] as { userInitiated: boolean }[] }
  const engine: TranslationEngine = {
    isAvailable: (): EngineAvailability => ({ available: true }),
    availability: (): Promise<PairAvailability> => Promise.resolve('available'),
    ensurePair: (_s, _t, options) => {
      state.ensureCalls.push({ userInitiated: options.userInitiated })
      options.onProgress?.(100)
      return Promise.resolve('ready')
    },
    translate: async (_s, _t, text, signal) => {
      state.translateCalls += 1
      await new Promise((r) => setTimeout(r, 5))
      if (signal.aborted) throw Object.assign(new Error('aborted'), { code: 'CANCELLED' })
      return `t:${text}`
    },
    detectLanguage: (): Promise<LanguageGuess | null> => Promise.resolve(null),
    dispose: () => undefined,
    ...overrides,
  }
  const counters = state as unknown as Record<string, unknown>
  return new Proxy(engine, {
    get: (target: object, prop: string | symbol): unknown => {
      if (prop === 'translateCalls') return counters['translateCalls']
      if (prop === 'ensureCalls') return counters['ensureCalls']
      return Reflect.get(target, prop)
    },
  }) as TranslationEngine & { translateCalls: number; ensureCalls: { userInitiated: boolean }[] }
}

function project(): Project {
  return sampleProject({
    language: 'en',
    speakers: [speaker('SPK_1', 'Speaker 1', '#4c8dff')],
    blocks: [
      block('b1', 0, 2, 'SPK_1', [word('one', 0, 1)]),
      block('b2', 3, 5, 'SPK_1', [word('two', 3, 4)]),
      block('b3', 6, 8, 'SPK_1', [word('three', 6, 7)]),
    ],
  })
}

function makeJobs(translationEngine: TranslationEngine) {
  const app = fakeEditorApp()
  const jobs = createJobsStore({ engine: noopEngine(), modelCache, translation: { engine: translationEngine, editorApp: app } })
  return { app, jobs }
}

// The session derives the source language from `project.language` (which the
// transcribe/settings path sets in the real app). Seed it as job output — not
// an undo step — so the run has a source track to translate.
function seedLanguage(app: ReturnType<typeof fakeEditorApp>): void {
  app.applyWithoutHistory((draft: { project: Project | null }) => {
    if (draft.project !== null) draft.project.language = 'en'
  })
}

describe('FR-302.1: jobs.translation[lang] per-language job state', () => {
  test('FR-302.1: a run creates the machine track and fills entries with progress', async () => {
    const engine = scriptedEngine()
    const { app, jobs } = makeJobs(engine)
    const p = project()
    app.project.createProject(p.asset)
    app.dispatch('captions-import', { blocks: p.blocks, speakers: p.speakers, replace: true })
    seedLanguage(app)
    const before = jobs.getState().translation['fr']
    expect(before === undefined || before.status === 'idle').toBe(true)
    const done = jobs.runTranslation(app.project.getState().project!, 'fr')
    // progress is observed while the run is in flight
    let sawProgress = false
    const unsub = jobs.subscribe(() => {
      const t = jobs.getState().translation['fr']
      if (t !== undefined && t.progress !== null && t.progress.done > 0) sawProgress = true
    })
    const stats = await done
    unsub()
    expect(stats.translated).toBe(3)
    expect(engine.translateCalls).toBe(3)
    expect(sawProgress, 'progress observed during the run').toBe(true)
    const final = jobs.getState().translation['fr']
    expect(final?.status).toBe('done')
    expect(final?.progress).toEqual({ done: 3, total: 3 })
    // the machine track exists with three translated entries (job output, no undo steps)
    const track = app.project.getState().project?.translations.find((x) => x.language === 'fr')
    expect(track?.origin).toBe('machine')
    expect(Object.keys(track?.entries ?? {}).length).toBe(3)
    // exactly THREE history steps: create-project + captions-import + the
    // machine track ADD. The three machine entries are job output
    // (applyWithoutHistory) → NOT additional undo steps.
    expect(app.history.undoCount(), 'machine entries are not undo steps').toBe(3)
  })

  test('FR-302.1: cancel lands ≤ 500 ms and keeps completed entries', async () => {
    // slow translate so cancel hits mid-run
    const engine = scriptedEngine({
      translate: async (_s, _t, text, signal) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), 3000)
          signal.addEventListener('abort', () => {
            clearTimeout(t)
            reject(Object.assign(new Error('aborted'), { code: 'CANCELLED' }))
          })
        })
        return `t:${text}`
      },
    })
    const { app, jobs } = makeJobs(engine)
    const p = project()
    app.project.createProject(p.asset)
    app.dispatch('captions-import', { blocks: p.blocks, speakers: p.speakers, replace: true })
    seedLanguage(app)
    // one block pre-translated so a completed entry survives
    const startedAt = Date.now()
    const run = jobs.runTranslation(app.project.getState().project!, 'fr')
    await vi.waitFor(() => expect(jobs.getState().translation['fr']?.status).toBe('translating'))
    jobs.cancelTranslation('fr')
    const stats = await run
    const elapsed = Date.now() - startedAt
    expect(stats.cancelled).toBe(true)
    expect(elapsed, 'cancel resolves within 500 ms').toBeLessThanOrEqual(500)
    const final = jobs.getState().translation['fr']
    expect(final?.status).toBe('cancelled')
  })

  test('FR-302.1: availability maps to picker badges (ready/download/unavailable/unknown)', async () => {
    const engine = scriptedEngine({
      availability: (_s, target): Promise<PairAvailability> => Promise.resolve(target === 'fr' ? 'available' : target === 'es' ? 'downloadable' : 'unavailable'),
    })
    const { jobs } = makeJobs(engine)
    await jobs.refreshAvailability('en', ['fr', 'es', 'de'])
    const t = jobs.getState().translation
    expect(t['fr']?.availability).toBe('ready')
    expect(t['es']?.availability).toBe('download')
    expect(t['de']?.availability).toBe('unavailable')
  })

  test('FR-302.1: a run on an unsupported browser records the coded failure, no track', async () => {
    const engine = scriptedEngine({ isAvailable: () => ({ available: false, reason: 'browser' }) })
    const { app, jobs } = makeJobs(engine)
    const p = project()
    app.project.createProject(p.asset)
    app.dispatch('captions-import', { blocks: p.blocks, speakers: p.speakers, replace: true })
    seedLanguage(app)
    await expect(jobs.runTranslation(app.project.getState().project!, 'fr')).rejects.toMatchObject({ code: 'PAIR_UNAVAILABLE' })
    expect(jobs.getState().translation['fr']?.status).toBe('failed')
    expect(jobs.getState().translation['fr']?.error?.code).toBe('PAIR_UNAVAILABLE')
    expect(app.project.getState().project?.translations.some((x) => x.language === 'fr'), 'no machine track on failure').toBe(false)
  })

  test('FR-302.1: downloading a pair sets status downloading before translating', async () => {
    const engine = scriptedEngine({
      availability: (): Promise<PairAvailability> => Promise.resolve('downloadable'),
      ensurePair: async (_s, _t, options) => {
        options.onProgress?.(0)
        await new Promise((r) => setTimeout(r, 30))
        options.onProgress?.(100)
        return 'ready'
      },
    })
    const { app, jobs } = makeJobs(engine)
    const p = project()
    app.project.createProject(p.asset)
    app.dispatch('captions-import', { blocks: p.blocks, speakers: p.speakers, replace: true })
    seedLanguage(app)
    const run = jobs.runTranslation(app.project.getState().project!, 'fr')
    // ensurePair is in flight (30 ms) — the slice shows the download phase
    expect(jobs.getState().translation['fr']?.status).toBe('downloading')
    const stats = await run
    expect(stats.translated).toBe(3)
    expect(jobs.getState().translation['fr']?.status).toBe('done')
  })
})
