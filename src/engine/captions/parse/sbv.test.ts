// FR-07.2 (L1, co-located coverage suite): parseSbv — H:MM:SS.mmm timing
// pairs, tag stripping, typed malformed-timing failure, yield seam.
import { describe, expect, test } from 'vitest'
import { parseSbv } from './sbv'

describe('FR-07.2: parseSbv', () => {
  test('parses unpadded-hour timing pairs, strips tags, keeps multi-line cue text', async () => {
    const text = ['0:00:00.000,0:00:01.500', 'One two three four', '', '00:00:02.000,00:00:03.000', '<i>Italic SBV</i>', 'second line', ''].join('\n')
    const result = await parseSbv(text)
    expect(result.format).toBe('sbv')
    expect(result.language).toBeNull()
    expect(result.cues).toHaveLength(2)
    expect(result.cues[0]).toEqual({ start: 0, end: 1.5, text: 'One two three four', lines: ['One two three four'] })
    expect(result.cues[1]!.lines).toEqual(['Italic SBV', 'second line'])
  })

  test('a malformed timing line throws UNRECOGNIZED_FORMAT with the 1-based line', async () => {
    await expect(parseSbv('not,sbv\ncontent\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 1 })
    await expect(parseSbv('0:00:00.000,0:00:01.000\nfirst\n\n1:0:00.000,1:00:01.000\nbroken minutes\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 4 })
  })

  test('yield seam per 2 000 cues (FR-07.7)', async () => {
    let yields = 0
    const body = Array.from(
      { length: 4_000 },
      (_, index) =>
        `${Math.floor(index / 3600)}:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000,${Math.floor((index + 1) / 3600)}:${String(Math.floor((index + 1) / 60) % 60).padStart(2, '0')}:${String((index + 1) % 60).padStart(2, '0')}.000\ncue ${index}\n`,
    ).join('\n')
    const result = await parseSbv(body, { scheduleYield: () => Promise.resolve().then(() => void (yields += 1)) })
    expect(result.cues).toHaveLength(4_000)
    expect(yields).toBe(2)
  })
})
