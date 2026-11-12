// CC-104.3 (L2): in-place word editing — double-click opens the frozen
// `[data-testid=transcript-editor]` (the ONLY onKeyDown-bearing component,
// conventions § UI conventions editable allowlist); Enter commits through
// `block-edit-text` (never any other mutation path); Shift+Enter inserts a
// manual line break (word.breakAfter, invariant 2); Esc reverts with NO
// command; blur commits; paste is sanitized (no HTML reaches the project);
// IME composition dispatches NOTHING mid-composition. Edit-preserves-timing
// golden: the equal-length whole-word edit 'beta' → 'veto' reproduces the
// word timings BYTE-IDENTICALLY (fixtures/golden/transcript/
// edit-preserves-timing.words.json — canonicalize of the frozen expected
// words). Canary-free corpus (editTarget) but spy attached (project content
// passes through editor surfaces).
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { createTestApp } from '../editor/helpers/editor-app'
import { canonicalize, serializeProject } from '@state/services/serialize'
import { createRedactionSpy } from '../../../src/test-support/redaction'
import { editTargetProject } from './helpers/transcript-fixture'
import { installDomStubs } from './helpers/dom-stubs'
import type { Project, WordToken } from '@engine/model@104'
import type { EditorApp } from '@state/history'

const SPEC_TRANSCRIPT = '@ui/transcript/Transcript'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

// cwd-relative (vitest runs at the package root): the jsdom environment gives
// a non-file `import.meta.url`, so `new URL(…, import.meta.url)` is unusable here.
const GOLDEN_WORDS = readFileSync(join(process.cwd(), 'fixtures/golden/transcript/edit-preserves-timing.words.json'), 'utf8').trimEnd()

async function mount(): Promise<{ app: EditorApp; dispose: () => void }> {
  const t = createTestApp({ project: editTargetProject() })
  const { Transcript } = (await import(/* @vite-ignore */ SPEC_TRANSCRIPT)) as typeof import('@ui/transcript/Transcript')
  act(() => {
    render(<Transcript app={t.app} rafs={t.rafs} heightPx={480} />)
  })
  return { app: t.app, dispose: () => t.app.dispose() }
}

function project(app: EditorApp): Project {
  return app.project.getState().project as Project
}

async function openEditor(): Promise<HTMLElement> {
  const wordEl = screen.getAllByTestId('transcript-word')[0]
  const target = screen.getAllByTestId('transcript-word')[1]!
  expect(wordEl, 'word spans render').toBeDefined()
  const user = userEvent.setup({ delay: null })
  await user.dblClick(target)
  const editor = screen.getByTestId('transcript-editor') as HTMLElement
  expect(editor.getAttribute('contenteditable'), 'contenteditable in-place editor').toBe('true')
  return editor
}

async function typeText(editor: HTMLElement, text: string): Promise<void> {
  const user = userEvent.setup({ delay: null })
  await user.clear(editor)
  await user.type(editor, text)
}

afterEach(cleanup)

