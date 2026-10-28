# Discovery Log: Caption Studio UI

Research findings with sources. Created at spec review 2026-10-27; verify time-sensitive items at unit start.

## Library versions (npm dist-tags, 2026-10-27)

| Package | Latest | Notes |
|---|---|---|
| zustand | 5.0.16 | `useShallow` for selector equality |
| zundo | 2.3.0 | temporal middleware; `limit`, `equality`, `handleSet` (throttle/coalesce text edits) — verify option names against 2.3 docs |
| @tanstack/react-virtual | 3.14.23 | dynamic sizes via `measureElement`; docs-mcp `@tanstack/react-virtual` indexed |
| idb | 8.0.4 | promise wrapper over IndexedDB |
| fake-indexeddb | 6.2.6 | vitest IDB in node env |
| fast-check | 4.10.2 | property tests (conventions) |
| @axe-core/playwright | 4.14.0 | a11y scans |

## Platform facts that shape units

- **File System Access** (`showOpenFilePicker`, persistable `FileSystemFileHandle` in IndexedDB, `queryPermission/requestPermission`): Chromium desktop only. Firefox and Safari have no `showOpenFilePicker` → unit-106 picker fallback is the main path there, not an edge case. `showDirectoryPicker` (multi-language export, unit-302) likewise Chromium-only.
- **Keyboard Map API** (`navigator.keyboard.getLayoutMap()`): Chromium only; overlay falls back to `KeyboardEvent.key` labels.
- **`⌘←` / `⌘→`** are browser Back/Forward in Chrome on macOS; page `keydown` `preventDefault` suppresses it while focus is in the page — test explicitly (unit-105).
- **contenteditable + IME**: `compositionstart/end` must gate commits (unit-104 FR-104.4); `beforeinput` `inputType` is the reliable signal for paste/line-break handling.
- **Persisted storage**: `navigator.storage.persist()` is more likely granted for installed PWAs and engaged sites (Chromium heuristics); Safari may evict script-written storage after 7 days without interaction for non-installed sites — another reason to surface install (unit-204) and re-link (unit-106). Verify current Safari policy at unit-106 start.

## Prior art

- zip-captions split-mode translation layout (stacked / side-by-side, original-first vs translated-first, pending placeholder never showing source text): `~/Documents/zip-captions-monorepo/aidlc-docs/construction/u3-split-orientation-pip/functional-design.md` — informs unit-104's row layout so unit-302's side-by-side view fits without a redesign.

## Open questions

- [ ] contenteditable per row vs a single overlay editor positioned over the virtualized row (simpler focus/IME handling at 10k rows) — decide in unit-104 spike, record here
- [ ] zundo coalescing: `handleSet` throttle vs custom command merge window (1 s text-edit coalescing, unit-102)
