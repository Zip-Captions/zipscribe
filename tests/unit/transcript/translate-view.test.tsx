// FR-302.2 / US-302.2 / CC-302.3 (L2): the transcript view-mode switcher —
// ⌘⇧L (`translate.cycle-view`) cycles source → translation → side-by-side;
// the active language renders its track text with the correct `dir`/`lang`
// (Arabic → RTL) and per-entry status badges (Machine-translated / Edited /
// Stale / Failed); a stale row exposes "Mark as reviewed" (→
// `translation-mark-reviewed`); a translation edit commits through
// `translation-edit-entry` and NOTHING else. SECURITY-03: content passes
// through render surfaces only — spy attached, nothing logged.
// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { sampleProject, block, word, speaker } from '../editor/helpers/fixture-project'
import { installDomStubs } from './helpers/dom-stubs'
import { dispatchCommand } from '@ui/commands/registry'
import { sourceTextHash } from '@engine/captions/qc'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import type { Project, TranslationTrack } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'
const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

installDomStubs()
const spy = createRedactionSpy()
afterEach(() => {
  cleanup()
  expect(spy.settle().clean, 'no transcript/caption content reaches a console channel').toBe(true)
  spy.restore()
})

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]
const BLOCKS = [block('blk_a', 0.5, 2.5, 'SPK_1', [word('alpha', 0.5, 1.2), word('beta', 1.3, 1.9)]), block('blk_b', 3.0, 5.0, 'SPK_1', [word('delta', 3.0, 4.1), word('epsilon', 4.2, 5.0)]), block('blk_c', 6.0, 7.0, 'SPK_1', [word('zeta', 6.0, 7.0)])]

function track(language: string, entries: TranslationTrack['entries']): TranslationTrack {
  return { language, origin: 'machine', engine: 'chrome-translator', entries }
}
// Each entry's sourceHash matches its source block's text, so entries are NOT
// stale until that block's text changes (the Stale test edits blk_a).
const H = { a: sourceTextHash(BLOCKS[0]!.text), b: sourceTextHash(BLOCKS[1]!.text), c: sourceTextHash(BLOCKS[2]!.text) }

function translationProject(overrides: Partial<Project> = {}): Project {
  return sampleProject({
    speakers: SPEAKERS.map((s) => ({ ...s })),
    blocks: BLOCKS.map((b) => ({ ...b, words: b.words.map((w) => ({ ...w })) })),
    language: 'en',
    translations: [
      track('fr', {
        blk_a: { text: 'alpha-fr', status: 'translated', sourceHash: H.a },
        blk_b: { text: 'delta-fr', status: 'edited', sourceHash: H.b },
        blk_c: { text: 'zeta-fr', status: 'failed', sourceHash: H.c },
      }),
      track('ar', {
        blk_a: { text: 'alpha-ar', status: 'translated', sourceHash: H.a },
        blk_b: { text: 'delta-ar', status: 'translated', sourceHash: H.b },
        blk_c: { text: 'zeta-ar', status: 'translated', sourceHash: H.c },
      }),
    ],
    ...overrides,
  })
}

async function mount(project: Project): Promise<{ app: EditorApp; dispose: () => void }> {
  const t = createTestApp({ project })
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
  return { app: t.app, dispose: () => t.app.dispose() }
}

function texts(testId: string): string[] {
  return Array.from(document.querySelectorAll(`[data-testid="${testId}"]`)).map((el) => el.textContent ?? '')
}

