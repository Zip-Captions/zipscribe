// Adversarial suite (fresh-session red-team of unit-01): the canary spy must
// catch every leak the contract enumerates — the whole of `console.*` (not six
// channels) and content carried inside Error objects passed to console.
//
// Contract sources:
// - `knowledge/conventions.md` § Testing strategy, Principle 4: "a global spy on
//   `console.*`, thrown errors, `EngineError.detail`, notices and written
//   artifacts fails the run if the marker ever appears (SECURITY-03)".
// - `.agent/REVIEW.md` Always-check 1: "no transcript/caption/translation text
//   or audio-derived strings in `console.*`, thrown error messages, …".
// - unit-01 FR-1.0.12: canary-transcript redaction spy in `src/test-support/`.
import { describe, expect, test } from 'vitest'
import { CANARY_MARKER, containsCanary, createRedactionSpy } from '../../../src/test-support/redaction'

describe('adversarial: redaction spy leak-path coverage', () => {
  test('ADVERSARIAL CC-01.10: console.error of a canary string is caught (documents the covered path)', () => {
    const spy = createRedactionSpy()
    console.error(`engine failed: ${CANARY_MARKER}`)
    const verdict = spy.settle()
    spy.restore()
    expect(verdict.leaks, 'console.error must be a detected channel').not.toEqual([])
  })

  test('ADVERSARIAL CC-01.10: an Error object carrying the canary in its message must not pass through console.error', () => {
    // SECURITY-03's canonical leak shape: an EngineError-ish error whose
    // message/detail holds transcript text, logged as an object. Error
    // properties are non-enumerable, so JSON.stringify-based flattening sees
    // "{}" and the spy stays clean while the console (once restored, or in the
    // browser) shows `Error: <canary>`.
    const spy = createRedactionSpy()
    console.error(Object.assign(new Error(`decode stalled on ${CANARY_MARKER}`), { code: 'DECODE_STALL' }))
    const verdict = spy.settle()
    spy.restore()
    expect(
      verdict.leaks,
      `console.error(new Error(canaryMessage)) produced no leak record: flatten() JSON.stringify's the Error to "{}" (message/stack are non-enumerable), so the SECURITY-03 canonical leak — transcript text inside a logged Error — passes the spy clean (conventions § Principles 4, REVIEW.md #1)`,
    ).not.toEqual([])
  })

  test('ADVERSARIAL CC-01.10: console.table of the canary must fail the run (console.* includes console.table)', () => {
    // The spy wraps log/info/warn/error/debug/trace only. console.table (and
    // console.dir) write straight to stdout un-wrapped: the marker literally
    // appears in run output while settle() reports clean.
    // The real console.table is temporarily captured (not printed) so this
    // counterexample does not itself echo the marker into CI output; the
    // assertion is on detection: an un-wrapped channel means the marker flows
    // to stdout in production runs of the harness while settle() stays clean.
    const originalTable = console.table
    console.table = (() => undefined) as typeof console.table
    const spy = createRedactionSpy()
    try {
      console.table([{ transcript: CANARY_MARKER }])
      const verdict = spy.settle()
      expect(
        verdict.leaks,
        'console.table([{transcript: CANARY}]) produced no leak record: the spy wraps only log/info/warn/error/debug/trace, and console.table/console.dir write straight to stdout un-instrumented — conventions § Principles 4 requires a spy on console.* (SECURITY-03, REVIEW.md #1)',
      ).not.toEqual([])
    } finally {
      spy.restore()
      console.table = originalTable
    }
  })

  test('ADVERSARIAL CC-01.10: containsCanary must detect the marker inside an Error object', () => {
    // The spy delegates leak detection to containsCanary; if it cannot see the
    // message of an Error, every consumer of it (console spy, scanError-adjacent
    // artifact checks) shares the blind spot.
    expect(
      containsCanary(new Error(`transcript: ${CANARY_MARKER}`)),
      'containsCanary(error) is false because Error.message is non-enumerable and JSON.stringify(error) === "{}" — the error-object blind spot behind both the console spy and any artifact scan built on the same helper',
    ).toBe(true)
  })
})
