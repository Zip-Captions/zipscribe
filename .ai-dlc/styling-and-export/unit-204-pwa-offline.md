---
status: pending
phase: mvp
discipline: frontend
depends_on: [unit-200-style-export-offline-design, unit-202-export, local-transcribe-engine/unit-03-model-manager, caption-studio-ui/unit-106-persistence]   # unit-203 deliberately NOT a dependency: 204 verifies against `vite preview` of the production build and self-provides the sw/manifest _headers entries (FR-204.6); deployed-header assertions on Cloudflare stay in unit-203 (phase: production)
workflow: tdd
mode: HITL   # service workers are easy to get subtly wrong and hard to roll back on users' machines
---

# Unit 204: Installable Offline PWA

## Description

Turn the deployed app into an installable Progressive Web App that works offline after the first visit: web app manifest + icons, a Workbox service worker (vite-plugin-pwa) that precaches the app shell and serves runtime wasm cache-first, an "Offline models" panel over unit-03's offline API, an install entry, update-available flow, offline indicator, persistent-storage request, and OS file handling ("Open with Zipscribe") on Chromium desktop. Product rules 6–7 (`knowledge/product.md`); interaction spec in `knowledge/design.md` § Offline & install; visuals from unit-200.

## User Stories

**US-204.1** As a user, I can install Zipscribe like an app.
- *Given* the production build served over HTTPS, *when* Chrome evaluates it, *then* `Page.getInstallabilityErrors` (CDP) returns none: manifest has `name`, `short_name`, `id: "/"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `theme_color`/`background_color` from tokens (`#0d0f12`), icons 192 + 512 (`any`) and 512 `maskable`, `description`, wide + narrow `screenshots`, and no `prefer_related_applications`.
- *Given* `beforeinstallprompt` fired, *when* the user picks ⋯ → "Install app", *then* the deferred prompt is shown and the entry disappears after `appinstalled` or when running in `display-mode: standalone`; *given* Safari, *then* the entry shows Add-to-Dock / Add-to-Home-Screen instructions instead; *given* neither, *then* no entry (never a broken button).

**US-204.2** As a user who visited once, the app opens and works offline.
- *Given* one online visit (SW installed and activated), *when* the network is disabled and the page reloaded, *then* the app shell loads from cache, the project list and an existing project open from IndexedDB, edits autosave, sidecar export downloads, and burn-in export runs (lazy chunks precached).
- *Given* offline and a model marked offline-ready, *when* Transcribe runs, *then* it completes with zero network requests; *given* offline and the model not cached, *then* the transcribe popover shows the `OFFLINE_MODEL_MISSING` state immediately (no spinner) and suggests "Make available offline" for next time.
- *Given* offline, *when* rendered, *then* the `Offline` chip shows next to the tier chip with a tooltip listing what works; it disappears on reconnect.

**US-204.3** As a user preparing for a trip, I manage offline models.
- *Given* ⋯ → "Offline models", *when* opened, *then* it lists registry models with size, offline-ready state, verified date, total usage and quota (`navigator.storage.estimate()`), and the persistence state; "Make available offline" downloads + verifies via `ensureOffline` (with the > 100 MB confirmation), "Remove" frees it via `removeCached`; "Keep data on this device" calls `navigator.storage.persist()` and shows the real result.
- *Given* translation is available (Chrome/Edge desktop), *when* the panel lists translation language packs, *then* it shows each pair's availability as reported by the browser (download via user gesture; removal is managed by the browser — say so).

**US-204.4** As a user, updates never lose my work.
- *Given* a new deployment, *when* the new SW is waiting, *then* a toast "New version ready — Reload" appears; clicking it flushes autosave, then `skipWaiting` + reload; ignoring it keeps the old version until all tabs close. Never auto-reloads.
- *Given* a schema bump in the new version, *when* it first opens a project, *then* unit-106 migrations run; an older tab still open sees the newer schema → read-only notice (unit-106 FR-106.3).

**US-204.5** As a user with the app installed (Chromium desktop), I open files straight from my OS.
- *Given* `file_handlers` in the manifest for every video and audio extension in `knowledge/architecture.md` § Supported media (incl. `.m4a .m4b .aac .flac .ogg .oga .opus .weba .mka .aiff .aif .wma .amr .3gp .caf`), caption files (`.srt .vtt .sbv .ttml .ass`) and `.zipscribe.json`, and `launch_handler: { client_mode: "focus-existing" }`, *when* a file is opened with Zipscribe, *then* `window.launchQueue` delivers it to the same import flow as drag-and-drop (unit-101/104/106); unsupported browsers simply don't register handlers.

## Functional Requirements

