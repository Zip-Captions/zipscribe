// The CC-105.1 snapshot oracle: parses the REAL
// .ai-dlc/knowledge/design.md § Keyboard shortcuts table at test time (drift =
// CI fail) and normalizes the Key cells to registry chord spellings.
//
// Normalization (prose is NEVER parsed — only backtick-quoted tokens, so
// "(also ⌘G / ⌘⇧G; Ctrl+G / Ctrl+Shift+G)" and "unit-103 adjudication 10"
// notes inside cells can only contribute backticked chords):
//   1. `Ctrl/Cmd+…` / `Cmd/Ctrl+…` → `Cmd+…` (the CmdOrCtrl token).
//   2. Slash runs expand against the first segment's modifier/held prefix:
//      `Shift+J/L` → Shift+J, Shift+L · `Alt+1/2/3` → Alt+1, Alt+2, Alt+3 ·
//      `Z+←/→` → Z+←, Z+→.
//   3. Glyph map: ⌘/Cmd → CmdOrCtrl → BOTH 'Meta+' and 'Ctrl+' spellings
//      (design.md:73 Platform modifiers — ⌘ macOS, Ctrl elsewhere; the
//      frozen unit-103/104 rows register both); ⇧ → Shift; ⌥ → Alt; ⌃ → Ctrl;
//      ←/→ → ArrowLeft/ArrowRight; `Esc` → Escape; `Space` stays `Space`.
//   4. Modifier order normalized to the frozen Meta+Ctrl+Alt+Shift+<key>
//      (held-letter chords keep the letter directly before the base key).
// An unparseable token THROWS (drift must be loud, never silently skipped).

export type DesignRowOwner = 'registry' | 'editable' | 'wheel'

export interface ExpectedBinding {
  id: string
  keys: string
  when?: string
}

export interface DesignRowContract {
  /** EXACT design.md Action cell text (byte match — row edits fail). */
  action: string
  /** EXACT backtick tokens expected in the Key cell (byte match before
   *  expansion — the design file cannot silently change a chord). */
  tokens: readonly string[]
  owner: DesignRowOwner
  /** For owner 'registry': the frozen binding rows (every chord appears
   *  exactly once per (id, keys); reverse check: no registry binding exists
   *  outside this contract). */
  bindings: readonly ExpectedBinding[]
}

export const DESIGN_SECTION_HEADING = '## Keyboard shortcuts (v1 map)'

