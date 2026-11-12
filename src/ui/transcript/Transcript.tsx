// Unit-104 slices B+C — the Subtitles-tab transcript panel (FR-104.1/2/3/4/5/6,
// US-2.1.1/2.1.2/2.1.3/2.1.6/2.1.7). Shape frozen by tests/unit/transcript/
// unit104-api-contract.d.ts § '@ui/transcript/Transcript'. Thin render layer
// (conventions § UI conventions): every mutation goes through `app.dispatch`
// (the frozen command system) — the component binds NO keys (the in-place
// editor is the frozen editable-allowlist exception under
// src/ui/transcript/editable/; keyboard handling lives in the command
// registry, whose transcript bindings this panel owns via
// registerCommandHandler while mounted), reads stores through selector
// subscriptions (zero store-wide re-renders), and keeps all content
// on-screen only (SECURITY-03: nothing content-bearing is ever logged).
//
// Virtualization (FR-104.2): @tanstack/react-virtual v3 DYNAMIC-size mode —
// the `measureElement` callback ref on every `data-index` row with an
// `estimateSize` fallback, `overscan: 6` (pinned; library default 5).
// https://tanstack.com/virtual/latest/docs/api/virtualizer#measureelement
// Follow-scroll = `scrollToIndex(index, { align: 'auto' })` — the pinned
// virtual-core 3.19.11 (via react-virtual ^3.14.26) renamed the frozen
// contract's 'nearest' alignment to 'auto': it already moves the MINIMUM and
// leaves a fully visible item untouched
// (https://tanstack.com/virtual/latest/docs/framework/marko/marko-virtual
// tag reference, scrollToIndex row). Re-measure on `document.fonts.ready` and
// a theme/style attribute bus (unit-104 § Risks: late webfont load).
//
// jsdom (L2) has no layout engine: the stock `observeElementRect` reads
// clientWidth/clientHeight (always 0×0), which blanks the window entirely —
// under the frozen dom-stubs (which DO install a no-op ResizeObserver, so the
// Workbench TranscriptPane LAYOUTLESS check does not apply here) the rect is
// reported from getBoundingClientRect (stubs: a fixed row-height box; real
// browsers: the true client box) plus the injected `heightPx` viewport. Real
// browsers keep TRUE virtualization — the e2e renderedRows bound (slice D)
// depends on it.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReactVirtualizerOptions } from '@tanstack/react-virtual'
import type { CaptionBlock, Seconds, Speaker } from '../../engine/model'
import type { EditorApp } from '../../state/history'
import type { JobsStore, JobsState } from '../../state/jobs'
import type { RafDriver } from '../../state/services/playback/arbitrator'
import { formatTimecode } from '../format'
import { TimecodeInput } from '../editable/TimecodeInput'
import { registerCommandHandler, registerSearchOpenReader } from '../commands/registry'
import { registerTranscriptPanel } from './bridge-seam'
import { BlockEditor } from './editable/BlockEditor'
import { findMatches, groupMatches } from './match-index'
import { getQcIssueCursor } from './qc-cursor-seam'
import { SpeakerPopover } from './SpeakerPopover'
import { speakerPalette } from './palette'
import './transcript.css'

export interface TranscriptProps {
  app: EditorApp
  rafs: RafDriver
  /** Streaming source (FR-104.6): skeleton rows beyond the committed frontier read `jobs.getState().segments/running`. */
  jobs?: JobsStore
  /** Viewport height for the virtualizer (jsdom has no layout; default 480). */
  heightPx?: number
  /** View-only speaker filter (CC-104.5): blocks whose `speakerId` is listed are absent from the rendered rows. NEVER mutates the project, never creates a history step. */
  hiddenSpeakerIds?: readonly string[]
}

