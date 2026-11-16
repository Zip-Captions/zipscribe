// unit-107 (FR-107.2, CC-107.2/CC-107.3/CC-107.4 foundation): the DECODED
// AudioContext clock for formats the element cannot play (AIFF/WMA/AMR…).
// Feed: DEDICATED media-worker instance (createWorker('media'), probe-worker
// doctrine) answering the protocol `{t:'decode-playback',jobId,file,fromSec,
// port}` request with native-rate interleaved-f32 {startSec,samples} chunks
// (decodeForPlayback, engine/audio/decode.ts) → MessagePort (NO
// SharedArrayBuffer, no COOP/COEP) → AudioWorklet ring (2 s target).
// Position truth = worklet-consumed frames / sampleRate (sample-accurate for
// the CC-107.4 drift legs); AudioContext.currentTime is pacing reference
// ONLY. Wire format pinned by tests/unit/audio-preview/helpers/
// fake-webaudio.ts header — the L3 double suite drives THIS implementation
// unchanged over doubles, e2e/audio-preview/{clocks,decoded}.spec.ts the
// real stack.
//
// Synchronicity contract (clock-contract-lib): play()/pause() flip `paused`
// SYNCHRONOUSLY; the AudioContext resume is the async part; position
// messages are ignored while paused; dispose() is idempotent and inert.
// FR-107.6: the AudioContext is created LAZILY on the first play() (autoplay
// policy) and never at construction; 'suspended'-while-playing is surfaced
// via contextState() (the composition root turns it into PLAYBACK_STALL).

import type { Seconds } from '../../../engine/model'
import type { MediaClock } from './media-clock'

export interface PlaybackChunk {
  startSec: number
  samples: Float32Array
}

export interface DecodedClockDeps {
  getBlob(): Promise<Blob>
  worker: Worker
  sampleRate: number
  channels: number
  duration: number
  audioContextFactory(): AudioContext
  workletUrl: string
  onNotice?(code: 'PLAYBACK_STALL'): void
  /** Composition handoff (graph tail): the worklet node is routed through the
   *  stage graph's gain+analyser (CC-107.3 gain authority) instead of the
   *  clock connecting it to the destination itself. */
  onWorkletNode?(node: AudioWorkletNode): void
  timers?: { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void }
}

export interface DecodedMediaClock extends MediaClock {
  readonly underrunCount: number
  contextState(): 'none' | 'suspended' | 'running' | 'closed'
}

const WORKLET_NAME = 'zipscribe-ring'

type WorkletInbound = { t: 'position'; consumedFrames: number } | { t: 'underrun' } | { t: 'primed' } | { t: 'ended' }

