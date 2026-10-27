# Knowledge: Design

Visual language and interaction blueprint for Zipscribe. Seeded at greenfield inception from verified competitor research (see § Sources); evolves as design-pass output. Builders read this before any `src/ui/**` work.

## Design direction

**Archetype: Dense/Utilitarian "dark workbench"** — neutral-near-black surfaces, functional accent color, restrained motion, information density over whitespace. Feel: DaVinci Resolve meets Linear. Rationale: caption editing is a pro tool; competitors (Clipchamp/CapCut) are video editors with captions bolted on — Zipscribe is the opposite priority.

### Design tokens (CSS custom properties, dark default)

```css
:root[data-theme="dark"] {
  --bg-app: #0d0f12;      --bg-panel: #15181d;    --bg-raised: #1c2027;
  --bg-overlay: #232830;  --border-subtle: #2a2f38; --border-focus: #4c8dff;
  --text-primary: #e8eaed; --text-secondary: #9aa2ad; --text-disabled: #5c6470;
  --accent: #4c8dff;      --accent-strong: #2f6fe0; --accent-soft: rgba(76,141,255,.14);
  --danger: #e5534b;      --success: #4ab871;       --warning: #d9a03f;
  --waveform: #3d4450;    --waveform-active: #4c8dff;
  --playhead: #ff5c5c;    --selection: rgba(76,141,255,.22);
  --speaker-palette: #4c8dff,#e5534b,#4ab871,#d9a03f,#a06bd9,#3fb8c9,#d96ba0,#8fa03f;
}
:root[data-theme="light"] { /* mirrors, #f7f8fa app bg, #fff panels — tokens switch, no component forks */ }
```

Typography: `Inter` UI (variable, self-hosted subset), tabular numerals for all timecodes (`font-variant-numeric: tabular-nums`), `JetBrains Mono` for timecode inputs. Spacing scale 4 px (4/8/12/16/24). Radius 6 px panels, 4 px controls. Density: control height 28 px, transcript line-height 1.45.

