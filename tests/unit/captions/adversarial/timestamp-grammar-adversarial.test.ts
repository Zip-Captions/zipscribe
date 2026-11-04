// Adversarial round (boundary-value category): per-format timestamp grammar
// extremes against the contract — unit-07 FR-07.2 (`.ai-dlc/local-transcribe-
// engine/unit-07-caption-import.md` line 44, "Timestamp grammars per spec")
// and the docs that line defers to (line 79):
//   WebVTT  https://www.w3.org/TR/webvtt1/  §4.1 "WebVTT timestamp" +
//           §6.2 "collect a WebVTT timestamp" (normative parser rules)
//   TTML2   https://www.w3.org/TR/ttml2/    §12.3.1 <time-expression>
//           (clock-time hours2|hours3plus, frames 2+ digits) + §7.2.5
//           ttp:frameRate ( <digit>+ — integers only)
//   SRT has no formal spec (unit-07 line 79) — de-facto grammar, tolerances
//   documented at src/engine/captions/parse/srt.ts lines 3-4.
//   SBV has no cited spec — pinned shorthand `H:MM:SS.mmm` (frozen contract
//   tests/unit/captions/unit07-api-contract.d.ts line 245); documented 1–2
//   digit-hour tolerance at parse/sbv.ts lines 2-3.
//   ASS `H:MM:SS.cc` (unit-07 line 44) — 3-digit ms tolerance documented at
//   parse/ass.ts lines 4-5.
// Parser failures are asserted structurally (frozen contract CaptionFailure)
// with FR-07.6 line numbers and no cue text (SECURITY-03 marker probes).
import { expect, test } from 'vitest'
import { parseSrt } from '@engine/captions/parse/srt'
import { parseVtt } from '@engine/captions/parse/vtt'
import { parseSbv } from '@engine/captions/parse/sbv'
import { parseTtml } from '@engine/captions/parse/ttml'
import { parseAss } from '@engine/captions/parse/ass'
import type { CaptionFailure } from '@engine/captions/contract@07'

const NO_YIELD = { scheduleYield: async () => {} }

async function captureFailure(run: () => Promise<unknown>): Promise<CaptionFailure> {
  try {
    await run()
  } catch (error) {
    return error as CaptionFailure
  }
  throw new Error('expected a CaptionFailure, but the call resolved')
}

function srtCue(timing: string, text = 'cue body'): string {
  return `1\n${timing}\n${text}\n`
}

// --- SRT (de-facto; parser-documented tolerances) ------------------------------

test('SRT boundary: 1–2-digit hours, 1/2/3-digit fractions and the `.` separator parse per documented de-facto grammar', async () => {
  const result = await parseSrt(srtCue('1:02:03,004 --> 2:03:04,5'), NO_YIELD)
  expect(result.cues).toHaveLength(1)
  expect(result.cues[0]!.start, '1-digit hour + 3-digit fraction 004 = 0.004 s').toBeCloseTo(3723.004, 3)
  expect(result.cues[0]!.end, '2-digit hour + 1-digit fraction 5 = 0.5 s (fraction = digits/10^digits)').toBeCloseTo(7384.5, 3)

  const dot = await parseSrt(srtCue('00:00:01.250 --> 00:00:02.000'), NO_YIELD)
  expect(dot.cues[0]!.start, '`.` fraction separator tolerated (srt.ts lines 3-4)').toBeCloseTo(1.25, 3)

  const maxHours = await parseSrt(srtCue('99:59:59,999 --> 99:59:59,999'), NO_YIELD)
  expect(maxHours.cues[0]!.start, '2-digit hour ceiling 99 h').toBeCloseTo(359999.999, 3)
})