describe('FR-302.2: ⌘⇧L cycles the transcript view mode', () => {
  test('CC-302.2: cycle advances source → translation → split → source', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    const { app, dispose } = await mount(translationProject())
    expect(app.editor.getState().viewMode).toBe('source')
    act(() => dispatchCommand('translate.cycle-view'))
    expect(app.editor.getState().viewMode).toBe('translation')
    expect(app.editor.getState().activeLanguage, 'a track is adopted on entering translation').toBe('fr')
    act(() => dispatchCommand('translate.cycle-view'))
    expect(app.editor.getState().viewMode).toBe('split')
    act(() => dispatchCommand('translate.cycle-view'))
    expect(app.editor.getState().viewMode).toBe('source')
    dispose()
  })

  test('FR-302.2: source view shows source words and no translation column', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    const { dispose } = await mount(translationProject())
    expect(texts('transcript-row-text').join(' ')).toContain('alpha')
    expect(document.querySelectorAll('[data-testid="transcript-translation-text"]').length).toBe(0)
    dispose()
  })

  test('US-302.2: translation view shows the active track text; split shows both', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    const { app, dispose } = await mount(translationProject())
    act(() => {
      app.editor.setViewMode('translation')
      app.editor.setActiveLanguage('fr')
    })
    expect(texts('transcript-translation-text')).toEqual(['alpha-fr', 'delta-fr', 'zeta-fr'])
    expect(texts('transcript-row-text').length, 'translation-only hides source words').toBe(0)
    act(() => app.editor.setViewMode('split'))
    expect(texts('transcript-translation-text').length).toBe(3)
    expect(texts('transcript-row-text').length, 'split shows both columns').toBe(3)
    dispose()
  })
})

describe('CC-302.3: translation text carries the script direction', () => {
  test('CC-302.3: Arabic rows render dir=rtl + lang; Latin rows render dir=ltr', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    const { app, dispose } = await mount(translationProject())
    act(() => {
      app.editor.setViewMode('translation')
      app.editor.setActiveLanguage('ar')
    })
    const nodes = Array.from(document.querySelectorAll('[data-testid="transcript-translation-text"]'))
    expect(nodes.length).toBe(3)
    for (const node of nodes) {
      expect(node.getAttribute('dir'), 'Arabic is RTL').toBe('rtl')
      expect(node.getAttribute('lang')).toBe('ar')
    }
    act(() => app.editor.setActiveLanguage('fr'))
    expect(document.querySelector('[data-testid="transcript-translation-text"]')?.getAttribute('dir')).toBe('ltr')
    dispose()
  })
})

describe('US-302.2: per-entry status badges + review', () => {
  test('US-302.2: Machine-translated / Edited / Failed badges render from entry status', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    const { app, dispose } = await mount(translationProject())
    act(() => {
      app.editor.setViewMode('translation')
      app.editor.setActiveLanguage('fr')
    })
    const badges = texts('transcript-translation-badge')
    expect(badges).toContain('Machine-translated')
    expect(badges).toContain('Edited')
    expect(badges).toContain('Failed')
    dispose()
  })

  test('US-302.2: a stale entry renders Stale and Mark-as-reviewed dispatches the command', async () => {
    if (CHILD) return test.skip(true, CHILD_REASON)
    const { app, dispose } = await mount(translationProject())
    const dispatched: Array<{ type: string; payload: unknown }> = []
    const realDispatch = app.dispatch.bind(app)
    app.dispatch = ((type: string, payload: unknown) => {
      dispatched.push({ type, payload })
      return realDispatch(type, payload)
    }) as typeof app.dispatch
    // blk_a's source is edited → its fr entry (sourceHash 'DEADBEEF') goes stale.
    act(() => app.dispatch('block-edit-text', { blockId: 'blk_a', text: 'alpha changed' }))
    act(() => {
      app.editor.setViewMode('translation')
      app.editor.setActiveLanguage('fr')
    })
    const badges = texts('transcript-translation-badge')
    expect(badges, 'the edited source flips the entry to Stale').toContain('Stale')
    const review = document.querySelector('[data-testid="transcript-mark-reviewed"]') as HTMLButtonElement | null
    expect(review, 'a stale row offers Mark as reviewed').not.toBeNull()
    act(() => review?.click())
    expect(dispatched.some((d) => d.type === 'translation-mark-reviewed' && (d.payload as { blockId: string }).blockId === 'blk_a')).toBe(true)
    dispose()
  })
})
