// tools/eval/wer-core.mjs — JS port of the Whisper text normalizer
// (openai/whisper `whisper/normalizers/english.py`, English) + word error
// rate. Used by `tools/eval/wer.mjs` (the CC-02.6 CLI) and the eval harness.
//
// Ported sequence — mirrors upstream `EnglishTextNormalizer.__call__`
// (https://raw.githubusercontent.com/openai/whisper/main/whisper/normalizers/english.py)
// in upstream's exact ORDER:
//   1. lowercase;
//   2. drop bracketed segments, filler interjections, normalise " '" spacing;
//   3. `replacers` dict applied in insertion order — contractions expand
//      FIRST, as word-boundary regexes over the whole text (so "Don't," →
//      "do not," before any punctuation is touched; bare "dont" is NOT
//      touched — upstream's patterns all require the apostrophe);
//   4. commas between digits removed, periods not followed by digits spaced;
//   5. remove_symbols_and_diacritics(s, keep=".%$¢€£")
//      (whisper/normalizers/basic.py: NFKD, keep-set, ADDITIONAL_DIACRITICS,
//      category Mn → '', categories M*/S*/P* → ' ');
//   6. prefix/suffix symbols not adjacent to digits spaced out;
//   7. whitespace collapsed (and trimmed — tokenisation convenience).
// Deliberate, documented deviations from a byte-for-byte port:
//   • EnglishNumberNormalizer (spelled-out numbers) and
//     EnglishSpellingNormalizer (english.json British→American map) are NOT
//     ported: the former needs inflect-scale morphology, the latter a data
//     file; neither is exercised by this eval corpus (spoken digits /
//     British spellings absent).
//   • the keep-set step is followed by a second lowercase, mirroring upstream
//     BasicTextNormalizer (`self.clean(s).lower()`, basic.py) so NFKD
//     compatibility decompositions of fullwidth forms (ＷＯＲＬＤ → WORLD) fold.
//   • the whitespace collapse uses JavaScript \s (ECMA WhiteSpace includes
//     U+00A0 and U+FEFF), keeping BOM/NBSP framing inert in the CLI.
// WER is computed with the classic Levenshtein edit distance over normalized
// words: WER = (substitutions + deletions + insertions) / reference words.

// upstream English.py: ignore_patterns
const IGNORE_PATTERN = /\b(hmm|mm|mhm|mmm|uh|um)\b/g

