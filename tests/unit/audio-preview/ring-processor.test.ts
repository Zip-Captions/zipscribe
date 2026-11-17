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
  test('CC-107.4: 44.1 k stereo burst beyond ring capacity keeps draining during playback (drift-rate regression)', () => {
    // The exact drift-leg rates: media 44 100, render 48 000 (consumeScale
    // 0.91875 — step 0/1 per quantum), stereo, 2 s ring vs a 12 s burst.
    // The real e2e starved at consumed≈2.15 s with the queue full.
    const RATE = 44_100
    const node = createNode({ sampleRate: RATE, channels: 2 })
    for (let c = 0; c < 12; c++) {
      const n = RATE
      const samples = new Float32Array(n * 2)
      for (let i = 0; i < n; i++) {
        samples[i * 2] = ((c + i / RATE) % 1) * 2 - 1
        samples[i * 2 + 1] = ((c + i / RATE) % 1) * 2 - 1
      }
      node.post({ t: 'chunk', startSec: c, samples })
    }
    node.post({ t: 'play' })
    const last = pumpTo(node, 5 * RATE - 1, 20_000)
    expect(last, 'consumption passes 5 s across TWO ring-full queue drains').toBeGreaterThanOrEqual(5 * RATE - QUANTUM)
    expect(countOf(node, 'underrun'), 'zero underruns with a full queue').toBe(0)
  })

  test('CC-107.4: overlapping double-feed bursts (open + play re-feed) lose no content to the cap', () => {
    // The real clock opens the feed at project load AND again on play
    // (needsFeed) — two whole-span bursts of the SAME span interleave with
    // reads. The second burst is deduped at enqueue (queueEndFrames,
    // [107-ADJ 16]); place()'s partial-fill remainder (FRONT re-queue) must
    // survive the cap or a hole opens (observed e2e at [2.152, 3.0) s).
    const RATE = 44_100
    const node = createNode({ sampleRate: RATE, channels: 2 })
    const burst = (): void => {
      for (let c = 0; c < 12; c++) {
        const samples = new Float32Array(RATE * 2)
        for (let i = 0; i < RATE; i++) {
          samples[i * 2] = ((c + i / RATE) % 1) * 2 - 1
          samples[i * 2 + 1] = ((c + i / RATE) % 1) * 2 - 1
        }
        node.post({ t: 'chunk', startSec: c, samples })
      }
    }
    burst()
    node.post({ t: 'play' })
    node.pump(50)
    burst() // second feed's whole-window burst, interleaved with playback
    const last = pumpTo(node, 6 * RATE - 1, 30_000)
    expect(last, 'consumption reaches 6 s through the double burst').toBeGreaterThanOrEqual(6 * RATE - QUANTUM)
    expect(countOf(node, 'underrun'), 'no starvation from cap-rejected remainders').toBe(0)
  })

  test('CC-107.4: a queue pinned at the 16.5 s cap survives place() partial-fill FRONT re-queue', () => {
    // [107-ADJ 15/16] the cap gates BACK deliveries only. A whole-file
    // burst overruns the cap (17 s queued past a gap); the clock's bridging
    // chunk then partial-fills the drained ring and its remainder is
    // re-queued at the FRONT. If the cap ever gated FRONT entries the
    // remainder vanished (e2e lost [2.152, 3.0) s exactly this way) and
    // consumption would stop at 4 s with a second underrun.
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 2) }) // ring base [0,2)
    // 19 × 1 s at 20 s: the queue crosses the 16.5 s cap at [37,38) and
    // [38,39) is dropped by design (pathological over-delivery).
    for (let c = 20; c < 39; c++) node.post({ t: 'chunk', startSec: c, samples: ramp(c, 1) })
    node.post({ t: 'play' })
    pumpTo(node, 2 * MEDIA_RATE - 1, 2_000) // drain the ring into the gap
    node.pump(2) // one more block on the empty ring → the stall alert
    expect(countOf(node, 'underrun'), 'the designed hole at 2 s stalls once').toBe(1)
    // The clock's stall recovery: re-request from the frozen playhead.
    node.post({ t: 'chunk', startSec: 2, samples: ramp(2, 18) })
    const last = pumpTo(node, 30 * MEDIA_RATE - 1, 40_000)
    expect(last, 'consumption reaches 30 s through the capped queue + FRONT remainder').toBeGreaterThanOrEqual(30 * MEDIA_RATE - QUANTUM)
    expect(countOf(node, 'underrun'), 'the 2 s stall is the ONLY starvation — the remainder survived the cap').toBe(1)
  })

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

  test('CC-107.4: duplicate back entries are deduped at enqueue so the cap never eats unique content', () => {
    // [107-ADJ 16] bounded from-time refills redeliver [time, deliveredEnd):
    // raw enqueue puts 12 s of duplicates behind 12 s of unique content —
    // over the 16.5 s cap — and the silent drop takes the UNIQUE tail
    // (observed e2e: the [14,18) span here, 56 counted underruns on the
    // 600 s leg). With queue-frontier dedupe the unique tail survives.
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 14) }) // ring 2 s + queue 12 s
    node.post({ t: 'chunk', startSec: 4, samples: ramp(4, 10) }) // 10 s duplicate → queue 22 s without dedupe
    node.post({ t: 'chunk', startSec: 14, samples: ramp(14, 4) }) // UNIQUE tail, meets a capped queue
    node.post({ t: 'play' })
    const last = pumpTo(node, 18 * MEDIA_RATE - 1, 40_000)
    expect(last, 'the unique [14,18) tail survives the duplicate burst').toBeGreaterThanOrEqual(18 * MEDIA_RATE - QUANTUM)
    expect(countOf(node, 'underrun'), 'no starvation').toBe(0)
  })

  test('CC-107.4: a sub-threshold tail chunk after exhaustion re-primes (EOF drain resume)', () => {
    // [107-ADJ 16] the 600 s leg stranded its final 114 frames queue-drained:
    // 114 < ring/8 (11 025) so 'primed' never re-fired and the clock waited
    // for a resume cue that EOF could never produce.
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 1) })
    node.post({ t: 'play' })
    pumpTo(node, MEDIA_RATE - 100, 3000)
    node.pump(400)
    expect(countOf(node, 'underrun'), 'drained to exhaustion').toBe(1)
    node.post({ t: 'chunk', startSec: 1, samples: ramp(1, 114 / MEDIA_RATE) })
    expect(countOf(node, 'primed'), 'any placement after an alert re-primes').toBe(2)
    const last = pumpTo(node, MEDIA_RATE + 100)
    expect(last, 'the 114-frame tail is consumed').toBeGreaterThanOrEqual(MEDIA_RATE + 100 - QUANTUM)
  })

  test('CC-107.2: overlapping refill is deduped (never re-appended)', () => {
    const node = createNode()
    node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 2) })
    node.post({ t: 'chunk', startSec: 1, samples: ramp(1, 2) }) // overlaps [1,2), extends to 3 s
    node.post({ t: 'play' })
    const last = pumpTo(node, 3 * MEDIA_RATE - 1)
    expect(last, 'contiguous to 3 s after overlap dedupe').toBeGreaterThanOrEqual(3 * MEDIA_RATE - QUANTUM)
    // Ceiling: with dedupe the file truly ends at 3 s, so the drained ring
    // goes silent (underrun) and positions stop. Without it the [1,2) re-run
    // extends content to 4 s and positions keep climbing past 3 s.
    node.pump(400)
    const ceiling = (positions(node).slice(-1)[0] ?? 0)
    expect(ceiling, 'no ink past the true 3 s end').toBeLessThanOrEqual(3 * MEDIA_RATE + QUANTUM)
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
    // Discriminating: 1000 quanta drains the 2 s buffer at ANY rate ≳0.75,
    // so pin the HALVING against a rate-1 control on an identical feed.
    const drainQuanta = (value: number): number => {
      const node = createNode()
      node.post({ t: 'chunk', startSec: 0, samples: ramp(0, 2) })
      if (value !== 1) node.post({ t: 'rate', value })
      node.post({ t: 'play' })
      for (let q = 1; q <= 2_000; q++) {
        node.pump(1)
        const ps = positions(node)
        if ((ps[ps.length - 1] ?? 0) >= 2 * MEDIA_RATE - QUANTUM) return q
      }
      return Number.POSITIVE_INFINITY
    }
    const at1 = drainQuanta(1)
    const at2 = drainQuanta(2)
    expect(at2, 'rate 2 drains in well under the rate-1 quanta').toBeLessThan(at1 * 0.7)
    expect(at2, 'rate 2 drains the 2 s buffer in ~375 quanta').toBeLessThanOrEqual(420)
  })

  test('CC-107.4: cancel/re-request flow-control simulation — 20 s file consumed whole, holes heal in ≤ 4 blocks', () => {
    // Mirrors decoded-clock pacing ([107-ADJ 17]): whole-file iterator (NO
    // worker window), 1 s chunks, CLOCK-side cancel at a 16 s delivered lead
    // + refill from the playhead at a 12 s lead. The clock treats a stale
    // (never-primed) consumed as invalid ([107-ADJ 14]) — mirrored here by
    // feedPositionSeen.
    const FILE_SECONDS = 20
    const node = createNode()
    let postedEndSec = 0 // seconds of the file handed to the port since last restart
    let feedActive = true
    let consumedSec = 0
    let nextChunkSec = 0
    const restartFeed = (fromSec: number): void => {
      feedActive = true
      nextChunkSec = fromSec
      postedEndSec = fromSec
      while (postNextChunk()) {
        /* burst the remainder of the whole file */
      }
    }

    const postNextChunk = (): boolean => {
      if (nextChunkSec >= FILE_SECONDS) return false
      const dur = Math.min(1, FILE_SECONDS - nextChunkSec)
      node.post({ t: 'chunk', startSec: nextChunkSec, samples: ramp(nextChunkSec, dur) })
      nextChunkSec += dur
      postedEndSec = Math.max(postedEndSec, nextChunkSec)
      return true
    }

    // initial whole-file burst
    restartFeed(0)
    node.post({ t: 'play' })

    let feedPositionSeen = false
    let silentRun = 0
    let silentRunMax = 0
    let underrunsSeen = 0
    let pausedClock = false
    let primedSeen = 0
    for (let quanta = 0; quanta < 40_000; quanta++) {
      const block = node.pump(1)
      if (consumedSec > 0.1 && consumedSec < FILE_SECONDS - 0.05) {
        if (block.every((v) => v === 0)) {
          silentRun += 1
          silentRunMax = Math.max(silentRunMax, silentRun)
        } else silentRun = 0
      }
      const underrunMsgs = countOf(node, 'underrun')
      if (underrunMsgs > underrunsSeen) {
        underrunsSeen = underrunMsgs
        pausedClock = true // clock freezes the playhead on stall
        // the stall carries its own recovery: startFeed cut +
        // re-request from the frozen time.
        restartFeed(consumedSec)
        feedPositionSeen = false
      }
      if (countOf(node, 'primed') > primedSeen) {
        primedSeen = countOf(node, 'primed')
        pausedClock = false // 'primed' resumes the mirror
      }
      const ps = positions(node)
      const last = ps[ps.length - 1] ?? 0
      if (last > 0 && !pausedClock) {
        feedPositionSeen = true
        consumedSec = last / MEDIA_RATE
      }
      // clock rules, in order ([107-ADJ 17]): the upper-edge cancel at a
      // 16 s delivered lead, then the refill gate at a 12 s lead.
      if (feedActive && postedEndSec - consumedSec >= 16) feedActive = false // cancelFeed (once per episode)
      if (!feedActive && feedPositionSeen && consumedSec < FILE_SECONDS - 0.75 && postedEndSec < FILE_SECONDS - 1 / MEDIA_RATE && postedEndSec - consumedSec < 12) {
        restartFeed(consumedSec)
      }
      if (consumedSec >= FILE_SECONDS - 0.01) break
      if (process.env.RING_DEBUG && quanta % 200 === 0) console.log('sim q=' + String(quanta) + ' consumed=' + consumedSec.toFixed(3) + ' postedEnd=' + postedEndSec.toFixed(3) + ' feedActive=' + String(feedActive) + ' primed=' + String(countOf(node, 'primed')) + ' underrun=' + String(countOf(node, 'underrun')))
    }
    if (process.env.RING_DEBUG) console.log('sim done consumed=' + consumedSec.toFixed(4) + ' postedEnd=' + postedEndSec.toFixed(4) + ' lastPositions=' + String(positions(node).slice(-4).map((f) => (f / MEDIA_RATE).toFixed(3))))
    expect(consumedSec, 'the whole synthetic file is consumed — no tail starvation').toBeGreaterThanOrEqual(FILE_SECONDS - 0.01)
    expect(silentRunMax, `longest silent run ${String(silentRunMax)} quanta — re-fetch must heal holes in <= 4 blocks`).toBeLessThanOrEqual(4)
    expect(underrunsSeen, 'the pathological whole-file burst drops its tail at the cap — the stall recovery re-fetches it exactly once ([107-ADJ 16]: the 600 s leg saw the same counted single underrun)').toBeLessThanOrEqual(1)
    if (process.env.RING_DEBUG) console.log('sim underruns=' + String(underrunsSeen))
  })
})
