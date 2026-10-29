// CC-04.11 / CC-04.12 (L1): the `PcmChunk` wire contract over a real
// `MessagePort` pair — 1 s chunks, `PcmChunkStream` async-iteration,
// two-port tee byte-identity, and the transferable/backpressure rules.
//
// Contract: protocol.ts `interface PcmChunk { startSec: Seconds; samples:
// Float32Array }` ("16 kHz mono f32, 1 s batches, transferable") imported
// verbatim — never redefined. `PcmChunkStream(port)` (unit-05's transcriber
// and unit-06's diarizer consume it) is an async iterable over the chunks a
// `decode` job posts to its ports.
import { afterEach, describe, expect, test } from 'vitest'
import type { PcmChunk } from '@engine/protocol@04'
import {
  PcmChunkStream,
  transferSource,
  type AudioSampleLike,
  type AudioTrackLike,
  type MediaSourceLike,
} from '@engine/audio/worker-core'
import { createMessageChannel, type CreateMessageChannel } from '@engine/audio/worker-core@ref'
import { sequentialBytes } from './helpers/hash-vector'

const channels: CreateMessageChannel[] = []

function channel(): CreateMessageChannel {
  const created = createMessageChannel()
  channels.push(created)
  return created
}

afterEach(() => {
  while (channels.length > 0) channels.pop()!.close()
})

function samplesOf(seed: number, frames = 16000): Float32Array {
  const bytes = sequentialBytes(frames * 4, seed)
  return new Float32Array(bytes.buffer.slice(0))
}

describe('CC-04.12: PcmChunkStream over a MessagePort', () => {
  test('CC-04.12: PcmChunkStream yields PcmChunk { startSec, samples } in order and completes on the end signal', async () => {
    const { port1, port2 } = channel()
    const stream = PcmChunkStream(port1)
    const sent: PcmChunk[] = [
      { startSec: 0, samples: samplesOf(1) },
      { startSec: 1, samples: samplesOf(2) },
      { startSec: 2, samples: samplesOf(3, 8000) },
    ]
    // Producer sends with transfer; the stream must surface the REAL arrays.
    for (const chunk of sent) port2.postMessage(chunk, [chunk.samples.buffer])
    port2.postMessage({ t: 'end' })

    const received: PcmChunk[] = []
    for await (const chunk of stream) {
      expect(typeof chunk.startSec).toBe('number')
      expect(chunk.samples).toBeInstanceOf(Float32Array)
      received.push(chunk)
    }
    expect(received.map((chunk) => chunk.startSec)).toEqual([0, 1, 2])
    expect(received.map((chunk) => chunk.samples.length)).toEqual([16000, 16000, 8000])
    expect(Array.from(received[0]!.samples)).toEqual(Array.from(sent[0]!.samples))
    // 1 s chunks at 16 kHz are exactly 16 000 samples (final chunk may be short).
    for (const chunk of received.slice(0, 2)) expect(chunk.samples.length).toBe(16000)
  })

  test('CC-04.12: PcmChunkStream exposes next()/return() (usable outside for-await)', async () => {
    const { port1, port2 } = channel()
    const stream = PcmChunkStream(port1)
    port2.postMessage({ startSec: 0, samples: samplesOf(4) })
    port2.postMessage({ t: 'end' })
    const first = await stream.next()
    expect(first.done).toBe(false)
    expect(first.value?.samples.length).toBe(16000)
    const end = await stream.next()
    expect(end.done).toBe(true)
    expect(await stream.return?.()).toEqual({ done: true, value: undefined })
  })

  test('CC-04.12: an error message propagates to the consumer as a rejection', async () => {
    const { port1, port2 } = channel()
    const stream = PcmChunkStream(port1)
    port2.postMessage({ t: 'job:error', jobId: 'x', error: { code: 'DECODE_STALL', retryable: true } })
    await expect(async () => {
      for await (const _chunk of stream) void _chunk
    }).rejects.toThrow(/DECODE_STALL/)
  })

  test('CC-04.12: stream buffers a burst of chunks without dropping any (consumer slower than producer)', async () => {
    const { port1, port2 } = channel()
    const stream = PcmChunkStream(port1)
    for (let index = 0; index < 30; index++) port2.postMessage({ startSec: index, samples: new Float32Array(4) }, [])
    port2.postMessage({ t: 'end' })
    const seen: number[] = []
    for await (const chunk of stream) seen.push(chunk.startSec)
    expect(seen).toEqual(Array.from({ length: 30 }, (_, index) => index))
  })
})

describe('CC-04.12: MessagePort transfer/backpressure plumbing (deps, not a stub)', () => {
  test('CC-04.12: teePcm copies a chunk to every port byte-identically', async () => {
    const first = channel()
    const second = channel()
    const source = samplesOf(9)
    const chunk: PcmChunk = { startSec: 3, samples: source.slice() }
    const { teePcm } = await import('@engine/audio/worker-core')
    teePcm(chunk, [first.port2, second.port2])
    await waitFor(() => first.received.length > 0 && second.received.length > 0)
    // The tee MUST copy (not move): the original stays usable after sending.
    expect(chunk.samples.length).toBe(16000)
    expect(Array.from(chunk.samples)).toEqual(Array.from(source))
    expect(first.received[0]!.t).toBe('chunk')
    expect(second.received[0]!.t).toBe('chunk')
  })

  test('CC-04.12: transferSource wraps a buffer as a `transfer` PcmSource', () => {
    const buffer = new ArrayBuffer(64)
    expect(transferSource(buffer)).toEqual({ kind: 'transfer', buffer })
  })
})

describe('CC-04.11: real MediaSourceLike doubles for the decode suite', () => {
  test('CC-04.11: AudioSampleLike/MediaSourceLike shapes round-trip through a generator (end-to-end deps usable)', async () => {
    const track: AudioTrackLike = {
      number: 1,
      codec: 'aac',
      sampleRate: 16000,
      numberOfChannels: 1,
      canDecode: () => true,
    }
    const source: MediaSourceLike = {
      getDuration: () => 2,
      audioTracks: () => [track],
      samples: async function* (): AsyncGenerator<AudioSampleLike> {
        for (let index = 0; index < 2; index++) {
          yield {
            timestamp: index,
            sampleRate: 16000,
            numberOfFrames: 16000,
            numberOfChannels: 1,
            samples: () => [samplesOf(index * 2)],
          }
        }
      },
    }
    const timestamps: number[] = []
    for await (const sample of source.samples(track)) timestamps.push(sample.timestamp)
    expect(timestamps).toEqual([0, 1])
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for the port message')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}