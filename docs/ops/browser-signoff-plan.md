# Browser sign-off runbook (puppeteer MCP)

Purpose: turn the pending owner sign-offs into **captured evidence** so the owner reviews a
package instead of operating a browser. A fresh agent session executes this runbook top to
bottom with `bash` + the puppeteer MCP tools + file tools, then opens a docs-only PR with the
evidence pack and the recording blocks.

Sign-offs covered:

| ID  | Sign-off                                                | Where it is recorded                 |
| --- | ------------------------------------------------------- | ------------------------------------ |
| S1  | `CC-301.4` remaining offline legs (unit-301)            | `docs/overnight-reports/unit-301.md` |
| S2  | HITL flag (f) — Workbox update config (unit-204)        | `docs/overnight-reports/unit-204.md` |
| S3  | `CC-200.1–.4` design/contrast review package (unit-200) | `docs/overnight-reports/unit-200.md` |
| S4  | PWA install/offline spot-check list (unit-204)          | `docs/overnight-reports/unit-204.md` |

Hard rules (read before touching a tool):

1. `[MANUAL]` criteria boxes are **never** checked by the agent. You record
   `who / date / browser+version / result` lines; the owner signs. A `[MANUAL]` checkbox
   flipped by this run is a defect — leave it empty, always.
2. `e2e/**` and `tests/**` are frozen — this run never edits, adds, or "fixes" a test.
   Nothing you observe here may be responded to by editing anything except
   `docs/signoff-evidence/**` and the three unit reports' appendices.
3. SECURITY-03: logs, screenshots, result JSON, and report lines contain **no transcript or
   user content**. Use the placeholder seed sentences defined below; log codes and numbers.
   If an assertion needs a translation sample, log its length/code, not the text.
4. Work only inside the repo. Scratch (drivers, burners, staged roots) lives in `.night/`
   (gitignored). Kill every server you start; `git status` must be clean at exit except the
   intended `docs/` additions.
5. Never kill or reuse harness ports **4310 / 4315–4317** (Playwright's webServer/harness
   ports). This run owns **4321–4323** only.
6. If something is genuinely blocked (tool missing, browser lacks an API): record the leg as
   `BLOCKED: <reason>` in the results table and the ledger, continue the rest, and open the
   PR anyway. Never fabricate a PASS.

## §0 Session contract (unattended)

- No `question` tool; nothing that blocks on input.
- Read `.agent/AGENTS.md` first and follow it.
- Ambiguity → minimal interpretation + note it in the report block under `ASSUMPTIONS`.
- One ledger entry per item + a final one (`docs/overnight-ledger.md`, append-only,
  `## <utc> — SIGNOFF <id> (run) — actor: orchestrator`).

## §1 Preflight

```bash
git status --short                      # must be clean; if not, STOP, report, do not proceed
corepack pnpm build                     # production dist
corepack pnpm exec playwright --version # informational, log it
ls .cache/models                        # expect whisper-tiny-* (+ whisper-base-timestamped)
```

Browser selection (log which one you got):

1. `puppeteer_puppeteer_connect_active_tab` (debugPort 9222). Success ⇒ the owner's real
   Chrome — preferred ("Chrome desktop" per the checklist). Probe and log the version:
   ```js
   return (async () => JSON.stringify(await navigator.userAgentData.getHighEntropyValues(['fullVersion', 'platform'])))()
   ```
   Require **≥ 140**. The owner's Chrome must be signed-in profile-neutral for this run
   (nothing signs in; no personal data appears in evidence).
2. Fallback: plain `puppeteer_puppeteer_navigate` (MCP-managed Chrome). On the fallback,
   model packs re-download per profile (~5–30 s per pair on first gesture) and the viewport
   is 800×600 — see the picker-occlusion workaround (Appendix A.3).

Note both in every recording block (`browser: Chrome 158 (active-tab) | MCP-managed`).

Evidence pack:

```bash
mkdir -p docs/signoff-evidence/$(date +%F)
```

Name artifacts `s<item>-<nn>-<slug>.png` / `.json`. Every PASS row in the results table must
point at ≥ 1 artifact.

## §2 S1 — CC-301.4 remaining offline legs (unit-301)

