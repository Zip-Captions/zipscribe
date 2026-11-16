// Web Audio + decode-playback doubles for the unit-107 L2 suites (node,
// no browser). These doubles pin the WIRE FORMAT of the decoded clock:
//
//   clock → worker:  { t:'decode-playback', jobId, file, fromSec, port } (MediaRequest,
//                    architecture.md — orchestrator PREP) carried via postMessage with the
//                    port in the transfer list; cancel reuses { t:'cancel', jobId }.
//   worker → clock:  { t:'decode:support', jobId, path } (existing MediaEvent).
//   clock → worklet (node.port.postMessage):  { t:'chunk', startSec, samples: Float32Array },
//                    { t:'flush' }, { t:'rate', value }, { t:'play' }, { t:'pause' }.
//   worklet → clock (node.port.onmessage):    { t:'position', consumedFrames },
//                    { t:'underrun' }, { t:'primed' }, { t:'ended' }.
//
// MessagePort pairs are REAL node MessageChannels (async delivery — drain
// with `flushPorts()`), so the production clock can (and must) use
// `new MessageChannel()` unchanged in L2 and L4.

export interface FakeConnection {
  from: string
  to: string
}

export interface FakeAudioNode {
  kind: string
  connections: FakeConnection[]
  connect(target: unknown): void
  disconnect(): void
}

export interface FakeGain extends FakeAudioNode {
  kind: 'gain'
  gain: { value: number }
}

export interface FakeAnalyser extends FakeAudioNode {
  kind: 'analyser'
  fftSize: number
  smoothingTimeConstant: number
}

export interface FakeSourceNode extends FakeAudioNode {
  kind: 'media-element-source'
  element: HTMLMediaElement
}

export interface FakeWorkletNodeHandle {
  node: FakeAudioNode & { kind: 'worklet'; name: string; options: unknown; port: MessagePort }
  /** The worklet-side port the test drives (post {t:'position'|...} here). */
  peer: MessagePort
}

export interface FakeAudioContextState {
  state: 'suspended' | 'running' | 'closed'
}

export interface FakeCtx extends FakeAudioContextState {
  currentTime: number
  destination: FakeAudioNode
  connections: FakeConnection[]
  resumeCalls: number
  suspendCalls: number
  closeCalls: number
  loadedWorkletUrls: string[]
  nodes: FakeAudioNode[]
  /** Test-side tick of the audio-thread clock. */
  tick(ms: number): void
}

export function createFakeAudioContextHarness(): {
  factory: () => AudioContext
  contexts: FakeCtx[]
  worklets: FakeWorkletNodeHandle[]
  connections: FakeConnection[]
} {
  const contexts: FakeCtx[] = []
  const worklets: FakeWorkletNodeHandle[] = []
  const connections: FakeConnection[] = []
  const factory = (): AudioContext => {
    const ctx: FakeCtx = {
      state: 'suspended',
      currentTime: 0,
      destination: { kind: 'destination', connections: [], connect: () => undefined, disconnect: () => undefined },
      connections,
      resumeCalls: 0,
      suspendCalls: 0,
      closeCalls: 0,
      loadedWorkletUrls: [],
      nodes: [],
      tick: (ms) => {
        if (ctx.state === 'running') ctx.currentTime += ms / 1000
      },
    }
    const makeNode = <K extends string>(kind: K): FakeAudioNode & { kind: K } => {
      const node: FakeAudioNode = {
        kind,
        connections: [],
        connect: (target: unknown) => {
          const to = (target as { kind?: string })?.kind ?? 'external'
          node.connections.push({ from: kind, to })
          connections.push({ from: kind, to })
        },
        disconnect: () => undefined,
      }
      ctx.nodes.push(node)
      return node as FakeAudioNode & { kind: K }
    }
    const ctxAny = ctx as unknown as Record<string, unknown> & FakeCtx
    ctxAny.resume = async () => {
      ctx.resumeCalls += 1
      if (ctx.state !== 'closed') ctx.state = 'running'
    }
    ctxAny.suspend = async () => {
      ctx.suspendCalls += 1
      if (ctx.state === 'running') ctx.state = 'suspended'
    }
    ctxAny.close = async () => {
      ctx.closeCalls += 1
      ctx.state = 'closed'
    }
    ctxAny.audioWorklet = {
      addModule: async (url: string) => {
        ctx.loadedWorkletUrls.push(url)
      },
    }
    ctxAny.createAnalyser = () => {
      const node = makeNode('analyser') as FakeAnalyser
      node.fftSize = 1024
      node.smoothingTimeConstant = 0
      return node
    }
    ctxAny.createGain = () => {
      const node = makeNode('gain') as FakeGain
      node.gain = { value: 1 }
      return node
    }
    ctxAny.createMediaElementSource = (element: HTMLMediaElement) => {
      const node = makeNode('media-element-source') as FakeSourceNode
      node.element = element
      return node
    }
    ctxAny.createWorkletNode = (name: string, options: unknown) => {
      const node = makeNode('worklet') as FakeAudioNode & { kind: 'worklet'; name: string; options: unknown; port: MessagePort }
      const channel = new MessageChannel()
      node.name = name
      node.options = options
      node.port = channel.port1
      const handle: FakeWorkletNodeHandle = { node, peer: channel.port2 }
      worklets.push(handle)
      return node
    }
    contexts.push(ctx)
    return ctx as unknown as AudioContext
  }
  return { factory, contexts, worklets, connections }
}

