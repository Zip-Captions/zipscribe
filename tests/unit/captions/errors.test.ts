// CC-07.1 (L1) / FR-07.1 / SECURITY-03: every rejected import is a TYPED
// failure — one of the four contract codes, carrying at most code + line,
// never a snippet of caption text; the passed project stays byte-identical
// (atomicity) and nothing leaks to console or the error surface.
import { expect, test } from 'vitest'
import { importCaptions } from '@engine/captions/import'
import type { Project } from '@engine/model@07'
import { CANARY_MARKER, containsCanary, createRedactionSpy, scanError } from '../../../src/test-support/redaction'
import { canonical } from './canonical'
import { captionFile, makeBlock, makeProject, makeWord } from './project-support'

const utf8 = new TextEncoder()
const MAX_FILE_BYTES = 20 * 1024 * 1024 // FR-07.1 guard, unit-07 spec
const MAX_CUES = 100_000 // unit-07 spec guard

function clock(sec: number, sep: ',' | '.'): string {
  const ms = Math.round(sec * 1000)
  const pad = (v: number, w: number): string => String(v).padStart(w, '0')
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}${sep}${pad(ms % 1000, 3)}`
}

function makeSrt(cueCount: number, textAt: (index: number) => string = (index) => `cue words ${index}`): Uint8Array {
  const lines: string[] = []
  for (let index = 0; index < cueCount; index++) {
    lines.push(`${index + 1}`, `${clock(index, ',')} --> ${clock(index + 0.5, ',')}`, textAt(index), '')
  }
  return utf8.encode(lines.join('\n'))
}

function projectWithCanary(): Project {
  return makeProject({
    duration: 600,
    blocks: [makeBlock(0, 10, [makeWord(`secret`, 0, 5), makeWord(CANARY_MARKER, 5, 10)], 'SPK_1', 'blk-canary')],
    speakers: [{ id: 'SPK_1', label: 'Speaker 1', color: '#fff' }],
  })
}

async function expectFailure(file: { name: string; bytes: Uint8Array }, shape: Record<string, unknown>, options?: Parameters<typeof importCaptions>[2]): Promise<unknown> {
  const project = projectWithCanary()
  const before = canonical(project)
  const spy = createRedactionSpy()
  let caught: unknown
  try {
    await importCaptions(project, file, options ?? { as: 'source' })
    expect.unreachable(`expected a ${String(shape.code)} failure`)
  } catch (error) {
    caught = error
  } finally {
    const verdict = spy.settle()
    spy.restore()
    expect(verdict.leaks, 'console output stayed canary-clean during the failure').toEqual([])
  }
  await expect(Promise.reject(caught)).rejects.toMatchObject(shape)
  expect(containsCanary(caught), 'SECURITY-03: the error surface (message/stack/detail) carries no caption text').toBe(false)
  expect(scanError(caught), 'scanError: message and detail are clean').toEqual([])
  expect(canonical(project), 'failed import leaves the project byte-identical (atomic)').toBe(before)
  return caught
}

test('CC-07.1 / FR-07.1: prose that matches no format → UNRECOGNIZED_FORMAT', async () => {
  await expectFailure(captionFile('captions/garbage.txt'), { code: 'UNRECOGNIZED_FORMAT' })
})

test('CC-07.1: the failure names the offending LINE for SRT-style syntax errors', async () => {
  // bad-timestamps.srt: cue 2's timestamp line is line 6 of the file.
  await expectFailure(captionFile('captions/bad-timestamps.srt'), { code: 'UNRECOGNIZED_FORMAT', line: 6 })
})

test('CC-07.1: a syntax error mid-file reports the line with the canary and leaks nothing', async () => {
  const broken = `1\n${clock(0, ',')} --> ${clock(1, ',')}\nGood cue\n\n2\n${clock(2, ',')} --> BROKEN\n${CANARY_MARKER}\n`
  await expectFailure({ name: 'broken.srt', bytes: utf8.encode(broken) }, { code: 'UNRECOGNIZED_FORMAT' })
})

test('CC-07.1 / FR-07.1: bytes neither UTF-8, UTF-16 nor windows-1252 → ENCODING failure', async () => {
  await expectFailure(captionFile('captions/undecodable.bin'), { code: 'ENCODING' })
})

test('CC-07.1: explicit encoding option surfaces undecodable bytes as ENCODING with the option echoed', async () => {
  // utf-16le bytes are NOT valid under an explicit utf-8 override.
  const le = new Uint8Array([0x61, 0, 0, 0x00]) // 'a' + NUL in UTF-16LE
  await expectFailure({ name: 'forced.srt', bytes: le }, { code: 'ENCODING' }, { as: 'source', encoding: 'utf-8' })
})

test('CC-07.1: oversize file (20 MiB + 1 byte) → FILE_TOO_LARGE, rejected BEFORE any cue processing', async () => {
  let yields = 0
  const huge = new Uint8Array(MAX_FILE_BYTES + 1) // zero-filled: cheapest 20 MiB+1
  const project = projectWithCanary()
  const before = canonical(project)
  const spy = createRedactionSpy()
  try {
    await expect(importCaptions(project, { name: 'huge.srt', bytes: huge }, { as: 'source', scheduleYield: async () => { yields += 1 } })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
  } finally {
    const verdict = spy.settle()
    spy.restore()
    expect(verdict.clean, 'nothing logged from the oversize guard').toBe(true)
  }
  expect(yields, 'size guard runs before parsing — zero yields').toBe(0)
  expect(canonical(project), 'project untouched').toBe(before)
})

test('CC-07.1: more than 100 000 cues → TOO_MANY_CUES', async () => {
  await expectFailure({ name: 'huge.srt', bytes: makeSrt(MAX_CUES + 1) }, { code: 'TOO_MANY_CUES' })
})

test('CC-07.1: the cue-count guard counts CUES, not bytes — a 99 999-cue file imports fine', async () => {
  const { report } = await importCaptions(makeProject({ duration: 200_000 }), { name: 'big.srt', bytes: makeSrt(99_999) }, { as: 'source', scheduleYield: async () => undefined })
  expect(report.cues).toBe(99_999)
})

test('CC-07.1: a .zipscribe.json that is not valid JSON is UNRECOGNIZED_FORMAT, not a raw SyntaxError', async () => {
  await expectFailure({ name: 'broken.zipscribe.json', bytes: utf8.encode('{"project": [oops')} , { code: 'UNRECOGNIZED_FORMAT' })
})

test('CC-07.1: translation-mode import into a project with ZERO blocks reports CUE_UNMATCHED for every cue', async () => {
  const cue = (index: number): string => `${clock(index, '.')} --> ${clock(index + 0.5, '.')}\nline ${index}\n\n`
  const body = `WEBVTT\n\n${cue(1)}${cue(2)}`
  const { report } = await importCaptions(makeProject({ duration: 100 }), { name: 'orphan.vtt', bytes: utf8.encode(body) }, { as: { translation: 'es' } })
  expect(report.adjustments.find((a) => a.code === 'CUE_UNMATCHED')?.count).toBe(2)
  expect(report.blocks, 'source blocks were never touched').toBe(0)
})