// upstream EnglishTextNormalizer.replacers — Python 3.7+ dicts iterate in
// insertion order; kept as ordered pairs so the substitution order is the
// contract (common contractions → titles/prefixes → perfect tenses →
// general contractions; the general n't/'re/'s/'d/'ll/'t/'ve/'m forms run
// LAST, after the specific ones).
const REPLACERS = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\blet's\b/g, 'let us'],
  [/\bain't\b/g, 'aint'],
  [/\by'all\b/g, 'you all'],
  [/\bwanna\b/g, 'want to'],
  [/\bgotta\b/g, 'got to'],
  [/\bgonna\b/g, 'going to'],
  [/\bi'ma\b/g, 'i am going to'],
  [/\bimma\b/g, 'i am going to'],
  [/\bwoulda\b/g, 'would have'],
  [/\bcoulda\b/g, 'could have'],
  [/\bshoulda\b/g, 'should have'],
  [/\bma'am\b/g, 'madam'],
  // contractions in titles/prefixes
  [/\bmr\b/g, 'mister '],
  [/\bmrs\b/g, 'missus '],
  [/\bst\b/g, 'saint '],
  [/\bdr\b/g, 'doctor '],
  [/\bprof\b/g, 'professor '],
  [/\bcapt\b/g, 'captain '],
  [/\bgov\b/g, 'governor '],
  [/\bald\b/g, 'alderman '],
  [/\bgen\b/g, 'general '],
  [/\bsen\b/g, 'senator '],
  [/\brep\b/g, 'representative '],
  [/\bpres\b/g, 'president '],
  [/\brev\b/g, 'reverend '],
  [/\bhon\b/g, 'honorable '],
  [/\basst\b/g, 'assistant '],
  [/\bassoc\b/g, 'associate '],
  [/\blt\b/g, 'lieutenant '],
  [/\bcol\b/g, 'colonel '],
  [/\bjr\b/g, 'junior '],
  [/\bsr\b/g, 'senior '],
  [/\besq\b/g, 'esquire '],
  // perfect tenses
  [/'d been\b/g, ' had been'],
  [/'s been\b/g, ' has been'],
  [/'d gone\b/g, ' had gone'],
  [/'s gone\b/g, ' has gone'],
  [/'d done\b/g, ' had done'],
  [/'s got\b/g, ' has got'],
  // general contractions
  [/n't\b/g, ' not'],
  [/'re\b/g, ' are'],
  [/'s\b/g, ' is'],
  [/'d\b/g, ' would'],
  [/'ll\b/g, ' will'],
  [/'t\b/g, ' not'],
  [/'ve\b/g, ' have'],
  [/'m\b/g, ' am'],
]

// upstream whisper/normalizers/basic.py ADDITIONAL_DIACRITICS
const ADDITIONAL_DIACRITICS = {
  œ: 'oe',
  Œ: 'OE',
  ø: 'o',
  Ø: 'O',
  æ: 'ae',
  Æ: 'AE',
  ß: 'ss',
  ẞ: 'SS',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'th',
  ł: 'l',
  Ł: 'L',
}

// upstream basic.py: keep-set of remove_symbols_and_diacritics as used by
// EnglishTextNormalizer.
const KEEP = '.%$¢€£'

/**
 * JS mirror of whisper/normalizers/basic.py remove_symbols_and_diacritics:
 * NFKD-normalise, keep keep-set chars, apply ADDITIONAL_DIACRITICS, drop
 * combining marks (category Mn), replace any other mark, symbol or
 * punctuation (unicodedata category initial in "MSP") with a space, keep
 * everything else.
 * @param {string} text
 * @param {string} keep
 * @returns {string}
 */
function removeSymbolsAndDiacritics(text, keep) {
  let out = ''
  for (const char of text.normalize('NFKD')) {
    if (keep.includes(char)) {
      out += char
      continue
    }
    const mapped = ADDITIONAL_DIACRITICS[char]
    if (mapped !== undefined) {
      out += mapped
      continue
    }
    if (/\p{Mn}/u.test(char)) continue
    if (/\p{M}|\p{S}|\p{P}/u.test(char)) {
      out += ' '
      continue
    }
    out += char
  }
  return out
}

/**
 * The Whisper (English) text normalizer — see module header for the ported
 * sequence, ordering rationale and documented deviations.
 * @param {string} text
 * @returns {string} normalized text (lowercase, no punctuation, single spaces)
 */
export function normalize(text) {
  if (typeof text !== 'string') return ''
  let s = text.toLowerCase()
  s = s.replace(/[<\[][^>\]]*[>\]]/g, '')
  s = s.replace(/\(([^\)]+?)\)/g, '')
  s = s.replace(IGNORE_PATTERN, '')
  s = s.replace(/\s+'/g, "'")
  for (const [pattern, replacement] of REPLACERS) s = s.replace(pattern, replacement)
  s = s.replace(/(\d),(\d)/g, '$1$2')
  s = s.replace(/\.([^0-9]|$)/g, ' $1')
  s = removeSymbolsAndDiacritics(s, KEEP).toLowerCase()
  s = s.replace(/[.$¢€£]([^0-9])/g, ' $1')
  s = s.replace(/([^0-9])%/g, '$1 ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/** Normalize + tokenize into the word sequence WER operates on. */
export function normalizeWords(text) {
  const normalized = normalize(text)
  return normalized === '' ? [] : normalized.split(' ')
}

/**
 * Word error rate = (S + D + I) / |reference|, Levenshtein over normalized
 * words. Empty reference → 0 by convention when the hypothesis is empty too,
 * else Infinity (matches whisper_word_error_rate guard behaviour; the CLI
 * never feeds it an empty reference).
 * @param {string} referenceText
 * @param {string} hypothesisText
 * @returns {number} WER as a fraction (0 = perfect)
 */
export function wordErrorRate(referenceText, hypothesisText) {
  const reference = normalizeWords(referenceText)
  const hypothesis = normalizeWords(hypothesisText)
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : Number.POSITIVE_INFINITY
  const n = reference.length
  const m = hypothesis.length
  // Full DP matrix (corpus-scale transcripts, fine); classic edit distance.
  /** @type {Int32Array[]} */
  const dist = []
  for (let i = 0; i <= n; i += 1) dist.push(new Int32Array(m + 1))
  for (let i = 0; i <= n; i += 1) dist[i][0] = i
  for (let j = 0; j <= m; j += 1) dist[0][j] = j
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost)
    }
  }
  return dist[n][m] / n
}

/**
 * Aligned (referenceWord, hypothesisWord) pairs from the edit script: equal
 * and substituted words are aligned position-by-position along the optimal
 * path; deletions/insertions produce no pair. Used for wordTimingMAEms
 * (FR-02.7) — timing error is only defined where words correspond.
 * @param {string} referenceText
 * @param {string} hypothesisText
 * @returns {Array<[number, number]>} pairs of word indices into the
 *   normalizeWords() outputs of the two texts (equal or substituted pairs)
 */
export function alignedWordPairs(referenceText, hypothesisText) {
  const reference = normalizeWords(referenceText)
  const hypothesis = normalizeWords(hypothesisText)
  const n = reference.length
  const m = hypothesis.length
  const dist = []
  for (let i = 0; i <= n; i += 1) dist.push(new Int32Array(m + 1))
  for (let i = 0; i <= n; i += 1) dist[i][0] = i
  for (let j = 0; j <= m; j += 1) dist[0][j] = j
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost)
    }
  }
  const pairs = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const same = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
    if (dist[i][j] === dist[i - 1][j - 1] + same) {
      pairs.push([i - 1, j - 1]) // match (same === 0) or substitution
      i -= 1
      j -= 1
    } else if (dist[i][j] === dist[i - 1][j] + 1) {
      i -= 1 // deletion
    } else {
      j -= 1 // insertion
    }
  }
  return pairs.reverse()
}
