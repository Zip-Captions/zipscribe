// FR-07.2 (L1, co-located coverage suite): parseAss — Dialogue lines only,
// H:MM:SS.cc times, {\…} override-tag stripping, \N/\n/\h line controls,
// text fields containing commas, typed failures, yield seam.
import { describe, expect, test } from 'vitest'
import { parseAss } from './ass'

const HEADER = ['[Script Info]', 'ScriptType: v4.00+', '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']

describe('FR-07.2: parseAss', () => {
  test('parses Dialogue lines only, strips override tags, maps line controls, keeps commas in Text', async () => {
    const text = [
      ...HEADER,
      'Style: Default,Arial,16,&H00FFFFFF',
      'Comment: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,not a cue',
      'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\pos(120,240)\\fad(200,200)}Karaoke tags gone',
      'Dialogue: 1,0:01:02.03,0:01:03.50,Default,,0,0,0,,{\\b1}Bold{\\b0} text, with commas\\Nsecond line\\nthird',
      'Dialogue: 0,0:00:04.500,0:00:05.00,Default,,0,0,0,,hard\\hbreak',
      '',
    ].join('\n')
    const result = await parseAss(text)
    expect(result.format).toBe('ass')
    expect(result.language).toBeNull()
    expect(result.cues).toHaveLength(3)
    expect(result.cues[0]).toEqual({ start: 0, end: 1, text: 'Karaoke tags gone', lines: ['Karaoke tags gone'] })
    expect(result.cues[1]!.start).toBeCloseTo(62.03, 3)
    expect(result.cues[1]!.end).toBeCloseTo(63.5, 3)
    expect(result.cues[1]!.text).toBe('Bold text, with commas\nsecond line\nthird')
    expect(result.cues[1]!.lines).toHaveLength(3)
    expect(result.cues[2]!.start).toBe(4.5) // 3 fractional digits tolerated as milliseconds
    expect(result.cues[2]!.text).toBe('hard break')
  })

  test('typed failures: malformed time, too few fields, no Dialogue lines at all', async () => {
    await expect(parseAss([...HEADER, 'Dialogue: 0,x:00:00.00,0:00:01.00,Default,,0,0,0,,t'].join('\n'))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 6 })
    await expect(parseAss([...HEADER, 'Dialogue: 0,0:00:00.00'].join('\n'))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 6 })
    await expect(parseAss('[Script Info]\nTitle: nothing here\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 1 })
  })

  test('yield seam per 2 000 cues (FR-07.7)', async () => {
    let yields = 0
    const dialogues = Array.from({ length: 2_000 }, (_, index) => `Dialogue: 0,0:00:0${index % 10}.00,0:00:0${index % 10}.50,Default,,0,0,0,,cue ${index}`)
    const result = await parseAss([...HEADER, ...dialogues].join('\n'), { scheduleYield: () => Promise.resolve().then(() => void (yields += 1)) })
    expect(result.cues).toHaveLength(2_000)
    expect(yields).toBe(1)
  })
})
