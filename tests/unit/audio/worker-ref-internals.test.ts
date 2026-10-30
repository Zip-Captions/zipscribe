// Coverage provider (CC-04.14 nested run, unit-03 internals-suite pattern):
// the reference MessagePort's closed/teardown semantics and classifier legs
// the frozen suites do not drive (post/close races, buffered() probes on both
// ports and unknown ports, cancelled/non-object classification). No
// CC-tracing; the frozen suites own the criterion evidence.
import { describe, expect, test } from 'vitest'
import { createMessageChannel } from '@engine/audio/worker-core@ref'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('worker-core@ref: closed-port and buffered legs', () => {
  test('postMessage after close is inert (sender and receiver sides)', async () => {
    const ch = createMessageChannel()
    ch.close()
    ch.port2.postMessage({ t: 'job:done', jobId: 'gone' })
    ch.port1.postMessage({ startSec: 0, samples: new Float32Array(4) })
    await flush()
    expect(ch.received).toHaveLength(0)
    expect(ch.buffered(ch.port1)).toBe(0)
  })

  test('messages queued before a close are never dispatched (arrival is still recorded)', async () => {
    const ch = createMessageChannel()
    let dispatched = 0
    ch.port1.onmessage = () => {
      dispatched += 1
    }
    ch.port2.postMessage({ t: 'job:done', jobId: 'raced' })
    ch.close()
    await flush()
    // the recorder counts arrival; the queue itself was dropped and no
    // handler ever ran.
    expect(ch.received).toEqual([{ t: 'done', jobId: 'raced' }])
    expect(dispatched).toBe(0)
    expect(ch.buffered(ch.port1)).toBe(0)
  })

  test('buffered() counts on each port and reports 0 for unknown ports', async () => {
    const ch = createMessageChannel()
    ch.port2.postMessage({ t: 'job:done', jobId: 'b1' })
    ch.port2.postMessage({ t: 'job:error', jobId: 'b2', error: { code: 'ENGINE_INTERNAL' } })
    expect(ch.buffered(ch.port1)).toBe(2)
    expect(ch.buffered(ch.port2)).toBe(0)
    const other = createMessageChannel()
    expect(ch.buffered(other.port1)).toBe(0)
    ch.close()
    other.close()
  })

  test('start() drains a queue accumulated without a handler, in order', async () => {
    const ch = createMessageChannel()
    ch.port2.postMessage({ t: 'job:done', jobId: 'q1' })
    ch.port2.postMessage({ startSec: 3, samples: new Float32Array([9]) })
    const seen: unknown[] = []
    ch.port1.onmessage = (event: { data: unknown }) => seen.push(event.data)
    ch.port1.start()
    await flush()
    expect(seen.map((data) => (data as { t?: string; startSec?: number }).t ?? (data as { startSec?: number }).startSec)).toEqual(['job:done', 3])
    // `received` logs arrival (before any handler existed) and again on
    // dispatch — the arrival prefix must be in post order.
    expect(ch.received.slice(0, 2).map((message) => message.t)).toEqual(['done', 'chunk'])
    ch.close()
  })
})

describe('worker-core@ref: classifier legs', () => {
  test('a cancelled message classifies; junk and untagged payloads are not recorded', async () => {
    const ch = createMessageChannel()
    ch.port2.postMessage({ t: 'cancelled', jobId: 'x-1' })
    ch.port2.postMessage('junk')
    ch.port2.postMessage(42)
    ch.port2.postMessage({ t: 'notice', jobId: 'ignored' })
    await flush()
    expect(ch.received).toEqual([{ t: 'cancelled', jobId: 'x-1' }])
    ch.close()
  })

  test('a payload without a string jobId records the empty job id', async () => {
    const ch = createMessageChannel()
    ch.port2.postMessage({ t: 'job:done' })
    await flush()
    expect(ch.received).toEqual([{ t: 'done', jobId: '' }])
    ch.close()
  })
})
