// CC-101.1 (L1, node): the settings slice behind the workbench layout —
// minimum-size clamping, persistence of the CLAMPED value through the unit-106
// storage seam, hydration (missing/corrupt key → defaults, never throws),
// collapse toggling (Ctrl+Alt+2/3 targets) and theme. The component half of
// CC-101.1 is the frozen L2 suite tests/unit/workbench/workbench-shell.test.tsx.
import { describe, expect, test } from 'vitest'
import { createSettingsStore, MIN_SIDEBAR_PX, MIN_TIMELINE_PX, SETTINGS_STORAGE_KEY } from './settings'
import type { SettingsStorage } from './settings'

function createStorage(initial: Record<string, string> = {}): { storage: SettingsStorage; writes: { key: string; value: string }[] } {
  const backing = new Map(Object.entries(initial))
  const writes: { key: string; value: string }[] = []
  const storage: SettingsStorage = {
    get: (key) => Promise.resolve(backing.get(key) ?? null),
    set: (key, value) => {
      backing.set(key, value)
      writes.push({ key, value })
      return Promise.resolve()
    },
  }
  return { storage, writes }
}

describe('CC-101.1: settings slice — panel sizes, collapse, theme (US-2.0.1)', () => {
  test('CC-101.1: a fresh store starts at spec defaults (dark theme, panels at/above minimum, nothing collapsed)', async () => {
    const { storage } = createStorage()
    const settings = await createSettingsStore({ storage })
    const state = settings.getState()
    expect(state.theme, 'FR-2.0.5: dark default').toBe('dark')
    expect(state.collapsed).toEqual({ sidebar: false, timeline: false })
    expect(state.panels.sidebarPx).toBeGreaterThanOrEqual(MIN_SIDEBAR_PX)
    expect(state.panels.timelinePx).toBeGreaterThanOrEqual(MIN_TIMELINE_PX)
  })

  test('CC-101.1: setPanelSize clamps to the minimum and persists the CLAMPED value under the frozen key', async () => {
    const { storage, writes } = createStorage()
    const settings = await createSettingsStore({ storage })
    settings.setPanelSize('sidebar', 90)
    settings.setPanelSize('timeline', 10)
    expect(settings.getState().panels.sidebarPx).toBe(MIN_SIDEBAR_PX)
    expect(settings.getState().panels.timelinePx).toBe(MIN_TIMELINE_PX)

    const last = writes.at(-1)
    expect(last?.key, 'every setter persists through the unit-106 storage seam').toBe(SETTINGS_STORAGE_KEY)
    const persisted = JSON.parse(last?.value ?? '{}') as { panels?: { sidebarPx?: number; timelinePx?: number } }
    expect(persisted.panels?.sidebarPx, 'the rejected request never persists — the clamp does').toBe(MIN_SIDEBAR_PX)
    expect(persisted.panels?.timelinePx).toBe(MIN_TIMELINE_PX)
  })

  test('CC-101.1: setPanelSize accepts sizes at/above the minimum', async () => {
    const { storage } = createStorage()
    const settings = await createSettingsStore({ storage })
    settings.setPanelSize('sidebar', 420)
    settings.setPanelSize('timeline', MIN_TIMELINE_PX)
    expect(settings.getState().panels.sidebarPx).toBe(420)
    expect(settings.getState().panels.timelinePx).toBe(MIN_TIMELINE_PX)
  })

  test('CC-101.1: a fresh store hydrates the persisted sizes (reload keeps the layout)', async () => {
    const first = createStorage()
    const firstStore = await createSettingsStore({ storage: first.storage })
    firstStore.setPanelSize('sidebar', 500)
    const saved = first.writes.at(-1)?.value ?? ''

    const again = await createSettingsStore({ storage: createStorage({ [SETTINGS_STORAGE_KEY]: saved }).storage })
    expect(again.getState().panels.sidebarPx).toBe(500)
  })

  test('CC-101.1: corrupt persisted JSON hydrates defaults and never throws', async () => {
    const { storage } = createStorage({ [SETTINGS_STORAGE_KEY]: '{not json' })
    await expect(createSettingsStore({ storage })).resolves.toBeTruthy()
    const settings = await createSettingsStore({ storage })
    expect(settings.getState().panels.sidebarPx).toBeGreaterThanOrEqual(MIN_SIDEBAR_PX)
    expect(settings.getState().theme).toBe('dark')
  })

  test('CC-101.1: toggleCollapsed flips per region (Ctrl+Alt+2/3 targets) and persists', async () => {
    const { storage, writes } = createStorage()
    const settings = await createSettingsStore({ storage })
    settings.toggleCollapsed('sidebar')
    expect(settings.getState().collapsed.sidebar).toBe(true)
    settings.toggleCollapsed('sidebar')
    expect(settings.getState().collapsed.sidebar, 'the chord toggles back').toBe(false)
    settings.toggleCollapsed('timeline')
    expect(settings.getState().collapsed.timeline).toBe(true)
    expect(settings.getState().collapsed.sidebar, 'regions are independent').toBe(false)
    const persisted = JSON.parse(writes.at(-1)?.value ?? '{}') as { collapsed?: { timeline?: boolean } }
    expect(persisted.collapsed?.timeline).toBe(true)
  })

  test('CC-101.1: setTheme switches dark/light/system and persists (FR-2.0.5)', async () => {
    const { storage, writes } = createStorage()
    const settings = await createSettingsStore({ storage })
    settings.setTheme('system')
    expect(settings.getState().theme).toBe('system')
    const persisted = JSON.parse(writes.at(-1)?.value ?? '{}') as { theme?: string }
    expect(persisted.theme).toBe('system')
  })

  test('FR-2.0.6: subscribe notifies on mutation and the unsubscribe works', async () => {
    const { storage } = createStorage()
    const settings = await createSettingsStore({ storage })
    let notifications = 0
    const unsubscribe = settings.subscribe(() => {
      notifications += 1
    })
    settings.setTheme('light')
    expect(notifications).toBe(1)
    unsubscribe()
    settings.setTheme('dark')
    expect(notifications, 'unsubscribed listeners stop (zustand vanilla contract)').toBe(1)
  })
})
