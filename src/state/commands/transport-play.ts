// `transport-play` (US-2.2.4, Space): play/pause truth on the UI-only editor
// slice — no history step (FR-102.2). Slice B proxies `clock.play` through
// the SyncArbitrator (single-seek/single-play rule asserted on the fake
// clock's call counts).

import type { CommandReject, EditorCommand } from './types'
import { transportEditor } from './transport-shared'

export function createTransportPlayCommand(): EditorCommand<'transport-play'> {
  return {
    id: 'transport-play',
    reduce(state, _payload: undefined): CommandReject | null {
      transportEditor(state).playing = true
      return null
    },
  }
}