test('SRT boundary: malformed fraction/hour/minute at the grammar edges are typed failures with line numbers only', async () => {
  const emptyFraction = await captureFailure(() => parseSrt(srtCue('00:00:01, --> 00:00:02,000', 'ZZMARK-EMPTY-FRAC'), NO_YIELD))
  expect(emptyFraction.code).toBe('UNRECOGNIZED_FORMAT')
  expect(emptyFraction.line).toBe(2)

  const fourDigits = await captureFailure(() => parseSrt(srtCue('00:00:01,0000 --> 00:00:02,000'), NO_YIELD))
  expect(fourDigits.code, '4 fraction digits exceed mmm').toBe('UNRECOGNIZED_FORMAT')

  const threeHours = await captureFailure(() => parseSrt(srtCue('100:00:00,000 --> 00:00:02,000'), NO_YIELD))
  expect(threeHours.code, 'hours documented 1–2 digits (srt.ts lines 3-4), 3 rejected').toBe('UNRECOGNIZED_FORMAT')

  const sixtyMinutes = await captureFailure(() => parseSrt(srtCue('00:60:00,000 --> 00:00:02,000'), NO_YIELD))
  expect(sixtyMinutes.code, 'minutes constrained [0-5]\\d').toBe('UNRECOGNIZED_FORMAT')

  const combined = `${emptyFraction.message}${emptyFraction.detail ?? ''}${emptyFraction.name}`
  expect(combined, 'SECURITY-03: cue text never in the failure').not.toContain('ZZMARK')
})

// --- WebVTT (W3C normative grammar) --------------------------------------------

test('VTT boundary (survived): [HH:]MM:SS.mmm — MM:SS.mmm, 2- and 3-digit hours parse; missing/short/long fraction and 1-digit hour reject', async () => {
  const noHours = await parseVtt(`WEBVTT\n\n01:02.500 --> 01:05.000\nbody`, NO_YIELD)
  expect(noHours.cues[0]!.start).toBeCloseTo(62.5, 3)

  const ninetyNine = await parseVtt(`WEBVTT\n\n99:59:59.999 --> 99:59:59.999\nbody`, NO_YIELD)
  expect(ninetyNine.cues[0]!.start, '>99 h requires the 2-digit ceiling to work').toBeCloseTo(359999.999, 3)

  const threeDigits = await parseVtt(`WEBVTT\n\n123:00:00.000 --> 123:00:02.000\nbody`, NO_YIELD)
  expect(threeDigits.cues[0]!.start).toBeCloseTo(442800, 3)

  const noFraction = await captureFailure(() => parseVtt(`WEBVTT\n\n01:02 --> 01:05\nbody`, NO_YIELD))
  expect(noFraction.code, 'W3C §6.2 step 13: `.` + digits required').toBe('UNRECOGNIZED_FORMAT')

  const fourDigits = await captureFailure(() => parseVtt(`WEBVTT\n\n01:02.5000 --> 01:05.000\nbody`, NO_YIELD))
  expect(fourDigits.code, 'W3C §6.2 steps 14-15: fraction not exactly three characters is an error').toBe('UNRECOGNIZED_FORMAT')

  const oneDigitHour = await captureFailure(() => parseVtt(`WEBVTT\n\n1:02.500 --> 1:05.000\nbody`, NO_YIELD))
  expect(oneDigitHour.code, '1-digit hour without h:m:s shape is an error (§6.2 steps 5-12)').toBe('UNRECOGNIZED_FORMAT')
})

test('VTT boundary VIOLATION: 4-digit hours are spec-valid (W3C webvtt1 §4.1 "Two or more ASCII digits"; §6.2 step 5 imposes no length cap) but the parser rejects them', async () => {
  // webvtt.ts line 16 caps the hour group at \d{1,3}; the spec caps it nowhere.
  const result = await parseVtt(`WEBVTT\n\n1234:00:00.000 --> 1234:00:02.000\nbody`, NO_YIELD)
  expect(result.cues, 'a conforming WebVTT timestamp must parse').toHaveLength(1)
  expect(result.cues[0]!.start).toBeCloseTo(1234 * 3600, 3)
  expect(result.cues[0]!.end).toBeCloseTo(1234 * 3600 + 2, 3)
})

