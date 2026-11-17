// CC-107.2 (L3-on-doubles, decoded leg) + FR-107.2/FR-107.6 (decoded clock
// mechanics, L2): lazily-created AudioContext on the first play gesture
// (autoplay policy — never at construction), the dedicated-worker
// decode-playback feed with MessagePort chunk transfers, worklet-reported
// ABSOLUTE position = clock time, seek = flush + re-decode(fromSec),
// underrun → pause + PLAYBACK_STALL + auto-resume on refill, rate messages,
// ended latch, idempotent dispose — and the FULL runClockContract over the
// doubles (element/decoded REAL clocks pass the same function in
// e2e/audio-preview/clocks.spec.ts).
//
// Wire format pinned by helpers/fake-webaudio.ts header (builder contract).
// RED: dynamic import of the unbuilt `@state/services/playback/decoded-clock`.
import { describe, expect, test } from 'vitest'
import { createSyncArbitrator } from '@state/services/playback/arbitrator'
import { createFakeRafs } from '../editor/helpers/fake-rafs'
import { attachFakeWorklet, createFakeAudioContextHarness, createFakeDecodeWorker, flushPorts } from './helpers/fake-webaudio'
import { runClockContract } from './clock-contract-lib'
import type { ArbitratorContractHandle, ClockContractHandle } from './clock-contract-lib'
import type { DecodedMediaClock } from '@state/services/playback/decoded-clock'

const DECODED_CLOCK_MODULE = '@state/services/playback/decoded-clock'
type DecodedClockModule = typeof import('@state/services/playback/decoded-clock')

const SAMPLE_RATE = 44_100
const CHANNELS = 1
const DURATION = 10
const FRAME_MS = 16

async function makeRig(): Promise<{
  clock: DecodedMediaClock
  harness: ReturnType<typeof createFakeAudioContextHarness>
  worker: ReturnType<typeof createFakeDecodeWorker>
  notices: string[]
  endedFires: { n: number }
  /** Attach the scripted worklet after the first play created it (idempotent). */
  ensureWorklet(): ReturnType<typeof attachFakeWorklet>
}> {
  const mod = (await import(/* @vite-ignore */ DECODED_CLOCK_MODULE)) as unknown as DecodedClockModule
  const harness = createFakeAudioContextHarness()
  const worker = createFakeDecodeWorker()
  const notices: string[] = []
  const endedFires = { n: 0 }
  let worklet: ReturnType<typeof attachFakeWorklet> | null = null
  const clock = mod.createDecodedMediaClock({
    getBlob: async () => new Blob([new Uint8Array(16)], { type: 'audio/aiff' }),
    worker: worker.worker,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    duration: DURATION,
    audioContextFactory: harness.factory,
    workletUrl: '/assets/ring-processor.js',
    onNotice: (code) => {
      notices.push(code)
    },
  })
  clock.onEnded?.(() => {
    endedFires.n += 1
  })
  worker.emitEvent({ t: 'decode:support', jobId: 'any', path: 'ffmpeg' })
  await flushPorts()
  return {
    clock,
    harness,
    worker,
    notices,
    endedFires,
    ensureWorklet: () => {
      if (worklet === null) {
        if (harness.worklets.length === 0) throw new Error('worklet node not created yet — play first')
        worklet = attachFakeWorklet(harness.worklets[0]!, { sampleRate: SAMPLE_RATE, channels: CHANNELS, durationSec: DURATION })
      }
      return worklet
    },
  }
}

type Rig = Awaited<ReturnType<typeof makeRig>>

async function playAndAttach(rig: Rig): Promise<ReturnType<typeof attachFakeWorklet>> {
  await rig.clock.play()
  await flushPorts()
  const worklet = rig.ensureWorklet()
  return worklet
}

/** Drain chunk deliveries, pump the scripted worklet, drain positions. */
async function advance(rig: Rig, worklet: ReturnType<typeof attachFakeWorklet>, ms: number): Promise<void> {
  await flushPorts()
  if (!rig.clock.paused) worklet.consumeMs(ms)
  await flushPorts()
}

