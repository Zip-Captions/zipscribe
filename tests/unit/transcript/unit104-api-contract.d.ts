// Unit-104 FROZEN API CONTRACT — test-author-owned ambient module declarations.
//
// The RED-phase suite of unit-104 (Transcript Editor — virtualized sidebar)
// imports the production module `src/ui/transcript/Transcript.tsx` through the
// `@ui/…` specifier (vite/vitest alias + tsconfig paths → `src/…`). It does
// not exist yet — that is the point: the tests import it INSIDE the test body
// via a variable specifier (`await import(/* @vite-ignore */ SPEC)`, the
// greenfield-RED doctrine of e2e/workbench/accessibility.spec.ts and
// tests/unit/timeline/keyboard-live-region.test.tsx — a static import of a
// missing module would break COLLECTION/typecheck, which is a harness error,
// not a RED) while `pnpm typecheck` types the tests against the declarations
// below. The builder must export exactly these names/shapes; the runtime
// assertions (not these types) are the acceptance gate
// (unit-03/04/05/101/102/103 `@NN` precedent,
// tests/unit/editor/unit102-api-contract.d.ts header doctrine).
//
// Ownership boundary: the unit-101 (`@state/jobs`, `@state/settings`,
// `@state/project`, `@ui/shell/Workbench`, `@ui/commands/registry`), unit-102
// (`@state/commands`, `@state/editor`, `@state/history` — incl. its `@104
// EXTENDS` section, appended per the orchestrator adjudication of
// 2026-11-11 in `src/state/CONTRACT.md` § Commands — unit-104 EXTENDS) and
// unit-103 (`@ui/timeline/*`, `@ui/editable/TimecodeInput`) ambient contracts
// stay authoritative — this file NEVER re-declares them. The four new command
// ids (`speaker-merge`, `speaker-split`, `replace-text`, `captions-align-apply`),
// their payloads and the additive `SpeakerEngine` seam members are frozen in
// the `@104 EXTENDS` section of unit102-api-contract.d.ts. Domain types are
// re-exported type-only under `@engine/model@104` (the `@104` suffix makes an
// accidental RUNTIME import impossible: nothing resolves it). `AsrWordInput`
// is imported TYPE-only from the already-merged `@engine/captions/align`
// (unit-07) — never re-declared here.
//
// Registry EXTENDS (unit-104 adds these CommandBinding entries to
// `src/ui/commands/registry.ts` — FROZEN ids/chords/gates, byte-exact, per
// `src/state/CONTRACT.md` § binding EXTENSION + knowledge/design.md
// § Keyboard shortcuts; unit-103 EXTENDS precedent; unit-105 owns the
// full-table snapshot):
//   transcript.search-open  'Meta+F'              (when: 'not-editing')
//   transcript.search-open  'Ctrl+F'              (when: 'not-editing')
//   search.next             'F3'                  (when: 'search-open')
//   search.next             'Meta+G'              (when: 'search-open')
//   search.next             'Ctrl+G'              (when: 'search-open')
//   search.previous         'Shift+F3'            (when: 'search-open')
//   search.previous         'Meta+Shift+G'        (when: 'search-open')
//   search.previous         'Ctrl+Shift+G'        (when: 'search-open')
//   qc.next-issue           "Meta+'"              (when: 'not-editing')
//   qc.previous-issue       "Meta+Shift+'"        (when: 'not-editing')
// The `when` union EXTENDS additively (unit-103 added 'timeline-focused';
// unit-104 adds 'search-open' — the F3/⌘G rows fire only while the transcript
// search is open, design.md "with search open"). Chord key tokens are the
// KeyboardEvent.key values: 'F3', 'G', and the quote key `'` written
// Meta+' / Meta+Shift+' (design.md § Keyboard shortcuts ⌘' / ⌘⇧' rows).
// `Shift+Delete` (close-gap delete) stays with unit-105 (FR-104.7) — the
// transcript row carries a button affordance instead (frozen below).
//
// VIRTUALIZATION FACTS (FR-104.2/FR-104.3, verified against the pinned
// @tanstack/react-virtual ^3 docs — dynamic-size mode):
//   * dynamic sizes = the `measureElement` callback ref on every row with
//     `data-index` (https://tanstack.com/virtual/latest/docs/api/virtualizer#measureElement)
//   * `overscan: 6` (FR-104.2; library default is 5)
//   * seek/active-block follow = `scrollToIndex(index, { align: 'nearest' })`
//     (FR-104.3; conventions § Focus management: block:'nearest' only, never
//     .focus()) — paused while the user scrolls or a row is being edited
//     (scroll-intent pause, FR-104.3/CC-104.2)
//   * `measure()` re-measures all rows — call it on `document.fonts.ready` and
//     the style-change bus (unit-104 Risk: late webfont load).
//
// `data-testid` contract (builder must use exactly these ids; all live under
// src/ui/transcript/**; components never bind keys — only the contenteditable
// editor uses onKeyDown, conventions § UI conventions editable allowlist):
//   transcript-root            — scroll element inside tabpanel-subtitles,
//                          role="list"; the ONLY element the virtualizer scrolls.
//   transcript-row             — role="listitem", tabindex="0",
//                          data-block-id="<id>", aria-label =
//                          "<speaker>, <timecode>, <text>" (conventions § ARIA
//                          row label; timecode via the shared formatTimecode).
//   transcript-row-chip        — speaker chip <button> (opens the popover).
//   transcript-row-timecode    — block start timecode, tabindex="0".
//   transcript-row-text        — text container (words render inside).
//   transcript-word            — word span, data-word-index="<n>",
//                          data-timing="<asr|aligned|estimated|manual>"
//                          (dotted underline on 'estimated', FR-104.8).
//   transcript-editor          — the in-place contenteditable (only after a
//                          dblclick on a word); contenteditable="true"; Enter
//                          commits via block-edit-text, Shift+Enter inserts a
//                          manual line break (word.breakAfter), Esc reverts,
//                          blur commits, paste is sanitized (no HTML), IME
//                          composition dispatches NO command mid-composition
//                          (FR-104.4/CC-104.3).
//   transcript-speaker-popover — opened by chip click: rename input
//                          transcript-speaker-rename-input +
//                          transcript-speaker-rename-apply (primary, label
//                          contains "Apply to all") +
//                          transcript-speaker-rename-block-only (secondary),
//                          transcript-speaker-recolor, transcript-speaker-merge,
//                          transcript-speaker-split, transcript-speaker-filter
//                          (hides this speaker — view-only, CC-104.5).
//   transcript-beta-badge      — "Beta" badge + tooltip (title attr explaining
//                          manual review), rendered only while
//                          project.speakerSource === 'auto-beta' (invariant 5).
//   transcript-close-gap       — row button dispatching `block-delete-close-gap`
//                          (the Shift+Delete BINDING is unit-105).
//   transcript-search          — search bar (rendered while editor.searchOpen).
//   transcript-search-input    — the query <input>.
//   transcript-search-replace-input — the replacement <input>.
//   transcript-search-count    — match-count readout (a number, SECURITY-03).
//   transcript-search-match    — match highlight span (text-range spans,
//                          NEVER innerHTML injection, FR-104.5),
//                          data-match-index="<n>", data-current-match="true"
//                          on the current one.
//   transcript-replace-all     — button; dispatches `replace-text` EXACTLY once
//                          (US-2.1.6: one command = one undo step).
//   transcript-skeleton-row    — streaming row beyond the committed frontier
//                          (FR-104.6), aria-hidden="true" (shimmer).
//   transcript-issue-filter    — "Issues (n)" filter chip (aria-pressed).
//   transcript-issue           — one issue row in the filter view (button; the
//                          JUMP: moves playhead + selection to its block,
//                          FR-104.8 / ⌘' navigation).
//   transcript-issue-dot       — per-row issue dot (--warning) on affected rows.
//   transcript-retime-tool     — toolbar "Shift / stretch timing…" button.
//   retime-dialog / retime-offset / retime-apply — the dialog, the offset
//                          number input, the apply button (captions-retime-all).
//   transcript-align-audio     — toolbar "Align to audio" (FR-104.8): starts
//                          `jobs.startTranscribe({ mode: 'align', ... })` and
//                          on job:done dispatches `captions-align-apply` —
//                          ONE undo step (CC-104.7).
//   caption-import-dialog / caption-import-report /
//   caption-import-report-format / -encoding / -cues / -blocks /
//   caption-import-report-adjustment (data-code="<ImportReport adjustment code>")
//                            / caption-import-confirm / caption-import-cancel
//                            — the Bring-your-own-captions import dialog
//                            (design.md § Bring-your-own captions, FR-104.9)
//                            opened by dropping a caption file on an OPEN
//                            project (drop target: the workbench shell);
//                            confirm replaces the source (captions-import,
//                            ONE undo step).
//   E2E ziptest scripting (worker seam, tests never touch the network): under
//   `?ziptest=1` the ASR channel is scripted — posted `loadModel`/`transcribe`
//   requests never reach a real ASR worker (worker-registry.ts +
//   src/state/services/engine-port.ts seam, unit-101 fake-engine doctrine);
//   `__zipWorkbenchBridge.injectAsrEvent` drives `job:segments`/`job:done` and
//   the align path dispatches `captions-align-apply` from them.

