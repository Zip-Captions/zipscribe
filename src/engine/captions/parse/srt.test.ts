// FR-07.2 (L1, co-located coverage suite): parseSrt — cue segmentation,
// optional index lines, CRLF, tag stripping, the pinned timestamp grammar and
// its typed line-numbered failure (FR-07.6), and the FR-07.7 yield seam. The
// frozen acceptance suite is tests/unit/captions (golden/round-trip/errors).
import { describe, expect, test } from 'vitest'
import { parseSrt } from './srt'

function cueBlock(index: number, startSec: number, text: string): string {
  const clock = (sec: number): string => {
    const ms = Math.round(sec * 1000)
    const pad = (v: number, w: number): string => String(v).padStart(w, '0')
    return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`
  }
  return `${index}\n${clock(startSec)} --> ${clock(startSec + 1)}\n${text}\n`
}

describe('FR-07.2: parseSrt', () => {
  test('parses indexed cues, keeps what the file said (no clamping — invariant 11 is the importer), strips tags, joins text lines', async () => {
    const text = ['1', '00:00:00,000 --> 00:00:01,400', 'Hi <i>there</i> friends', '', '2', '00:00:02,000 --> 00:00:03,000', 'one', 'two', ''].join('\n')
    const result = await parseSrt(text)
    expect(result.format).toBe('srt')
    expect(result.language).toBeNull()
    expect(result.cues).toHaveLength(2)
    expect(result.cues[0]).toEqual({ start: 0, end: 1.4, text: 'Hi there friends', lines: ['Hi there friends'] })
    expect(result.cues[1]!.lines).toEqual(['one', 'two'])
  })

  test('CRLF files parse identically; cues without an index line also parse; fractions accept . and ,', async () => {
    const crlf = '1\r\n00:01:00.500 --> 00:01:02.000\r\ncrlf cue\r\n\r\n00:02:00,000 --> 00:02:01,000\r\nno index\r\n'
    const result = await parseSrt(crlf)
    expect(result.cues.map((cue) => cue.text)).toEqual(['crlf cue', 'no index'])
    expect(result.cues[0]!.start).toBe(60.5)
  })

  test('overlapping / end-before-start cues are handed through untouched (importer clamps)', async () => {
    const result = await parseSrt('1\n00:00:03,000 --> 00:00:02,000\nbackwards\n')
    expect(result.cues[0]).toMatchObject({ start: 3, end: 2 })
  })

  test('a malformed timestamp line throws UNRECOGNIZED_FORMAT with its 1-based line (codes/numbers only, FR-07.6)', async () => {
    const broken = '1\n00:00:00,000 --> 00:00:01,000\nGood first cue\n\n2\n00:xx:00,000 --> nonsense\nBroken second cue\n'
    await expect(parseSrt(broken)).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 6 })
    await expect(parseSrt('just prose here\nsecond line\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT', line: 1 })
    await expect(parseSrt('1\n')).rejects.toMatchObject({ code: 'UNRECOGNIZED_FORMAT' })
  })

  test('yields at least once per completed 2 000-cue chunk (FR-07.7) and works without an injected scheduler', async () => {
    let yields = 0
    const text = Array.from({ length: 4_500 }, (_, index) => cueBlock(index + 1, index * 0.001, `cue ${index}`)).join('\n')
    const counted = await parseSrt(text, { scheduleYield: () => Promise.resolve().then(() => void (yields += 1)) })
    expect(counted.cues).toHaveLength(4_500)
    expect(yields).toBeGreaterThanOrEqual(Math.floor(4_500 / 2_000))
    const defaulted = await parseSrt(text) // default macrotask-tick scheduler
    expect(defaulted.cues).toHaveLength(4_500)
    expect(defaulted.cues[4_499]!.text).toBe('cue 4499')
  })
})
