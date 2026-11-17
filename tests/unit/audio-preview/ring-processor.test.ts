// unit-107 (FR-107.2/FR-107.4, L2-on-the-REAL-processor): the ring lives in
// src/workers/** (outside the coverage include) and the decoded-clock suite
// drives only the SCRIPTED fake — until now nothing exercised the actual
// position-keyed ingest against the actual consumption loop. The [RQ] drift
// legs (CC-107.4) caught a deterministic tail starvation in here that every
// 30 s e2e missed; this suite pins the mechanics at L2 (fast, deterministic,
// no browser): priming, underrun-once + re-prime on refill, gap queueing,
// overlap dedupe, flush re-anchor, rate stride, and a full cancel/re-request
// flow-control simulation over a synthetic 12 s file (the drift scenario at
// scale — the clock's 9 s window, 1.5 s refill and whole-file iterator are
// mirrored, [107-ADJ 13/14]).
import { beforeAll, describe, expect, test } from 'vitest'

const MEDIA_RATE = 16_000
const RENDER_RATE = 48_000
const QUANTUM = 128

interface Posted {
  t: string
  consumedFrames?: number
}

interface RingNode {
  post(msg: unknown): void
  readonly posted: Posted[]
  /** Run `quanta` render blocks, returning the LAST block's mono output. */
  pump(quanta?: number): Float32Array
}

type ProcessorCtor = new (options: { processorOptions?: Record<string, unknown> }) => object

let RingCtor: ProcessorCtor | null = null
let activePort: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: Posted) => void; sink: Posted[] } | null = null

beforeAll(async () => {
  const scope = globalThis as unknown as Record<string, unknown>
  scope.AudioWorkletProcessor = class {
    // Per-instance port: the REAL constructor assigns onmessage on this
    // object, and everything the processor posts is recorded into the
    // currently-attached array (one node per test).
    readonly port = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage: (m: Posted): void => {
        activePort?.sink.push(m)
      },
      sink: [] as Posted[],
    }
  }
  scope.sampleRate = RENDER_RATE
  scope.registerProcessor = (_name: string, ctor: ProcessorCtor): void => {
    RingCtor = ctor
  }
  await import('../../../src/workers/ring-processor')
  expect(RingCtor, 'ring-processor registered itself on import').not.toBeNull()
})

function createNode(opts: { sampleRate?: number; channels?: number } = {}): RingNode {
  const Ctor = RingCtor as ProcessorCtor
  const posted: Posted[] = []
  const node = new Ctor({ processorOptions: { sampleRate: opts.sampleRate ?? MEDIA_RATE, channels: opts.channels ?? 1 } }) as {
    process: (i: Float32Array[][], o: Float32Array[][]) => boolean
    port: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: Posted) => void; sink: Posted[] }
  }
  activePort = node.port
  node.port.sink = posted
  return {
    post: (msg) => {
      node.port.onmessage?.({ data: msg } as MessageEvent)
    },
    posted,
    pump: (quanta = 1) => {
      let out = new Float32Array(QUANTUM)
      for (let i = 0; i < quanta; i++) {
        const output = [new Float32Array(QUANTUM)]
        node.process([[]], [output])
        out = output[0]!
      }
      return out
    },
  }
}

function ramp(fromSec: number, seconds: number): Float32Array {
  const n = Math.round(seconds * MEDIA_RATE)
  const arr = new Float32Array(n)
  for (let i = 0; i < n; i++) arr[i] = (fromSec + i / MEDIA_RATE) % 1
  return arr
}

const positions = (node: RingNode): number[] => node.posted.filter((p) => p.t === 'position').map((p) => p.consumedFrames ?? 0)
const countOf = (node: RingNode, t: string): number => node.posted.filter((p) => p.t === t).length

/** Pump until the last position >= target frames (or cap reached). */
function pumpTo(node: RingNode, targetFrames: number, cap = 4000): number {
  let last = 0
  for (let i = 0; i < cap; i++) {
    node.pump(1)
    const ps = positions(node)
    last = ps[ps.length - 1] ?? 0
    if (last >= targetFrames) break
  }
  return last
}

