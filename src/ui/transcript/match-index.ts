// Search match index (FR-104.5, US-2.1.6): match positions over the WORD
// TOKENS of every block, case-folded per the frozen `replace-text` match
// semantics (case-insensitive substring default; `caseSensitive` exact
// substring; `wholeWord` token-core equality with the align.ts normalize
// rule). Pure and content-free to callers: the built structure is numbers +
// generated block ids only — query/replacement strings NEVER leave the panel
// (SECURITY-03). The Transcript rebuilds this memoized on the blocks
// REFERENCE only (the block-version bump — never per keystroke beyond the
// debounced query), so an index build is O(words) per project change.

export interface SearchMatch {
  /** Generated synthetic block id (SECURITY-03 safe). */
  blockId: string
  wordIndex: number
  /** Character range INSIDE the word token's text (text-range span). */
  start: number
  end: number
}

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

/** Whole-word token core: case-fold + strip non-alphanumerics (align.ts rule, minus the kept whitespace — word tokens carry no spaces). */
function normalizeCore(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Every non-overlapping occurrence of `query` in every block's word tokens, in document order (block order, word order, left-to-right). */
export function findMatches(blocks: readonly { id: string; words: readonly { text: string }[] }[], query: string, options: SearchOptions = {}): SearchMatch[] {
  const out: SearchMatch[] = []
  if (query.length === 0) return out
  const caseSensitive = options.caseSensitive === true
  const wholeWord = options.wholeWord === true
  const needle = caseSensitive ? query : query.toLowerCase()
  for (const block of blocks) {
    for (let wordIndex = 0; wordIndex < block.words.length; wordIndex++) {
      const word = block.words[wordIndex]
      if (word === undefined) continue
      const text = word.text
      if (wholeWord) {
        const equal = caseSensitive ? text === query : normalizeCore(text) === normalizeCore(query)
        if (equal) out.push({ blockId: block.id, wordIndex, start: 0, end: text.length })
        continue
      }
      const haystack = caseSensitive ? text : text.toLowerCase()
      let at = haystack.indexOf(needle)
      while (at !== -1) {
        out.push({ blockId: block.id, wordIndex, start: at, end: at + needle.length })
        at = haystack.indexOf(needle, at + needle.length)
      }
    }
  }
  return out
}

/** Index occurrences by block then word for O(1) row lookup during render. */
export function groupMatches(matches: readonly SearchMatch[]): Map<string, Map<number, readonly { start: number; end: number; index: number }[]>> {
  const byBlock = new Map<string, Map<number, { start: number; end: number; index: number }[]>>()
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    if (match === undefined) continue
    let byWord = byBlock.get(match.blockId)
    if (byWord === undefined) {
      byWord = new Map()
      byBlock.set(match.blockId, byWord)
    }
    const list = byWord.get(match.wordIndex)
    if (list === undefined) byWord.set(match.wordIndex, [{ start: match.start, end: match.end, index }])
    else list.push({ start: match.start, end: match.end, index })
  }
  return byBlock
}
