// FR-07.2 (L1, co-located coverage suite): parseZipscribeJson — cue-level
// sidecar shape, optional language, anything-else → UNRECOGNIZED_FORMAT
// (never a raw SyntaxError, never cue text — FR-07.6), yield seam.
import { describe, expect, test } from 'vitest'
import { parseZipscribeJson } from './json'

const sidecar = (language: string | undefined, blocks: unknown): string => JSON.stringify(language === undefined ? { blocks } : { language, blocks })

describe('FR-07.2: parseZipscribeJson', () => {
  test('parses the pinned shape, reports language and cue lines', async () => {
    const result = await parseZipscribeJson(
      sidecar('en', [
        { start: 0, end: 1, text: 'Structured json here' },
        { start: 2.5, end: 3.5, text: 'a\nb' },
      ]),
    )
    expect(result.format).toBe('zipscribe-json')
    expect(result.language).toBe('en')
    expect(result.cues[1]!.lines).toEqual(['a', 'b'])
  })

  test('language omitted/empty is null; blocks-only root is valid', async () => {
    const result = await parseZipscribeJson(sidecar(undefined, []))
    expect(result).toEqual({ format: 'zipscribe-json', cues: [], language: null })
    const emptyLanguage = await parseZipscribeJson(sidecar('', [{ start: 0, end: 1, text: 'x' }]))
    expect(emptyLanguage.language).toBeNull()
  })

  test('shape violations are UNRECOGNIZED_FORMAT with codes/numbers only (no raw SyntaxError, no cue text)', async () => {
    await expect(parseZipscribeJson('{"project": [oops')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseZipscribeJson('[1,2,3]')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseZipscribeJson('null')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseZipscribeJson('{"blocks": "nope"}')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseZipscribeJson(sidecar('en', ['x']))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', detail: undefined })
    await expect(parseZipscribeJson(sidecar('en', [{ start: '0', end: 1, text: 'x' }]))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseZipscribeJson(sidecar('en', [{ start: 0, end: Number.NaN, text: 'CANARY-42' }]))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseZipscribeJson(sidecar('en', [{ start: 0, end: Number.POSITIVE_INFINITY, text: 'x' }]))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseZipscribeJson(sidecar('en', [{ start: 0, end: 1, text: 42 }]))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
  })

  test('yield seam per 2 000 cues (FR-07.7)', async () => {
    let yields = 0
    const blocks = Array.from({ length: 4_000 }, (_, index) => ({ start: index, end: index + 1, text: `cue ${index}` }))
    const result = await parseZipscribeJson(sidecar('en', blocks), { scheduleYield: () => Promise.resolve().then(() => void (yields += 1)) })
    expect(result.cues).toHaveLength(4_000)
    expect(yields).toBe(2)
  })
})
