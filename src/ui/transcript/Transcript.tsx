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
//
// Viewport sourcing (review-r1 F6): `heightPx` is a TEST-ONLY explicit
// override (the frozen L2 suites pass it — the virtualizer needs a
// deterministic height without layout). In production the prop is omitted and
// the root flex-fills its tabpanel (`.ts-root-fill` in transcript.css, the
// unit-103 Timeline ResizeObserver doctrine): the rect comes from the
// element's real client box, kept fresh by ResizeObserver — which the code
// tolerates being absent (jsdom/SSR ⇒ LAYOUTLESS everything-visible).

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ReactVirtualizerOptions } from '@tanstack/react-virtual'
import type { CaptionBlock, Seconds, Speaker } from '../../engine/model'
import { checkCaptions } from '../../engine/captions/qc'
import type { QcIssue, QcIssueCode } from '../../engine/captions/qc'
import type { EditorApp } from '../../state/history'
import type { JobsStore, JobsState } from '../../state/jobs'
import { defaultModelForTier } from '../../state/jobs'
import type { SettingsStore } from '../../state/settings'
import type { RafDriver } from '../../state/services/playback/arbitrator'
import { formatTimecode } from '../format'
import { TimecodeInput } from '../editable/TimecodeInput'
import { dispatchCommand, registerCommandHandler, registerSearchOpenReader } from '../commands/registry'
import { registerTranscriptPanel } from './bridge-seam'
import { registerQcIssueCursor } from './qc-cursor-seam'
import { BlockEditor } from './editable/BlockEditor'
import { findMatches, groupMatches } from './match-index'
import { getQcIssueCursor } from './qc-cursor-seam'
import { RetimeDialog } from './RetimeDialog'
import { SpeakerPopover } from './SpeakerPopover'
import { speakerPalette } from './palette'
import './transcript.css'

export interface TranscriptProps {
  app: EditorApp
  rafs: RafDriver
  /** Streaming source (FR-104.6): skeleton rows beyond the committed frontier read `jobs.getState().segments/running`. */
  jobs?: JobsStore
  /** TEST-ONLY virtualizer viewport (jsdom has no layout — the frozen L2 suites pin it). Omitted in production: the root flex-fills its pane and the height is MEASURED (review-r1 F6). */
  heightPx?: number
  /** View-only speaker filter (CC-104.5): blocks whose `speakerId` is listed are absent from the rendered rows. NEVER mutates the project, never creates a history step. */
  hiddenSpeakerIds?: readonly string[]
  /** FR-104.8 align: remembered transcribe prefs (language/model) for `startTranscribe({ mode:'align' })`; defaults to the tier model. */
  settings?: SettingsStore
}

const ROW_ESTIMATE_PX = 40
const OVERSCAN = 6
/** FR-104.3: follow-scroll stays paused this long after a user scroll intent. */
const IDLE_RESUME_MS = 30_000
/** Scroll events this close after a programmatic write are the browser's echo of our own move — never user intent. */
const PROGRAMMATIC_IGNORE_MS = 150
/** US-2.1.6: the query is committed 120 ms after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 120

const NO_BLOCKS: readonly CaptionBlock[] = Object.freeze([])
const NO_SPEAKERS: readonly Speaker[] = Object.freeze([])
const EMPTY_ISSUES: readonly QcIssue[] = Object.freeze([])
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

/** FR-104.8 issue-list display order (design.md § QC panel, grouped by code). */
const QC_CODE_ORDER: readonly QcIssueCode[] = ['CPS_HIGH', 'LINE_TOO_LONG', 'TOO_MANY_LINES', 'DURATION_SHORT', 'DURATION_LONG', 'GAP_TINY', 'OUT_OF_MEDIA', 'TRANSLATION_STALE', 'TRANSLATION_MISSING']
/** Plain-language labels — the UI owns copy, the engine code rides in data-code (design.md: "Too fast to read — 24 chars/sec"). */
const QC_COPY: Record<QcIssueCode, (issue: QcIssue) => string> = {
  CPS_HIGH: (issue) => `Too fast to read — ${String(issue.value)} chars/sec`,
  LINE_TOO_LONG: (issue) => `Line too long — ${String(issue.value)} characters`,
  TOO_MANY_LINES: (issue) => `Too many lines — ${String(issue.value)}`,
  DURATION_SHORT: (issue) => `Shown too briefly — ${String(issue.value)} s`,
  DURATION_LONG: (issue) => `Shown too long — ${String(issue.value)} s`,
  GAP_TINY: (issue) => `Gap too small — ${String(issue.value)} s`,
  OUT_OF_MEDIA: (issue) => `Runs past the media end — ${String(issue.value)} s`,
  TRANSLATION_STALE: (issue) => `Translation out of date (${issue.track})`,
  TRANSLATION_MISSING: (issue) => `Translation missing (${issue.track})`,
}
/** DOM bound for the issue list (the chip shows the TRUE count; a 10k-issue
 *  list must never flood the DOM — the perf row-count budget philosophy). */
