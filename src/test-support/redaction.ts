// Canary-transcript redaction spy (FR-1.0.12, SECURITY-03).
//
// Every suite can load a canary transcript containing CANARY_MARKER; wrapping
// console.* (and checking errors / notices / written artifacts) with this spy
// turns any leak of the marker into a failing assertion. Leak records carry a
// non-reversible hash + length only — the harness must never echo the marker
// itself into output (the very thing it is detecting).

const CHANNELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const

// A unique, meaningless marker — not user content; a stand-in whose appearance
// anywhere proves content reached an output channel.
export const CANARY_MARKER = 'zipscribe-canary-9f4c1e77-transcript-secret'

export interface LeakRecord {
  channel: string
  argumentIndex: number
  argumentType: string
  markerHash: string
  markerLength: number
}

export interface RedactionVerdict {
  leaks: LeakRecord[]
  clean: boolean
}

export interface RedactionSpy {
  settle(): RedactionVerdict
  restore(): void
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function flatten(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return String(value)
  try {
    return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item)) ?? Object.prototype.toString.call(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

export function containsCanary(value: unknown): boolean {
  return flatten(value).includes(CANARY_MARKER)
}

function leakRecord(channel: string, argumentIndex: number, argument: unknown): LeakRecord {
  return {
    channel,
    argumentIndex,
    argumentType: typeof argument,
    markerHash: fnv1a(CANARY_MARKER),
    markerLength: CANARY_MARKER.length,
  }
}

/** Errors must never carry canary content in message or EngineError-style
 *  `detail` (conventions § Repository & style — "never embed transcript/user
 *  content in message"). */
export function scanError(error: unknown): LeakRecord[] {
  const leaks: LeakRecord[] = []
  if (error instanceof Error) {
    if (containsCanary(error.message)) leaks.push(leakRecord('error.message', 0, error.message))
    const detail = (error as { detail?: unknown }).detail
    if (containsCanary(detail)) leaks.push(leakRecord('error.detail', 0, detail))
  }
  return leaks
}

type ConsoleChannel = (args: unknown[]) => void

export function createRedactionSpy(): RedactionSpy {
  const captured: { channel: string; index: number; argument: unknown }[] = []
  const originals = new Map<string, ConsoleChannel | undefined>()
  const channels = console as unknown as Record<string, ConsoleChannel | undefined>

  for (const channel of CHANNELS) {
    originals.set(channel, channels[channel])
    channels[channel] = (...args: unknown[]) => {
      args.forEach((argument, index) => captured.push({ channel, index, argument }))
      // Deliberately do not forward: forwarding would echo the leak into the
      // run output while we are still detecting it.
    }
  }

  return {
    settle(): RedactionVerdict {
      const leaks = captured.filter((entry) => containsCanary(entry.argument)).map((entry) => leakRecord(entry.channel, entry.index, entry.argument))
      return { leaks, clean: leaks.length === 0 }
    },
    restore(): void {
      for (const [channel, original] of originals) {
        channels[channel] = original
      }
    },
  }
}
