// Unit-104 slice B — the speaker popover (US-2.1.7, CC-104.5). Opened by the
// row chip button; every mutation dispatches EXCLUSIVELY through
// `app.dispatch` (the frozen command layer — speaker-rename / -recolor /
// -merge / -split / -assign, one command = one undo step). Rename defaults to
// the merged "Apply to all N blocks" primary; the "this block only" secondary
// is block-level `speaker-assign` (frozen contract: block-level reassignment
// rides the assign command). The filter row hides the speaker VIEW-ONLY
// (rows absent, project bytes NEVER change — the parent drives the hidden
// set). SECURITY-03: the draft label is user content — rendered on screen
// only, never logged.

import { useState } from 'react'
import type { ReactElement } from 'react'
import type { CaptionBlock, Seconds, Speaker } from '../../engine/model'
import type { EditorApp } from '../../state/history'

export interface SpeakerPopoverProps {
  app: EditorApp
  block: CaptionBlock
  speakers: readonly Speaker[]
  palette: readonly string[]
  /** Blocks currently attributed to this speaker (the "Apply to all N blocks" count). */
  blockCount: number
  /** Split point default (the playhead at open). */
  atTime: Seconds
  onClose: () => void
  /** View-only filter: hide this speaker's rows (no command, no project touch). */
  onHideSpeaker: (speakerId: string) => void
}

function clamp(value: Seconds, min: Seconds, max: Seconds): Seconds {
  return Math.min(Math.max(value, min), max)
}

export function SpeakerPopover(props: SpeakerPopoverProps): ReactElement {
  const { app, block, speakers, palette, blockCount, atTime, onClose, onHideSpeaker } = props
  const speaker = speakers.find((candidate) => candidate.id === block.speakerId)
  const others = speakers.filter((candidate) => candidate.id !== block.speakerId)
  const [draftLabel, setDraftLabel] = useState<string>(speaker?.label ?? '')
  const [mergeTarget, setMergeTarget] = useState<string>(others[0]?.id ?? block.speakerId)
  const [assignTarget, setAssignTarget] = useState<string>(block.speakerId)

  return (
    <div data-testid="transcript-speaker-popover" className="ts-popover" role="group" aria-label={`Speaker options for ${speaker?.label ?? block.speakerId}`}>
      <div className="ts-popover-row">
        <input
          data-testid="transcript-speaker-rename-input"
          className="ts-rename-input"
          aria-label="New speaker name"
          value={draftLabel}
          onChange={(event) => {
            setDraftLabel(event.target.value)
          }}
        />
        <button
          type="button"
          data-testid="transcript-speaker-rename-apply"
          className="ts-popover-action"
          onClick={() => {
            const label = draftLabel.trim()
            if (label.length > 0) app.dispatch('speaker-rename', { speakerId: block.speakerId, label })
            onClose()
          }}
        >
          {`Apply to all ${blockCount} block${blockCount === 1 ? '' : 's'}`}
        </button>
        <button
          type="button"
          data-testid="transcript-speaker-rename-block-only"
          className="ts-popover-action ts-popover-action-secondary"
          onClick={() => {
            // Block-level attribution: `speaker-assign` on this block only
            // (the frozen block-level path; rename semantics ride the target).
            app.dispatch('speaker-assign', { blockIds: [block.id], speakerId: assignTarget })
            onClose()
          }}
        >
          This block only
        </button>
        <label className="ts-popover-label">
          Block speaker
          <select data-testid="transcript-speaker-assign" value={assignTarget} onChange={(event) => setAssignTarget(event.target.value)}>
            {speakers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div data-testid="transcript-speaker-recolor" className="ts-popover-row" role="group" aria-label="Recolor speaker">
        {palette.map((color) => (
          <button
            key={color}
            type="button"
            className="ts-swatch"
            style={{ backgroundColor: color }}
            aria-label={`Set speaker color ${color}`}
            onClick={() => {
              app.dispatch('speaker-recolor', { speakerId: block.speakerId, color })
            }}
          />
        ))}
      </div>
      <div data-testid="transcript-speaker-merge" className="ts-popover-row">
        <label className="ts-popover-label">
          Merge with
          <select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
            {others.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ts-popover-action"
          disabled={others.length === 0}
          onClick={() => {
            app.dispatch('speaker-merge', { from: block.speakerId, into: mergeTarget })
            onClose()
          }}
        >
          Merge
        </button>
      </div>
      <div className="ts-popover-row">
        <button
          type="button"
          data-testid="transcript-speaker-split"
          className="ts-popover-action"
          onClick={() => {
            app.dispatch('speaker-split', { speakerId: block.speakerId, at: clamp(atTime, block.start, block.end) })
            onClose()
          }}
        >
          Split at playhead
        </button>
        <button
          type="button"
          data-testid="transcript-speaker-filter"
          className="ts-popover-action"
          onClick={() => {
            onHideSpeaker(block.speakerId)
          }}
        >
          Hide speaker
        </button>
      </div>
    </div>
  )
}
