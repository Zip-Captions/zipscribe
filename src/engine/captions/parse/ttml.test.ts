// FR-07.2 (L1, co-located coverage suite): parseTtml per
// https://www.w3.org/TR/ttml2/ — clock/offset times, ttp:frameRate 'f'
// offsets, xml:lang, nested tags/entities, dur fallback, typed failures.
import { describe, expect, test } from 'vitest'
import { parseTtml } from './ttml'

const HEADER = (extra = ''): string => `<?xml version="1.0" encoding="UTF-8"?>\n<tt xml:lang="de" xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter"${extra}>\n  <body>\n    <div>`

describe('FR-07.2: parseTtml', () => {
  test('offset seconds, frame offsets via ttp:frameRate, xml:lang, nested tags, entities, <br>-free multi-line-free text', async () => {
    const text = [
      HEADER(' ttp:frameRate="25"'),
      '      <p begin="0s" end="1s">Ready <span regional="a">go</span> now</p>',
      '      <p begin="50f" end="100f">Frames &amp; seconds</p>',
      '      <p begin="00:00:02.500" end="00:00:03.250">clock</p>',
      '    </div>\n  </body>\n</tt>\n',
    ].join('\n')
    const result = await parseTtml(text)
    expect(result.format).toBe('ttml')
    expect(result.language).toBe('de')
    expect(result.cues.map((cue) => [cue.start, cue.end, cue.text])).toEqual([
      [0, 1, 'Ready go now'],
      [2, 4, 'Frames & seconds'],
      [2.5, 3.25, 'clock'],
    ])
  })

  test('clock fractions/frames, offset units h/m/ms/t, dur fallback, default frameRate 30, self-closed <p/> ignored', async () => {
    const text = [
      HEADER(''),
      '      <p begin="0:00:01:15" end="0:00:02">sec + frames/30</p>',
      '      <p begin="1h" end="1.001h" dur="5ms">hours</p>',
      '      <p begin="0.5m" end="31s">minutes</p>',
      '      <p begin="0.1s" dur="200f">dur frames at default 30</p>',
      '      <p begin="1t" end="2t">ticks</p>',
      '      <p begin="0s" end="0s"/>',
      '    </div>\n  </body>\n</tt>\n',
    ].join('\n')
    const result = await parseTtml(text)
    const spans = result.cues.map((cue) => [cue.start, cue.end] as const)
    const expected: Array<readonly [number, number]> = [
      [1 + 15 / 30, 2],
      [3600, 3603.6],
      [30, 31],
      [0.1, 0.1 + 200 / 30],
      [1 / 30, 2 / 30],
    ]
    expect(spans).toHaveLength(expected.length)
    for (let index = 0; index < expected.length; index++) {
      expect(spans[index]![0], `cue ${index} start`).toBeCloseTo(expected[index]![0], 6)
      expect(spans[index]![1], `cue ${index} end`).toBeCloseTo(expected[index]![1], 6)
    }
  })

  test('numeric entities decode and outer whitespace trims (xml:space default)', async () => {
    const text = [HEADER(''), '      <p begin="0s" end="1s">  &#65;&#x42;  </p>', '    </div>\n  </body>\n</tt>\n'].join('\n')
    const result = await parseTtml(text)
    expect(result.cues[0]!.text).toBe('AB')
  })

  test('typed failures: missing <tt>, malformed frameRate, missing/malformed timing', async () => {
    await expect(parseTtml('<html><body>no</body></html>')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 1 })
    await expect(parseTtml([HEADER(' ttp:frameRate="zero"'), '<p begin="0s" end="1s">x</p>', '</div></body></tt>'].join('\n'))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
    await expect(parseTtml([HEADER(''), '<p begin="soon" end="later">x</p>', '</div></body></tt>'].join('\n'))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 5 })
    await expect(parseTtml([HEADER(''), '<p>x</p>', '</div></body></tt>'].join('\n'))).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 5 })
  })

  test('yield seam per 2 000 cues (FR-07.7)', async () => {
    let yields = 0
    const paragraphs = Array.from({ length: 2_001 }, (_, index) => `      <p begin="${index}s" end="${index + 1}s">cue ${index}</p>`).join('\n')
    const result = await parseTtml(`${HEADER('')}\n${paragraphs}\n    </div>\n  </body>\n</tt>\n`, { scheduleYield: () => Promise.resolve().then(() => void (yields += 1)) })
    expect(result.cues).toHaveLength(2_001)
    expect(yields).toBe(1)
  })
})
