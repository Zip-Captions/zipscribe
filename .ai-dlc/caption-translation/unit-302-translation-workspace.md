---
status: pending
discipline: frontend
depends_on: [unit-301-translation-engine, caption-studio-ui/unit-104-transcript-editor, styling-and-export/unit-202-export]
workflow: default
mode: HITL   # review UX needs the owner's judgement; contracts already fixed by 301/104/202
---

# Unit 302: Translation Workspace (languages, side-by-side review, per-language export)

## Description

The UI for translation tracks: a Languages section in the sidebar (add/remove languages, download packs, translate all / stale / failed, progress, cancel), a transcript view switcher (source · translation · side-by-side), inline editing of translations with status badges, a preview/burn-in track picker, and per-language export. Honest gating when the browser can't translate.

## User Stories

**US-302.1** As a localizer, I add languages and watch them fill in.
- *Given* the Languages section, *when* "Add language" is clicked, *then* a picker lists target languages with availability badges (`Ready` / `Download` with size unknown / `Unavailable`); choosing a `Download` language starts the pack download inside that click (user gesture) with a progress bar, then translation starts; *given* an unsupported browser, *then* the section shows "On-device translation needs Chrome or Edge on desktop" plus "Import translation file" and "Add empty track (translate manually)".
- *Given* a running translation, *when* it progresses, *then* a polite live region announces percent, rows fill in visible-first, and Cancel stops it within 500 ms keeping completed entries.

**US-302.2** As a localizer, I review translations next to the source.
- *Given* side-by-side view (`⌘⇧L` cycles source → translation → side-by-side), *when* rendered, *then* each row shows source text and translation (`dir` set per language — Arabic/Hebrew render RTL), with badges `Machine-translated` / `Edited` / `Stale` / `Failed`; virtualization bounds from unit-104 still hold at 10 000 blocks.
- *Given* a translation cell, *when* double-clicked and edited (Enter commits, Shift+Enter line break, Esc cancels), *then* `translation-edit-entry` dispatches, status becomes `edited`, one undo step.
- *Given* stale entries, *when* the user clicks "Retranslate stale" or a row's "Mark as reviewed", *then* only those entries change; QC panel lists `TRANSLATION_STALE` / `TRANSLATION_MISSING` per language (from unit-07 `checkCaptions`).
- A persistent note in the Languages section reads "Machine translation may be inaccurate — review before publishing" (zip-captions ADR-013 requirement; not dismissible).

**US-302.3** As a localizer, I deliver every language.
- *Given* the export dialog, *when* a sidecar format is chosen, *then* a language selector (source + each track) is shown; "All languages" writes `{slug}.{lang}.{ext}` per track into a directory chosen via `showDirectoryPicker` (Chromium) or downloads them one by one elsewhere.
- *Given* burn-in, *when* a translation track is selected, *then* the overlay renderer draws that track's text for each source block (block-level highlight only — translations have no word timings) and RTL text shapes correctly (pixel golden for an Arabic sample).

**US-302.4** As a localizer, I can add a translation from a file.
- *Given* "Import translation file", *when* a VTT/SRT/... in another language is chosen, *then* unit-07 maps cues onto source blocks (`as: {translation: lang}`), the import report shows unmatched cues, and the track's origin is `imported`.

## Functional Requirements

- **FR-302.1** Languages section in the Subtitles tab (unit-101 sidebar), backed by `jobs.translation[lang]` state; buttons disabled per availability; downloads only inside click handlers.
- **FR-302.2** Transcript view mode in `editor` slice (`'source' | 'translation' | 'split'` + `activeLanguage`); timeline block labels and preview overlay follow `activeLanguage`.
- **FR-302.3** Overlay renderer input gains `track: 'source' | lang` (unit-201 contract extension, recorded as a contract change): translation text wraps with the same style rules; `ctx.direction` from language.
- **FR-302.4** Serializers (unit-202) called with `track` param; VTT output sets `Language:` header-free but file name carries the language; speaker labels from the source block's speaker.
- **FR-302.5** Registry/design-table additions: `⌘⇧L` cycle transcript view (row added to `knowledge/design.md` in this unit's PR).

## Completion Criteria

- [ ] **CC-302.1** Mocked-API e2e: add fr + es → progress → all rows filled → edit one → stale after source edit → retranslate stale → export all languages (byte-exact goldens)
- [ ] **CC-302.2** Unsupported-browser e2e (webkit project): gating copy shown; import translation file + manual track work; no translation command enabled
- [ ] **CC-302.3** RTL: Arabic track renders RTL in transcript (DOM `dir`) and burn-in (pixel golden)
- [ ] **CC-302.4** axe: 0 critical in Languages section and side-by-side view
- [ ] **CC-302.5** All gates green incl. `pnpm test:e2e`

## Docs to consult

- `knowledge/design.md` (interaction specs, shortcut table) · docs-mcp `chrome-built-in-ai` (user activation) · zip-captions split-mode design: `aidlc-docs/construction/u3-split-orientation-pip/functional-design.md` (prior art)