Proves, with the preview server down and the app SW-cached, that translation keeps working
(models are browser-internal) and that no request is dispatched. The already-recorded legs
(gesture-download, progress 0–100, batches, cancel ≤ 500 ms, edit/stale/retranslate) are NOT
re-run here; only the two offline legs + the gap table.

1. Start the server: `nohup corepack pnpm preview -- --port 4321 --strictPort > .night/signoff-preview.log 2>&1 &` — `curl -sf http://127.0.0.1:4321/ -o /dev/null`.
2. Navigate `http://127.0.0.1:4321/?ziptest=1`; wait for `__zipEditorBridge` (evaluate poll, ≤ 20 s).
3. Seed the project — Appendix A.1 (48 placeholder blocks, project language `en`).
4. ONLINE pass: add the French track via the picker (Appendix A.3 workaround if MCP Chrome),
   wait `languages-status` → `Complete`, and confirm `getTranslationEntryCount('fr') === 48`.
   Screenshot the languages section. This warms Chrome's model cache for the offline legs.
5. Verify a first visit cached the shell: evaluate
   `!!(await navigator.serviceWorker.getRegistration())?.active` and
   `caches.keys()` includes the workbox precache name + `zipscribe-wasm`. JSON artifact.
6. **Offline leg** — kill the server (the only tool-available "network off"; state it in the
   recording): `lsof -ti :4321 | xargs kill`.
7. `location.reload()` (evaluate). Assert: `[data-testid="workbench-shell"]` visible (SW-served
   shell, no error page) AND `getEditorState().blockCount === 48` (IndexedDB restore).
   Screenshot.
8. Run the es track offline (add Spanish first if absent — the availability probe may cache;
   if the picker marks it `unavailable` without network, note it and use French-only).
   Poll `getTranslationEntryCount('es')` (or `'fr'` re-run with mode missing after
   `block-edit-text` on 5 blocks) until it grows and status hits `Complete`/`Partial`.
   **PASS = entries advanced with the server dead.** Screenshot the filled view.
9. Dispatch audit (offline window):
   ```js
   return JSON.stringify(
     performance
       .getEntriesByType('resource')
       .map((e) => e.name)
       .filter((n) => /huggingface|:4321/.test(n)).length,
   )
   ```
   Expect `0` added since boot after the offline window (boot-time entries from the ONLINE
   phase are listed with their count in the JSON — the assertion is: no NEW entries after the
   reload at step 7; capture the before/after counts).
10. `OFFLINE_MODEL_MISSING`-adjacent honesty check (S1 bonus, 2 min): with the server dead,
    the transcribe popover must NOT hang — quick presence check only (deep behaviour is
    e2e-covered). `BLOCKED:` if it requires a non-cached model + network to distinguish.

**Owner-only residue (record verbatim):** DevTools network-offline variant (true offline,
not just dead origin) and the `chrome://settings/language` models-off codes-only notice.
Both stay owner boxes, unchecked.

## §3 S2 — HITL flag (f): live Workbox update demo (unit-204)

Gives the owner a first-person witness of the FR-204.4 semantics implemented as
flush→unregister+reload: prompt-only toast, `Later` keeps the old SW controlling with no
reload, `Reload now` flushes autosave then swaps. The frozen e2e (`update.spec.ts`) already
asserts this; this section captures human-readable evidence.