export const DESIGN_ROW_CONTRACT: readonly DesignRowContract[] = [
  {
    action: 'Play / pause',
    tokens: ['Space'],
    owner: 'registry',
    bindings: [{ id: 'transport.play-pause', keys: 'Space', when: 'not-editing' }],
  },
  {
    action: 'Seek ± 5 s',
    tokens: ['J', 'L', 'Shift+J/L'],
    owner: 'registry',
    bindings: [
      { id: 'transport.skip-backward', keys: 'J', when: 'not-editing' },
      { id: 'transport.skip-forward', keys: 'L', when: 'not-editing' },
      { id: 'transport.skip-backward-large', keys: 'Shift+J', when: 'not-editing' },
      { id: 'transport.skip-forward-large', keys: 'Shift+L', when: 'not-editing' },
    ],
  },
  {
    action: 'Playhead ± 1 frame',
    tokens: ['←', '→'],
    owner: 'registry',
    bindings: [
      { id: 'transport.step-backward', keys: 'ArrowLeft', when: 'not-editing' },
      { id: 'transport.step-forward', keys: 'ArrowRight', when: 'not-editing' },
    ],
  },
  {
    action: 'Playhead ± 1 s',
    tokens: ['Shift+←', 'Shift+→'],
    owner: 'registry',
    bindings: [
      { id: 'transport.step-second-backward', keys: 'Shift+ArrowLeft', when: 'not-editing' },
      { id: 'transport.step-second-forward', keys: 'Shift+ArrowRight', when: 'not-editing' },
    ],
  },
  {
    action: 'Go to start / end',
    tokens: ['⌘←', '⌘→', 'Home', 'End'],
    owner: 'registry',
    bindings: [
      { id: 'transport.seek-start', keys: 'Meta+ArrowLeft', when: 'not-editing' },
      { id: 'transport.seek-start', keys: 'Ctrl+ArrowLeft', when: 'not-editing' },
      { id: 'transport.seek-start', keys: 'Home', when: 'not-editing' },
      { id: 'transport.seek-end', keys: 'Meta+ArrowRight', when: 'not-editing' },
      { id: 'transport.seek-end', keys: 'Ctrl+ArrowRight', when: 'not-editing' },
      { id: 'transport.seek-end', keys: 'End', when: 'not-editing' },
    ],
  },
  {
    action: 'Split caption block at playhead',
    tokens: ['S'],
    owner: 'registry',
    bindings: [{ id: 'timeline.split', keys: 'S', when: 'not-editing' }],
  },
  {
    action: 'Merge selected with next block',
    tokens: ['Ctrl/Cmd+Shift+M'],
    owner: 'registry',
    bindings: [
      { id: 'timeline.merge', keys: 'Meta+Shift+M', when: 'not-editing' },
      { id: 'timeline.merge-ctrl', keys: 'Ctrl+Shift+M', when: 'not-editing' },
    ],
  },
  {
    action: 'Delete selected block (leave gap)',
    tokens: ['Delete', 'Backspace'],
    owner: 'registry',
    bindings: [
      { id: 'timeline.delete', keys: 'Delete', when: 'not-editing' },
      { id: 'timeline.delete', keys: 'Backspace', when: 'not-editing' },
    ],
  },
  {
    action: 'Delete selected block + close gap',
    tokens: ['Shift+Delete'],
    owner: 'registry',
    bindings: [{ id: 'timeline.delete-close-gap', keys: 'Shift+Delete', when: 'not-editing' }],
  },
  {
    action: 'Trim block start/end to playhead',
    tokens: ['Z+←/→', 'C+←/→'],
    owner: 'registry',
    bindings: [
      { id: 'timeline.trim-start', keys: 'Z+ArrowLeft' },
      { id: 'timeline.trim-start', keys: 'Z+ArrowRight' },
      { id: 'timeline.trim-end', keys: 'C+ArrowLeft' },
      { id: 'timeline.trim-end', keys: 'C+ArrowRight' },
    ],
  },
  {
    action: 'Loop region on/off',
    tokens: ['Y'],
    owner: 'registry',
    bindings: [{ id: 'transport.loop-toggle', keys: 'Y', when: 'not-editing' }],
  },
  {
    action: 'Set in / out from playhead',
    tokens: ['I', 'O', 'Shift+I', 'Shift+O'],
    owner: 'registry',
    bindings: [
      { id: 'transport.loop-in', keys: 'I', when: 'not-editing' },
      { id: 'transport.loop-out', keys: 'O', when: 'not-editing' },
      { id: 'transport.loop-clear', keys: 'Shift+I', when: 'not-editing' },
      { id: 'transport.loop-clear', keys: 'Shift+O', when: 'not-editing' },
    ],
  },
  {
    action: 'Next / previous search match',
    tokens: ['F3', 'Shift+F3', '⌘G', '⌘⇧G', 'Ctrl+G', 'Ctrl+Shift+G'],
    owner: 'registry',
    bindings: [
      { id: 'search.next', keys: 'F3', when: 'search-open' },
      { id: 'search.next', keys: 'Meta+G', when: 'search-open' },
      { id: 'search.next', keys: 'Ctrl+G', when: 'search-open' },
      { id: 'search.previous', keys: 'Shift+F3', when: 'search-open' },
      { id: 'search.previous', keys: 'Meta+Shift+G', when: 'search-open' },
      { id: 'search.previous', keys: 'Ctrl+Shift+G', when: 'search-open' },
    ],
  },
  {
    action: 'Collapse sidebar / timeline',
    tokens: ['Ctrl+Alt+2', 'Ctrl+Alt+3'],
    owner: 'registry',
    bindings: [
      { id: 'panels.collapse.sidebar', keys: 'Ctrl+Alt+2', when: 'not-editing' },
      { id: 'panels.collapse.timeline', keys: 'Ctrl+Alt+3', when: 'not-editing' },
    ],
  },
  {
    action: 'Cycle transcript view (source → translation → side-by-side)',
    tokens: ['⌘⇧L'],
    owner: 'registry',
    bindings: [
      { id: 'translate.cycle-view', keys: 'Meta+Shift+L', when: 'not-editing' },
      { id: 'translate.cycle-view', keys: 'Ctrl+Shift+L', when: 'not-editing' },
    ],
  },
  {
    action: "Next / previous QC issue",
    tokens: ['⌘\'', '⌘⇧\''],
    owner: 'registry',
    bindings: [
      { id: 'qc.next-issue', keys: "Meta+'", when: 'not-editing' },
      { id: 'qc.next-issue', keys: "Ctrl+'", when: 'not-editing' },
      { id: 'qc.previous-issue', keys: "Meta+Shift+'", when: 'not-editing' },
      { id: 'qc.previous-issue', keys: "Ctrl+Shift+'", when: 'not-editing' },
    ],
  },
  {
    action: 'Timeline zoom in / out / fit',
    tokens: ['⌘=', '⌘-', '⌘0', 'Ctrl+=', 'Ctrl+-', 'Ctrl+0'],
    owner: 'registry',
    bindings: [
      { id: 'timeline.zoom-in', keys: 'Meta+=', when: 'not-editing' },
      { id: 'timeline.zoom-in', keys: 'Ctrl+=', when: 'not-editing' },
      { id: 'timeline.zoom-out', keys: 'Meta+-', when: 'not-editing' },
      { id: 'timeline.zoom-out', keys: 'Ctrl+-', when: 'not-editing' },
      { id: 'timeline.zoom-fit', keys: 'Meta+0', when: 'not-editing' },
      { id: 'timeline.zoom-fit', keys: 'Ctrl+0', when: 'not-editing' },
    ],
  },
  {
    action: 'Timeline zoom (wheel/pinch)',
    tokens: ['Ctrl + wheel'],
    owner: 'wheel',
    bindings: [],
  },
  {
    action: 'Move block focus (timeline focused)',
    tokens: ['←', '→'],
    owner: 'registry',
    bindings: [
      { id: 'timeline.focus-next', keys: 'ArrowRight', when: 'timeline-focused' },
      { id: 'timeline.focus-prev', keys: 'ArrowLeft', when: 'timeline-focused' },
    ],
  },
  {
    action: 'Toggle block selection',
    tokens: ['Enter'],
    owner: 'registry',
    bindings: [{ id: 'timeline.select', keys: 'Enter', when: 'timeline-focused' }],
  },
  {
    action: 'Select all / deselect',
    tokens: ['⌘A', 'Esc'],
    owner: 'registry',
    bindings: [
      { id: 'transcript.select-all', keys: 'Meta+A', when: 'not-editing' },
      { id: 'transcript.select-all', keys: 'Ctrl+A', when: 'not-editing' },
      { id: 'transcript.deselect', keys: 'Escape', when: 'not-editing' },
    ],
  },
  {
    action: 'Find in transcript',
    tokens: ['⌘F'],
    owner: 'registry',
    bindings: [
      { id: 'transcript.search-open', keys: 'Meta+F', when: 'not-editing' },
      { id: 'transcript.search-open', keys: 'Ctrl+F', when: 'not-editing' },
    ],
  },
  {
    action: 'Undo / redo',
    tokens: ['⌘Z', '⌘⇧Z', '⌘Y'],
    owner: 'registry',
    bindings: [
      { id: 'edit.undo', keys: 'Meta+Z' },
      { id: 'edit.undo', keys: 'Ctrl+Z' },
      { id: 'edit.redo', keys: 'Meta+Shift+Z' },
      { id: 'edit.redo', keys: 'Ctrl+Shift+Z' },
      { id: 'edit.redo', keys: 'Meta+Y' },
      { id: 'edit.redo', keys: 'Ctrl+Y' },
    ],
  },
  {
    action: 'Save snapshot',
    tokens: ['⌘S'],
    owner: 'registry',
    bindings: [
      { id: 'view.save-snapshot', keys: 'Meta+S' },
      { id: 'view.save-snapshot', keys: 'Ctrl+S' },
    ],
  },
  {
    action: 'Toggle caption visibility',
    tokens: ['⌘\\'],
    owner: 'registry',
    bindings: [
      { id: 'view.captions-toggle', keys: 'Meta+\\', when: 'not-editing' },
      { id: 'view.captions-toggle', keys: 'Ctrl+\\', when: 'not-editing' },
    ],
  },
  {
    action: 'Focus panels',
    tokens: ['Alt+1/2/3'],
    owner: 'registry',
    bindings: [
      { id: 'focus.sidebar', keys: 'Alt+1', when: 'not-editing' },
      { id: 'focus.stage', keys: 'Alt+2', when: 'not-editing' },
      { id: 'focus.timeline', keys: 'Alt+3', when: 'not-editing' },
    ],
  },
  {
    action: 'Shortcuts overlay',
    tokens: ['⌘/'],
    owner: 'registry',
    bindings: [
      { id: 'view.shortcuts-overlay', keys: 'Meta+/' },
      { id: 'view.shortcuts-overlay', keys: 'Ctrl+/' },
    ],
  },
  {
    action: 'Confirm/cancel edit',
    tokens: ['Enter', 'Esc', 'Shift+Enter'],
    owner: 'editable',
    bindings: [],
  },
]