const MAX_ISSUE_ITEMS = 50

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
  const { app, rafs, jobs, heightPx, hiddenSpeakerIds, settings } = props
  const jobsStore = jobs ?? IDLE_JOBS

  const project = useStoreValue(app.project, (state) => state.project)
  const selection = useStoreValue(app.editor, (state) => state.selection)
  const running = useStoreValue(jobsStore, (state) => state.running)
  const progress = useStoreValue(jobsStore, (state) => state.progress)
  const segments = useStoreValue(jobsStore, (state) => state.segments)

  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [popoverBlockId, setPopoverBlockId] = useState<string | null>(null)
  const [hiddenLocal, setHiddenLocal] = useState<readonly string[]>([])
  // FR-104.8 (slice D): the Issues (n) filter toggle, the retime dialog and
  // the align affordance state (progress / coded toast).
  const [issueFilterOn, setIssueFilterOn] = useState(false)
  const [retimeOpen, setRetimeOpen] = useState(false)
  const [alignToast, setAlignToast] = useState<string | null>(null)
  // Review-r1 F2: a failed align job is announced in-panel with the stable
  // error CODE (the jobs store keeps EngineError codes, never user text —
  // SECURITY-03). Errored align still applies nothing and adds no undo step.
  const [alignErrorCode, setAlignErrorCode] = useState<string | null>(null)
  const [qcAnnounce, setQcAnnounce] = useState('')
  const alignJobRef = useRef<{ jobId: string; cancelled: boolean } | null>(null)
  const qcCursorIndexRef = useRef(-1)

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
  const heightRef = useRef(heightPx ?? 0)
  heightRef.current = heightPx ?? 0
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

  // ── QC (FR-104.8 first half) — DERIVED, never stored (domain glossary "QC
  // issue", REVIEW item): engine `checkCaptions` memoized on the PROJECT
  // REFERENCE only, so playhead ticks/selection/filtering never re-check.
  const issues = useMemo<readonly QcIssue[]>(() => (project === null ? EMPTY_ISSUES : checkCaptions(project)), [project])
  const issuesByBlock = useMemo(() => {
    const map = new Map<string, QcIssue[]>()
    for (const issue of issues) {
      const list = map.get(issue.blockId)
      if (list === undefined) map.set(issue.blockId, [issue])
      else list.push(issue)
    }
    return map
  }, [issues])
  // Display/cursor order: grouped by code (frozen rule order), then block
  // order, then track — ONE canonical order for the list AND ⌘' navigation.
  const orderedIssues = useMemo(() => {
    if (issues.length === 0) return EMPTY_ISSUES
    const position = new Map((project?.blocks ?? NO_BLOCKS).map((block, index) => [block.id, index] as const))
    return [...issues].sort((a, b) => {
      const byCode = QC_CODE_ORDER.indexOf(a.code) - QC_CODE_ORDER.indexOf(b.code)
      if (byCode !== 0) return byCode
      const byBlock = (position.get(a.blockId) ?? 0) - (position.get(b.blockId) ?? 0)
      if (byBlock !== 0) return byBlock
      return a.track.localeCompare(b.track)
    })
  }, [issues, project])
  const issuesRef = useRef(orderedIssues)
  issuesRef.current = orderedIssues
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  // The "Issues (n)" filter narrows the rows to blocks that HAVE issues
  // (view-only — the data and the derivation are untouched).
  const visible = useMemo(() => {
    const unfiltered = hidden.size === 0 ? blocks : blocks.filter((block) => !hidden.has(block.speakerId))
    return issueFilterOn ? unfiltered.filter((block) => issuesByBlock.has(block.id)) : unfiltered
  }, [blocks, hidden, issueFilterOn, issuesByBlock])
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

  /**
   * Review-r1 F5: the search bar's close affordance. A CLICK handler (outside
   * the keyboard allowlist) dispatching the registry `transcript.search-open`
   * command — the toggle/close LOGIC stays registry-owned (the mounted
   * handler flips `editor.searchOpen`; ⌘F/⌃F unfocused still toggles closed
   * through the same path). The focused input is blurred FIRST because the
   * registry's `not-editing` gate (keyboard doctrine) would otherwise
   * correctly skip the dispatch while the query/replace field holds focus.
   */
  function closeSearch(): void {
    if (typeof document !== 'undefined') (document.activeElement as HTMLElement | null)?.blur?.()
    dispatchCommand('transcript.search-open')
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
      // Test override wins when injected (deterministic jsdom window);
      // otherwise the REAL measured client box drives the window (review-r1
      // F6 — production flex-fills the pane, ResizeObserver keeps this fresh).
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

  // ── QC jump + ⌘'/⌘⇧' cursor (FR-104.8) ────────────────────────────────────
  /**
   * Mirror of the US-2.1.2 click-seek path (seekTo): synchronous
   * `transport-seek` (≤ 1 frame, same receiver the editor bridge drives) +
   * block selection — UI-only, zero history steps. Lands MID-BLOCK so the
   * playhead is genuinely on the issue's block (design.md "jumps playhead +
   * selection to the issue's block"), then scrolls the row into view
   * (scrollToIndex, never .focus()).
   */
  function jumpToIssue(index: number): void {
    const list = issuesRef.current
    if (list.length === 0) return
    const wrapped = ((index % list.length) + list.length) % list.length
    const issue = list[wrapped]
    if (issue === undefined) return
    const block = blocksRef.current.find((candidate) => candidate.id === issue.blockId)
    if (block === undefined) return
    qcCursorIndexRef.current = wrapped
    app.dispatch('transport-seek', { time: (block.start + block.end) / 2 })
    app.editor.setSelection({ anchorBlockId: block.id, focusBlockId: block.id })
    const rowIndex = visibleRef.current.findIndex((candidate) => candidate.id === block.id)
    if (rowIndex >= 0) virtualizerRef.current.scrollToIndex(rowIndex, { align: 'auto' })
    // SECURITY-03: position numbers only, never block text or issue values.
    setQcAnnounce(`Issue ${String(wrapped + 1)} of ${String(list.length)}`)
  }

  // The slice-C registry handlers (qc.next-issue/qc.previous-issue) drive
  // this cursor while the panel is mounted; empty issue list = safe no-op.
  useEffect(() => {
    return registerQcIssueCursor({
      nextIssue(): void {
        const list = issuesRef.current
        if (list.length === 0) return
        jumpToIssue(qcCursorIndexRef.current < 0 ? 0 : qcCursorIndexRef.current + 1)
      },
      previousIssue(): void {
        const list = issuesRef.current
        if (list.length === 0) return
        jumpToIssue(qcCursorIndexRef.current < 0 ? list.length - 1 : qcCursorIndexRef.current - 1)
      },
    })
    // jumpToIssue reads refs + stable setters/app — stable by contract.
  }, [app])

  // ── Align to audio (FR-104.8 second half / CC-104.7) ──────────────────────
  // Reuses the Transcribe job pipeline (domain Align lifecycle) with
  // mode:'align' → the jobs slice shows kind 'align'. On the job's own
  // done transition the accumulated `job:segments` words are applied through
  // EXACTLY ONE `captions-align-apply` dispatch = one undo step; cancel or
  // error NEVER applies. Content-free progress/toast (SECURITY-03).
  function startAlign(): void {
    if (jobs === undefined) return
    setAlignToast(null)
    setAlignErrorCode(null)
    const prefs = settings?.getState().transcribe
    const state = jobsStore.getState()
    const modelId = prefs?.modelId ?? state.modelOptions.find((option) => option.offlineReady)?.id ?? defaultModelForTier(state.capability?.tier)
    jobs.startTranscribe({ language: prefs?.language ?? null, modelId, diarize: false, mode: 'align' })
  }

  function cancelAlign(): void {
    if (jobs === undefined) return
    if (alignJobRef.current !== null) alignJobRef.current.cancelled = true
    jobs.cancel()
  }

  useEffect(() => {
    return jobsStore.subscribe(() => {
      const state = jobsStore.getState()
      if (state.running !== null) {
        if (state.running.kind === 'align') {
          if (alignJobRef.current === null || alignJobRef.current.jobId !== state.running.jobId) alignJobRef.current = { jobId: state.running.jobId, cancelled: false }
        } else {
          // A non-align job displaced ours (its cancel was already posted by
          // startTranscribe) — ours is dead, nothing to apply.
          alignJobRef.current = null
        }
        return
      }
      const entry = alignJobRef.current
      if (entry === null) return
      alignJobRef.current = null
      if (entry.cancelled) return
      if (state.error !== null) {
        // Review-r1 F2 (silent-failure fix): announce the coded failure — the
        // StatusBar renders only percent/model/tier/cache, nothing else in
        // ui/** surfaced jobs.error. Code only, never EngineError.detail
        // (SECURITY-03). Frozen semantics kept: nothing applied, no undo step.
        setAlignErrorCode(state.error.code)
        return
      }
      const asrWords = state.segments.flatMap((segment) => segment.words.map((word) => ({ text: word.text, start: word.start, end: word.end })))
      if (asrWords.length === 0) return
      app.dispatch('captions-align-apply', { asrWords })
      const allWords = (app.project.getState().project?.blocks ?? NO_BLOCKS).flatMap((block) => block.words)
      if (allWords.length === 0) return
      const aligned = allWords.filter((word) => word.timing === 'aligned').length
      // Coded-count toast only (SECURITY-03): numbers, never words.
      setAlignToast(`aligned ${String(aligned)}/${String(allWords.length)} words (${String(Math.round((aligned / allWords.length) * 100))}%)`)
    })
  }, [jobsStore, app])

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
          // Test override when injected; otherwise the real client box (the
          // production pane is flex-filled — review-r1 F6).
          viewportHeightPx: heightRef.current > 0 ? heightRef.current : (element?.clientHeight ?? 0),
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

  // Scroll-intent accounting (FR-104.3): a WHEEL gesture and any scroll event
  // that is not our own programmatic echo (scrollbar drag included — it fires
  // plain `scroll`) pause the follow for the idle window; the next seek after
  // a user scroll lands without moving the viewport (CC-104.2, frozen).
  // Review-r1 F7: pointer-down over rows is NOT a scroll intent — the
  // primary word-click seek must not freeze follow for 30 s (edit-time pin
  // is covered separately by the editing guard).
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
        {issues.length > 0 && (
          <button type="button" data-testid="transcript-issue-filter" className="ts-issue-filter" aria-pressed={issueFilterOn} onClick={() => setIssueFilterOn((on) => !on)}>
            {`Issues (${String(issues.length)})`}
          </button>
        )}
        {project !== null && (
          <span className="ts-toolbar-actions">
            <button type="button" data-testid="transcript-retime-tool" className="ts-toolbar-button" disabled={blocks.length === 0} onClick={() => setRetimeOpen(true)}>
              Shift / stretch timing…
            </button>
            <button type="button" data-testid="transcript-align-audio" className="ts-toolbar-button" disabled={jobs === undefined || running !== null || blocks.length === 0} onClick={startAlign}>
              Align to audio
            </button>
            {running !== null && running.kind === 'align' && (
              <>
                <span data-testid="transcript-align-progress" className="ts-align-progress" aria-label="Align progress">
                  {progress !== null && progress.totalSec > 0 ? `${String(Math.round((progress.processedSec / progress.totalSec) * 100))}%` : '…'}
                </span>
                <button type="button" data-testid="transcript-align-cancel" className="ts-toolbar-button" onClick={cancelAlign}>
                  Cancel
                </button>
              </>
            )}
            {alignToast !== null && (
              <span data-testid="transcript-align-toast" role="status" className="ts-align-toast">
                {alignToast}
              </span>
            )}
            {alignErrorCode !== null && (
              <span data-testid="transcript-align-error" role="status" className="ts-align-error" data-code={alignErrorCode}>
                {`Align failed (${alignErrorCode}) — nothing applied`}
              </span>
            )}
          </span>
        )}
      </div>
      {retimeOpen && (
        <RetimeDialog
          app={app}
          onClose={() => {
            setRetimeOpen(false)
          }}
        />
      )}
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
          {/* Review-r1 F5: real close affordance — the input cannot bind Esc
              (keyboard allowlist), ⌘F is swallowed by the browser find while
              the field has focus. CLICK-dispatch through the registry. */}
          <button type="button" data-testid="transcript-search-close" className="ts-popover-action ts-search-close" aria-label="Close search" onClick={closeSearch}>
            ×
          </button>
        </div>
      )}
      {/* FR-104.8: grouped issue list (plain-language labels, code in
          data-code; UI-owned copy). Rendered whenever issues exist — the
          filter chip additionally narrows the ROWS. Bounded DOM (numbers
          only, SECURITY-03). */}
      {orderedIssues.length > 0 && (
        <div className="ts-issues" data-testid="transcript-issues" aria-label="Caption quality issues">
          {orderedIssues.slice(0, MAX_ISSUE_ITEMS).map((issue, index) => (
            <button
              key={`${issue.code}:${issue.track}:${issue.blockId}:${String(index)}`}
              type="button"
              data-testid="transcript-issue"
              data-code={issue.code}
              data-block-id={issue.blockId}
              className="ts-issue-item"
              onClick={() => jumpToIssue(index)}
            >
              {QC_COPY[issue.code](issue)}
            </button>
          ))}
        </div>
      )}
      <div data-testid="transcript-qc-live" className="ts-live" aria-live="polite">
        {qcAnnounce}
      </div>
      <div
        ref={scrollRef}
        data-testid="transcript-root"
        role="list"
        aria-label="Transcript"
        className={heightPx === undefined ? 'ts-root ts-root-fill' : 'ts-root'}
        style={heightPx === undefined ? { overflowY: 'auto' } : { height: `${heightPx}px`, overflowY: 'auto' }}
        onScroll={onScroll}
        onWheel={markScrollIntent}
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
                {issuesByBlock.has(block.id) && <span data-testid="transcript-issue-dot" className="ts-issue-dot" aria-hidden="true" title="This block has quality-check issues" />}
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