declare module '@engine/model@104' {
  export type { CaptionBlock, MediaAsset, Project, Seconds, Speaker, WordToken } from '@engine/model'
}

// ── L2 mount surface (jsdom): the transcript panel component ────────────────
declare module '@ui/transcript/Transcript' {
  import type { EditorApp } from '@state/history'
  import type { RafDriver } from '@state/services/playback/arbitrator'
  import type { JobsStore } from '@state/jobs'
  import type { ReactElement } from 'react'

  export interface TranscriptProps {
    app: EditorApp
    rafs: RafDriver
    /** Streaming source (FR-104.6): skeleton rows beyond the committed
     *  frontier read `jobs.getState().segments/running`. Optional so L2
     *  editing suites can mount without a jobs store. */
    jobs?: JobsStore
    /** Viewport height for the virtualizer (jsdom has no layout; default 480). */
    heightPx?: number
    /** View-only speaker filter (CC-104.5): blocks whose `speakerId` is listed
     *  are absent from the rendered rows. NEVER mutates the project and never
     *  creates a history step (the filter menu drives this state). */
    hiddenSpeakerIds?: readonly string[]
  }
  /**
   * The Subtitles-tab transcript panel: virtualized block list (dynamic sizes,
   * overscan 6 — react-virtual facts pinned in this file's header), speaker
   * chips + timecodes + text + confidence, click-word-to-seek (≤ 1 rAF frame,
   * `transport-seek` at `word.start` + the block enters editor selection),
   * in-place word editing exclusively through the command registry, search +
   * replace (debounced 120 ms, match count, F3 cycling with viewport jump),
   * speaker popover ops + Beta badge, QC issue dots/filter/jump, retime
   * dialog, align toolbar, streaming skeleton rows. Thin render layer — all
   * behavior through commands/stores (conventions § ui/**), keyboard handling
   * through the command registry only (components never bind keys; the
   * contenteditable editor is the frozen onKeyDown-allowlist exception).
   * WHILE MOUNTED the panel registers command handlers for every frozen
   * transcript binding id above (unit-103 Timeline precedent).
   */
  export function Transcript(props: TranscriptProps): ReactElement
}

