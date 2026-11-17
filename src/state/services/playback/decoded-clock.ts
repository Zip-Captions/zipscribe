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
  // [107-ADJ 14] a fresh feed's `consumedFrames` is STALE until the worklet
  // posts its first live position (a seek-to-585 before any play measured
  // the in-flight gap against 0 → bogus cancel + re-request from 0). All
  // consumed-vs-posted decisions wait for this flag.
  let feedPositionSeen = false

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
    feedActive = true
    // [107-ADJ 14] the feed is meaningless (and chunks would be DROPPED)
    // before the worklet exists — a seek-then-play sequence started the feed
    // at 585 s pre-worklet and the clock froze with no underrun (chunks
    // vanished into a null port). Await the worklet first; failure keeps
    // needsFeed true so play() retries honestly.
    try {
      await ensureWorklet()
    } catch {
      feedActive = false
      return
    }
    if (disposed || currentJobId !== jobId) return
    needsFeed = false
    feedPositionSeen = false
    postedEndFrames = Math.round(fromSec * sampleRate)
    const channel = new MessageChannel()
    feedPort = channel.port1
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { startSec?: unknown; samples?: unknown } | null
      if (data === null || typeof data.startSec !== 'number' || !(data.samples instanceof Float32Array)) return
      postToWorklet({ t: 'chunk', startSec: data.startSec, samples: data.samples })
      awaitingAnchor = false
      postedEndFrames = Math.max(postedEndFrames, Math.round(data.startSec * sampleRate) + data.samples.length / deps.channels)
      // [107-ADJ 13] 9 s in-flight / 1.5 s refill lead (was 6 s / 0.5 s): the
      // 600 s drift legs recorded one worker hiccup beyond the old buffer
      // (single-threaded ffmpeg feed + GC); 1.5 s remaining + 9 s in flight
      // tolerates ~10 s of feed stall.
      if (feedPositionSeen && postedEndFrames - consumedFrames > 9 * sampleRate) {
        // Bound memory: cut the stream; refill restarts from the consumed
        // position (cancel + re-request is inside the pinned wire).
        // [107-ADJ 13] RESTART NOW, not at the 1.5 s drain: leaving
        // feedActive false let every in-flight cut drain the ring 9 s→1.5 s
        // before the position-message gate re-requested — one worker
        // hiccup past 1.5 s per 10-min leg was the recorded underrun.
        // Immediate restart from the consumed position keeps ~9 s of slack.
        cancelFeed()
        feedActive = false
        const consumedSec = consumedFrames / sampleRate
        void startFeed(consumedSec)
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
  // truth channel is the dedicated feed port. Main-port job:error is the
  // one main-port signal that matters: it stalls the clock honestly
  // (numeric code only — SECURITY-03 never carries file-derived strings).
  deps.worker.onmessage = (event: MessageEvent<unknown>): void => {
    const msg = event.data as { t?: unknown; jobId?: unknown; error?: { code?: unknown } } | null
    if (msg !== null && msg.t === 'job:error') {
      // [107-ADJ 14] two honest exclusions: errors for SUPERSEDED jobs (the
      // pacing/seek cancel+restart churns jobIds) and CANCELLED — the
      // worker's truthful report of a cancel WE issued (flow control), not
      // a stall. Anything else on the LIVE job stalls the clock honestly
      // (numeric code only — SECURITY-03 never carries file-derived strings).
      if (msg.jobId !== currentJobId) return
      if (msg.error?.code === 'CANCELLED') return
      paused = true
      deps.onNotice?.('PLAYBACK_STALL')
    }
  }

  const ensureWorklet = async (): Promise<void> => {
    if (workletReady !== null) {
      await workletReady
      return
    }
    ctx = deps.audioContextFactory()
    workletReady = (async () => {
      try {
        await ctx?.audioWorklet.addModule(deps.workletUrl)
      } catch {
        // MIME-hostile servers (a `?url` asset served as .ts): re-source the
        // module text through a same-origin fetch + JS-typed blob URL. The
        // L3 fake resolves the direct addModule, so tests never fetch.
        if (ctx === null) return
        const source = await (await fetch(deps.workletUrl)).text()
        const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
        try {
          await ctx.audioWorklet.addModule(blobUrl)
        } finally {
          URL.revokeObjectURL(blobUrl)
        }
      }
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
      // Chromium does NOT implicitly activate an AudioWorkletNode port for
      // addEventListener — start() is required or messages never dispatch.
      node.port.start?.()
      node.port.addEventListener('message', (event: MessageEvent<unknown>) => {
        const msg = event.data as WorkletInbound | null
        if (msg === null || typeof msg.t !== 'string' || disposed) return
        // An unprimed (post-flush, pre-chunk) position is meaningless — the
        // ring has no anchor yet; accepting one would drag the playhead
        // backwards (the scripted double posts it, a real ring must not).
        if (msg.t === 'position') {
          consumedFrames = msg.consumedFrames
        }
        if (msg.t === 'position' && (!paused || stallPaused) && !awaitingAnchor) {
          // [107-ADJ 15] during a HOLE stall the playhead freezes at the
          // stall position but the refill gate must keep running — it is
          // the stall's own recovery path (startFeed from the frozen time
          // re-fetches exactly where the ring starved; 'primed' resumes).
          if (!paused) {
            time = Math.min(duration, msg.consumedFrames / sampleRate)
            if (msg.consumedFrames / sampleRate >= duration - 1e-6) {
              fireEnded()
            }
          }
          feedPositionSeen = true
          if (!feedActive && !endedLatch && time < duration - 0.75 && postedEndFrames - consumedFrames < 1.5 * sampleRate) {
            void startFeed(time)
          }
        } else if (msg.t === 'underrun') {
          if (!paused && !endedLatch) {
            paused = true
            stallPaused = true
            underruns += 1
            deps.onNotice?.('PLAYBACK_STALL')
            // [107-ADJ 15] the ring posts underrun for a HOLE too (queued
            // head not contiguous with the tail): the delivered-window
            // bookkeeping then lies — postedEnd sits far ahead while the
            // ring starves at the hole — and while an iterator window is
            // still in flight feedActive stays true, so neither the 1.5 s
            // refill gate nor the 9 s cancel gate can ever fire. The stall
            // must carry its own recovery: cut the feed (startFeed cancels
            // the job + flushes) and re-request [stalled time, +window);
            // place() heals the hole and 'primed' resumes the mirror.
            // Re-requesting at EOF is a no-op — the ended latch already fired.
            void startFeed(time)
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
      await ensureWorklet().catch(() => {
        // Setup failure (worklet/ctx): the clock is honest — paused again,
        // numeric notice code (SECURITY-03).
        paused = true
        deps.onNotice?.('PLAYBACK_STALL')
      })
      if (paused) return
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
