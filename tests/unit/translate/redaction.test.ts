// CC-301.5 (L1) / SECURITY-03: translation text — source or machine — never
// reaches a log, and EngineError details carry codes/numbers only.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTranslationSession } from '@engine/translate/session'
import { createChromeTranslationEngine } from '@engine/translate/chrome-translator'
import { createTranslationApplyService } from '@state/services/translation-apply'
import { createTestApp } from '../editor/helpers/editor-app'
import { REAL_TRANSLATION_RULES } from '@engine/translate/track'
import type { TranslationEngine } from '@engine/translate/engine'
import type { Project } from '@engine/model'
import { sampleProject, block, word } from '../editor/helpers/fixture-project'

const CANARY = 'CANARY-zip-42-secret-caption-text'

const logs: unknown[][] = []
function spyConsole() {
  logs.length = 0
  for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push([level, ...args]))
  }
}
afterEach(() => {
  vi.restoreAllMocks()
  const g = globalThis as Record<string, unknown>
  delete g.Translator
  delete g.LanguageDetector
  if (Object.hasOwn(g, 'navigator')) delete g.navigator
})

function canaryProject(): Project {
  return sampleProject({
    language: 'en',
    blocks: [block('blk_1', 0, 1.9, 'SPK_1', [word(CANARY, 0, 1.9)]), block('blk_2', 2, 3.9, 'SPK_1', [word('plain second block', 2, 3.9)])],
    translations: [{ language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: {} }],
  })
}

function noLogsContainCanary(label: string) {
  for (const [level, ...args] of logs) {
    const rendered = args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' ')
    expect(`${label}: [${level}] ${rendered}`).not.toContain(CANARY)
  }
}

describe('CC-301.5: session redaction', () => {
  test('CC-301.5: failing runs log ONE code-only warning; canary text never appears in any console call', async () => {
    spyConsole()
    const engine: TranslationEngine = {
      isAvailable: () => ({ available: true }),
      availability: async () => 'available',
      ensurePair: async () => 'ready',
      translate: async (_s, _t, text) => {
        if (text.includes('CANARY')) {
          throw Object.assign(new Error(`translate exploded on "${text}"`), { name: 'UnknownError', message: `secret "${text}" leaked into message` })
        }
        return `traduit: ${text}`
      },
      detectLanguage: async () => ({ language: 'en', confidence: 0.9 }),
      dispose: () => undefined,
    }
    const session = createTranslationSession(engine, { scheduler: async () => undefined })
    const stats = await session.run(canaryProject(), 'fr')
    expect(stats.failed, 'CANARY block failed via the API error').toBe(1)
    expect(logs.length, 'exactly the aggregated warning (and nothing else)').toBe(1)
    noLogsContainCanary('session run')
    const warning = JSON.stringify(logs[0])
    expect(warning, 'codes retained').toContain('TRANSLATE_FAILED')
    expect(warning, 'error MESSAGES never reach the log (only the session-built summary)').not.toContain('leaked')
  })

  test('CC-301.5: adapter maps API error names through a whitelist — messages/names with content never surface', async () => {
    spyConsole()
    const g = globalThis as Record<string, unknown>
    g.Translator = {
      async availability() {
        return 'available'
      },
      async create() {
        return {
          async translate(input: string) {
            const error = new Error(`API blew up processing "${input}"`)
            error.name = `InternalError ${CANARY}`
            throw error
          },
          destroy() {},
        }
      },
    }
    Object.defineProperty(g, 'navigator', { value: { userAgent: 'Chrome/138', userActivation: { isActive: true } }, configurable: true })
    const engine = createChromeTranslationEngine()
    const error = (await engine.translate('en', 'fr', CANARY, new AbortController().signal).catch((e: unknown) => e)) as { code: string; detail?: string }
    expect(error.code).toBe('TRANSLATE_FAILED')
    expect(error.detail, 'whitelisted token only').toBe('API')
    expect(JSON.stringify(error)).not.toContain(CANARY)
    noLogsContainCanary('adapter translate')
    engine.dispose()
  })

  test('CC-301.5: command rejections echo ids/codes — never the translated text', () => {
    spyConsole()
    const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
    t.app.dispatch('translation-add-track', { language: 'fr', origin: 'manual' })
    const rejection = t.app.dispatch('translation-edit-entry', { language: 'fr', blockId: 'blk_missing', text: CANARY })
    expect(JSON.stringify(rejection)).not.toContain(CANARY)
    expect(rejection?.code).toBe('DANGLING_BLOCK_REF')
    noLogsContainCanary('command layer')
  })

  test('CC-301.5: the apply service with a failing engine — one aggregated warning, no text, no crash', async () => {
    spyConsole()
    const t = createTestApp({ translationRules: REAL_TRANSLATION_RULES })
    const engine: TranslationEngine = {
      isAvailable: () => ({ available: true }),
      availability: async () => 'available',
      ensurePair: async () => 'ready',
      translate: async (_s, _t, text) => {
        throw Object.assign(new Error(`fail on "${text}"`), { name: 'UnknownError' })
      },
      detectLanguage: async () => ({ language: 'en', confidence: 0.9 }),
      dispose: () => undefined,
    }
    const service = createTranslationApplyService({ editorApp: t.app, engine, scheduler: async () => undefined })
    const stats = await service.run(t.app.project.getState().project!, 'fr', {})
    expect(stats.failed).toBeGreaterThan(0)
    noLogsContainCanary('apply service')
    expect(logs.length, 'one aggregated warning for the run').toBe(1)
    service.dispose()
  })
})
