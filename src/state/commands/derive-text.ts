// Domain invariant 2: `block.text` == `words` joined with ' ', using '\n'
// instead after a word with `breakAfter` (punctuation is part of the
// preceding word's text). Reducers derive text through this single function;
// the frozen suites join with the identical rule (helpers/fixture-project
// `joinWords`) and compare against the re-export below.

import type { WordToken } from '../../engine/model'

export function deriveBlockText(words: readonly WordToken[]): string {
  let out = ''
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (word === undefined) continue
    if (i > 0) out += words[i - 1]?.breakAfter === true ? '\n' : ' '
    out += word.text
  }
  return out
}
