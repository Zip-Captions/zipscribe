// Friendly popover labels (unit-304 #63) — the ONE copy source the Transcribe
// popover renders for model rows and language options. Raw registry ids and
// revision hashes (e.g. `whisper-tiny_timestamped@51724429`) and bare ISO
// codes are NEVER user-facing (the 2026-11-26 sweep #63); the ids stay in the
// `data-model-id` / option-value seams the contracts pin.
//
// Naming follows the registry rows (src/engine/model/registry.ts) and the
// documented "(family) (quant)" style of `docs/ops/ux-stories.md` § J-01 /
// `docs/ops/ux-review-plan.md` ("whisper-base (int8)"): the whisper rows carry
// the fp32/q4 transformers.js recipe (registry WHISPER_DTYPE_RECIPE), so they
// render the honest family name; the sherpa row ships int8 ONNX files, so it
// keeps the documented `(int8)` suffix.
//
// SECURITY-03: static canned strings only — nothing content-derived.

/** Curated model-id → friendly label. Keys are registry ids; unknown ids
 *  fall through to `deriveModelLabel` (honest derivation, never the raw id). */
const FRIENDLY_MODEL_LABELS: Record<string, string> = {
  'whisper-tiny_timestamped@51724429': 'Whisper Tiny',
  'whisper-base_timestamped@608c49e6': 'Whisper Base',
  'whisper-small_timestamped@65caa70f': 'Whisper Small',
  'sherpa-zipformer-en-int8@11a70a47': 'Zipformer English (int8)',
  'cactus-whistle@b358ddad': 'Whistle',
}

/** Registry-internal tokens that are provenance, not product naming. */
const DERIVED_LABEL_NOISE = new Set(['timestamped'])

function titleCase(token: string): string {
  return token.length === 0 ? token : token.charAt(0).toUpperCase() + token.slice(1)
}

/** Fallback for ids outside the curated map: strip the `@<revision>` and the
 *  `_timestamped` provenance, hyphen-split, title-case — friendly words,
 *  never the raw id and never the revision hash. */
function deriveModelLabel(id: string): string {
  const base = (id.split('@')[0] ?? id).split('_')[0] ?? ''
  const words = base
    .split('-')
    .filter((token) => token.length > 0 && !DERIVED_LABEL_NOISE.has(token.toLowerCase()))
    .map(titleCase)
  return words.length > 0 ? words.join(' ') : 'Model'
}

/** The user-facing label for a registry model id — never the raw id, never a
 *  revision hash. */
export function modelLabel(id: string): string {
  return FRIENDLY_MODEL_LABELS[id] ?? deriveModelLabel(id)
}

/** Human names for the offered BCP-47 primary tags (popover language select +
 *  any code→name copy; covers the popover offering and the Languages-section
 *  candidate set). Unknown tags render the tag itself (honest, never blank). */
const HUMAN_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  id: 'Indonesian',
  vi: 'Vietnamese',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  'zh-Hant': 'Chinese (Traditional)',
  he: 'Hebrew',
  th: 'Thai',
  uk: 'Ukrainian',
}

export function languageLabel(code: string): string {
  return HUMAN_LANGUAGE_NAMES[code] ?? code
}