- **FR-204.1** `vite-plugin-pwa@2` with `registerType: 'prompt'`, `injectRegister: false` (we register in `ui/pwa/register.ts` via `workbox-window`), `devOptions.enabled: false` (no SW in `pnpm dev`), manifest generated from `pwa.config.ts`; icons generated by `@vite-pwa/assets-generator` from unit-200's SVG source.
- **FR-204.2** Workbox strategy (`generateSW` unless a custom handler is needed — then `injectManifest`):
  - precache: `index.html`, hashed JS/CSS (incl. lazy worker, mediabunny, export, ffmpeg-loader chunks), bundled font subsets, icons, sample clip;
  - runtime `CacheFirst` for `/wasm/*` (versioned paths; cache `zipscribe-wasm`, max 10 entries) — ffmpeg core and engine-B/C wasm cached on first use, not precached (size);
  - **bypass** model hosts entirely (no SW caching of HF requests — unit-03's verified cache owns models; double-caching multi-hundred-MB files is forbidden);
  - `navigateFallback: '/index.html'`, denylist `/wasm/`, `/assets/` (assets fail loudly instead of returning HTML).
- **FR-204.3** Precache budget: total precache ≤ 15 MB; build fails above it (check alongside `check-bundle`); each file ≤ 25 MiB (Cloudflare Pages limit).
- **FR-204.4** `ui/pwa/`: `useInstallPrompt`, `useOnlineStatus` (`navigator.onLine` + `online/offline` events + model-host fetch failures from `jobs` errors), `useSwUpdate`, `OfflineModelsPanel`, `launchQueue` consumer.
- **FR-204.5** Persistent storage: request on install (`appinstalled`), on first "Make available offline", and from the panel button; never on page load without user action.
- **FR-204.6** Manifest + SW served `no-cache`: this unit self-provides the `public/_headers` entries for `/sw.js` and `/manifest.webmanifest` (the subset of unit-203 FR-203.1 it owns; unit-203 later extends the same file for `/assets/*`, `/wasm/*` and CSP) and verifies them against the `vite preview` server in e2e; deployed-header assertions on Cloudflare remain unit-203 `[DEPLOY]` (CC-203.8). SW scope `/`.
- **FR-204.7** Kill switch: shipping a `sw.js` that unregisters itself and clears caches is documented in `docs/ops/sw-kill-switch.md` (this unit) as the emergency rollback for a broken SW; unit-203's `docs/RELEASE.md` links it when it lands.

## Technical Specification

- New deps (pre-approved in `settings.yml approved_dependencies`): `vite-plugin-pwa`, `workbox-window`, `@vite-pwa/assets-generator`.
- E2E runs against `vite preview` of the production build (SW disabled in dev); Playwright `serviceWorkers: 'allow'`; offline via `context.setOffline(true)`; installability via `page.context().newCDPSession(page)` → `Page.getInstallabilityErrors` and `Page.getAppManifest` (experimental CDP — pin behaviour in test helper).
- Initial JS budget: `workbox-window` counts toward the 350 KB gzip budget.

## Completion Criteria

- [ ] **CC-204.1** Installability: zero CDP installability errors; manifest field assertions (incl. maskable icon, screenshots, file_handlers) pass
- [ ] **CC-204.2** Offline e2e (US-204.2): shell, project open, edit + autosave, sidecar export, burn-in export, offline-ready transcription (tiny model, mocked or real per CI tier), `OFFLINE_MODEL_MISSING` fast-fail
- [ ] **CC-204.3** Request audit offline run: zero network attempts except none-cached model attempts that are short-circuited before fetch
- [ ] **CC-204.4** SW update e2e: deploy build A → open → build B → toast → reload after autosave flush; no reload without click
- [ ] **CC-204.5** SW never stores model-host responses (cache inspection test); precache ≤ 15 MB enforced
- [ ] **CC-204.6** Offline models panel: ensure/remove/persist flows tested (mocked storage APIs + one real Chromium run)
- [ ] **CC-204.7** `launchQueue` file-open test (Chromium; simulated `launchQueue` in test)
- [ ] **CC-204.8** All gates green incl. `pnpm test:e2e`

## Risks

- **Stale SW / broken deploy reaches users' machines** → prompt-based updates, `no-cache` on `sw.js`, kill-switch runbook (FR-204.7), HITL review of the Workbox config.
- **Storage eviction** (non-persisted origins, Safari's 7-day script-storage cap for non-installed sites) → persist request, install encouragement in the panel copy, re-link flow (unit-106) for media.
- **CDP installability API is experimental** → isolate in one helper; fall back to manifest-field assertions if it changes.

## Boundaries

- Web Share Target, window-controls-overlay, background sync/periodic sync, push: seeds or out of scope (no server).
- Model caching/verification itself: unit-03. Storage schema/migrations: unit-106. Full deployed headers/CSP + CD on Cloudflare: unit-203 (phase: production) — this unit only self-provides the `sw.js`/manifest `no-cache` header entries (FR-204.6).

## Docs to consult

- vite-plugin-pwa: https://vite-pwa-org.netlify.app/ (scrape into docs-mcp at unit start) · Workbox 7 strategies · install criteria: https://web.dev/articles/install-criteria · manifest `file_handlers` / `launch_handler`: MDN · CDP `Page.getInstallabilityErrors`