describe('CC-107.2: decoded clock — FR-107.2/FR-107.6 mechanics (doubles)', () => {
  test('CC-107.2: the AudioContext is created lazily on the first play (FR-107.6) and the gesture resumes it', async () => {
    const rig = await makeRig()
    expect(rig.harness.contexts.length, 'no context at construction').toBe(0)
    expect(rig.clock.contextState()).toBe('none')
    await rig.clock.play()
    await flushPorts()
    expect(rig.harness.contexts.length).toBe(1)
    expect(rig.harness.contexts[0]!.resumeCalls, 'resume called on the gesture play').toBeGreaterThanOrEqual(1)
    expect(rig.clock.contextState()).toBe('running')
    expect(rig.harness.contexts[0]!.loadedWorkletUrls).toContain('/assets/ring-processor.js')
    rig.clock.dispose()
  })

  test('CC-107.2: play issues the dedicated-worker decode-playback feed at fromSec 0', async () => {
    const rig = await makeRig()
    await playAndAttach(rig)
    const feed = rig.worker.requests.filter((r) => r.t === 'decode-playback')
    expect(feed.length, 'one decode-playback request').toBe(1)
    expect(feed[0]!.fromSec).toBe(0)
    expect(typeof feed[0]!.jobId).toBe('string')
    rig.clock.dispose()
  })

  test('CC-107.2: worklet-consumed frames are the clock time (sample-accurate position)', async () => {
    const rig = await makeRig()
    const worklet = await playAndAttach(rig)
    rig.worker.pushChunk({ startSec: 0, samples: new Float32Array(SAMPLE_RATE * CHANNELS) })
    await advance(rig, worklet, 1000)
    expect(Math.abs(rig.clock.currentTime() - 1)).toBeLessThan(0.05)
    rig.clock.dispose()
  })

  test('CC-107.2: pause freezes the position (stray positions ignored)', async () => {
    const rig = await makeRig()
    const worklet = await playAndAttach(rig)
    rig.worker.pushChunk({ startSec: 0, samples: new Float32Array(SAMPLE_RATE * CHANNELS) })
    await advance(rig, worklet, 500)
    rig.clock.pause()
    await flushPorts()
    const t0 = rig.clock.currentTime()
    worklet.consume(22_050) // a stray position while paused
    await flushPorts()
    expect(Math.abs(rig.clock.currentTime() - t0), 'no motion while paused').toBeLessThanOrEqual(0.001)
    rig.clock.dispose()
  })

  test('CC-107.2: seek flushes the ring and re-decodes at fromSec (immediate anchored time)', async () => {
    const rig = await makeRig()
    const worklet = await playAndAttach(rig)
    rig.worker.pushChunk({ startSec: 0, samples: new Float32Array(SAMPLE_RATE * CHANNELS) })
    await advance(rig, worklet, 1000)
    rig.clock.seek(5)
    await flushPorts()
    const feeds = rig.worker.requests.filter((r) => r.t === 'decode-playback')
    expect(feeds.length, 're-decode issued').toBe(2)
    expect(feeds[1]!.fromSec).toBeCloseTo(5, 6)
    expect(
      worklet.messagesFromClock.some((m) => (m as { t: string }).t === 'flush'),
      'ring flushed',
    ).toBe(true)
    expect(Math.abs(rig.clock.currentTime() - 5)).toBeLessThanOrEqual(0.25)
    rig.clock.dispose()
  })

  test('CC-107.2: underrun → pause + PLAYBACK_STALL + auto-resume on refill (FR-107.2)', async () => {
    const rig = await makeRig()
    const worklet = await playAndAttach(rig)
    worklet.underrun()
    await flushPorts()
    expect(rig.clock.paused, 'paused on underrun').toBe(true)
    expect(rig.notices).toEqual(['PLAYBACK_STALL'])
    expect(rig.clock.underrunCount).toBe(1)
    // Refill → auto-resume.
    rig.worker.pushChunk({ startSec: 5, samples: new Float32Array(2 * SAMPLE_RATE * CHANNELS) })
    await flushPorts()
    worklet.primed()
    await flushPorts()
    expect(rig.clock.paused, 'auto-resumed on refill').toBe(false)
    rig.clock.dispose()
  })

  test('CC-107.2: setRate proxies the rate to the worklet', async () => {
    const rig = await makeRig()
    const worklet = await playAndAttach(rig)
    rig.clock.setRate(1.5)
    await flushPorts()
    expect(
      worklet.messagesFromClock.some((m) => JSON.stringify(m) === '{"t":"rate","value":1.5}'),
      'rate message posted',
    ).toBe(true)
    expect(worklet.lastRate()).toBe(1.5)
    rig.clock.dispose()
  })

  test('CC-107.4: an underrun at the delivered tail with feed complete is END, not a stall', async () => {
    // [107-ADJ 16] the 600 s leg died here: the final 114-frame rest chunk
    // left the ring drained below the 0.25 s re-prime threshold, 'primed'
    // never re-fired, and the clock sat stall-paused at 599.997 s.
    const rig = await makeRig()
    rig.clock.play()
    await flushPorts()
    const worklet = rig.ensureWorklet()
    const short = SAMPLE_RATE * CHANNELS * DURATION - 114 // decoded tail short of header duration
    rig.worker.pushChunk({ startSec: 0, samples: new Float32Array(short) })
    await flushPorts()
    const reqs = rig.worker.requests.filter((r) => r.t === 'decode-playback')
    reqs[reqs.length - 1]!.port.postMessage({ t: 'end' })
    await flushPorts()
    worklet.consume(short) // drain the ring exactly to the delivered tail
    await flushPorts()
    expect(rig.endedFires.n, 'position alone does not end below duration-1 ms').toBe(0)
    worklet.underrun()
    await flushPorts()
    expect(rig.endedFires.n, 'EOF underrun latches ended').toBe(1)
    expect(rig.clock.paused, 'ended is paused').toBe(true)
    expect(rig.clock.currentTime(), 'clamped at or below duration').toBeLessThanOrEqual(DURATION)
    expect(rig.notices, 'no stall notice for an EOF drain').not.toContain('PLAYBACK_STALL')
  })

  test('CC-107.4: a delivered window covering EOF does not re-request (feed-complete)', async () => {
    // [107-ADJ 15] EOF ping-pong: the 12 s refill lead keeps the gate open
    // for the whole final second; without the feed-complete latch the
    // clock re-issued decode-playback every ~40 ms at 599.2 s and each
    // re-anchored startFeed reset the worklet read head, stranding the
    // tail in a stall.
    const rig = await makeRig()
    rig.clock.play()
    await flushPorts()
    const worklet = rig.ensureWorklet()
    // One window delivering the whole file (minus two frames — rounding,
    // the realistic case the old postedEnd EOF guard let through).
    rig.worker.pushChunk({ startSec: 0, samples: new Float32Array(SAMPLE_RATE * CHANNELS * DURATION - 2) })
    await flushPorts()
    const reqs = rig.worker.requests.filter((r) => r.t === 'decode-playback')
    reqs[reqs.length - 1]!.port.postMessage({ t: 'end' })
    await flushPorts()
    worklet.consume(SAMPLE_RATE * 2) // deep inside the lead window
    await flushPorts()
    worklet.consume(SAMPLE_RATE * 8)
    await flushPorts()
    expect(rig.endedFires.n, 'ended latches within 1 ms of EOF').toBe(1)
    expect(rig.worker.requests.filter((r) => r.t === 'decode-playback').length, 'no EOF re-request storm').toBe(1)
  })

  test('CC-107.2: ended → paused, clamped, onEnded fires once', async () => {
    const rig = await makeRig()
    let fired = 0
    rig.clock.onEnded?.(() => {
      fired += 1
    })
    const worklet = await playAndAttach(rig)
    worklet.ended()
    await flushPorts()
    expect(rig.clock.paused).toBe(true)
    expect(rig.clock.currentTime()).toBeLessThanOrEqual(DURATION)
    expect(fired, 'onEnded fired once').toBe(1)
    worklet.ended()
    await flushPorts()
    expect(fired, 'repeat ended does not re-fire').toBe(1)
    rig.clock.dispose()
  })

  test('CC-107.2: dispose is idempotent — worker terminated, context closed', async () => {
    const rig = await makeRig()
    await playAndAttach(rig)
    rig.clock.dispose()
    expect(rig.worker.terminated, 'dedicated worker terminated').toBe(true)
    expect(rig.harness.contexts[0]!.state).toBe('closed')
    expect(() => {
      rig.clock.dispose()
    }).not.toThrow()
    expect(rig.clock.paused).toBe(true)
  })
})