// ── Parser ───────────────────────────────────────────────────────────────────

export interface DesignTableRow {
  action: string
  key: string
  note: string
}

/** Rows of the § Keyboard shortcuts markdown table (header + separator
 *  excluded). Throws when the section is missing — the oracle must be loud. */
export function parseDesignShortcutRows(markdown: string): DesignTableRow[] {
  const start = markdown.indexOf(DESIGN_SECTION_HEADING)
  if (start < 0) throw new Error(`design.md: section "${DESIGN_SECTION_HEADING}" not found`)
  const rest = markdown.slice(start + DESIGN_SECTION_HEADING.length)
  const end = rest.search(/\n##\s/)
  const section = end < 0 ? rest : rest.slice(0, end)
  const rows: DesignTableRow[] = []
  for (const line of section.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length < 3) continue
    if (cells[0] === 'Action' || /^-+$/.test(cells[0] ?? '')) continue
    const action = cells[0] ?? ''
    const key = cells[1] ?? ''
    const note = cells[2] ?? ''
    rows.push({ action, key, note })
  }
  if (rows.length === 0) throw new Error('design.md: shortcut table has no rows')
  return rows
}

/** The backtick-quoted tokens of a Key cell (prose outside backticks never
 *  reaches the parser). */
export function keyCellTokens(keyCell: string): string[] {
  const tokens: string[] = []
  const pattern = /`([^`]+)`/g
  let match: RegExpExecArray | null = pattern.exec(keyCell)
  while (match !== null) {
    tokens.push(match[1] ?? '')
    match = pattern.exec(keyCell)
  }
  return tokens
}

const MODIFIER_ORDER: readonly string[] = ['Meta', 'Ctrl', 'Alt', 'Shift']

function normalizeChord(chord: string): string {
  const tokens = chord.split('+')
  if (tokens.some((token) => token === '')) throw new Error(`unparseable design chord: "${chord}"`)
  const modifiers = MODIFIER_ORDER.filter((modifier) => tokens.includes(modifier))
  const rest = tokens.filter((token) => !MODIFIER_ORDER.includes(token))
  if (rest.length === 1) return [...modifiers, ...rest].join('+')
  // Held-letter chord: Z/C + arrow (design.md Clipchamp trims).
  if (rest.length === 2 && (rest[0] === 'Z' || rest[0] === 'C') && rest[1] !== undefined && rest[1].startsWith('Arrow')) return [...modifiers, ...rest].join('+')
  throw new Error(`unparseable design chord: "${chord}"`)
}

/** One backtick token → the set of registry chord spellings it denotes. */
export function expandToken(token: string): string[] {
  // CmdOrCtrl spellings seen in the table: `Ctrl/Cmd+Shift+M`.
  let normalized = token.trim().replace('Ctrl/Cmd+', 'Cmd+').replace('Cmd/Ctrl+', 'Cmd+')
  // Glyph map (modifier glyphs contribute their own '+' separator: the table
  // writes `⌘←` / `⌘⇧G` with no separators between glyphs).
  normalized = normalized
    .replace(/⌘/g, 'Cmd+')
    .replace(/⇧/g, 'Shift+')
    .replace(/⌥/g, 'Alt+')
    .replace(/⌃/g, 'Ctrl+')
    .replace(/←/g, 'ArrowLeft')
    .replace(/→/g, 'ArrowRight')
    .replace(/↑/g, 'ArrowUp')
    .replace(/↓/g, 'ArrowDown')
    .replace(/^Esc$/, 'Escape')
    .replace(/\++/g, '+')
    .replace(/^\+|\+$/g, '')
  // Slash-run expansion against the first segment's prefix — only when every
  // part is a non-empty alternative (`⌘/` is the SLASH key, not a run).
  if (normalized.includes('/')) {
    const parts = normalized.split('/')
    if (parts.length > 1 && parts.every((part) => part.length > 0)) {
      const first = parts[0] ?? ''
      const lastPlus = first.lastIndexOf('+')
      const prefix = lastPlus < 0 ? '' : first.slice(0, lastPlus + 1)
      const expanded = parts.map((part, index) => (index === 0 ? first : prefix + part))
      return [...new Set(expanded.flatMap((segment) => expandToken(segment)))]
    }
  }
  // CmdOrCtrl → the frozen Meta+ AND Ctrl+ spellings (design.md:73).
  const variants = normalized.includes('Cmd') ? [normalized.replace('Cmd', 'Meta'), normalized.replace('Cmd', 'Ctrl')] : [normalized]
  const chords = variants.map((variant) => normalizeChord(variant))
  return [...new Set(chords)]
}

/** Every normalized chord a Key cell denotes. */
export function normalizeKeyCell(keyCell: string): string[] {
  const tokens = keyCellTokens(keyCell)
  if (tokens.length === 0) throw new Error(`design.md Key cell has no backtick tokens: "${keyCell}"`)
  return [...new Set(tokens.flatMap((token) => expandToken(token)))].sort()
}
