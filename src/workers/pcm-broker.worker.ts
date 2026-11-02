// Off-main-thread PCM broker (CC-05.3) — holds the decoded ArrayBuffer so the
// main thread never serializes bulk PCM inside a postMessage task.
//
// Why: the host must post the protocol `transcribe` request (with a
// `{kind:'transfer', buffer}` PcmSource) to EVERY worker epoch (initial +
// recycle). Without a broker it deep-clones the whole buffer on the main
// thread per post (~120-250 ms for 460 MB — a long task that contaminates
// the CC-05.3 observation window, CC-05.3's own doctrine). The broker owns
// the buffer once (transfer in, O(1) ownership move) and slices a fresh
// clone per request ON THIS THREAD, transferring it back (also O(1) both
// ways). Per epoch the main thread performs three tiny posts and one tiny
// message receive — no task ever approaches the 50 ms budget.
//
// SECURITY-03: bytes only, never logged; no transcript-derived data exists here.

interface BrokerRequest {
  t: 'ready' | 'own' | 'clone'
  buffer?: ArrayBuffer
  requestId?: number
}

interface BrokerReply {
  t: 'ready' | 'clone'
  buffer?: ArrayBuffer
  requestId?: number
}

interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<BrokerRequest>) => void) | null
  postMessage(message: BrokerReply, transfer?: Transferable[]): void
}

const scope = globalThis as unknown as DedicatedWorkerScope

let held: ArrayBuffer | null = null

scope.onmessage = (event: MessageEvent<BrokerRequest>) => {
  const msg = event.data
  switch (msg.t) {
    case 'ready': {
      scope.postMessage({ t: 'ready' })
      return
    }
    case 'own': {
      // The host transferred the original in via the transfer list; this
      // thread is now the sole owner (the page-side buffer is detached).
      // Requests are FIFO-ordered, so a `clone` queued after `own` sees the
      // new buffer; replacing `held` releases the previous run's buffer to
      // this thread's GC.
      if (msg.buffer instanceof ArrayBuffer) held = msg.buffer
      return
    }
    case 'clone': {
      if (typeof msg.requestId !== 'number') return
      if (held === null) {
        scope.postMessage({ t: 'clone', requestId: msg.requestId, buffer: new ArrayBuffer(0) })
        return
      }
      const copy = held.slice(0)
      scope.postMessage({ t: 'clone', requestId: msg.requestId, buffer: copy }, [copy])
      return
    }
  }
}
