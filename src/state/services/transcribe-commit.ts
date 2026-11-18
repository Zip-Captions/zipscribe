// FR-108.1 (unit-108): the stream-commit service — the state-layer bridge
// that turns a running transcribe job's streamed `job:segments` into
// committed project blocks under a PROGRESS FRONTIER rule:
//
//   • a segment commits once `job:progress.processedSec` has reached its end
//     (no progress ⇒ no commits — the frozen FR-104.6 streaming contract:
//     ahead-of-frontier rows stay skeleton-only in the Transcript);
//   • `job:done` flushes every remaining received segment;
//   • `job:error` and cancel NEVER flush — committed blocks hold (US-108.2),
//     late events of a dead job commit nothing;
//   • kind-'align' jobs never commit here (the frozen panel
//     `captions-align-apply` path owns them).
//
// It lives in the state layer, NOT in `Transcript` (frozen unit-104: the
// component never commits) and is wired once by the composition root. Each
// commit batch is ONE `captions-import` dispatch (one undo step per batch);
// a validator rejection stops that batch — codes only, nothing logged
// (SECURITY-03: this module never reads or derives from segment text).
//
// Correlation: the service taps RAW engine events through the jobs store's
// `onEngineEvent` (fired BEFORE the store folds them), so the live-job check
// (`running.jobId === event.jobId`) reads the same pre-event state the store
// itself filters on — a cancelled/displaced job's late events are ignored
// exactly like the store ignores them, and a `job:done` still sees its own
// running entry when the flush decision is made. Cancel (a bare
// `running → null` with no terminal event) is caught by the store
// subscription, which drops the active job without flushing.

import { newUuid } from '../ids'
import type { JobsStore } from '../jobs'
import type { EditorApp } from '../history'
import type { RawSegment } from '../../engine/protocol'
import type { CaptionBlock, Speaker } from '../../engine/model'

export interface TranscribeCommitService {
  dispose(): void
}

/** The single speaker ASR-committed blocks get until diarize frames land (unit-108 Boundaries). */
const ASR_SPEAKER: Speaker = { id: 'SPK_1', label: 'Speaker 1', color: '#4c8dff' }

function segmentKey(segment: RawSegment): string {
  return `${segment.start}|${segment.end}|${segment.text}`
}

function toBlock(segment: RawSegment): CaptionBlock {
  return {
    id: newUuid('blk'),
    start: segment.start,
    end: segment.end,
    text: segment.text,
    words: segment.words.map((word) => ({ ...word, timing: 'asr' as const })),
    speakerId: ASR_SPEAKER.id,
  }
}

interface ActiveCommit {
  jobId: string
  kind: 'transcribe' | 'align'
  /** Highest `job:progress.processedSec` seen; segments commit at end <= frontier. */
  frontier: number
  /** Every segment received for THIS job (taps), sorted by start. */
  received: RawSegment[]
  /** Segment keys already committed (dedupe across batches/flush). */
  committed: Set<string>
  /** The replace-mode track replacement happened (later batches append). */
  replaced: boolean
}

export function createTranscribeCommitService(deps: { jobs: JobsStore; editorApp: EditorApp }): TranscribeCommitService {
  const { jobs, editorApp } = deps
  let active: ActiveCommit | null = null

  /** The frozen store correlation rule re-applied at tap time. */
  const isLive = (jobId: string): boolean => jobs.getState().running?.jobId === jobId

  function commitSegments(segments: readonly RawSegment[]): void {
    if (active === null) return
    const dispatchBatch = (batch: readonly RawSegment[]): boolean => {
      if (active === null) return false
      const blocks = batch.map(toBlock)
      const reject = editorApp.dispatch('captions-import', active.replaced ? { blocks, replace: false } : { blocks, replace: true, speakers: [ASR_SPEAKER] })
      if (reject === null) active.replaced = true
      return reject === null
    }
    if (dispatchBatch(segments)) {
      for (const segment of segments) active.committed.add(segmentKey(segment))
      return
    }
    // A poisoned batch (e.g. one malformed segment): commit one by one,
    // skipping rejects — a single bad row never blocks the stream.
    for (const segment of segments) {
      if (dispatchBatch([segment])) active.committed.add(segmentKey(segment))
    }
  }

  function commitEligible(flush: boolean): void {
    if (active === null) return
    const frontier = flush ? Number.POSITIVE_INFINITY : active.frontier
    const committed = active.committed
    const fresh = active.received.filter((segment) => segment.end <= frontier && !committed.has(segmentKey(segment)))
    commitSegments(fresh)
  }

  const unsubscribeTap = jobs.onEngineEvent((event) => {
    switch (event.t) {
      case 'job:progress': {
        if (active === null || event.jobId !== active.jobId || active.kind !== 'transcribe' || !isLive(event.jobId)) return
        active.frontier = Math.max(active.frontier, event.processedSec)
        commitEligible(false)
        return
      }
      case 'job:segments': {
        if (active === null || event.jobId !== active.jobId || active.kind !== 'transcribe' || !isLive(event.jobId)) return
        active.received = [...active.received, ...event.segments].sort((a, b) => a.start - b.start)
        commitEligible(false)
        return
      }
      case 'job:done': {
        if (active === null || event.jobId !== active.jobId) return
        if (active.kind === 'transcribe' && isLive(event.jobId)) commitEligible(true)
        active = null
        return
      }
      case 'job:error': {
        // US-108.2: hold what committed, never flush, drop the job.
        if (active !== null && event.jobId === active.jobId) active = null
        return
      }
      default:
        return
    }
  })

  const unsubscribeStore = jobs.subscribe(() => {
    const running = jobs.getState().running
    if (running === null) {
      // Cancel (or displacement away): no terminal tap consumed `active` —
      // the job dies here, WITHOUT a flush. A done/error tap already cleared
      // it synchronously before this fires, making this a no-op.
      active = null
      return
    }
    if (active !== null && active.jobId === running.jobId) return
    // Start (or displacement onto a fresh job): the ONLY place a new active
    // opens — never after a terminal, since done/error clear before a start
    // could observe their nulls (the start itself flips running non-null).
    active = { jobId: running.jobId, kind: running.kind, frontier: 0, received: [], committed: new Set<string>(), replaced: false }
  })

  return {
    dispose(): void {
      unsubscribeTap()
      unsubscribeStore()
      active = null
    },
  }
}