1. Driver (the helper is TS with extensionless relative imports — Node 24 type-strips but
   won't resolve them; use this VERIFIED loader recipe):
   ```js
   // .night/signoff/ts-ext-loader.mjs
   export async function resolve(specifier, context, next) {
     try {
       return await next(specifier, context)
     } catch (e) {
       if (e.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
         for (const ext of ['.ts', '/index.ts']) {
           try {
             return await next(specifier + ext, context)
           } catch {
             /* next */
           }
         }
       }
       throw e
     }
   }
   // .night/signoff/register.mjs
   import { register } from 'node:module'
   register('./ts-ext-loader.mjs', import.meta.url)
   // .night/signoff/driver.mjs
   import { existsSync, rmSync } from 'node:fs'
   import { stageBuilds, startDualRootServer } from '../../e2e/pwa/helpers/dual-root-preview.ts'
   const { distA, distB } = stageBuilds()
   const srv = await startDualRootServer(4331, distA, distB)
   srv.deploy('a')
   const cmdB = `${distA}/../CMD-B`
   setInterval(() => {
     if (existsSync(cmdB)) {
       srv.deploy('b')
       rmSync(cmdB)
       console.log('deployed-b')
     }
   }, 500)
   console.log(JSON.stringify({ ready: 'http://127.0.0.1:4331/', cmdB }))
   process.stdin.resume()
   ```
   Launch: `nohup node --import ./.night/signoff/register.mjs .night/signoff/driver.mjs > .night/signoff-dual.log 2>&1 &`
   (run from repo root). Poll the log until `ready` appears; the log's `cmdB` path is the
   B-deploy trigger (`touch <cmdB>` from bash — same process flips the served root).
2. Navigate `http://127.0.0.1:4331/?ziptest=1`. Wait for SW controller:
   `!!(await navigator.serviceWorker.getRegistration())?.active` true; screenshot; witness
   build A: `!document.documentElement.outerHTML.includes('zipscribe-e2e-build-B')`.
3. Make a dirty edit (autosave-pending witness): Appendix A.1 seed, then
   `__zipEditorBridge.command('block-edit-text', { blockId: 'b0', text: 'PENDING SAVE MARKER 0001' })`
   (placeholder text — codes only).
4. Deploy B: `touch` the `cmdB` path printed by the driver log; then trigger an update check:
   ```js
   return (async () => {
     const r = await navigator.serviceWorker.getRegistration()
     await r.update()
     return 'updated'
   })()
   ```
5. Wait (≤ 60 s, poll) for `[data-testid="update-toast"]` visible. Screenshot. PASS-1:
   **toast appeared; page did NOT reload on its own** (still `PENDING SAVE MARKER 0001`
   visible in the DOM, witness still build A).
6. Click `Later` (Appendix A.4 button-by-text click). Wait ≥ 10 s. PASS-2: no reload
   (marker still A, pending text still present, `getEditorState().blockCount` unchanged);
   `getRegistration().waiting` non-null (parked worker — evaluate JSON).
7. Edit again (dirty: `block-edit-text b1 → 'FLUSH WITNESS 0002'`), then click `Reload now`.
   PASS-3: after reload — witness is build B (`outerHTML.includes('zipscribe-e2e-build-B')`),
   AND the edited text survives (`getEditorState()`/block query shows `FLUSH WITNESS 0002`
   — the autosave flush ran before the swap). Screenshot the reloaded app.
8. Write `docs/signoff-evidence/<date>/s2-results.json` with the PASS-1/2/3 booleans +
   timings, and reference it from the flag (f) recording block in unit-204's report:
   the flag itself stays the owner's to flip.
9. Kill the driver (`lsof -ti :4331 | xargs kill`) and `rm -r .night/signoff || true` (the
   helper's `close()` removes its own `.night/pwa-update-<pid>` staging when the process
   exits cleanly; sweep leftovers: `rm -r .night/pwa-update* || true`).

## §4 S3 — CC-200.1–.4 design review package (unit-200)

Pure capture; the judgment stays the owner's.

1. `nohup python3 -m http.server 4323 --directory .ai-dlc/styling-and-export/mockups > .night/signoff-mockups.log 2>&1 &`
2. Navigate `http://127.0.0.1:4323/review.html`.
3. Structure probe:
   ```js
   return JSON.stringify([...document.querySelectorAll('section, h1, h2, h3, figure')].slice(0, 80).map((e) => ({ tag: e.tagName, id: e.id || null, text: (e.textContent || '').slice(0, 40) })))
   ```
4. Capture the four groups — `presets/`, `export/`, `offline/`, `contrast/` (per the README's
   section headings): per-group screenshot via `puppeteer_puppeteer_screenshot` with the
   group's CSS selector; if a group is taller than the viewport, scroll in ≤ 800 px steps and
   capture viewport frames named `s3-<group>-<nn>.png`. Cross-check the count: probe
   `document.querySelectorAll('svg').length` ≥ 55 and log it.
5. Recording block in unit-204? No — **unit-200's report**: append
   `#### Evidence run (agent, puppeteer, <date>) — <browser>` listing every artifact and a
   final row per CC-200.1–.4: `evidence captured — owner sign-off pending` (boxes unchecked).
6. Kill the mockups server.

## §5 S4 — PWA install/offline spot-check list (unit-204)

Shallow human-readable confirmations (deep coverage stays with `e2e/pwa` on every PR).

1. Server: restart the 4321 preview (`§2` step 1). Navigate `/?ziptest=1` AFTER clearing SW
   for a clean read:
   ```js
   return (async () => {
     const rs = await navigator.serviceWorker.getRegistrations()
     for (const r of rs) await r.unregister()
     for (const k of await caches.keys()) await caches.delete(k)
     return 'cleared'
   })()
   ```
   then reload.
2. **Install entry**: best-effort `beforeinstallprompt` capture — right after the reload:
   ```js
   return (async () => {
     const got = new Promise((r) =>
       addEventListener(
         'beforeinstallprompt',
         (e) => {
           e.preventDefault()
           r(true)
         },
         { once: true },
       ),
     )
     const hit = await Promise.race([got.then(() => 'captured'), new Promise((r2) => setTimeout(() => r2('none'), 15000))])
     const menu = document.querySelector('[data-testid="pwa-menu-install"]')
     return JSON.stringify({ bip: hit, installItem: menu ? { present: true, disabled: menu.disabled } : { present: false } })
   })()
   ```
   PASS = install menu item present; `bip` either value recorded honestly (Chromium may
   require engagement; a real install is owner-only — state it).
3. **Manifest**:
   ```js
   return (async () => {
     const m = await (await fetch('/manifest.webmanifest')).json()
     return JSON.stringify({
       id: m.id,
       scope: m.scope,
       display: m.display,
       theme: m.theme_color,
       icons: m.icons.length,
       maskable: m.icons.some((i) => (i.purposes || []).includes('maskable')),
       screenshots: (m.screenshots || []).length,
       fileHandlers: (m.file_handlers || []).length,
       launchHandler: m.launch_handler?.route === 'focus-existing',
     })
   })()
   ```
   Expect: scope `/`, display `standalone`, theme `#0d0f12`, maskable ≥ 1, screenshots ≥ 2
   (wide+narrow), `file_handlers.length === 1` with `Object.keys(accept).length >= 8` incl.
   `video/mp4` + `audio/mpeg`, launchHandler true. JSON artifact.
4. **SW + chip**: registration active; `caches.keys()` includes `zipscribe-wasm`; chip hidden
   while healthy (`!document.querySelector('[data-testid="offline-chip"]')`). Screenshot.
5. **Chip-on-model-failure (app-level, disclose as such)**: install a fetch blocker BEFORE
   any model-host traffic, then force an online model-host attempt via the Offline models
   panel (`[data-testid="pwa-menu-offline-models"]` → click `Make available offline` on
   `whisper-base-timestamped` — > 100 MB confirm button `[data-testid="model-download-confirm-button"]`
   appears → confirm):
   ```js
   return (() => {
     const o = window.fetch
     window.__hfBlocked = 0
     window.fetch = (u, i) => {
       if (String(u).includes('huggingface.co')) {
         window.__hfBlocked++
         return Promise.reject(new TypeError('signoff-block'))
       }
       return o(u, i)
     }
     return 'blocked'
   })()
   ```
   After the failure surfaces: PASS = `[data-testid="offline-chip"]` present with the tooltip
   text (screenshot + codes). If the panel path never reaches the network (e.g. mirror hit
   first), record `N/A — mirror served` honestly; the authoritative latch test is
   `use-online-status.adversarial.test.ts` (unit) + `offline.spec.ts` (e2e) on CI.
6. Recording block appended to unit-204's report (rows: `PASS/FAIL/N-A/owner-only` per step,
   artifacts named), flag (f)/(a)/(b) text left untouched.
