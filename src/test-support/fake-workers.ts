// Shared fakes (conventions § Mocks and fakes). unit-01 provides the skeleton
// the L3 contract suites of later units will exercise; each fake is scripted
// over the protocol.ts unions and touches no browser or network APIs.

import type { JobEvent } from '../engine/protocol'

export interface FakeWorkerScript {
  /** Events answered for a message whose `t` matches the key. */
  byRequest: Partial<Record<string, JobEvent[]>>
}

export interface SentMessage {
  data: { t: string; jobId?: string }
}

/** In-memory worker double: records requests, replays scripted events. */
export class FakeWorkerSession {
  readonly sent: SentMessage[] = []
  private readonly listeners: ((message: SentMessage) => void)[] = []
  private readonly script: FakeWorkerScript

  constructor(script: FakeWorkerScript) {
    this.script = script
  }

  postMessage(data: { t: string; jobId?: string }): void {
    this.sent.push({ data })
    const replies = this.script.byRequest[data.t] ?? []
    for (const reply of replies) this.emit({ data: reply })
  }

  onMessage(listener: (message: SentMessage) => void): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(message: SentMessage): void {
    for (const listener of this.listeners) listener(message)
  }
}
