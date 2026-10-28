// tools/eval/wer-core.mjs — JS port of the Whisper text normalizer
// (openai/whisper `whisper_normalizer/english.py`, English) + word error
// rate. Used by `tools/eval/wer.mjs` (the CC-02.6 CLI) and the eval harness.
//
// Ported behaviour (in the order the upstream English normalizer applies it):
//   1. lowercase (BasicTextNormalizer.lowercase);
//   2. expand common contractions (CONTRACTIONS map, "don't" → "do not");
//   3. strip characters in the Unicode punctuation/symbol categories
//      (BasicTextNormalizer's punctuation table removal; apostrophes go with
//      it, so "it's" → "it s" only if unlisted above);
//   4. collapse whitespace and trim.
// Number-to-word conversion (upstream NUMBERS/measurements) is deliberately
// NOT ported: it needs the inflect package's English morphology and is only
// exercised by spoken digits, which this eval corpus does not contain. WER is
// computed with the classic Levenshtein edit distance over normalized words:
//   WER = (substitutions + deletions + insertions) / reference word count.
// Reference: https://github.com/openai/whisper/blob/main/whisper_normalizer/english.py

// Token -> apostrophe form (upstream English.py CONTRACTIONS list), applied
// before EXPANSIONS so un-punctuated ASR output ("dont") expands too.
// 'well' is deliberately absent: it is overwhelmingly the interjection/adverb,
// not the contraction "we'll" (upstream disambiguates with frequency lists
// that are out of scope for this port).
const APOSTROPHE_FORMS = {
  aint: "ain't",
  arent: "aren't",
  cant: "can't",
  couldve: "could've",
  couldnt: "couldn't",
  "couldnt've": "couldn't've",
  didnt: "didn't",
  doesnot: 'does not',
  doesnt: "doesn't",
  dont: "don't",
  hadnt: "hadn't",
  hasnt: "hasn't",
  havent: "haven't",
  hes: "he's",
  id: "i'd",
  ill: "i'll",
  im: "i'm",
  ive: "i've",
  isnt: "isn't",
  lets: "let's",
  mightnt: "mightn't",
  mustnt: "mustn't",
  neednt: "needn't",
  shes: "she's",
  shouldve: "should've",
  shouldnt: "shouldn't",
  thats: "that's",
  theres: "there's",
  theyd: "they'd",
  theyll: "they'll",
  theyre: "they're",
  theyve: "they've",
  wasnt: "wasn't",
  werent: "weren't",
  whatll: "what'll",
  whats: "what's",
  weds: "we'd",
  were: "we're",
  weve: "we've",
  whatd: "what'd",
  wholl: "who'll",
  whos: "who's",
  whove: "who've",
  wont: "won't",
  wouldve: "would've",
  wouldnt: "wouldn't",
  youd: "you'd",
  youll: "you'll",
  youre: "you're",
  youve: "you've",
}

const EXPANSIONS = {
  "ain't": 'is not',
  "aren't": 'are not',
  "can't": 'cannot',
  "can't've": 'cannot have',
  "'cause": 'because',
  "could've": 'could have',
  "couldn't": 'could not',
  "couldn't've": 'could not have',
  "didn't": 'did not',
  "doesn't": 'does not',
  "don't": 'do not',
  "hadn't": 'had not',
  "hasn't": 'has not',
  "haven't": 'have not',
  "he'd": 'he would',
  "he'll": 'he will',
  "he's": 'he is',
  "how'd": 'how did',
  "how'll": 'how will',
  "how's": 'how is',
  "i'd": 'i would',
  "i'll": 'i will',
  "i'm": 'i am',
  "i've": 'i have',
  "isn't": 'is not',
  "it'd": 'it would',
  "it'll": 'it will',
  "it's": 'it is',
  "let's": 'let us',
  "ma'am": 'madam',
  "mayn't": 'may not',
  "mightn't": 'might not',
  "mustn't": 'must not',
  "needn't": 'need not',
  "o'clock": 'of the clock',
  "shan't": 'shall not',
  "she'd": 'she would',
  "she'll": 'she will',
  "she's": 'she is',
  "should've": 'should have',
  "shouldn't": 'should not',
  "that'd": 'that would',
  "that'll": 'that will',
  "that's": 'that is',
  "there'd": 'there would',
  "there's": 'there is',
  "they'd": 'they would',
  "they'll": 'they will',
  "they're": 'they are',
  "they've": 'they have',
  "wasn't": 'was not',
  "we'd": 'we would',
  "we'll": 'we will',
  "we're": 'we are',
  "we've": 'we have',
  "weren't": 'were not',
  "what'll": 'what will',
  "what're": 'what are',
  "what's": 'what is',
  "what've": 'what have',
  "where's": 'where is',
  "who'd": 'who did',
  "who'll": 'who will',
  "who's": 'who is',
  "who've": 'who have',
  "won't": 'will not',
  "would've": 'would have',
  "wouldn't": 'would not',
  "you'd": 'you would',
  "you'll": 'you will',
  "you're": 'you are',
  "you've": 'you have',
}

/**
 * The Whisper (English) text normalizer.
 * @param {string} text
 * @returns {string} normalized text (lowercase, no punctuation, single spaces)
 */
export function normalize(text) {
  if (typeof text !== 'string') return ''
  let out = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  // Expand contractions: tokens written without apostrophes first (the
  // APOSTROPHE_FORMS table: "dont" → "don't"), then the apostrophe forms
  // themselves via EXPANSIONS ("don't" → "do not").
  out = out
    .split(/\s+/)
    .map((token) => {
      const expanded = EXPANSIONS[token] ?? EXPANSIONS[APOSTROPHE_FORMS[token] ?? token]
      return expanded ?? token
    })
    .join(' ')
  // Strip all Unicode punctuation and symbols (keeps letters, numbers, marks,
  // whitespace). This subsumes the apostrophes left by unmatched forms.
  out = out.replace(/[\p{P}\p{S}]/gu, ' ')
  // Collapse whitespace.
  out = out.replace(/\s+/g, ' ').trim()
  return out
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