/**
 * E2E-only injection bridge (FR-2.0.6 doctrine; sibling of
 * `__zipEditorBridge`/`__zipWorkbenchBridge`/`__zipTimelineBridge`, lazily
 * installed under `?ziptest=1`, DIAGNOSTICS ONLY — keyboard/mouse/scroll go
 * through REAL trusted input, never through this bridge). SECURITY-03:
 * everything crossing here is numbers, protocol enums, generated synthetic
 * block IDS and booleans — never user text; nothing logs content.
 */
interface Window {
  __zipTranscriptBridge?: {
    getTranscriptState(): {
      /** Rows currently mounted in the DOM (virtualized window + overscan). */
      renderedRows: number
      /** project.blocks.length — the full row count behind the window. */
      totalRows: number
      scrollTop: number
      scrollHeight: number
      viewportHeightPx: number
      searchOpen: boolean
      matchCount: number
      currentMatchIndex: number
      activeBlockId: string | null
      /** The block whose row currently holds the in-place editor (null = none). */
      editingBlockId: string | null
      /** FR-104.6 streaming rows beyond the committed frontier (aria-hidden). */
      skeletonRows: number
      /** Current QC issue count for the source track (FR-104.8 "Issues (n)"). */
      issueCount: number
      focusedRowBlockId: string | null
      hiddenSpeakerIds: string[]
      /** The align/transcribe job the jobs store currently runs (scripting). */
      runningJobKind: 'transcribe' | 'align' | null
      runningJobId: string | null
    }
    /** zundo history counters (SECURITY-03: numbers only) — the
     *  "each step exactly one undo step" assertions (CC-104.5/CC-104.7). */
    getHistory(): { undoCount: number; redoCount: number }
    /** Numbers + protocol timing enum only (SECURITY-03) — the align evidence
     *  (matched words 'aligned', unmatched stay 'estimated', CC-104.7). */
    getWordTimings(blockId: string): Array<{ timing: 'asr' | 'aligned' | 'estimated' | 'manual'; start: number; end: number }> | null
    getBlockTimes(blockId: string): { start: number; end: number } | null
  }
}
