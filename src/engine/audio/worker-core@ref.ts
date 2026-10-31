// Reference MessagePort pair for the Node suites (`@engine/audio/worker-core@ref`,
// frozen contract `tests/unit/media/unit04-api-contract.d.ts`): a connected
// port pair plus a recorder, so the L1 suites exercise the real
// postMessage/transfer/backpressure contract without a browser.
//
// Semantics this reference must reproduce (probed against Node's
// `worker_threads.MessagePort` and Chromium's `MessagePort`):
//  - messages queue while the receiving port has no handler and are delivered
//    (in order) once one is installed — the stalled-consumer test;
//  - delivery is asynchronous (task-like), not synchronous inside post;
//  - a transferred `Float32Array` arrives as a real `Float32Array`;
//  - when a consumer port CONSUMES a posted message, the poster receives a
//    `{__zReceipt}` marker on its own port — the delivery signal real
//    `MessagePort` does not expose to the poster (probed: Chromium applies no
//    cap and no close event, so the engine's flow control needs this).
// `transfer` is accepted but does not detach (the frozen suite compares the
// sender's arrays after posting).

export interface RefMessage {
  t: 'chunk' | 'done' | 'error' | 'cancelled'
  jobId: string
}

export interface CreateMessageChannel {
  port1: MessagePort
  port2: MessagePort
  /** Messages received on `port1` (transferred arrays arrive as real `Float32Array`). */
  received: RefMessage[]
  /** Backpressure probe: messages still buffered on `port`. */
  buffered(port: MessagePort): number
  close(): void
}

class RefPort {
  onmessage: ((event: { data: unknown }) => void) | null = null
  private readonly queue: { data: unknown }[] = []
  private draining = false
  private closed = false
  peer: RefPort | null = null
  recorder: ((message: unknown) => void) | null = null

  postMessage(message: unknown, _transfer?: readonly Transferable[]): void {
    if (this.closed) return
    this.peer?.enqueue(structuredClone(message))
  }

  start(): void {
    this.scheduleDrain()
  }

  close(): void {
    this.closed = true
    this.queue.length = 0
    this.onmessage = null
    this.recorder = null
  }

  buffered(): number {
    return this.queue.length
  }

  private enqueue(message: unknown): void {
    if (this.closed) return
    // "Received on port1" counts arrival, not handler dispatch — the teePcm
    // contract asserts bytes land in `received` with no handler installed.
    this.recorder?.(message)
    this.queue.push({ data: message })
    this.scheduleDrain()
  }

  private scheduleDrain(): void {
    queueMicrotask(() => this.drain())
  }

  private drain(): void {
    if (this.draining || this.closed) return
    this.draining = true
    try {
      while (this.queue.length > 0 && this.onmessage !== null) {
        const message = this.queue.shift()!.data
        this.recorder?.(message)
        this.onmessage({ data: message })
        // Delivery receipt to the poster (skip receipts themselves — they
        // would ping-pong forever).
        if (!isReceipt(message)) this.peer?.enqueue({ __zReceipt: 1 })
      }
    } finally {
      this.draining = false
    }
  }
}

function isReceipt(message: unknown): boolean {
  return typeof message === 'object' && message !== null && '__zReceipt' in message
}

export function createMessageChannel(): CreateMessageChannel {
  const port1 = new RefPort()
  const port2 = new RefPort()
  port1.peer = port2
  port2.peer = port1
  const received: RefMessage[] = []
  port1.recorder = (message) => {
    const kind = classify(message)
    if (kind !== null) received.push({ t: kind, jobId: jobIdOf(message) })
  }
  return {
    port1: port1 as unknown as MessagePort,
    port2: port2 as unknown as MessagePort,
    received,
    buffered(port: MessagePort): number {
      const ref = (port as unknown) === (port1 as unknown) ? port1 : (port as unknown) === (port2 as unknown) ? port2 : null
      return ref?.buffered() ?? 0
    },
    close(): void {
      port1.close()
      port2.close()
    },
  }
}

function classify(message: unknown): RefMessage['t'] | null {
  if (typeof message !== 'object' || message === null) return null
  const data = message as { t?: unknown; startSec?: unknown; samples?: unknown }
  if (data.t === undefined && typeof data.startSec === 'number' && data.samples instanceof Float32Array) return 'chunk'
  if (data.t === 'job:done') return 'done'
  if (data.t === 'job:error') return 'error'
  if (data.t === 'cancelled') return 'cancelled'
  return null
}

function jobIdOf(message: unknown): string {
  const jobId = (message as { jobId?: unknown }).jobId
  return typeof jobId === 'string' ? jobId : ''
}
