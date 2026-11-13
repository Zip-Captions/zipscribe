// CC-105.2 (L1, node — DOM-FREE): the FR-105.3 context model. Pure predicates:
// resolveContext({activeElementTag, isContentEditable, inTimelineRegion,
// inTranscriptRegion, searchOpen, hasSelection}) → {focus, selection}. INPUT/
// TEXTAREA/SELECT or contenteditable ⇒ 'input'; the timeline region wins when
// both regions report focus; selection passes through from the editor slice
// shape. No DOM globals (node env, no jsdom) — this suite is the proof the
// predicates are pure.
import { describe, expect, test } from 'vitest'
import { loadSeamModule } from './helpers/seams'
import type { CommandContext } from '@ui/commands/context'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test` / verify:unit'

type ContextModule = {
  resolveContext: (input: {
    activeElementTag: string | null
    isContentEditable: boolean
    inTimelineRegion: boolean
    inTranscriptRegion: boolean
    searchOpen: boolean
    hasSelection: boolean
    selection?: { anchorBlockId: string | null; focusBlockId: string | null } | null
  }) => CommandContext
}

const load = () => loadSeamModule<ContextModule>('@ui/commands/context')

const base = {
  activeElementTag: null as string | null,
  isContentEditable: false,
  inTimelineRegion: false,
  inTranscriptRegion: false,
  searchOpen: false,
  hasSelection: false,
}

describe('CC-105.2: FR-105.3 context model (pure predicates, node env)', () => {
  test('CC-105.2: INPUT/TEXTAREA/SELECT focus resolves to "input"', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const ctx = resolveContext({ ...base, activeElementTag: tag })
      expect(ctx.focus, `${tag} is an input focus`).toBe('input')
    }
  })

  test('CC-105.2: contenteditable focus resolves to "input"', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    const ctx = resolveContext({ ...base, activeElementTag: 'DIV', isContentEditable: true })
    expect(ctx.focus, 'contenteditable is an input focus (conventions: suppress during contenteditable)').toBe('input')
  })

  test('CC-105.2: input focus wins over region focus', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    const ctx = resolveContext({ ...base, activeElementTag: 'INPUT', inTimelineRegion: true, inTranscriptRegion: true })
    expect(ctx.focus, 'an input inside a region is still "input" (the app doesn\'t hijack typing)').toBe('input')
  })

  test('CC-105.2: timeline wins when both regions report focus', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    const ctx = resolveContext({ ...base, inTimelineRegion: true, inTranscriptRegion: true })
    expect(ctx.focus, 'timeline region focus wins').toBe('timeline')
  })

  test('CC-105.2: single-region focus resolves to that region', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    expect(resolveContext({ ...base, inTimelineRegion: true }).focus).toBe('timeline')
    expect(resolveContext({ ...base, inTranscriptRegion: true }).focus).toBe('transcript')
  })

  test('CC-105.2: body focus resolves to "body"', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    expect(resolveContext({ ...base }).focus).toBe('body')
  })

  test('CC-105.2: selection passes through from the editor slice shape', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    const selection = { anchorBlockId: 'blk_a', focusBlockId: 'blk_c' }
    const ctx = resolveContext({ ...base, inTimelineRegion: true, hasSelection: true, selection })
    expect(ctx.selection, 'selection echoes the editor slice shape').toEqual(selection)
    expect(ctx.focus).toBe('timeline')
  })

  test('CC-105.2: no selection (or hasSelection false) yields null selection', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    expect(resolveContext({ ...base, hasSelection: false, selection: { anchorBlockId: 'blk_a', focusBlockId: 'blk_a' } }).selection).toBeNull()
    expect(resolveContext({ ...base, hasSelection: true }).selection).toBeNull()
    expect(resolveContext({ ...base }).selection, 'body/no-selection → null').toBeNull()
  })

  test('CC-105.2: searchOpen is carried into the context (FR-105.3)', async ({ skip }) => {
    skip(CHILD, CHILD_REASON)
    const { resolveContext } = await load()
    expect(resolveContext({ ...base, searchOpen: true }).searchOpen).toBe(true)
    expect(resolveContext({ ...base }).searchOpen).toBe(false)
  })
})
