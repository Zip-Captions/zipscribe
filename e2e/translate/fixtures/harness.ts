// CC-301.3 (L4) browser harness for the unit-301 translation session — the
// REAL session/plan/track modules run in a real Chromium page; ONLY the
// built-in Translator/LanguageDetector APIs are scripted (they are
// Chrome-internal, not under test here — the adapter contract they exercise
// is proven in tests/unit/translate/chrome-translator.test.ts). NOTHING of
// the thing under test (session scheduling, batching, plan, applyEntries) is
// stubbed: the session runs with its PRODUCTION default scheduler
// (setTimeout 0) — that yielding behaviour is precisely what the long-task
// gate measures.
//
// The engine modules load via DYNAMIC import so the page always boots
// (ready=true) and the spec fails on the RUN with the surfaced error.
//
// SECURITY-03: only numbers and codes cross the page boundary — block texts
// are synthetic fixture content and never leave the page.
import { sampleProject, block, word, speaker } from '../../../tests/unit/editor/helpers/fixture-project'
import type { Project } from '@engine/model@102'

interface LongTaskRecord {
  duration: number
  startTime: number
  name: string
}

export interface TranslateRunOptions {
  blockCount: number
}

export interface TranslateRunSummary {
  ok: boolean
  error?: { code: string; retryable: boolean; detail?: string }
  planned: number
  translated: number
  passThrough: number
  failed: number
  cancelled: boolean
  entriesApplied: number
  translateCalls: number
}

const longTasks: LongTaskRecord[] = []
let observer: PerformanceObserver | null = null

function startLongTaskWatch(): void {
  longTasks.length = 0
  observer?.disconnect()
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const attribution = (entry as PerformanceEntry & { attribution?: { name: string }[] }).attribution
      longTasks.push({ duration: entry.duration, startTime: entry.startTime, name: attribution?.[0]?.name ?? 'unknown' })
    }
  })
  observer.observe({ entryTypes: ['longtask'] })
}

function stopLongTaskWatch(): LongTaskRecord[] {
  observer?.disconnect()
  observer = null
  return [...longTasks]
}

// Scripted built-in APIs (the adapter consumes globalThis.Translator /
// globalThis.LanguageDetector — static availability()/create(), sequential
// per-instance translate, destroy(), monitor with downloadprogress).
let translateCalls = 0

function installScriptedApis(): void {
  const g = globalThis as Record<string, unknown>
  g.Translator = {
    async availability() {
      return 'available'
    },
    async create(init: { monitor?: (m: { addEventListener: (t: string, cb: (e: { loaded: number; total: number }) => void) => void }) => void }) {
      init.monitor?.({
        addEventListener: (_t, cb) => {
          cb({ loaded: 50, total: 100 })
        },
      })
      return {
        async translate(input: string) {
          translateCalls += 1
          // The criterion's API profile (CC-301.3: mocked latency 30–300 ms).
          // Real async API work + yielding the loop is the honest shape of
          // what the session must not turn into a synchronous burst.
          await new Promise((r) => setTimeout(r, 30 + Math.random() * 60))
          return `fr:${input}`
        },
        destroy() {
          /* scripted instances hold no resources */
        },
      }
    },
  }
  g.LanguageDetector = {
    async availability() {
      return 'available'
    },
    async create() {
      return {
        async detect() {
          // Source is 'en' — detection returns the SOURCE language, so the
          // session translates (pass-through stays 0; it is unit-tested).
          return [{ detectedLanguage: 'en', confidence: 0.95 }]
        },
        destroy() {
          /* scripted */
        },
      }
    },
  }
}

// Pre-import the modules under test AT BOOT so the first run() (inside the
// long-task watch window) never pays vite dev-server transform cost — a
// transform spike is page-context work unrelated to the session and would
// flake the gate.
const modulesReady = Promise.all([import('@engine/translate/chrome-translator'), import('@engine/translate/session'), import('@engine/translate/track')])

async function run(options: TranslateRunOptions): Promise<TranslateRunSummary> {
  const base: TranslateRunSummary = { ok: false, planned: 0, translated: 0, passThrough: 0, failed: 0, cancelled: false, entriesApplied: 0, translateCalls: 0 }
  try {
    const [{ createChromeTranslationEngine }, { createTranslationSession }, { applyEntries }] = await modulesReady
    installScriptedApis()
    translateCalls = 0
    const speakers = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]
    const blocks = Array.from({ length: options.blockCount }, (_, i) => block(`blk_${i}`, i * 1.5, i * 1.5 + 1.4, 'SPK_1', [word(`synthetic sentence number ${i}`, i * 1.5, i * 1.5 + 1.4)]))
    const project: Project = sampleProject({
      language: 'en',
      blocks,
      speakers,
      translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: {} }],
    })
    const session = createTranslationSession(createChromeTranslationEngine())
    let entriesApplied = 0
    const stats = await session.run(project, 'fr', {
      onEntries: (updates) => {
        entriesApplied += applyEntries(project, 'fr', updates)
      },
    })
    session.dispose()
    return { ok: true, planned: stats.planned, translated: stats.translated, passThrough: stats.passThrough, failed: stats.failed, cancelled: stats.cancelled, entriesApplied, translateCalls }
  } catch (error) {
    const e = error as { code?: string; retryable?: boolean; detail?: string }
    return { ...base, error: { code: e.code ?? 'HARNESS_IMPORT_FAILED', retryable: e.retryable ?? false, ...(e.detail === undefined ? {} : { detail: e.detail }) } }
  }
}

const harness = { run, startLongTaskWatch, stopLongTaskWatch }
;(globalThis as Record<string, unknown>).__zipscribeTranslateHarness = harness
// Ready only once the boot pre-import has settled — otherwise a spec's
// three quick round-trips could start the long-task watch while vite dev
// transforms are still in flight.
void modulesReady.then(() => {
  ;(globalThis as Record<string, unknown>).__zipscribeTranslateHarnessReady = true
})
