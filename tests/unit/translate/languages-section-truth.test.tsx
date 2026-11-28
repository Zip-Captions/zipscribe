// CC-112.6 (L2, jsdom): Languages section TRUTHFULNESS (FR-112.4, #54). The
// section currently renders from the SOURCE LANGUAGE ALONE: any project
// without `project.language` falls into the "Transcribe or set a source
// language to enable translation." empty state — even when translation tracks
// exist (the measured #54 contradiction: the Export dialog listed
// `source` + `es`, the section claimed there were none). The section must
// render from project tracks — `project.language` + `project.translations` —
// and replace the empty state whenever ANY track exists, showing the source
// language user-visible (the pinned `languages-source` element carries it).
//
// Branch matrix: no language + no tracks → honest empty state (frozen
// behavior, GREEN guard); language set → section with the source rendered;
// tracks without a language → tracks rendered anyway (the #54 half, RED
// today); language + es track → source + es row (export parity).
// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { createFakeTranslationEngine } from '../editor/helpers/fake-export-port'
import { createFakeModelCache, createProbingEngine } from '../workbench/helpers/fake-engine'
import { createJobsStore } from '@state/jobs'
import type { JobsStore } from '@state/jobs'
import { block, sampleProject, speaker, word } from '../editor/helpers/fixture-project'
import { installDomStubs } from '../transcript/helpers/dom-stubs'
import { LanguagesSection } from '@ui/translate/LanguagesSection'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import type { Project, TranslationTrack } from '@engine/model@104'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'

const SPEAKERS = [speaker('SPK_1', 'Speaker 1', '#4c8dff')]
const BLOCKS = [block('b1', 0, 2, 'SPK_1', [word('alpha', 0, 1)]), block('b2', 3, 5, 'SPK_1', [word('beta', 3, 4)]), block('b3', 6, 8, 'SPK_1', [word('gamma', 6, 7)])]

const ES_TRACK: TranslationTrack = { language: 'es', origin: 'imported', engine: null, entries: {} }

function project(overrides: Partial<Project> = {}): Project {
  return sampleProject({ speakers: SPEAKERS.map((s) => ({ ...s })), blocks: BLOCKS.map((b) => ({ ...b, words: b.words.map((w) => ({ ...w })) })), ...overrides })
}

let DISPOSE: (() => void) | null = null

function mount(proj: Project): { jobs: JobsStore } {
  installDomStubs()
  const t = createTestApp({ project: proj })
  const jobs: JobsStore = createJobsStore({ engine: createProbingEngine(), modelCache: createFakeModelCache(), translation: { engine: createFakeTranslationEngine({ available: ['es', 'fr'] }), editorApp: t.app } })
  act(() => {
    render(<LanguagesSection app={t.app} jobs={jobs} />)
  })
  DISPOSE = () => t.app.dispose()
  return { jobs }
}

const section = (): HTMLElement | null => document.querySelector('section[aria-label="Languages"]')

afterEach(() => {
  cleanup()
  DISPOSE?.()
  DISPOSE = null
})

describe('CC-112.6: the Languages section renders project-track truth, never the false empty state', () => {
  test('CC-112.6: no language and no tracks keeps the honest empty state (frozen branch, guard)', async () => {
    if (CHILD) return
    mount(project({ language: null, translations: [] }))
    await act(async () => {})
    const root = section()
    expect(root, 'the section mounts').not.toBeNull()
    expect(root?.textContent ?? '', 'no truth to show — the transcribe prompt stays honest').toContain('Transcribe or set a source language')
    expect(document.querySelector('[data-testid="languages-add"]'), 'no Add affordance without any truth').toBeNull()
  })

  test('CC-112.6: a project with a source language renders it — not the transcribe-only empty state (FR-112.4)', async () => {
    if (CHILD) return
    mount(project({ language: 'en', translations: [] }))
    await act(async () => {})
    const root = section()
    expect(root, 'the section mounts').not.toBeNull()
    expect(root?.textContent ?? '', 'the section no longer contradicts the project').not.toContain('Transcribe or set a source language')
    const source = document.querySelector('[data-testid="languages-source"]') as HTMLElement | null
    expect(source, 'the source language is user-visible (pinned languages-source element)').not.toBeNull()
    expect(source?.getAttribute('data-language'), 'the rendered source is the project language tag').toBe('en')
    expect(document.querySelector('[data-testid="languages-add"]'), 'the Add-language affordance is reachable').not.toBeNull()
  })

  test('CC-112.6: translation tracks WITHOUT a source language still render the tracks (the #54 contradiction)', async () => {
    if (CHILD) return
    mount(project({ language: null, translations: [ES_TRACK] }))
    await act(async () => {})
    const root = section()
    expect(root, 'the section mounts').not.toBeNull()
    expect(root?.textContent ?? '', 'an existing track must beat the empty state — the section cannot deny tracks the Export dialog already lists (#54)').not.toContain('Transcribe or set a source language')
    const esRow = document.querySelector('[data-testid="languages-row"][data-language="es"]') as HTMLElement | null
    expect(esRow, 'the es track is listed').not.toBeNull()
  })

  test('CC-112.6: source + imported es track render both — parity with the Export dialog track list', async () => {
    if (CHILD) return
    mount(project({ language: 'en', translations: [ES_TRACK] }))
    await act(async () => {})
    const spy = createRedactionSpy()
    const root = section()
    expect(root, 'the section mounts').not.toBeNull()
    expect(root?.textContent ?? '').not.toContain('Transcribe or set a source language')
    expect(document.querySelector('[data-testid="languages-source"]')?.getAttribute('data-language'), 'source shows en').toBe('en')
    expect(document.querySelector('[data-testid="languages-row"][data-language="es"]'), 'the es track shows next to the source').not.toBeNull()
    expect(spy.settle().clean, 'nothing translation-bearing reached a console channel').toBe(true)
    spy.restore()
  })
})