test('VTT boundary VIOLATION: 1–2 digit fractions are spec-invalid (W3C webvtt1 §6.2 steps 14-15 "not exactly three characters … return an error") but the parser accepts them', async () => {
  // webvtt.ts line 16 accepts \d{1,3} and vtt.ts lines 14-15 attribute "one to
  // three for fraction" to the spec — the normative rules require exactly three.
  const short = await captureFailure(() => parseVtt(`WEBVTT\n\n00:00:01.5 --> 00:00:02.000\nZZMARK-SHORT-FRAC`, NO_YIELD))
  expect(short.code, '`.5` must be a parse error per §6.2 step 15').toBe('UNRECOGNIZED_FORMAT')
  const twoDigit = await captureFailure(() => parseVtt(`WEBVTT\n\n00:00:01.50 --> 00:00:02.000\nbody`, NO_YIELD))
  expect(twoDigit.code, '`.50` must be a parse error per §6.2 step 15').toBe('UNRECOGNIZED_FORMAT')
})

// --- SBV (no cited spec; pinned shorthand + documented hour tolerance) ---------

test('SBV boundary: unpadded hour parses, documented 2-digit-hour tolerance parses, comma separator is mandatory', async () => {
  const single = await parseSbv('0:00:00.000,0:00:02.000\nbody', NO_YIELD)
  expect(single.cues[0]!.start).toBe(0)
  expect(single.cues[0]!.end).toBeCloseTo(2, 3)

  const twoDigitHour = await parseSbv('9:59:59.999,10:00:01.500\nbody', NO_YIELD)
  expect(twoDigitHour.cues[0]!.start, '2-digit hours tolerated (sbv.ts lines 2-3)').toBeCloseTo(35999.999, 3)

  const spaceSeparated = await captureFailure(() => parseSbv('0:00:00.000 0:00:02.000\nZZMARK-SBV', NO_YIELD))
  expect(spaceSeparated.code, 'the `,` separator is part of the grammar').toBe('UNRECOGNIZED_FORMAT')
  expect(spaceSeparated.line, 'FR-07.6: 1-based line of the malformed timing').toBe(1)
  expect(`${spaceSeparated.message}${spaceSeparated.detail ?? ''}`, 'SECURITY-03').not.toContain('ZZMARK')
})

// --- TTML (TTML2 normative grammar) ---------------------------------------------

function ttml(body: string, attrs = ''): string {
  return `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" ${attrs}>${body}</tt>`
}

function ttmlCue(attrs: string, ttAttrs = '', text = 'body'): string {
  return ttml(`<div><p ${attrs}>${text}</p></div>`, ttAttrs)
}

test('TTML boundary (survived): clock vs offset forms parse per §12.3.1; frameRate integers; malformed values are typed failures', async () => {
  const clock = await parseTtml(ttmlCue('begin="00:00:01.500" end="00:00:02.500"'), NO_YIELD)
  expect(clock.cues[0]!.start).toBeCloseTo(1.5, 3)

  const framesClock = await parseTtml(ttmlCue('begin="00:00:00:15" end="00:00:00:30"', 'ttp:frameRate="25"'), NO_YIELD)
  expect(framesClock.cues[0]!.start, '15 frames at 25 fps = 0.6 s').toBeCloseTo(0.6, 6)

  const offsets = await parseTtml(ttmlCue('begin="500ms" end="1.5s"') + `<p begin="2m" end="1h">x</p>` + `<p begin="50f" end="51f">y</p>`, NO_YIELD)
  expect(offsets.cues[0]!.start, 'ms').toBeCloseTo(0.5, 6)
  expect(offsets.cues[0]!.end, 'fractional seconds').toBeCloseTo(1.5, 6)
  expect(offsets.cues[1]!.start, 'minutes').toBeCloseTo(120, 6)
  expect(offsets.cues[1]!.end, 'hours').toBeCloseTo(3600, 6)
  expect(offsets.cues[2]!.start, '50f at the TTML2 default frameRate 30').toBeCloseTo(50 / 30, 6)

  const ticks = await parseTtml(ttmlCue('begin="30t" end="31t"', 'ttp:frameRate="25"'), NO_YIELD)
  expect(ticks.cues[0]!.start, 'ticks: default tickRate 1 → count/frameRate').toBeCloseTo(1.2, 6)

  const noUnit = await captureFailure(() => parseTtml(ttmlCue('begin="5" end="6"', '', 'ZZMARK-TTML'), NO_YIELD))
  expect(noUnit.code, 'offset-time requires a metric (§12.3.1)').toBe('UNRECOGNIZED_FORMAT')
  expect(`${noUnit.message}${noUnit.detail ?? ''}`, 'SECURITY-03').not.toContain('ZZMARK')

  const rationalRate = await captureFailure(() => parseTtml(ttmlCue('begin="00:00:01.000" end="00:00:02.000"', 'ttp:frameRate="30000/1001"'), NO_YIELD))
  expect(rationalRate.code, '§7.2.5 ttp:frameRate : <digit>+ — the rational form is NOT TTML2 syntax (frameRateMultiplier is the NTSC mechanism)').toBe('UNRECOGNIZED_FORMAT')

  const zeroRate = await captureFailure(() => parseTtml(ttmlCue('begin="00:00:01.000" end="00:00:02.000"', 'ttp:frameRate="0"'), NO_YIELD))
  expect(zeroRate.code, '§7.2.5 frameRate must be > 0').toBe('UNRECOGNIZED_FORMAT')

  const beginOnly = await captureFailure(() => parseTtml(ttmlCue('begin="00:00:01.000"'), NO_YIELD))
  expect(beginOnly.code, 'v1 text-profile scope: <p>-level end or dur required (parse/ttml.ts lines 1-4)').toBe('UNRECOGNIZED_FORMAT')
})

