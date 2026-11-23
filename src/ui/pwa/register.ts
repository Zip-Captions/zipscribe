// FR-204.1 / FR-204.4 — the app-owned service-worker registration.
//
// `injectRegister: false` (pwa.config.ts): vite-plugin-pwa only GENERATES
// the SW + manifest; registration is ours via workbox-window — the update
// machinery the toast needs ('waiting' with isUpdate, messageSW
// SKIP_WAITING, 'controlling') lives on the Workbox class, and only
// workbox-window distinguishes a first install from an update (the
// `isUpdate` flag on installwaiting/waiting). API verified against the
// Workbox-window docs (https://developer.chrome.com/docs/workbox/modules/workbox-window/):
// register()/update() fire installwaiting → installed → waiting when the
// byte-compared /sw.js differs; messageSW posts to the WAITING worker while
// one is parked; 'controlling' fires when it takes over after SKIP_WAITING.
//
// registerType 'prompt' (design.md § Offline & install): the waiting worker
// NEVER self-activates; useSwUpdate's toast is the only skipWaiting path.
// `autoUpdate` keeps a real (1 h default) update poll alive — a tab open
// across a deployment still gets the toast (US-204.4).
//
// FR-204.5: persistent storage is requested on `appinstalled` (and from the
// panel / first "Make available offline") — NEVER on plain page load.
// The beforeinstallprompt event is captured here at boot (it must be
// captured when it fires, long before the ⋯ menu opens); useInstallPrompt
// consumes the deferred prompt.
//
// SECURITY-03: zero logging — registration failures are swallowed silently
// (an offline-capable shell is a progressive enhancement; the app is fully
// functional without the SW).

import { Workbox } from 'workbox-window'

let workbox: Workbox | undefined
let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false

/** The install-prompt capture state read by useInstallPrompt. */
export interface InstallPromptState {
  /** A real `beforeinstallprompt` was captured (Chromium install path). */
  canPrompt: boolean
  /** `appinstalled` already fired this session (the entry disappears). */
  installed: boolean
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function onInstallPrompt(event: Event): void {
  event.preventDefault() // defer — the ⋯ menu decides when to show it
  deferredPrompt = event as BeforeInstallPromptEvent
}

async function onAppInstalled(): Promise<void> {
  installed = true
  deferredPrompt = null
  try {
    const storage = globalThis.navigator?.storage
    if (storage !== undefined && typeof storage.persist === 'function') await storage.persist()
  } catch {
    // persist() rejection is honest absence (the panel renders the raw
    // result on the explicit button); never a boot failure.
  }
}

/**
 * Boot entry (App.tsx, production build only): registers `/sw.js` at scope
 * `/` (FR-204.6) and starts the install-prompt capture. Idempotent; safe
 * under any browser (missing APIs simply keep the entry hidden).
 */
export function registerPwaRuntime(): void {
  if (typeof window === 'undefined' || workbox !== undefined) return
  if (!import.meta.env.PROD) return // FR-204.1: no SW in `pnpm dev`
  window.addEventListener('beforeinstallprompt', onInstallPrompt)
  window.addEventListener('appinstalled', () => void onAppInstalled())
  workbox = new Workbox('/sw.js', { scope: '/', autoUpdate: true })
  void workbox.register().catch(() => undefined)
}

/** The registered Workbox instance (useSwUpdate subscribes to it); undefined
 *  until `registerPwaRuntime` has run (dev/jsdom). */
export function getPwaWorkbox(): Workbox | undefined {
  return workbox
}

/** Consume the deferred install prompt (⋯ → "Install app"). False when no
 *  prompt is pending (Safari / criteria unmet → the menu shows instructions
 *  or nothing instead). */
export async function promptInstall(): Promise<boolean> {
  if (deferredPrompt === null) return false
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  if (choice.outcome === 'accepted') deferredPrompt = null
  return true
}

export function installPromptState(): InstallPromptState {
  return { canPrompt: deferredPrompt !== null && !installed, installed }
}