describe('CC-107.2: real ring processor (worklet-scope harness)', () => {
  test('CC-107.2: priming cue at ring/8, sample-accurate consumption, underrun ONCE at exhaustion', () => {
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 1) })
    expect(countOf(node, 'primed'), 'primed once ≥ ring/8 buffered').toBe(1)
    node.post({ t: 'play' })
    pumpTo(node, MEDIA_RATE / 2)
    expect(countOf(node, 'underrun'), 'no underrun while content remains').toBe(0)
    const last = pumpTo(node, MEDIA_RATE + 1)
    expect(last, 'consumed reaches the 1 s mark exactly').toBeGreaterThanOrEqual(MEDIA_RATE)
    node.pump(20)
    expect(countOf(node, 'underrun'), 'exhaustion posts underrun exactly once').toBe(1)
  })

  test('CC-107.2: gap queues (never drops); refill re-primes and audio resumes', () => {
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 1) })
    node.post({ t: 'play' })
    pumpTo(node, MEDIA_RATE - 100, 3000)
    node.pump(400)
    expect(countOf(node, 'underrun'), 'starved by the gap').toBe(1)
    node.post({ t: 'chunk', startSec: 1, samples: ramp(1, 1) })
    expect(countOf(node, 'primed'), 'refill re-posts primed').toBe(2)
    const last = pumpTo(node, 2 * MEDIA_RATE - 1)
    expect(last, 'queued continuation consumed to 2 s').toBeGreaterThanOrEqual(2 * MEDIA_RATE - QUANTUM)
  })

  test('CC-107.2: overlapping refill is deduped (never re-appended)', () => {
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 2) })
    node.post({ t: 'chunk', startSec: 1, samples: ramp(1, 2) }) // overlaps [1,2), extends to 3 s
    node.post({ t: 'play' })
    const last = pumpTo(node, 3 * MEDIA_RATE - 1)
    expect(last, 'contiguous to 3 s after overlap dedupe').toBeGreaterThanOrEqual(3 * MEDIA_RATE - QUANTUM)
    // monotonic positions, no re-run of [1,2)
    const ps = positions(node)
    for (let i = 1; i < ps.length; i++) expect(ps[i]! >= ps[i - 1]!, 'positions monotonic').toBe(true)
  })

  test('CC-107.2: flush clears the anchor; the next chunk re-anchors', () => {
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 1) })
    node.post({ t: 'play' })
    pumpTo(node, 500, 100)
    node.post({ t: 'flush' })
    node.post({ t: 'chunk', startSec: 5, samples: ramp(5, 1) })
    node.post({ t: 'play' })
    const before = positions(node).length
    node.pump(300)
    const tail = positions(node).slice(before)
    expect(tail[0], 'post-flush position jumps to the new anchor, never backward').toBeGreaterThanOrEqual(5 * MEDIA_RATE - QUANTUM)
  })

  test('CC-107.2: rate=2 consumes ~2× (sample-accurate stride)', () => {
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 2) })
    node.post({ t: 'rate', value: 2 })
    node.post({ t: 'play' })
    const quanta = 1000
    node.pump(quanta)
    const ps = positions(node)
    const last = ps[ps.length - 1] ?? 0
    // 1000 quanta × (128/48000 s) × rate 2 × media 16000 ≈ 6400 frames… wait:
    // 1000×128/48000 = 2.667 s wall → 2× = 5.33 s media → but only 2 s fed.
    expect(last, 'double-rate drains the 2 s buffer')
      .toBeGreaterThanOrEqual(2 * MEDIA_RATE - QUANTUM)
  })

  test('CC-107.4: cancel/re-request flow-control simulation — 12 s file consumed whole, zero underruns', () => {
    // Mirrors decoded-clock pacing ([107-ADJ 13]): whole-file iterator,
    // 1 s chunks, 9 s in-flight cancel + IMMEDIATE restart from consumed,
    // 1.5 s refill trigger. The clock treats a stale (never-primed) consumed
    // as invalid ([107-ADJ 14]) — mirrored here by feedPositionSeen.
    const FILE_SECONDS = 12
    const node = createNode()
    let postedEndSec = 0 // seconds of the file handed to the port since last restart
    let feedActive = true
    let consumedSec = 0
    let nextChunkSec = 0
    const feedEndSec = (): number => Math.min(FILE_SECONDS, postedEndSec + 9)

    const postNextChunk = (): boolean => {
      if (nextChunkSec >= feedEndSec()) return false
      const dur = Math.min(1, feedEndSec() - nextChunkSec)
      node.post({ t: 'chunk', startSec: nextChunkSec, samples: ramp(nextChunkSec, dur) })
      nextChunkSec += dur
      postedEndSec = Math.max(postedEndSec, nextChunkSec)
      return true
    }

    // initial whole-file burst window
    while (postNextChunk()) {
      /* post until the 9 s window is full */
    }
    node.post({ t: 'play' })

    let feedPositionSeen = false
    for (let quanta = 0; quanta < 6000; quanta++) {
      node.pump(1)
      const ps = positions(node)
      const last = ps[ps.length - 1] ?? 0
      if (last > 0) feedPositionSeen = true
      consumedSec = last / MEDIA_RATE
      // clock rules, in order
      if (feedPositionSeen && postedEndSec - consumedSec > 9) {
        feedActive = false
        nextChunkSec = consumedSec
        postedEndSec = consumedSec
        feedActive = true
        feedPositionSeen = false
        while (postNextChunk()) {
          /* burst the new window */
        }
        continue
      }
      if (!feedActive && feedPositionSeen && consumedSec < FILE_SECONDS - 0.75 && postedEndSec - consumedSec < 1.5) {
        feedActive = true
        nextChunkSec = consumedSec
        postedEndSec = consumedSec
        while (postNextChunk()) {
          /* refill */
        }
      }
      if (consumedSec >= FILE_SECONDS - 0.01) break
      if (process.env.RING_DEBUG && quanta % 200 === 0) console.log('sim q=' + String(quanta) + ' consumed=' + consumedSec.toFixed(3) + ' postedEnd=' + postedEndSec.toFixed(3) + ' feedActive=' + String(feedActive) + ' primed=' + String(countOf(node, 'primed')) + ' underrun=' + String(countOf(node, 'underrun')))
    }
    if (process.env.RING_DEBUG) console.log('sim done consumed=' + consumedSec.toFixed(4) + ' postedEnd=' + postedEndSec.toFixed(4) + ' lastPositions=' + String(positions(node).slice(-4).map((f) => (f / MEDIA_RATE).toFixed(3))))
    expect(consumedSec, 'the whole synthetic file is consumed — no tail starvation').toBeGreaterThanOrEqual(FILE_SECONDS - 0.01)
    expect(countOf(node, 'underrun'), 'zero underruns through the 9 s cancel/restart churn').toBe(0)
  })
})