test('TTML boundary VIOLATION: 4-digit clock hours are spec-valid (§12.3.1 hours3plus = <digit> <digit> <digit>+) but the parser rejects them', async () => {
  // ttml.ts line 17 caps hours at \d{1,3}.
  const result = await parseTtml(ttmlCue('begin="1234:00:00.000" end="1234:00:02.000"'), NO_YIELD)
  expect(result.cues, 'a conforming clock-time must parse').toHaveLength(1)
  expect(result.cues[0]!.start).toBeCloseTo(4442400, 3)
  expect(result.cues[0]!.end).toBeCloseTo(4442402, 3)
})

test('TTML boundary VIOLATION: 3-digit frames terms are spec-valid (§12.3.1 frames = <digit><digit> | <digit><digit><digit>+) but the parser rejects them', async () => {
  // ttml.ts line 17 caps the frames term at \d{1,2}.
  const result = await parseTtml(ttmlCue('begin="00:00:01:150" end="00:00:02:000"', 'ttp:frameRate="200"'), NO_YIELD)
  expect(result.cues, '150 frames at 200 fps must parse').toHaveLength(1)
  expect(result.cues[0]!.start, '1 + 150/200').toBeCloseTo(1.75, 6)
  expect(result.cues[0]!.end).toBeCloseTo(2, 6)
})

// --- ASS (H:MM:SS.cc) -------------------------------------------------------------

function assDialogue(start: string, end: string, text: string): string {
  return `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`
}

test('ASS boundary: .cc parses, documented 3-digit ms tolerance parses, 1-digit fraction and 2-digit minutes are typed failures', async () => {
  const centis = await parseAss(assDialogue('0:00:01.50', '0:00:02.50', 'body'), NO_YIELD)
  expect(centis.cues[0]!.start, '.50 centiseconds = 0.5 s').toBeCloseTo(1.5, 3)

  const millis = await parseAss(assDialogue('0:00:02.500', '0:00:03.000', 'body'), NO_YIELD)
  expect(millis.cues[0]!.start, '3-digit ms tolerated (ass.ts lines 4-5)').toBeCloseTo(2.5, 3)

  const oneDigit = await captureFailure(() => parseAss(assDialogue('0:00:03.5', '0:00:04.00', 'ZZMARK-ASS'), NO_YIELD))
  expect(oneDigit.code, 'unit-07 line 44 pins `H:MM:SS.cc` — a single centisecond digit is malformed').toBe('UNRECOGNIZED_FORMAT')
  expect(oneDigit.line, 'FR-07.6 line number of the Dialogue line').toBe(3)
  expect(`${oneDigit.message}${oneDigit.detail ?? ''}`, 'SECURITY-03').not.toContain('ZZMARK')

  const sixtyMinutes = await captureFailure(() => parseAss(assDialogue('0:60:00.00', '0:60:02.00', 'body'), NO_YIELD))
  expect(sixtyMinutes.code).toBe('UNRECOGNIZED_FORMAT')
})
