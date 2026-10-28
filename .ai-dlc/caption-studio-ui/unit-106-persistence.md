---
status: pending
discipline: frontend
depends_on: [unit-102-editor-core-playback, local-transcribe-engine/unit-04-media-ingest]
workflow: tdd
mode: AHOTL
---

# Unit 106: Persistence (IndexedDB, autosave, project lifecycle)

## Description

Local-first storage: versioned project store (JSON + `PeaksData` + settings + panel state) in IndexedDB via `idb`, debounced autosave, `⌘S` snapshot, project list (new/open/duplicate/delete), media re-linking (File System Access handle with file-picker fallback + fingerprint verification), storage quota management with blob cache eviction (≤ 500 MB policy), schema migration framework.

## User Stories

**US-2.4.1** As a user, I never lose work and never think about saving.
- *Given* any committed command, *when* 2 s idle (debounce) or `visibilitychange→hidden` or `⌘S`, *then* project persisted; reload restores byte-equal state (golden project JSON incl. selections-free UI state exclusion list).
- *Given* app closed mid-transcription, *when* reopened, *then* project present with blocks committed before close and a "transcription was interrupted" state (partial blocks kept — engine-1/05 contract).
- *Given* two autosaves racing (rapid edits), *when* both complete, *then* last-completed wins, store never torn (IDB transaction atomicity test).

**US-2.4.2** As a user returning later, my media is re-linked, not re-uploaded.
- *Given* project with persisted `FileSystemFileHandle`, *when* reopen, *then* silent re-link after `queryPermission` + fingerprint check (name, size, duration, hash-of-sample-chunks vs stored fingerprint); *given* handle stale/denied, *when* re-link flow, *then* file picker → fingerprint mismatch shows explicit warning ("different file — replace or keep?"); never silent-swap.
- *Given* no FSA support (Firefox), *when* reopen, *then* picker-fallback path works (same fingerprint contract).

**US-2.4.3** As a user with many projects, storage behaves.
- *Given* projects total > quota or blob cache > 500 MB, *when* save, *then* least-recently-opened blob caches evicted first (project JSON + peaks never evicted; media re-link covers it); status surfaces estimate via `navigator.storage.estimate()`.
- *Given* project deleted, *when* confirmed (toast-undoable, product rule), *then* all stores' rows purged.

## Functional Requirements

- **FR-106.1** `state/services/persistence.ts`: stores `projects` (`{id, schemaVersion, name, updatedAt, project, peaks, panelState}`), `mediaHandles` (`{projectId, handle?, fingerprint}`), `blobCache` (`{projectId, blob, bytes, lastOpened}`); `idb` transactions; no direct IDB calls outside this module.
- **FR-106.2** Autosave policy: command-count ≥ 1 pending ∧ idle 2 s ∧ not already in-flight; save-state indicator in status bar (unit-101 seam); `⌘S` forces immediate.
- **FR-106.3** Migration framework: `MIGRATIONS: Record<v, up>`, unknown-future version → read-only mode + notice (never write over newer schema); v1 baseline migration = identity + test.
- **FR-106.4** Fingerprint: `MediaFingerprint` (architecture) — stored on import; re-link compares it field by field.
- **FR-106.5** Project list UI (Media tab): open/new/duplicate/delete, sort by updated, storage estimate display, "Open project" from list restores selection/playhead context.
- **FR-106.6** Export/import of project file (`.zipscribe.json` — canonical project JSON incl. translation tracks + fingerprint, no media) for backup/share; drag-in to open (also seeds future share-links).
- **FR-106.7** Request `navigator.storage.persist()` when the user saves their first project or makes a model available offline (and on install — unit-204); show the result honestly in the storage display, never as a blocking prompt.
- **FR-106.8** Fingerprint comes from unit-04 (`MediaAsset.fingerprint`, computed in the media worker) — this unit stores and compares it, never recomputes it on the main thread.

## Completion Criteria

- [ ] **CC-106.1** Byte-equal reload golden (project incl. peaks+settings; exclusion list documented) after autosave
- [ ] **CC-106.2** Interrupted-transcription reopen state test (fake worker mid-stream unload)
- [ ] **CC-106.3** Racing-save atomicity + torn-write (fail-at-each-step injection) tests
- [ ] **CC-106.4** Re-link flows: silent handle restore, permission-denied picker fallback, fingerprint mismatch warning (all three, playwright with stubbed FSA)
- [ ] **CC-106.5** Quota eviction LRU order + "JSON never evicted" assertion (quota mocked)
- [ ] **CC-106.6** `.zipscribe.json` export→import round-trip byte-equal
- [ ] **CC-106.7** All gates green

## Risks

- Safari IDB eviction under pressure → `persisted()` request + "pin project" action (star) surfacing `navigator.storage.persist()` result honestly.

## Docs to consult

- idb: https://github.com/jakearchibald/idb · MDN File System Access API + storage estimate · zip-captions catalog/checksum conventions (prior art)