describe('CC-107.2: clock contract — decoded clock on doubles (L3)', () => {
  test('CC-107.2: the decoded clock passes the full MediaClock contract (play/pause/seek/loop/rate/ended)', async () => {
    const rig = await makeRig()
    const rafs = createFakeRafs()
    const view = {
      get duration(): number {
        return DURATION
      },
      currentTime: () => rig.clock.currentTime(),
      get paused(): boolean {
        return rig.clock.paused
      },
      play: () => {
        void rig.clock.play()
      },
      pause: () => {
        rig.clock.pause()
      },
      seek: (t: number) => {
        rig.clock.seek(t)
      },
      setRate: (r: number) => {
        rig.clock.setRate(r)
      },
      dispose: () => undefined,
    }
    const arbitrator = createSyncArbitrator({ clock: view, rafs })
    const pump = async (ms: number): Promise<void> => {
      // Wall-time yield: keepFed is a REAL 1 ms interval and MessagePort
      // delivery is macrotask-scheduled — a pure setImmediate drain never
      // lets the feed catch up (wait(ms) models real elapsed time).
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 2)
      })
      const frames = Math.max(1, Math.round(ms / FRAME_MS))
      for (let i = 0; i < frames; i++) rafs.frame(FRAME_MS)
      await flushPorts()
      if (process.env.DC_DEBUG) console.log('pump', ms, 'paused', rig.clock.paused, 'worklets', rig.harness.worklets.length)
      if (!rig.clock.paused && rig.harness.worklets.length > 0) {
        rig.ensureWorklet().consumeMs(ms)
      }
      await flushPorts()
    }
    const clockHandle: ClockContractHandle = {
      kind: 'decoded',
      play: async () => {
        await rig.clock.play()
        await flushPorts()
        if (rig.harness.worklets.length > 0) rig.ensureWorklet()
      },
      pause: async () => {
        rig.clock.pause()
      },
      seek: async (t) => {
        rig.clock.seek(t)
        await flushPorts()
      },
      setRate: async (r) => {
        rig.clock.setRate(r)
        await flushPorts()
      },
      time: async () => rig.clock.currentTime(),
      duration: async () => rig.clock.duration,
      paused: async () => rig.clock.paused,
      endedCount: async () => (rig.endedFires.n > 0 ? 1 : 0),
      wait: (ms) => pump(ms),
      dispose: async () => {
        rig.clock.dispose()
      },
    }
    const arbHandle: ArbitratorContractHandle = {
      command: async (id, payload) => {
        const p = payload as { start?: number; end?: number; time?: number } | undefined
        if (id === 'transport-loop-set') arbitrator.setLoop([p?.start ?? 0, p?.end ?? 0])
        else if (id === 'transport-loop-clear') arbitrator.setLoop(null)
        else if (id === 'transport-seek') arbitrator.seek(p?.time ?? 0)
        else if (id === 'transport-play') arbitrator.play()
        else if (id === 'transport-pause') arbitrator.pause()
        else throw new Error(`unexpected contract command ${id}`)
        return null
      },
      playhead: async () => arbitrator.playhead,
      playing: async () => arbitrator.playing,
      wait: (ms) => pump(ms),
    }
    // Keep the ring non-empty across the whole contract run (1 s chunks).
    const keepFed = setInterval(() => {
      try {
        rig.worker.pushChunk({ startSec: rig.clock.currentTime(), samples: new Float32Array(SAMPLE_RATE * CHANNELS) })
      } catch {
        /* no decode-playback request yet */
      }
    }, 1)
    const violations = await runClockContract(clockHandle, arbHandle)
    clearInterval(keepFed)
    expect(violations, `contract violations:\n${violations.join('\n')}`).toEqual([])
  })
})
