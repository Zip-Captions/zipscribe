// unit-107 (FR-107.2/FR-107.4): the AudioWorklet ring processor — the
// decoded clock's output stage. Receives native-rate interleaved-f32 chunks
// on its port (wire pinned by tests/unit/audio-preview/helpers/
// fake-webaudio.ts and decoded-clock.ts), resamples by linear-interpolation
// stride at the commanded rate, and writes the output quantum. Position
// truth = anchorFrames + consumedLocal frames (sample-accurate — the
// CC-107.4 drift legs read this), reported to the main thread per block.
// Flow control stays INSIDE the pinned wire: the CLOCK paces postings by
// position-vs-posted gaps and restarts the worker feed (cancel + re-request)
// on refill, so this ring only ever holds ~2 s.
//
// 'ended' is latched by the CLOCK (duration is clock-side knowledge), so
// the processor never posts it. On exhaustion while playing it posts
// 'underrun' once and re-posts 'primed' when the next chunk refills it.

// Worklet-scope globals are absent from lib.dom (main-thread lib) — the
// module is loaded ONLY by AudioWorklet.addModule, where these exist.
declare const AudioWorkletProcessor: new () => { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void

const RING_SECONDS = 2
const POSITION_EPSILON_FRAMES = 1

class RingProcessor extends AudioWorkletProcessor {
  private readonly ring: Float32Array
  private readonly ringFrames: number
  private ringCapacityFrames: number
  private writeFrame = 0 // absolute frame index of next write
  private readFrame = 0 // absolute frame index of next read (fractional via frac)
  private readFrac = 0
  private anchorFrames: number | null = null
  private primed = false
  private playing = false
  private underrunSent = false
  private rate = 1
  private readonly channels: number
  // Ring frames live in MEDIA-rate domain; process() is pulled in RENDER-rate
  // quanta. Consumption must stride by mediaRate/renderRate or the clock's
  // consumedFrames→seconds math fast-forwards (48k render vs 16k media = 3×).
  private readonly consumeScale: number
  private readonly mediaRate: number
  // Absolute media frame just past the last sample held (ring + queue).
  // Feed placement is keyed by chunk startSec: the clock's cancel/re-post
  // refill re-sends overlapping data, which must be DEDUPED (never
  // re-appended), and out-of-order/gapped data is QUEUED (never dropped —
  // dropping over-capacity chunks deadlocks the 6 s-in-flight pacing).
  private tailContentFrames = 0
  private queue: { absStart: number; samples: Float32Array }[] = []

  constructor(options: { processorOptions?: { sampleRate?: number; channels?: number } }) {
    super()
    const channels = Math.max(1, Math.round(options.processorOptions?.channels ?? 1))
    const sampleRate = options.processorOptions?.sampleRate ?? 48000
    this.channels = channels
    this.mediaRate = sampleRate
    this.ringFrames = Math.max(1, Math.round(RING_SECONDS * sampleRate))
    const globalScope = globalThis as unknown as { sampleRate?: number }
    const renderRate = typeof globalScope.sampleRate === 'number' && globalScope.sampleRate > 0 ? globalScope.sampleRate : sampleRate
    this.consumeScale = sampleRate / renderRate
    this.ringCapacityFrames = 0
    this.ring = new Float32Array(this.ringFrames * channels)
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const msg = event.data as {
        t?: unknown
        startSec?: unknown
        samples?: unknown
        value?: unknown
      } | null
      if (msg === null || typeof msg.t !== 'string') return
      if (msg.t === 'chunk' && msg.samples instanceof Float32Array) {
        this.write(msg.startSec, msg.samples)
      } else if (msg.t === 'flush') {
        this.anchorFrames = null
        this.primed = false
        this.underrunSent = false
        this.writeFrame = 0
        this.readFrame = 0
        this.readFrac = 0
        this.ringCapacityFrames = 0
        this.tailContentFrames = 0
        this.queue = []
      } else if (msg.t === 'rate' && typeof msg.value === 'number' && msg.value > 0) {
        this.rate = msg.value
      } else if (msg.t === 'play') {
        this.playing = true
        // A late 'play' after an underrun-refill still needs the primed cue.
        if (this.primed && this.ringFramesAvailable() > 0) {
          this.underrunSent = false
          this.port.postMessage({ t: 'primed' })
        }
      } else if (msg.t === 'pause') {
        this.playing = false
      }
    }
  }

  private ringFramesAvailable(): number {
    return this.writeFrame - this.readFrame
  }

  private write(startSec: unknown, samples: Float32Array): void {
    if (this.anchorFrames === null) {
      if (typeof startSec !== 'number') return
      this.anchorFrames = Math.round(startSec * this.mediaRate)
      this.readFrame = this.anchorFrames
      this.writeFrame = this.anchorFrames
      this.tailContentFrames = this.anchorFrames
      this.readFrac = 0
    }
    const absStart = typeof startSec === 'number' ? Math.round(startSec * this.mediaRate) : this.tailContentFrames
    if (!this.place(absStart, samples)) this.enqueueBack({ absStart, samples })
    this.drainQueue()
  }

  /** Position-keyed ingest: dedupe overlap, queue gaps, append contiguous.
   *  Returns false ONLY when the ring had no room for any frame and nothing
   *  was mutated — the caller must keep the data queued (a no-progress place
   *  retried in-line was the render-thread deadlock). */
  private place(absStart: number, samples: Float32Array): boolean {
    const frames = Math.floor(samples.length / this.channels)
    if (frames === 0) return true
    if (absStart + frames <= this.tailContentFrames) return true // covered (refill overlap)
    if (absStart > this.tailContentFrames) {
      // Gap: hold until the tail catches up (never skip ahead). Back of the
      // queue — ingest order is arrival order (unshifting would invert it
      // and the first head would look like a gap → deadlock).
      this.enqueueBack({ absStart, samples })
      return true
    }
    const skip = this.tailContentFrames - absStart // overlapping head already held
    const remaining = frames - skip
    const available = this.ringFrames - (this.writeFrame - this.readFrame)
    const usable = Math.max(0, Math.min(remaining, available))
    if (usable === 0) return false // ring full: no mutation, caller re-queues
    const base = this.writeFrame % this.ringFrames
    for (let f = 0; f < usable; f++) {
      const dst = ((base + f) % this.ringFrames) * this.channels
      const src = (skip + f) * this.channels
      for (let c = 0; c < this.channels; c++) this.ring[dst + c] = samples[src + c] ?? 0
    }
    this.writeFrame += usable
    this.tailContentFrames += usable
    this.ringCapacityFrames = Math.max(this.ringCapacityFrames, this.writeFrame - this.readFrame)
    if (!this.primed && this.writeFrame - this.readFrame >= Math.round(this.ringFrames / 8)) {
      this.primed = true
      this.underrunSent = false
      this.port.postMessage({ t: 'primed' })
    }
    if (usable < remaining) {
      // Partial fill: the untouched tail stays queued at the FRONT (it is
      // the current head's continuation) — dropping it would open a gap the
      // position-keyed drain can never bridge.
      this.enqueueFront({ absStart: this.tailContentFrames, samples: samples.subarray((skip + usable) * this.channels) })
    }
    return true
  }

  private enqueueBack(entry: { absStart: number; samples: Float32Array }): void {
    this.enqueueAt(entry, false)
  }

  private enqueueFront(entry: { absStart: number; samples: Float32Array }): void {
    this.enqueueAt(entry, true)
  }

  private enqueueAt(entry: { absStart: number; samples: Float32Array }, front: boolean): void {
    const queuedFrames = this.queue.reduce((n, e) => n + Math.floor(e.samples.length / this.channels), 0)
    if (queuedFrames >= 6 * this.mediaRate) return
    if (front) this.queue.unshift(entry)
    else this.queue.push(entry)
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0]!
      const headFrames = Math.floor(head.samples.length / this.channels)
      if (head.absStart + headFrames <= this.tailContentFrames) {
        this.queue.shift()
        continue
      }
      if (head.absStart > this.tailContentFrames) break
      this.queue.shift()
      if (!this.place(head.absStart, head.samples)) {
        // Ring still full: put it back verbatim and wait for reads to free
        // space (a no-progress place must NEVER be retried in-line).
        this.queue.unshift(head)
        break
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    if (output !== undefined && this.playing && this.anchorFrames !== null) {
      const quantum = output[0]?.length ?? 128
      const stride = this.rate * this.consumeScale
      for (let i = 0; i < quantum; i++) {
        const position = this.readFrame + this.readFrac
        const i0 = Math.floor(position)
        const frac = position - i0
        const available = this.writeFrame - i0
        if (available <= 0) {
          for (let c = 0; c < output.length; c++) output[c]![i] = 0
          if (this.primed && !this.underrunSent && this.queue.length === 0) {
            // True exhaustion: nothing to read AND nothing queued. (The old
            // readFrame>=writeFrame test could never fire — reads pin at
            // writeFrame-1 — so the clock's underrun-refill was dead code.)
            this.underrunSent = true
            this.primed = false
            this.port.postMessage({ t: 'underrun' })
          }
          continue
        }
        const lastReadable = this.writeFrame - 1
        const at = (frame: number, c: number): number => this.ring[(Math.min(frame, lastReadable) % this.ringFrames) * this.channels + c] ?? 0
        for (let c = 0; c < output.length; c++) {
          const a = at(i0, c) ?? 0
          const b = at(i0 + 1, c) ?? 0
          output[c]![i] = a + (b - a) * frac
        }
        this.readFrac += stride
        const step = Math.floor(this.readFrac)
        this.readFrame += step
        this.readFrac -= step
      }
      if (this.anchorFrames !== null) {
        const consumed = this.readFrame + (this.readFrac >= POSITION_EPSILON_FRAMES ? 1 : 0)
        this.port.postMessage({ t: 'position', consumedFrames: consumed })
        if (this.queue.length > 0) this.drainQueue()
      }
    } else if (output !== undefined) {
      for (let c = 0; c < output.length; c++) output[c]?.fill(0)
    }
    return true
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('zipscribe-ring', RingProcessor)
}

export {}
