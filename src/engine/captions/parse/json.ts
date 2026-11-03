// Zipscribe JSON sidecar parser (FR-07.2), the cue-level shape pinned by the
// frozen contract: `{ "language"?: string, "blocks": [{ start, end, text }] }`.
// Words are cue-derived (ParsedCue carries no word times). Anything outside
// the shape — invalid JSON, wrong members, non-finite times — is the typed
// 'UNRECOGNIZED_FORMAT' failure (never a raw SyntaxError, never cue text —
// FR-07.6 / SECURITY-03).

import type { ParseOptions, ParseResult, ParsedCue } from '../types'
import { CaptionFailureError } from '../failure'
import { YIELD_EVERY_CUES, yieldScheduler } from './shared'

interface JsonBlock {
  start: number
  end: number
  text: string
}

function requireBlock(value: unknown, index: number): JsonBlock {
  if (typeof value !== 'object' || value === null) {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `zipscribe-json blocks[${index}] is not an object`)
  }
  const record = value as Record<string, unknown>
  const { start, end, text } = record
  if (typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end) || typeof text !== 'string') {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', `zipscribe-json blocks[${index}] needs numeric start/end and string text`)
  }
  return { start, end, text }
}

export async function parseZipscribeJson(text: string, opts?: ParseOptions): Promise<ParseResult> {
  const scheduleYield = yieldScheduler(opts)
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'zipscribe-json is not valid JSON')
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'zipscribe-json root is not an object')
  }
  const record = data as Record<string, unknown>
  const blocks: readonly unknown[] | undefined = Array.isArray(record.blocks) ? (record.blocks as unknown[]) : undefined
  if (blocks === undefined) {
    throw new CaptionFailureError('UNRECOGNIZED_FORMAT', 'zipscribe-json has no "blocks" array')
  }
  const language = typeof record.language === 'string' && record.language !== '' ? record.language : null
  const cues: ParsedCue[] = []
  for (let index = 0; index < blocks.length; index++) {
    const block = requireBlock(blocks[index], index)
    cues.push({ start: block.start, end: block.end, text: block.text, lines: block.text.split('\n') })
    if (cues.length % YIELD_EVERY_CUES === 0) await scheduleYield()
  }
  return { format: 'zipscribe-json', cues, language }
}
