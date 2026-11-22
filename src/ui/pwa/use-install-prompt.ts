// FR-204.4 (unit-204) `useInstallPrompt` — the ⋯ menu's "Install app" entry
// state (US-204.1 / design.md § Offline & install).
//
// Three honest branches (never a broken button):
// - a captured `beforeinstallprompt` → the real deferred prompt (Chromium);
// - no prompt but Safari-family (no beforeinstallprompt API at all) → the
//   entry shows Add-to-Home-Screen / Add-to-Dock INSTRUCTIONS instead;
// - neither (e.g. Firefox, or criteria unmet in a non-Safari engine) → no
//   entry at all.
// The entry disappears after `appinstalled` or when already running in
// `display-mode: standalone` (US-204.1).

import { useEffect, useState } from 'react'
import { installPromptState, promptInstall } from './register'

export type InstallEntry = { kind: 'none' } | { kind: 'prompt' } | { kind: 'instructions' } | { kind: 'installed' }

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const media = window.matchMedia?.('(display-mode: standalone)')
  const iosStandalone = (globalThis.navigator as unknown as { standalone?: boolean }).standalone === true
  return media?.matches === true || iosStandalone === true
}

function isSafariFamily(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Safari/iu.test(ua) && !/Chrom/iu.test(ua) && /Apple/iu.test(ua)
}

export interface InstallPromptHook {
  entry: InstallEntry
  /** "Install app" click: shows the deferred prompt. False when there is no
   *  prompt to show (caller keeps instructions/none rendering). */
  install(): Promise<boolean>
}

export function useInstallPrompt(): InstallPromptHook {
  const [state, setState] = useState(installPromptState)

  useEffect(() => {
    const refresh = (): void => setState(installPromptState())
    window.addEventListener('beforeinstallprompt', refresh)
    window.addEventListener('appinstalled', refresh)
    return () => {
      window.removeEventListener('beforeinstallprompt', refresh)
      window.removeEventListener('appinstalled', refresh)
    }
  }, [])

  const entry: InstallEntry = (() => {
    if (state.installed || isStandalone()) return { kind: 'installed' }
    if (state.canPrompt) return { kind: 'prompt' }
    if (isSafariFamily()) return { kind: 'instructions' }
    return { kind: 'none' }
  })()

  return {
    entry,
    install: async () => promptInstall(),
  }
}
