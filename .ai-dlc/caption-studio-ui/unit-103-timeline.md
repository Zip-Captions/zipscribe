---
status: pending
discipline: frontend
depends_on: [unit-102-editor-core-playback, local-transcribe-engine/unit-04-media-ingest]
workflow: tdd
mode: AHOTL
---

# Unit 103: Timeline (canvas)

## Description

Canvas timeline: ruler with zoom/scroll, waveform from `PeaksData`, caption-block track with drag-trim handles, snapping, marquee/selection, and block commands wired to the registry. Custom canvas renderer (data-model hit-testing) per `knowledge/architecture.md` — DOM blocks would thrash at scale. Satisfies orig. FR-2.2.1/2.2.2 (+ our gap-filler numeric timing inputs).

## User Stories

**US-2.2.1** (orig. FR-2.2.1) As a video editor, I drag block edge handles to retime with snapping.
- *Given* a selected block, *when* I drag its left/right handle (8 px zones), *then* `block-retime` dispatches on release (live ghost during drag), constrained: never past adjacent block start/end − 0.05 s, never word-splitting without "detach words" modifier (`Alt` allows free time, words re-derive proportionally).
- *Given* snap on, *when* drag within 8 px of adjacent block edge or playhead, *then* snap indicator line renders and value snaps.

**US-2.2.2** (orig. FR-2.2.2) As a keyboard user, `S` splits the block under the playhead.
- *Given* selection containing playhead time, *when* `S`, *then* two blocks with contiguous times; word goes to block whose midpoint is nearer its own midpoint; split is one undo step.

**US-2.2.3** (orig. FR-2.2.3, redesigned) As an editor, merge is `Ctrl/Cmd+Shift+M`.
- *Given* ≥ 2 adjacent selected blocks, *when* merge, *then* one block, words concatenated, text joined with single space (CapCut-style), single undo step.

**US-2.2.5** As an editor, I type exact times.
- *Given* selected block, *when* time inputs (inspector strip under timeline) edited to `00:12.350`, *then* `block-retime` with typed values; invalid input shows error state and never mutates (recovery UX).

**US-2.2.6** As a user, the timeline keeps up.
- *Given* 10 000 blocks, *when* zoom `⌘=`/`⌘-`/`⌘0`, wheel-pan, drag, *then* input latency p95 < 16 ms (chromium trace); zoom keeps time-under-cursor fixed (anchor math test).

## Functional Requirements

- **FR-103.1** Canvas renderer with dpr scaling + resize observer; layers: ruler, waveform (peaks), blocks, handles, playhead, snap indicators; re-render only on dirty regions (dirty-flag; rAF coalesced).
- **FR-103.2** Viewport model `{ t0, pxPerSec }`; hit-test via spatial index (interval tree over visible window; O(log n + k)).
- **FR-103.3** Interactions: click/shift-click/marquee select; drag block body (moves that block only, with its words; clamped between neighbours — never pushes them); handle-trim; keyboard: `Z/C+←→` trim start/end to playhead (Clipchamp-verified), arrow-nudge moves selection focus.
- **FR-103.4** Waveform: `PeaksData` → bucket draw with `--waveform` tokens; zoom-aware re-bucketing; silence markers.
- **FR-103.5** Block visuals: time-width mapping, text preview (fit, ellipsize), speaker color left border, low-confidence `--warning` dot, selected/ghost/snap states per design tokens.
- **FR-103.6** Playhead drag (scrub) through arbitrator; ruler click seeks; loop region shade + handles.
- **FR-103.7** Accessibility: `tabindex` on timeline with `role="slider"`-style keyboard model (arrows move block focus, `Enter` select, `S`/`⌘⇧M` work from timeline focus); screen-reader announcement of focused block summary (live region).

## Completion Criteria

- [ ] **CC-103.1** Golden: viewport→pixel mapping tests (anchor zoom math, hit-test parity vs data model at 3 zoom levels)
- [ ] **CC-103.2** Drag/trim/split/merge dispatch correct commands (store assertions, one-undo-step each)
- [ ] **CC-103.3** Snap + constraint tests (adjacency clamp, no word-split without Alt)
- [ ] **CC-103.4** 10k-block perf: input latency p95 < 16 ms; dirty-region redraw (no full-canvas repaint per frame)
- [ ] **CC-103.5** Keyboard walkthrough spec passes (no mouse) on focused timeline
- [ ] **CC-103.6** All gates green

## Risks

- Canvas text measurement cost per frame → measure cache per (text, font, width) with LRU; perf test guards.

## Docs to consult

- docs-mcp `playwright` (trace/latency); knowledge/design.md interaction specs; Clipchamp Z/C trim + zoom keys: official shortcuts doc