const ROW_ESTIMATE_PX = 40
const OVERSCAN = 6
const DEFAULT_VIEWPORT_PX = 480
/** FR-104.3: follow-scroll stays paused this long after a user scroll intent. */
const IDLE_RESUME_MS = 30_000
/** Scroll events this close after a programmatic write are the browser's echo of our own move — never user intent. */
const PROGRAMMATIC_IGNORE_MS = 150
/** US-2.1.6: the query is committed 120 ms after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 120

const NO_BLOCKS: readonly CaptionBlock[] = Object.freeze([])
const NO_SPEAKERS: readonly Speaker[] = Object.freeze([])
const EMPTY_SEGMENTS: JobsState['segments'] = []
const IDLE_JOBS_STATE: JobsState = {
  capability: null,
  tierNotice: null,
  modelOptions: [],
  running: null,
  progress: null,
  segments: EMPTY_SEGMENTS,
  error: null,
  notices: [],
  pendingConfirmDownload: null,
}
const IDLE_JOBS: Readable<JobsState> = { getState: () => IDLE_JOBS_STATE, subscribe: () => () => undefined }

interface Readable<T> {
  getState(): T
  subscribe(listener: () => void): () => void
}

/**
 * Selector-bound store read (Workbench `useSnapshot` doctrine): the frozen L2
 * suites assert the DOM synchronously after store commits, so notifications
 * flush the render before returning. Only the SELECTED value participates in
 * the equality check — playhead ticks never re-render the rows (zero
 * store-wide subscriptions, conventions § State & commands).
 */
function useStoreValue<S, V>(store: Readable<S>, select: (state: S) => V): V {
  const [value, setValue] = useState<V>(() => select(store.getState()))
  useEffect(() => {
    const sync = (): void => {
      const next = select(store.getState())
      setValue((current) => (Object.is(current, next) ? current : next))
    }
    sync()
    return store.subscribe(() => {
      flushSync(sync)
    })
  }, [store])
  return value
}

function speakerLabel(speakers: readonly Speaker[], speakerId: string): string {
  return speakers.find((speaker) => speaker.id === speakerId)?.label ?? 'Unknown speaker'
}

/**
 * FR-104.5 highlight rendering: per-occurrence TEXT-RANGE spans around plain
 * text slices — never innerHTML, never markup inside a match span (frozen
 * assertion: no b/i/span[style] descendants).
 */
function highlightWordParts(text: string, occurrences: readonly { start: number; end: number; index: number }[] | undefined, active: number): ReactNode[] {
  if (occurrences === undefined || occurrences.length === 0) return [text]
  const parts: ReactNode[] = []
  let cursor = 0
  for (const occurrence of occurrences) {
    if (occurrence.start > cursor) parts.push(text.slice(cursor, occurrence.start))
    parts.push(
      <span
        key={occurrence.index}
        data-testid="transcript-search-match"
        data-match-index={occurrence.index}
        data-current-match={occurrence.index === active ? 'true' : undefined}
        className={occurrence.index === active ? 'ts-match ts-match-current' : 'ts-match'}
      >
        {text.slice(occurrence.start, occurrence.end)}
      </span>,
    )
    cursor = occurrence.end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

/** Last block whose start is at or before the playhead (the follow/active target). */
function activeIndexAt(blocks: readonly CaptionBlock[], playhead: Seconds): number {
  let index = -1
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block !== undefined && block.start <= playhead) index = i
    else break
  }
  return index
}