describe('CC-104.3 (L2): in-place editing — goldens, break, revert, blur, paste, IME', () => {
  test('CC-104.3: dblclick → edit → Enter commits block-edit-text; equal-length edit keeps word times BYTE-equal (golden); ONE step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      const undoBefore = app.history.undoCount()
      const editor = await openEditor()
      await typeText(editor, 'alpha veto gamma')
      const user = userEvent.setup({ delay: null })
      await user.keyboard('{Enter}')
      const blk = project(app).blocks.find((b) => b.id === 'blk_a')!
      expect(blk.text, 'committed via block-edit-text').toBe('alpha veto gamma')
      expect(canonicalize(blk.words as unknown as WordToken[]), 'edit preserves timing — frozen golden').toBe(GOLDEN_WORDS)
      expect(app.history.undoCount(), 'the edit is ONE undo step').toBe(undoBefore + 1)
      app.history.undo()
      expect(project(app).blocks.find((b) => b.id === 'blk_a')?.text).toBe('alpha beta gamma')
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.3: Shift+Enter inserts a manual line break (breakAfter, invariant 2)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      const editor = await openEditor()
      await typeText(editor, 'alpha')
      const user = userEvent.setup({ delay: null })
      // Break placed MID-TEXT (type the first word, break, then the rest):
      // domain.md invariant 2 (text == words joined by ' ' / '\n' after
      // breakAfter) makes a TRAILING breakAfter emit no character, so a
      // trailing '\n' in text is impossible — mid-text breaks are the only
      // observable form (orchestrator adjudication 2026-11-12).
      await user.keyboard('{Shift>}{Enter}{/Shift}')
      await user.type(editor, ' beta gamma')
      await user.keyboard('{Enter}')
      const blk = project(app).blocks.find((b) => b.id === 'blk_a')!
      expect(blk.text, 'Shift+Enter produced a manual break — text carries an internal \\n').toContain('\n')
      expect(blk.words.some((w) => w.breakAfter === true), 'a word carries breakAfter').toBe(true)
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.3: Esc reverts — editor closes, project byte-identical, NO history step', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      const before = serializeProject(project(app))
      const undoBefore = app.history.undoCount()
      const editor = await openEditor()
      await typeText(editor, 'totally different text')
      const user = userEvent.setup({ delay: null })
      await user.keyboard('{Escape}')
      expect(screen.queryByTestId('transcript-editor'), 'editor closed').toBeNull()
      expect(serializeProject(project(app)), 'revert — nothing committed').toBe(before)
      expect(app.history.undoCount(), 'Esc dispatches NO command').toBe(undoBefore)
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.3: blur commits the edit', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      const undoBefore = app.history.undoCount()
      const editor = await openEditor()
      await typeText(editor, 'alpha beta gamma delta')
      act(() => {
        editor.blur()
        fireEvent.blur(editor)
      })
      expect(project(app).blocks.find((b) => b.id === 'blk_a')?.text).toBe('alpha beta gamma delta')
      expect(app.history.undoCount()).toBe(undoBefore + 1)
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.3: paste is sanitized — no HTML markup reaches the project', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      const editor = await openEditor()
      const html = '<b>bold</b><script>evil()</script>hello'
      const plain = 'boldhello'
      const data = {
        types: ['text/html', 'text/plain'],
        getData: (kind: string) => (kind === 'text/html' ? html : kind === 'text/plain' ? plain : ''),
      }
      fireEvent.paste(editor, { clipboardData: data })
      const user = userEvent.setup({ delay: null })
      await user.keyboard('{Enter}')
      const blk = project(app).blocks.find((b) => b.id === 'blk_a')!
      expect(blk.text, 'no markup survives the paste').not.toContain('<')
      expect(blk.text, 'the plain text survives').toContain('boldhello')
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })

  test('CC-104.3: IME composition — Enter mid-composition commits NOTHING; compositionEnd then Enter commits', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const redaction = createRedactionSpy()
    const dom = installDomStubs()
    try {
      const { app, dispose } = await mount()
      const before = serializeProject(project(app))
      const undoBefore = app.history.undoCount()
      const editor = await openEditor()
      await typeText(editor, 'alpha べーた gamma')
      fireEvent.compositionStart(editor)
      const user = userEvent.setup({ delay: null })
      await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
      fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', isComposing: true })
      fireEvent.keyUp(editor, { key: 'Enter', code: 'Enter', isComposing: true })
      expect(screen.getByTestId('transcript-editor'), 'still composing — editor open').toBeInTheDocument()
      expect(serializeProject(project(app)), 'no command during composition').toBe(before)
      expect(app.history.undoCount()).toBe(undoBefore)
      fireEvent.compositionEnd(editor)
      await user.keyboard('{Enter}')
      expect(project(app).blocks.find((b) => b.id === 'blk_a')?.text, 'committed after composition').toContain('べーた')
      expect(app.history.undoCount(), 'exactly ONE step after composition commit').toBe(undoBefore + 1)
      expect(redaction.settle().clean).toBe(true)
      dispose()
    } finally {
      dom.restore()
      redaction.restore()
    }
  })
})