7. Kill the preview server.

## §6 Recording + PR

Per unit report, append (never overwrite; prettier-clean markdown — run
`corepack pnpm exec prettier --write` on the three reports at the end; CI L0 gates formatting):

```markdown
#### Sign-off evidence run (agent, puppeteer MCP, <YYYY-MM-DD>)

- who: agent session <id> via puppeteer MCP (browser: <version + target>)
- results: S1 <n>/<m> PASS · S2 PASS-1/2/3 <…> · S3 <n> artifacts · S4 <…>
- artifacts: docs/signoff-evidence/<date>/ (list)
- owner residue: <bullets from the residue tables>
- ASSUMPTIONS: <deviations, e.g. dead-origin as offline proxy, app-level block>
```

Then: ledger entries, `git add docs/signoff-evidence docs/overnight-reports && git commit
-m "docs(signoff): puppeteer evidence run S1–S4 (<date>) — owner sign-offs still pending"`,
branch `docs/signoff-evidence-<date>`, PR to `develop`, `gh pr checks --watch`, merge on
green (docs-only; a flake is NOT re-run silently — note it in the PR).

## §7 Exit check

Before declaring done:

- [ ] every PASS row ↔ ≥ 1 artifact file exists on disk;
- [ ] no `[MANUAL]` checkbox flipped anywhere (`git diff` review);
- [ ] `git diff develop -- e2e tests src` is empty;
- [ ] no stray processes (`lsof -i :4321 -i :4322 -i :4323 -i :4331` empty), `git status` clean;
- [ ] the run printed a **residual-owner-queue**: DevTools-offline + models-off (unit-301),
      flag (f)/(a)/(b) flips + Chrome-visual install (unit-204), design judgment CC-200.1–.5,
      gate-tail confirmations (unit-103 class), CC-02.10 licensing, Cloudflare-credential
      items (unit-203 / CC-I3.9) — each pointing at its report section.