export function createDecodedMediaClock(deps: DecodedClockDeps): DecodedMediaClock {
  const { sampleRate, duration } = deps
  let paused = true
  let disposed = false
  let time = 0
  let underruns = 0
  let endedLatch = false
  let stallPaused = false
  let needsFeed = true
  let feedSeq = 0
  let cachedBlob: Promise<Blob> | null = null
  const blobPromise = (): Promise<Blob> => {
    cachedBlob ??= deps.getBlob()
    return cachedBlob
  }
  let awaitingAnchor = true
  let currentJobId: string | null = null
  let feedPort: MessagePort | null = null
  let workletPort: MessagePort | null = null
  let workletNode: AudioWorkletNode | null = null
  let ctx: AudioContext | null = null
  let workletReady: Promise<void> | null = null
  const endedCallbacks = new Set<() => void>()

  const fireEnded = (): void => {
    if (endedLatch) return
    endedLatch = true
    paused = true
    time = Math.min(time, duration)
    for (const cb of [...endedCallbacks]) cb()
  }

  const postToWorklet = (msg: unknown): void => {
    workletPort?.postMessage(msg)
  }
  // Feed pacing (pinned-wire flow control): the clock tracks the
  // posted-vs-consumed gap; a runaway decode stream is bounded by
  // cancel+close (chunk side) and restarted from the consumed position once
  // the worklet runs low (position side). ~2 s ring, ~6 s in flight max.
  let consumedFrames = 0
  let postedEndFrames = 0
  let feedActive = false

  const cancelFeed = (): void => {
    if (currentJobId !== null) deps.worker.postMessage({ t: 'cancel', jobId: currentJobId })
    currentJobId = null
    feedPort?.close()
    feedPort = null
    needsFeed = true
  }

  const startFeed = async (fromSec: number): Promise<void> => {
    const jobId = `pb_${String(++feedSeq)}`
    currentJobId = jobId
    needsFeed = false
    feedActive = true
    postedEndFrames = Math.round(fromSec * sampleRate)
    const channel = new MessageChannel()
    feedPort = channel.port1
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { startSec?: unknown; samples?: unknown } | null
      if (data === null || typeof data.startSec !== 'number' || !(data.samples instanceof Float32Array)) return
      postToWorklet({ t: 'chunk', startSec: data.startSec, samples: data.samples })
      awaitingAnchor = false
      postedEndFrames = Math.max(postedEndFrames, Math.round(data.startSec * sampleRate) + data.samples.length / deps.channels)
      if (postedEndFrames - consumedFrames > 6 * sampleRate) {
        // Bound memory: cut the stream; refill restarts from the consumed
        // position (cancel + re-request is inside the pinned wire).
        cancelFeed()
        feedActive = false
      }
    }
    const blob = await blobPromise()
    if (disposed || currentJobId !== jobId) {
      channel.port1.close()
      return
    }
    deps.worker.postMessage({ t: 'decode-playback', jobId, file: blob as unknown as File, fromSec, port: channel.port2 }, [channel.port2])
  }

  // decode:support (MediaEvent) is observed and tolerated; the clock's
  // correctness never depends on the codec path (honesty: it only gates
  // telemetry the UI does not consume yet).
  deps.worker.onmessage = (): void => undefined

  const ensureWorklet = async (): Promise<void> => {
    if (workletReady !== null) {
      await workletReady
      return
    }
    ctx = deps.audioContextFactory()
    workletReady = (async () => {
      await ctx?.audioWorklet.addModule(deps.workletUrl)
      if (disposed || ctx === null) return
      const options: AudioWorkletNodeOptions = {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [deps.channels],
        processorOptions: { sampleRate, channels: deps.channels },
      }
      // Test doubles expose a scripted `createWorkletNode` on the context
      // (fake-webaudio wire pin); real browsers construct AudioWorkletNode.
      const seam = ctx as AudioContext & { createWorkletNode?(name: string, options: AudioWorkletNodeOptions): AudioWorkletNode }
      const node = typeof seam.createWorkletNode === 'function' ? seam.createWorkletNode(WORKLET_NAME, options) : new AudioWorkletNode(ctx, WORKLET_NAME, options)
      workletNode = node
      workletPort = node.port
      // addEventListener, NOT onmessage: the L3 double (fake-webaudio
      // attachFakeWorklet) owns the port's onmessage slot for the scripted
      // inbound direction — stacked listeners are the pinned wire.
      node.port.addEventListener('message', (event: MessageEvent<unknown>) => {
        const msg = event.data as WorkletInbound | null
        if (msg === null || typeof msg.t !== 'string' || disposed) return
        // An unprimed (post-flush, pre-chunk) position is meaningless — the
        // ring has no anchor yet; accepting one would drag the playhead
        // backwards (the scripted double posts it, a real ring must not).
        if (msg.t === 'position') {
          consumedFrames = msg.consumedFrames
        }
        if (msg.t === 'position' && !paused && !awaitingAnchor) {
          time = Math.min(duration, msg.consumedFrames / sampleRate)
          if (msg.consumedFrames / sampleRate >= duration - 1e-6) {
            fireEnded()
          }
          if (!feedActive && !endedLatch && time < duration - 0.75 && postedEndFrames - consumedFrames < 0.5 * sampleRate) {
            void startFeed(time)
          }
        } else if (msg.t === 'underrun') {
          if (!paused && !endedLatch) {
            paused = true
            stallPaused = true
            underruns += 1
            deps.onNotice?.('PLAYBACK_STALL')
          }
        } else if (msg.t === 'primed') {
          if (stallPaused && !disposed && !endedLatch) {
            stallPaused = false
            paused = false
            postToWorklet({ t: 'play' })
            void ctx?.resume().catch(() => undefined)
          }
        } else if (msg.t === 'ended') {
          fireEnded()
        }
      })
      deps.onWorkletNode?.(node)
    })()
    await workletReady
  }

  const clock = {
    get duration(): Seconds {
      return duration
    },
    currentTime: (): Seconds => time,
    get paused(): boolean {
      return paused || disposed
    },
    get underrunCount(): number {
      return underruns
    },
    contextState(): 'none' | 'suspended' | 'running' | 'closed' {
      if (ctx === null) return 'none'
      if (disposed) return 'closed'
      // Safari's 'interrupted' behaves as suspended (audio pauses, recoverable).
      return ctx.state === 'interrupted' ? 'suspended' : ctx.state
    },
    play: async (): Promise<void> => {
      if (disposed) return
      // Synchronous paused flip (contract); the resume/worklet setup is the
      // async part (FR-107.6 autoplay gesture).
      paused = false
      stallPaused = false
      if (endedLatch) {
        // Ended → restart from 0 (element parity): flush + re-feed at 0.
        endedLatch = false
        time = 0
        cancelFeed()
        postToWorklet({ t: 'flush' })
        awaitingAnchor = true
      }
      await ensureWorklet()
      postToWorklet({ t: 'play' })
      void ctx?.resume().catch(() => undefined)
      if (needsFeed) void startFeed(time)
    },
    pause: (): void => {
      paused = true
      stallPaused = false
      postToWorklet({ t: 'pause' })
    },
    seek: (t: Seconds): void => {
      // Seek never resumes playback; the anchored time is immediate
      // (seek-to-audible ≤ 250 ms is measured from the following play).
      time = Math.max(0, Math.min(t, duration))
      endedLatch = false
      stallPaused = false
      postToWorklet({ t: 'flush' })
      awaitingAnchor = true
      cancelFeed()
      void startFeed(t)
    },
    setRate: (r: number): void => {
      postToWorklet({ t: 'rate', value: r })
    },
    onEnded: (cb: () => void): (() => void) => {
      endedCallbacks.add(cb)
      return () => {
        endedCallbacks.delete(cb)
      }
    },
    dispose: (): void => {
      if (disposed) return
      disposed = true
      paused = true
      cancelFeed()
      deps.worker.terminate()
      workletPort?.close()
      workletPort = null
      workletNode?.disconnect()
      workletNode = null
      void ctx?.close().catch(() => undefined)
    },
  }
  return clock
}