export function Transcript(props: TranscriptProps): ReactElement {
  const { app, rafs, jobs, heightPx = DEFAULT_VIEWPORT_PX, hiddenSpeakerIds } = props
  const jobsStore = jobs ?? IDLE_JOBS

  const project = useStoreValue(app.project, (state) => state.project)
  const selection = useStoreValue(app.editor, (state) => state.selection)
  const running = useStoreValue(jobsStore, (state) => state.running)
  const segments = useStoreValue(jobsStore, (state) => state.segments)

  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [popoverBlockId, setPopoverBlockId] = useState<string | null>(null)
  const [hiddenLocal, setHiddenLocal] = useState<readonly string[]>([])

  // ── Search + replace (US-2.1.6 / FR-104.5) ────────────────────────────────
  // The panel renders while `editor.searchOpen` (the frozen editor-slice
  // field, driven ONLY by the `transcript.search-open` registry command —
  // components bind no keys). `queryDraft` follows the input; `query` is the
  // DEBOUNCED (120 ms) committed value the index is built over. The index
  // memo keys on the blocks REFERENCE + committed query + options: never
  // rebuilt on unrelated store updates, never per keystroke.
  const searchOpen = useStoreValue(app.editor, (state) => state.searchOpen)
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [currentMatch, setCurrentMatch] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const heightRef = useRef(heightPx)
  heightRef.current = heightPx
  const editingRef = useRef<string | null>(editingBlockId)
  editingRef.current = editingBlockId
  const focusedRef = useRef<string | null>(null)
  const pausedUntilRef = useRef(0)
  const lastProgrammaticAtRef = useRef(0)
  const programmaticDepthRef = useRef(0)
  const followScheduledRef = useRef(false)
  const followFrameRef = useRef<number | null>(null)
  // Slice-C search-state accessors (frozen bridge fields): wired now, filled
  // by slice C — never reshaped.
  const matchCountRef = useRef(0)
  const currentMatchRef = useRef(-1)

  const blocks = project?.blocks ?? NO_BLOCKS
  const speakers = project?.speakers ?? NO_SPEAKERS
  const fps = project?.asset.fps

  const hidden = useMemo(() => new Set<string>([...(hiddenSpeakerIds ?? []), ...hiddenLocal]), [hiddenSpeakerIds, hiddenLocal])
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const visible = useMemo(() => (hidden.size === 0 ? blocks : blocks.filter((block) => !hidden.has(block.speakerId))), [blocks, hidden])
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // Matches span ALL blocks (US-2.1.6); the committed-query + blocks-reference
  // keyed memo IS the "rebuild lazily on block-version bump" (FR-104.5) —
  // playhead ticks, selection and speaker filtering never re-index. Closed
  // search ⇒ empty index at zero cost.
  const matches = useMemo(() => (searchOpen ? findMatches(blocks, query, { caseSensitive, wholeWord }) : []), [searchOpen, blocks, query, caseSensitive, wholeWord])
  const matchesByBlock = useMemo(() => groupMatches(matches), [matches])
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  // Current match is clamped against the live index (a replace/undo shrink
  // can invalidate the stored position; -1 = none).
  const activeMatch = matches.length === 0 ? -1 : Math.min(Math.max(currentMatch, 0), matches.length - 1)
  // Frozen bridge fields (slice-C values; the seam's read() reports REAL
  // search state — never the slice-B placeholders).
  matchCountRef.current = matches.length
  currentMatchRef.current = activeMatch

  /** F3/Shift+F3 cycle with wrap + viewport jump (scrollToIndex, never .focus()). */
  function stepMatch(delta: number): void {
    const list = matchesRef.current
    if (list.length === 0) return
    const from = currentMatchRef.current
    const next = from < 0 ? (delta > 0 ? 0 : list.length - 1) : (from + delta + list.length) % list.length
    setCurrentMatch(next)
    const match = list[next]
    if (match !== undefined) {
      const rowIndex = visibleRef.current.findIndex((candidate) => candidate.id === match.blockId)
      if (rowIndex >= 0) virtualizerRef.current.scrollToIndex(rowIndex, { align: 'auto' })
    }
  }

  function onQueryChange(value: string): void {
    setQueryDraft(value)
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      setQuery(value)
      setCurrentMatch(0)
    }, SEARCH_DEBOUNCE_MS)
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    }
  }, [])

  // ⌘F focuses the query field (design.md § Layout — search bar in the
  // sidebar); opening never .focus()es anything else (conventions § Focus).
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  /** Replace-all = EXACTLY ONE `replace-text` dispatch = one undo step (US-2.1.6). */
  function onReplaceAll(): void {
    if (query.length === 0) return
    app.dispatch('replace-text', { query, replacement, caseSensitive, wholeWord })
  }

  // Registry handlers, owned by the mounted panel (unit-103 Timeline /
  // useTransportCommands precedent): registered on mount, unregistered on
  // unmount. `search-open` gate reads the editor store through the registry
  // seam. The qc.* handlers drive the slice-D issue cursor through its seam —
  // safe no-ops while no cursor is mounted.
  useEffect(() => {
    const unsubscribes = [
      registerSearchOpenReader(() => app.editor.getState().searchOpen),
      registerCommandHandler('transcript.search-open', () => {
        app.editor.setSearchOpen(!app.editor.getState().searchOpen)
      }),
      registerCommandHandler('search.next', () => {
        stepMatch(1)
      }),
      registerCommandHandler('search.previous', () => {
        stepMatch(-1)
      }),
      registerCommandHandler('qc.next-issue', () => {
        getQcIssueCursor()?.nextIssue()
      }),
      registerCommandHandler('qc.previous-issue', () => {
        getQcIssueCursor()?.previousIssue()
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    }
    // stepMatch reads only refs + stable setters — stable by contract.
  }, [app])

  // FR-104.6 streaming frontier: accumulated `job:segments` beyond the last
  // committed block render as aria-hidden, textless skeleton rows.
  const lastCommittedEnd = blocks.length > 0 ? (blocks[blocks.length - 1]?.end ?? 0) : 0
  const skeletonCount = running === null ? 0 : segments.reduce((count, segment) => (segment.start >= lastCommittedEnd ? count + 1 : count), 0)
  const rowCount = visible.length + skeletonCount

  // LAYOUTLESS (FR-104.2 sanctioned escape hatch, Workbench TranscriptPane
  // precedent): with NO ResizeObserver in the realm (jsdom/SSR) nothing can
  // ever measure, so report an everything-visible rect and mount the full
  // list. Strictly guarded on observer absence — browser runs (and the
  // dom-stubs suites, which DO install a no-op ResizeObserver before this
  // module evaluates) keep the stock windowed path with overscan 6.
  const observeTranscriptRect: NonNullable<ReactVirtualizerOptions<HTMLDivElement, HTMLDivElement>['observeElementRect']> = (instance, reportRect) => {
    if (typeof ResizeObserver === 'undefined') {
      reportRect({ width: 1, height: 1_000_000 })
      return () => undefined
    }
    const element = instance.scrollElement
    if (element === null) return () => undefined
    const report = (): void => {
      const box = element.getBoundingClientRect()
      const width = Math.max(1, Math.round(box.width) || 1)
      const height = heightRef.current > 0 ? heightRef.current : Math.max(1, Math.round(box.height) || 1)
      reportRect({ width, height })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    getItemKey: (index: number) => (index < visible.length ? (visible[index]?.id ?? index) : `ts-skeleton-${index}`),
    observeElementRect: observeTranscriptRect,
  })
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  /** Active-block follow (FR-104.3): minimum-movement viewport jump. */
  function followTo(playhead: Seconds): void {
    const index = activeIndexAt(visibleRef.current, playhead)
    if (index < 0) return
    const virtualizer = virtualizerRef.current
    const element = scrollRef.current
    if (element === null) return
    // FR-104.3 'nearest': a fully-visible active row never moves the
    // viewport; otherwise the row lands at the viewport top. Public API
    // only — getOffsetForIndex clamps to the element's real scrollHeight,
    // which is 0 without layout, so fall back to the mounted row's start
    // (all-mount LAYOUTLESS) or the uniform estimate (windowed).
    const mounted = virtualizer.getVirtualItems().find((candidate) => candidate.index === index)
    if (mounted !== undefined && mounted.start >= element.scrollTop && mounted.end <= element.scrollTop + element.clientHeight) return
    const computed = virtualizer.getOffsetForIndex(index, 'start')
    const target = computed !== undefined && computed[0] > 0 ? computed[0] : (mounted?.start ?? index * ROW_ESTIMATE_PX)
    programmaticDepthRef.current += 1
    lastProgrammaticAtRef.current = Date.now()
    element.scrollTo({ top: target })
    // The jsdom dom-stubs scrollTo records the offset WITHOUT firing the
    // scroll event a real browser would — notify the offset observer (and our
    // own bookkeeping) with a synchronous synthetic event so the virtualized
    // window follows the programmatic move. A real browser's own scroll event
    // for the same offset classifies 'spurious' and is a no-op.
    element.dispatchEvent(new Event('scroll'))
    programmaticDepthRef.current -= 1
  }

  // Playhead subscription (editor-slice mirror — the SAME truth TransportBar
  // renders; components never touch currentTime, conventions/design.md).
  // rAF-throttled through the injected driver: at most one follow per frame,
  // leading edge (a seek visibly lands within ≤ 1 frame). Paused while the
  // user scrolled (30 s idle resume) or a row is being edited.
  useEffect(() => {
    let lastPlayhead = app.editor.getState().playhead
    const unsubscribe = app.editor.subscribe(() => {
      const playhead = app.editor.getState().playhead
      if (playhead === lastPlayhead) return
      lastPlayhead = playhead
      if (editingRef.current !== null) return
      if (Date.now() < pausedUntilRef.current) return
      if (followScheduledRef.current) return
      followScheduledRef.current = true
      followFrameRef.current = rafs.request(() => {
        followScheduledRef.current = false
        followFrameRef.current = null
      })
      followTo(playhead)
    })
    return () => {
      unsubscribe()
      if (followFrameRef.current !== null) rafs.cancel(followFrameRef.current)
      followFrameRef.current = null
      followScheduledRef.current = false
    }
    // followTo only reads refs + the virtualizer ref — stable by contract.
  }, [app, rafs])

  // FR-104.2 measurement freshness: late webfont load + the theme/style
  // attribute bus (unit-104 § Risks) drop all measurements so the dynamic
  // pass re-reads every mounted row.
  useEffect(() => {
    let cancelled = false
    const reflow = (): void => {
      if (!cancelled) virtualizer.measure()
    }
    const fonts = typeof document !== 'undefined' ? (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts : undefined
    void fonts?.ready?.then(reflow).catch(() => undefined)
    let observer: MutationObserver | null = null
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      observer = new MutationObserver(reflow)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })
    }
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [virtualizer])

  // The E2E bridge's read surface (src/ui/transcript/bridge-seam.ts — the
  // unit-103 timeline precedent). Reads flow through refs/store getters so the
  // handle is current without re-registering.
  useEffect(() => {
    return registerTranscriptPanel({
      read: () => {
        const element = scrollRef.current
        const playhead = app.editor.getState().playhead
        const activeIndex = activeIndexAt(visibleRef.current, playhead)
        return {
          renderedRows: element?.querySelectorAll('[data-testid="transcript-row"]').length ?? 0,
          scrollTop: element?.scrollTop ?? 0,
          scrollHeight: virtualizerRef.current.getTotalSize(),
          viewportHeightPx: heightRef.current,
          searchOpen: app.editor.getState().searchOpen,
          matchCount: matchCountRef.current,
          currentMatchIndex: currentMatchRef.current,
          activeBlockId: activeIndex >= 0 ? (visibleRef.current[activeIndex]?.id ?? null) : null,
          editingBlockId: editingRef.current,
          skeletonRows: element?.querySelectorAll('[data-testid="transcript-skeleton-row"]').length ?? 0,
          focusedRowBlockId: focusedRef.current,
          hiddenSpeakerIds: [...hiddenRef.current],
        }
      },
      scrollToIndex: (index: number) => {
        virtualizerRef.current.scrollToIndex(index, { align: 'auto' })
      },
    })
  }, [app])

  // Scroll-intent accounting (FR-104.3): wheel/pointerdown and any scroll
  // event that is not our own programmatic echo pause the follow for the idle
  // window; the next seek after a user scroll lands without moving the
  // viewport (CC-104.2, frozen).
  function markScrollIntent(): void {
    pausedUntilRef.current = Date.now() + IDLE_RESUME_MS
  }
  function onScroll(): void {
    if (programmaticDepthRef.current > 0) return
    if (Date.now() - lastProgrammaticAtRef.current < PROGRAMMATIC_IGNORE_MS) return
    markScrollIntent()
  }

  // US-2.1.2: click-word → seek through the frozen command path (the same
  // `transport-seek` receiver the editor bridge drives — seekCount
  // observability intact); the block enters editor selection. Synchronous:
  // the seek is visible before any frame is driven.
  function seekTo(time: Seconds, blockId: string, event: ReactMouseEvent): void {
    event.stopPropagation()
    app.dispatch('transport-seek', { time })
    app.editor.setSelection({ anchorBlockId: blockId, focusBlockId: blockId })
  }

  const popoverBlock = popoverBlockId === null ? null : (blocks.find((block) => block.id === popoverBlockId) ?? null)
  const popoverPalette = speakerPalette()

  return (
    <div className="ts-panel" data-testid="transcript-panel">
      <div className="ts-toolbar">
        {project !== null && project.speakerSource === 'auto-beta' && (
          <span data-testid="transcript-beta-badge" className="ts-beta-badge" title="Speaker labels are automatic (beta) — review and rename them before publishing.">
            Beta
          </span>
        )}
      </div>
      {popoverBlock !== null && (
        <SpeakerPopover
          app={app}
          block={popoverBlock}
          speakers={speakers}
          palette={popoverPalette}
          blockCount={blocks.filter((block) => block.speakerId === popoverBlock.speakerId).length}
          atTime={app.editor.getState().playhead}
          onClose={() => {
            setPopoverBlockId(null)
          }}
          onHideSpeaker={(speakerId) => {
            setHiddenLocal((current) => (current.includes(speakerId) ? current : [...current, speakerId]))
            setPopoverBlockId(null)
          }}
        />
      )}
      {searchOpen && (
        <div className="ts-search" data-testid="transcript-search" role="search">
          <input
            ref={searchInputRef}
            data-testid="transcript-search-input"
            className="ts-search-input"
            value={queryDraft}
            placeholder="Find in transcript"
            aria-label="Find in transcript"
            onChange={(event) => {
              onQueryChange(event.target.value)
            }}
          />
          {/* SECURITY-03: the readout is a NUMBER — never the query, never block text. */}
          <span data-testid="transcript-search-count" className="ts-search-count">
            {String(matches.length)}
          </span>
          <label className="ts-search-option" title="Match case">
            <input
              type="checkbox"
              data-testid="transcript-search-case"
              checked={caseSensitive}
              onChange={(event) => {
                setCaseSensitive(event.target.checked)
                setCurrentMatch(0)
              }}
            />
            Aa
          </label>
          <label className="ts-search-option" title="Whole words">
            <input
              type="checkbox"
              data-testid="transcript-search-word"
              checked={wholeWord}
              onChange={(event) => {
                setWholeWord(event.target.checked)
                setCurrentMatch(0)
              }}
            />
            W
          </label>
          <input
            data-testid="transcript-search-replace-input"
            className="ts-search-input"
            value={replacement}
            placeholder="Replace"
            aria-label="Replace with"
            onChange={(event) => {
              setReplacement(event.target.value)
            }}
          />
          <button type="button" data-testid="transcript-replace-all" className="ts-popover-action" onClick={onReplaceAll}>
            Replace all
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        data-testid="transcript-root"
        role="list"
        aria-label="Transcript"
        className="ts-root"
        style={{ height: `${heightPx}px`, overflowY: 'auto' }}
        onScroll={onScroll}
        onWheel={markScrollIntent}
        onPointerDown={markScrollIntent}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const block = item.index < visible.length ? visible[item.index] : undefined
            if (block === undefined) {
              // FR-104.6: shimmer beyond the frontier — aria-hidden and EMPTY
              // (no speculative text; the shimmer is a CSS pseudo-element).
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  data-testid="transcript-skeleton-row"
                  aria-hidden="true"
                  className="ts-skeleton"
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: item.size, transform: `translateY(${item.start}px)` }}
                />
              )
            }
            const selected = selection.anchorBlockId === block.id || selection.focusBlockId === block.id
            const editing = editingBlockId === block.id
            const label = speakerLabel(speakers, block.speakerId)
            const color = speakers.find((speaker) => speaker.id === block.speakerId)?.color
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                data-testid="transcript-row"
                data-block-id={block.id}
                role="listitem"
                tabIndex={0}
                aria-label={`${label}, ${formatTimecode(block.start)}, ${block.text}`}
                className={`ts-row${selected ? ' ts-row-selected' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
                onClick={() => {
                  app.editor.setSelection({ anchorBlockId: block.id, focusBlockId: block.id })
                }}
                onFocus={() => {
                  focusedRef.current = block.id
                }}
                onBlur={() => {
                  if (focusedRef.current === block.id) focusedRef.current = null
                }}
              >
                <button
                  type="button"
                  data-testid="transcript-row-chip"
                  className="ts-chip"
                  style={color === undefined ? undefined : { backgroundColor: color }}
                  aria-label={`Speaker options for ${label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setPopoverBlockId(block.id)
                  }}
                >
                  {label}
                </button>
                <span
                  data-testid="transcript-row-timecode"
                  className="ts-timecode"
                  tabIndex={0}
                  onClick={(event) => {
                    seekTo(block.start, block.id, event)
                  }}
                >
                  {selected ? (
                    <TimecodeInput
                      label="Start"
                      testId="transcript-row-timecode-edit"
                      value={block.start}
                      fps={fps}
                      onCommit={(t) => {
                        app.dispatch('block-retime', { blockId: block.id, start: t })
                      }}
                    />
                  ) : (
                    formatTimecode(block.start)
                  )}
                </span>
                {editing ? (
                  // FR-104.4 in-place editor — the slice-C editable-allowlist
                  // component (src/ui/transcript/editable/, conventions §
                  // onKeyDown allowlist) owns Enter/Shift+Enter/Esc/IME; the
                  // commit dispatches ONLY `block-edit-text` here (FR-104.4).
                  <BlockEditor
                    initialText={block.text}
                    onSubmit={(text) => {
                      app.dispatch('block-edit-text', { blockId: block.id, text })
                      setEditingBlockId(null)
                    }}
                    onCancel={() => {
                      setEditingBlockId(null)
                    }}
                  />
                ) : (
                  <span data-testid="transcript-row-text" className="ts-text">
                    {block.words.map((word, wordIndex) => (
                      <Fragment key={wordIndex}>
                        <span
                          data-testid="transcript-word"
                          data-word-index={wordIndex}
                          data-timing={word.timing ?? 'asr'}
                          className={word.timing === 'estimated' ? 'ts-word ts-word-estimated' : 'ts-word'}
                          onClick={(event) => {
                            seekTo(word.start, block.id, event)
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation()
                            setEditingBlockId(block.id)
                          }}
                        >
                          {highlightWordParts(word.text, matchesByBlock.get(block.id)?.get(wordIndex), activeMatch)}
                        </span>
                        {wordIndex < block.words.length - 1 ? ' ' : ''}
                      </Fragment>
                    ))}
                    {block.confidence !== undefined && <span data-testid="transcript-confidence-dot" className="ts-confidence-dot" aria-hidden="true" title={`Confidence ${Math.round(block.confidence * 100)}%`} />}
                  </span>
                )}
                <button
                  type="button"
                  data-testid="transcript-close-gap"
                  className="ts-row-action"
                  aria-label="Delete block and close the gap (neighbours meet at the midpoint)"
                  onClick={(event) => {
                    event.stopPropagation()
                    app.dispatch('block-delete-close-gap', { blockId: block.id })
                  }}
                >
                  ⇤⟩
                </button>
                <button
                  type="button"
                  data-testid="transcript-row-delete"
                  className="ts-row-action"
                  aria-label="Delete block (leave the gap)"
                  onClick={(event) => {
                    event.stopPropagation()
                    app.dispatch('block-delete', { blockId: block.id })
                  }}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