## Appendix A — proven evaluate snippets

A.1 seed (placeholder content only — SECURITY-03):
see this repo's 2026-11-23 CC-301.4 run; canonical shape:
`{ id, start: i*2, end: i*2+1.5, text: words.join(' '), words: words.map(...) , speakerId: 'SPK_1' }`
with `words = ['placeholder','line','number',String(i),'signoff','probe']`, then
`__zipEditorBridge.openProjectWithMedia(asset, '/fixtures/audio/speech-2min.m4a')`,
`seedBlocks(blocks, [{ id:'SPK_1', label:'Speaker 1', color:'#4c8dff' }])`,
`setProjectLanguage('en')`. `asset` = the SIDECAR_ASSET shape from
`e2e/export/helpers/export-harness.ts` (id/name `clip.mp4`/kind audio/duration 119.888/
sampleRate 16000/fingerprint trio).

A.2 status observer (cancel/timing witness): MutationObserver on `document.body` pushing
`{ t: performance.now(), s: <languages-status text>, prog: <progress value/max>, live:
<languages-live text> }` into `window.__statusLog` on change.

A.3 picker occlusion workaround (MCP Chrome 800×600): a `transcript-issue` button overlays
the picker dropdown — raise the dropdown before clicking Add:
`const c = document.querySelector('[data-testid="languages-picker-item"][data-language="fr"]').parentElement; c.style.position='relative'; c.style.zIndex='99999'`
then `puppeteer_puppeteer_click` on
`[data-testid="languages-picker-item"][data-language="fr"] [data-testid="languages-picker-add"]`.
(The e2e masks this with `force:true`; the underlying stacking bug is already a backlog seed.)

A.4 toast button click by text (UpdateToast buttons have no testid):
`[...document.querySelectorAll('[data-testid="update-toast"] button')].find(b => b.textContent === 'Later').click()`
(same for `Reload now`).

A.5 cancel-window measurement (if re-measuring): click cancel via A.4-style lookup
(`[data-testid="languages-cancel"]`), set `t0 = performance.now()` immediately before, poll
5 ms until `languages-status` ∈ {`Cancelled`, `Partial`, `Complete`, `Failed`}, report
`Math.round(t1 - t0)`; PASS ≤ 500.

## Appendix B — tool limits (be honest in recordings)

- No CDP session via MCP ⇒ `Page.getInstallabilityErrors` stays CI-covered
  (`e2e/pwa/installability.spec.ts` every PR); no `context.setOffline` ⇒ dead-origin +
  performance-entry audits are the offline proxy (disclose per leg); no
  `addInitScript` ⇒ page-level interceptors are best-effort post-load (state it);
  no viewport resize (MCP Chrome fixed ~800×600); `chrome://` pages and real installs are
  owner-only.
- MCP-managed Chrome may be a fresh profile: model packs re-download on first gesture
  (~5–30 s per pair) — that is the gesture-gated path the checklist WANTS, so it is a
  feature there and neutral here.
