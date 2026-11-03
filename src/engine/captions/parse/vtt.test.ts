// FR-07.2 (L1, co-located coverage suite): parseVtt per
// https://www.w3.org/TR/webvtt1/ — signature, `Language:` header,
// NOTE/STYLE/REGION blocks, cue identifiers/settings, <v> voices, inline
// timestamp tags, entities, typed failures, yield seam.
import { describe, expect, test } from 'vitest'
import { parseVtt } from './vtt'

describe('FR-07.2: parseVtt', () => {
  test('header, NOTE/STYLE/REGION skipping, identifiers, cue settings, voices and entities', async () => {
    const text = [
      'WEBVTT',
      'Language: pt-BR',
      '',
      'NOTE vendor comment',
      '',
      'STYLE',
      '::cue { color: #fff; }',
      'end',
      '',
      'REGION',
      'id:lowerthird',
      'width:80%',
      'end',
      '',
      'intro',
      '00:00:00.000 --> 00:00:01.400 position:10% align:start',
      '<v Alex>Hi &amp; there</v>',
      '',
      '1:02:03.004 --> 1:02:04.000',
      '<v Jo.class>Hello</v>',
      '',
    ].join('\n')
    const result = await parseVtt(text)
    expect(result.format).toBe('vtt')
    expect(result.language).toBe('pt-BR')
    expect(result.cues).toHaveLength(2)
    expect(result.cues[0]).toEqual({ start: 0, end: 1.4, text: 'Hi & there', lines: ['Hi & there'], voice: 'Alex' })
    expect(result.cues[1]!.start).toBeCloseTo(3723.004, 3)
    expect(result.cues[1]!.voice).toBe('Jo')
  })

  test('inline timestamp tags are stripped from text; optional-hours grammar accepted; anonymous <v> (empty name) stays voiceless', async () => {
    const text = ['WEBVTT - meta', '', '00:00:00.000 --> 00:00:02.000', '<00:00:00.500>Hello <00:00:01.000>there friends', '', '00:00:03.000 --> 00:00:04.000', '<v >anonymouse</v>', ''].join('\n')
    const result = await parseVtt(text)
    expect(result.cues[0]!.text).toBe('Hello there friends')
    expect(result.cues[0]!.voice).toBeUndefined()
    expect(result.cues[1]!.text).toBe('anonymouse')
    expect(result.cues[1]!.voice).toBeUndefined()
  })

  test('typed failures: missing WEBVTT signature, cue block without a timing line, malformed timestamp', async () => {
    await expect(parseVtt('NOTE only\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 1 })
    await expect(parseVtt('WEBVTT\n\nidentifier only\nno timing here\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 3 })
    await expect(parseVtt('WEBVTT\n\n00:65:00.000 --> 00:00:01.000\nbad\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 3 })
  })

  test('yield seam per 2 000 cues (FR-07.7)', async () => {
    let yields = 0
    const clock = (seconds: number): string => {
      const pad = (v: number, w: number): string => String(v).padStart(w, '0')
      const ms = Math.round(seconds * 1000)
      return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(ms % 1000, 3)}`
    }
    const body = Array.from({ length: 2_001 }, (_, index) => `${clock(index)} --> ${clock(index + 1)}\ncue ${index}\n`).join('\n')
    const result = await parseVtt(`WEBVTT\n\n${body}`, { scheduleYield: () => Promise.resolve().then(() => void (yields += 1)) })
    expect(result.cues).toHaveLength(2_001)
    expect(yields).toBe(1)
  })
})
