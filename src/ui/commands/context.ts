// The FR-105.3 context model (CC-105.2): PURE, DOM-free predicates — the
// caller reads document/navigator and feeds plain data in, so every `when`
// gate decision is unit-testable in the node environment. INPUT/TEXTAREA/
// SELECT or contenteditable focus ⇒ 'input' (the app never hijacks typing);
// the timeline region wins over the transcript region; selection passes
// through from the editor slice shape.

export type CommandFocus = 'body' | 'input' | 'timeline' | 'transcript'

export interface CommandSelection {
  anchorBlockId: string | null
  focusBlockId: string | null
}

export interface ContextInput {
  activeElementTag: string | null
  isContentEditable: boolean
  inTimelineRegion: boolean
  inTranscriptRegion: boolean
  searchOpen: boolean
  hasSelection: boolean
  selection?: CommandSelection | null
}

export interface CommandContext {
  focus: CommandFocus
  selection: CommandSelection | null
  searchOpen: boolean
}

const INPUT_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function resolveContext(input: ContextInput): CommandContext {
  const tag = input.activeElementTag !== null ? input.activeElementTag.toUpperCase() : null
  let focus: CommandFocus = 'body'
  if (input.isContentEditable || (tag !== null && INPUT_TAGS.has(tag))) focus = 'input'
  else if (input.inTimelineRegion) focus = 'timeline'
  else if (input.inTranscriptRegion) focus = 'transcript'
  const selection = input.hasSelection && input.selection !== null && input.selection !== undefined ? input.selection : null
  return { focus, selection, searchOpen: input.searchOpen }
}
