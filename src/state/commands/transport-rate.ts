// `transport-rate` (FR-102.5 rate menu): playback rate must be a finite
// positive number (RATE_INVALID otherwise). UI-only (FR-102.2); slice B's
// arbitrator proxies `clock.setRate` and samples the rate-scaled clock.

import type { CommandReject, EditorCommand, TransportRatePayload } from './types'
import { isFiniteNumber, reject } from './validators'
import { transportEditor } from './transport-shared'

export function createTransportRateCommand(): EditorCommand<'transport-rate'> {
  return {
    id: 'transport-rate',
    reduce(state, payload: TransportRatePayload): CommandReject | null {
      if (!isFiniteNumber(payload.rate) || payload.rate <= 0) return reject('RATE_INVALID', String(payload.rate))
      transportEditor(state).rate = payload.rate
      return null
    },
  }
}