/** Drain pending MessagePort deliveries (real node channels are async). */
export async function flushPorts(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

export interface DecodePlaybackRequest {
  t: 'decode-playback'
  jobId: string
  file: File | Blob
  fromSec: number
  port: MessagePort
}

export interface CancelRequest {
  t: 'cancel'
  jobId: string
}

/** Double of the dedicated media worker speaking the decode-playback feed. */
export function createFakeDecodeWorker(): {
  worker: Worker
  requests: (DecodePlaybackRequest | CancelRequest)[]
  readonly terminated: boolean
  /** Deliver the (last) request's reply events on the worker channel. */
  emitEvent(event: unknown): void
  /** Stream a chunk on the (last) request's port (transfer-free: same-thread
   *  node MessageChannel — the receiver gets a structured clone). */
  pushChunk(chunk: { startSec: number; samples: Float32Array }): void
} {
  const requests: (DecodePlaybackRequest | CancelRequest)[] = []
  let messageHandler: ((event: { data: unknown }) => void) | null = null
  let terminated = false
  const worker = {
    postMessage: (data: unknown) => {
      const d = data as DecodePlaybackRequest | CancelRequest
      if (d.t === 'decode-playback') requests.push(d)
      else if (d.t === 'cancel') requests.push(d)
    },
    set onmessage(h: ((event: { data: unknown }) => void) | null) {
      messageHandler = h
    },
    get onmessage() {
      return messageHandler
    },
    addEventListener: (type: string, h: (event: { data: unknown }) => void) => {
      if (type === 'message') messageHandler = h
    },
    removeEventListener: () => undefined,
    terminate: () => {
      terminated = true
    },
  }
  return {
    worker: worker as unknown as Worker,
    requests,
    get terminated(): boolean {
      return terminated
    },
    emitEvent: (event) => {
      queueMicrotask(() => messageHandler?.({ data: event }))
    },
    pushChunk: (chunk) => {
      const last = [...requests].reverse().find((r) => r.t === 'decode-playback') as DecodePlaybackRequest | undefined
      if (last === undefined) throw new Error('no decode-playback request yet')
      queueMicrotask(() => {
        last.port.postMessage(chunk)
      })
    },
  }
}

/** Scripted worklet: consumes chunks at a commanded pace and reports
 *  ABSOLUTE positions (chunk-anchor + local consumption) — the deterministic
 *  stand-in for the AudioWorkletProcessor. `flush` resets the anchor like
 *  the real ring does on seek; consumption reaching `durationSec` posts
 *  `ended` once. */
export function attachFakeWorklet(handle: FakeWorkletNodeHandle, opts: { sampleRate: number; channels: number; durationSec: number }): {
  bufferedFrames(): number
  consumedFrames(): number
  lastRate(): number
  messagesFromClock: unknown[]
  /** Consume `frames` local frames and post the absolute position update. */
  consume(frames: number): void
  /** Consume `ms` of wall time at the current rate. */
  consumeMs(ms: number): void
  underrun(): void
  primed(): void
  ended(): void
} {
  let anchorFrames = 0
  let buffered = 0
  let consumed = 0
  let rate = 1
  let endedSent = false
  const totalFrames = Math.round(opts.durationSec * opts.sampleRate)
  const messagesFromClock: unknown[] = []
  // Physical MessagePort semantics: clock posts on node.port (port1) → the
  // scripted worklet receives on PEER (port2); the worklet posts on peer →
  // the clock receives on node.port. The scripted handler therefore sits on
  // BOTH ends of the channel — port1 keeps the pinned `node.port.onmessage`
  // slot (the clock must listen via addEventListener, stacked), and port2
  // makes clock→worklet messages observable in messagesFromClock.
  const scriptedWorklet = (event: { data: unknown }): void => {
    const msg = event.data as { t: string; startSec?: number; samples?: Float32Array; value?: number }
    messagesFromClock.push(event.data)
    if (msg.t === 'chunk' && msg.samples !== undefined) {
      if (buffered === 0 && consumed === 0 && msg.startSec !== undefined) anchorFrames = Math.round(msg.startSec * opts.sampleRate)
      buffered += msg.samples.length / opts.channels
    }
    if (msg.t === 'flush') {
      anchorFrames = 0
      buffered = 0
      consumed = 0
      endedSent = false
    }
    if (msg.t === 'rate' && typeof msg.value === 'number') rate = msg.value
  }
  handle.node.port.onmessage = scriptedWorklet
  handle.peer.onmessage = scriptedWorklet
  const post = (data: unknown): void => {
    handle.peer.postMessage(data)
  }
  const consumeFrames = (frames: number): void => {
    const n = Math.min(frames, buffered - consumed)
    consumed += Math.max(0, n)
    post({ t: 'position', consumedFrames: anchorFrames + consumed })
    if (!endedSent && anchorFrames + consumed >= totalFrames) {
      endedSent = true
      post({ t: 'ended' })
    }
  }
  return {
    bufferedFrames: () => buffered - consumed,
    consumedFrames: () => anchorFrames + consumed,
    lastRate: () => rate,
    messagesFromClock,
    consume: (frames) => {
      consumeFrames(frames)
    },
    consumeMs: (ms) => {
      consumeFrames(Math.round((ms / 1000) * opts.sampleRate * rate))
    },
    underrun: () => {
      post({ t: 'underrun' })
    },
    primed: () => {
      post({ t: 'primed' })
    },
    ended: () => {
      post({ t: 'ended' })
    },
  }
}