## Layout (verified competitor patterns + our deltas)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⌂ Zipscribe   [Project name ▾]              [Tier chip]  [● Transcribe] [Export] │
├───────────────────────────┬────────────────────────────────────────────┤
│ LEFT: tabbed sidebar      │ CENTER: preview stage                      │
│ [Subtitles][Media][Style] │   canvas overlay on <video>                │
│ ┌ search (⌘/Ctrl+F) ┐     │   aspect-ratio letterbox + safe margins    │
│ │ S1 [00:01–00:04]      │ │   transport: ◀◀ 5s ▶/⏸ 5s▶▶ | 00:12.3/10:00│
│ │  wel­come back… (edit)│ │   loop-region toggle · speaker badges      │
│ │ S2 [00:04–00:09]      │ ├────────────────────────────────────────────┤
│ │  thanks! today…       │ │ BOTTOM: timeline                           │
│ │  ▸ 84 WPM · conf ▂▃▅  │ │  ruler (⌘-zoom) │ [audio peaks waveform]  │
│ └───────────────────────┘ │             │ [caption blocks ⣿⣿⣿]        │
│ status: model·tier·cache  │  tools: zoom fit · snap · speaker filter   │
└───────────────────────────┴────────────────────────────────────────────┘
```

Verified patterns adopted: transcript pane + timeline dual view synced to playhead (Clipchamp, CapCut); click timestamp/word → seek (Clipchamp); double-click word inline edit (Clipchamp); timeline caption blocks with drag-edge trim (CapCut); transcript-driven ripple delete (Clipchamp work version, CapCut transcript editing); filler-word/gap detection one-click removal (CapCut); batch styling via select-all (CapCut); bounded-then-deep undo (Clipchamp 50 → ours ≥ 100); panel focus regions (Clipchamp Alt+1..4).

Our deltas (competitor gaps, verified research): transcript **search**, caption **merge** shortcut + buttons, **numeric in/out time inputs**, **loop region**, **auto-diarization with rename/recolor/reassign**, multi-format export (SRT+VTT+JSON vs Clipchamp SRT-only), **beta badge + confidence display**, keyboard shortcut overlay.

## Interaction specs

- **Active-word highlight**: during playback, current word gets accent underline + raised weight (style-driven karaoke is Intent 3); block auto-scrolls into view with 2-block context, smooth, never steals focus during editing.
- **Block selection model**: click selects block; shift-click extends; drag on empty timeline = marquee; selection syncs transcript↔timeline via store (single `selection` slice).
- **Trim handles**: 8 px grab zones on block edges, ± 1 frame nudge via Alt-drag, snap to adjacent blocks/waveform zero-crossings within 8 px (toggleable).
- **Inline edit**: double-click word → contenteditable in-place; Enter commits block, Shift+Enter inserts manual line break (CapCut convention), Esc cancels; editing never changes timings unless "Re-time from words" is toggled on the block.
- **Speaker chips**: colored chip per block; click chip → rename popover (applies globally, "only this block?" secondary); filter menu hides speakers.
- **Progressive transcription**: sidebar shows blocks streaming in (`job:segments`), skeleton rows with shimmer beyond frontier; status bar shows `model · tier · ETA`.
- **Destructive ops**: never without undo affordance — toast with "Undo" link (uses command history, not a second confirm).
- **Empty states**: import drop zone doubles as first-run screen with model-download status inline.
- **Focus/a11y**: all controls reachable (Tab order = visual order), focus-visible ring `--border-focus`, transcript rows ARIA `role="listitem"` + aria-label with timecode + speaker + text, live-region announces transcription progress % (polite), contrast AA for text (4.5:1).

## Keyboard shortcuts (v1 map)

Clipchamp keys verified ✔ (official docs); CapCut has no official list — community keys marked UNVERIFIED and treated as suggestions we validate by feel. Platform modifiers: `⌘` on macOS, `Ctrl` elsewhere.

| Action | Key | Note |
|---|---|---|
| Play / pause | `Space` | ✔ both competitors |
| Seek ± 5 s | `J` / `L` (±10 s `Shift+J/L`) | editor convention |
| Playhead ± 1 frame | `←` / `→` | ✔ Clipchamp |
| Playhead ± 1 s | `Shift+←` / `Shift+→` | ✔ Clipchamp (larger step) |
| Go to start / end | `⌘←` / `⌘→` | ✔ Clipchamp |
| Split caption block at playhead | `S` | ✔ Clipchamp (split) |
| Merge selected with next block | `Ctrl/Cmd+Shift+M` | our gap-filler (neither competitor) |
| Delete selected block | `Delete` / `Backspace` | ✔ (when not editing text) |
| Ripple delete (cut media too) | `Shift+Delete` | transcript-driven ripple ✔ Clipchamp-work/CapCut |
| Ripple trim block start/end to playhead | `Z+←/→` / `C+←/→` | ✔ Clipchamp |
| Loop region on/off | `L` with region set — use `Y` | `L` taken by seek |
| Set in / out from playhead | `I` / `O`; clear `Shift+I/O` | editor convention |
| Timeline zoom in / out / fit | `⌘=` / `⌘-` / `⌘0` | ✔ Clipchamp |
| Timeline zoom (wheel) | `⌘ + wheel` | ✔ CapCut UNVERIFIED |
| Select all / deselect | `⌘A` / `Esc` | ✔ CapCut (batch style) |
| Find in transcript | `⌘F` | our gap-filler |
| Undo / redo | `⌘Z` / `⌘⇧Z` or `⌘Y` | ✔ Clipchamp |
| Save snapshot | `⌘S` | (cloud tools have none — ours persists to IDB) |
| Toggle caption visibility | `⌘\` | preview |
| Focus panels | `Alt+1/2/3` (sidebar/stage/timeline) | ✔ Clipchamp Alt+N |
| Shortcuts overlay | `⌘/` | ✔ Clipchamp |
| Confirm/cancel edit | `Enter` / `Esc`; `Shift+Enter` line break | ✔ CapCut convention |

Rules: shortcuts registered through the single command registry (unit-105); never bound during `contenteditable` focus except save/undo; chord conflicts resolved in favor of table above; overlay + command palette (`⌘K`, later) share registry.

## Sources (for re-verification during design pass)

- Clipchamp shortcuts: https://support.microsoft.com/en-us/clipchamp/keyboard-shortcuts-for-clipchamp · autocaptions: https://support.microsoft.com/en-us/clipchamp/how-to-use-autocaptions-in-clipchamp
- CapCut caption workflow: https://www.capcut.com/resource/add-captions-with-ai · transcript editing: https://www.capcut.com/tools/video-transcript-editing · AI captions: https://www.capcut.com/resource/ai-captioning
- Research caveats: CapCut publishes no official shortcut list; third-party complaint mining blocked (403s) — re-derive pain points in-house via dogfooding during Intent 2.
