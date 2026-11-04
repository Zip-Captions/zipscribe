// Workbench settings slice — panel sizes, collapse flags, theme.
//
// Shapes are the unit-101 frozen contract
// (tests/unit/workbench/unit101-api-contract.d.ts § @state/settings);
// unit-102 extends, never breaks. Persistence goes exclusively through the
// injected `SettingsStorage` seam (async so the unit-106 IDB adapter can
// replace it — the tests inject a fake over `createFakeKvStore`).
// zustand vanilla + immer per knowledge/conventions.md § State & commands
// (UI-only state, so no zundo history).

import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'

/** Persisted surface: async so the unit-106 IDB adapter can replace it; tests inject a fake over `createFakeKvStore`. */
export interface SettingsStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export const SETTINGS_STORAGE_KEY = 'zipscribe.settings.workbench'

/** Minimum panel sizes (US-2.0.1 "minimum panel sizes enforced"); `setPanelSize` clamps, never silently drops. */
export const MIN_SIDEBAR_PX = 240
export const MIN_TIMELINE_PX = 120

export interface PanelSizes {
  sidebarPx: number
  timelinePx: number
}

export interface WorkbenchSettings {
  panels: PanelSizes
  collapsed: { sidebar: boolean; timeline: boolean }
  /** FR-2.0.5: dark default; 'system' follows prefers-color-scheme only when the user never chose. */
  theme: 'dark' | 'light' | 'system'
}

export interface SettingsStore {
  getState(): WorkbenchSettings
  subscribe(listener: () => void): () => void
  /** Clamps to MIN_SIDEBAR_PX / MIN_TIMELINE_PX and persists the CLAMPED value. */
  setPanelSize(region: 'sidebar' | 'timeline', px: number): void
  /** Ctrl+Alt+2 / Ctrl+Alt+3 (design.md shortcut table) land here via the command registry. */
  toggleCollapsed(region: 'sidebar' | 'timeline'): void
  setTheme(theme: 'dark' | 'light' | 'system'): void
}

const DEFAULT_PANELS: PanelSizes = { sidebarPx: 320, timelinePx: 200 }

const DEFAULT_SETTINGS: WorkbenchSettings = {
  panels: { ...DEFAULT_PANELS },
  collapsed: { sidebar: false, timeline: false },
  theme: 'dark',
}

/**
 * SET.2 (adversary adjudication): the frozen contract words the clamp as
 * MIN-only, but US-2.0.1 "layout-boundedness" makes a panel size beyond any
 * real display as corrupt as NaN — the slice must bound it too. Upper bound
 * is viewport-derived when measurable (a panel can never exceed its
 * viewport axis), else a fixed cap documented as ~8K-display maximum for
 * non-browser hosts (node tests, SSR).
 */
const MAX_PANEL_PX = 8192

function upperBoundPx(region: 'sidebar' | 'timeline'): number {
  const min = region === 'sidebar' ? MIN_SIDEBAR_PX : MIN_TIMELINE_PX
  if (typeof window !== 'undefined') {
    const viewport = region === 'sidebar' ? window.innerWidth : window.innerHeight
    if (Number.isFinite(viewport) && viewport > 0) return Math.max(min, Math.round(viewport))
  }
  return Math.max(min, MAX_PANEL_PX)
}

function clampSize(region: 'sidebar' | 'timeline', px: number): number {
  const min = region === 'sidebar' ? MIN_SIDEBAR_PX : MIN_TIMELINE_PX
  if (typeof px !== 'number' || !Number.isFinite(px)) return DEFAULT_PANELS[`${region}Px` as keyof PanelSizes]
  return Math.min(upperBoundPx(region), Math.max(min, Math.round(px)))
}

/** SET.2: a persisted size beyond the bound is corruption — hydrate to the bounded default, not the clamped corrupt value. */
function hydrateSize(region: 'sidebar' | 'timeline', value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value > upperBoundPx(region)) {
    return DEFAULT_PANELS[`${region}Px` as keyof PanelSizes]
  }
  return clampSize(region, value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Missing key → defaults; corrupt JSON → defaults, never throws (contract § createSettingsStore). */
function hydrate(raw: string | null): WorkbenchSettings {
  if (raw === null) return structuredClone(DEFAULT_SETTINGS)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
  if (!isRecord(parsed)) return structuredClone(DEFAULT_SETTINGS)
  const panels = isRecord(parsed.panels) ? parsed.panels : {}
  const collapsed = isRecord(parsed.collapsed) ? parsed.collapsed : {}
  const sidebarPx = hydrateSize('sidebar', panels.sidebarPx)
  const timelinePx = hydrateSize('timeline', panels.timelinePx)
  const theme = parsed.theme === 'light' || parsed.theme === 'system' ? parsed.theme : 'dark'
  return {
    panels: { sidebarPx, timelinePx },
    collapsed: { sidebar: collapsed.sidebar === true, timeline: collapsed.timeline === true },
    theme,
  }
}

/** Hydrates from storage (missing key → defaults; corrupt JSON → defaults; a rejecting read → defaults — SET.4 (adversary adjudication): "never throws" is symmetric with the tolerated write failure, the unit-106 IDB adapter may transiently fail and a blank app is unacceptable). Persists on every setter. */
export function createSettingsStore(deps: { storage: SettingsStorage }): Promise<SettingsStore> {
  return deps.storage
    .get(SETTINGS_STORAGE_KEY)
    .catch(() => null)
    .then((raw) => {
      const store = createStore<WorkbenchSettings>()(immer(() => hydrate(raw)))
      const persist = (): void => {
        // Fire-and-forget: a storage failure must never break an interaction
        // (the next setter retries); the unit-106 adapter owns error reporting.
        void deps.storage.set(SETTINGS_STORAGE_KEY, JSON.stringify(store.getState())).catch(() => undefined)
      }
      return {
        getState: store.getState,
        subscribe: store.subscribe,
        setPanelSize(region: 'sidebar' | 'timeline', px: number): void {
          const size = clampSize(region, px)
          store.setState((state) => {
            if (region === 'sidebar') state.panels.sidebarPx = size
            else state.panels.timelinePx = size
          })
          persist()
        },
        toggleCollapsed(region: 'sidebar' | 'timeline'): void {
          store.setState((state) => {
            state.collapsed[region] = !state.collapsed[region]
          })
          persist()
        },
        setTheme(theme: 'dark' | 'light' | 'system'): void {
          store.setState((state) => {
            state.theme = theme
          })
          persist()
        },
      }
    })
}
