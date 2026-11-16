// FR-107.5 / CC-107.6 backing (L1, node): the `visualizer` settings slice —
// defaults { mode: 'spectrum', tintBySpeaker: true } (design.md § Audio
// projects), setter merge semantics, whole-blob persistence under the same
// key, and SET.2 corrupt-tolerant hydration (a corrupt visualizer object
// degrades to defaults, never throws). The settings live in the
// localStorage blob — NOT in project history (zundo partializes to {project}
// — frozen in history.ts; this suite pins the persisted copy round-trips).
import { describe, expect, test } from 'vitest'
import { createSettingsStore, SETTINGS_STORAGE_KEY } from '@state/settings'
import type { SettingsStorage } from '@state/settings'

type SettingsStoreT = Awaited<ReturnType<typeof createSettingsStore>>

function makeStorage(initial: Record<string, string> = {}): { storage: SettingsStorage; writes: { key: string; value: string }[] } {
  const backing = new Map(Object.entries(initial))
  const writes: { key: string; value: string }[] = []
  return {
    writes,
    storage: {
      get: async (key) => backing.get(key) ?? null,
      set: async (key, value) => {
        backing.set(key, value)
        writes.push({ key, value })
      },
    },
  }
}

async function makeStore(initial: Record<string, string> = {}): Promise<{ store: SettingsStoreT; writes: { key: string; value: string }[] }> {
  const { storage, writes } = makeStorage(initial)
  const store = await createSettingsStore({ storage })
  return { store, writes }
}

describe('CC-107.6/FR-107.5: visualizer settings slice', () => {
  test('CC-107.6: defaults are spectrum mode with tint-by-speaker on (design.md)', async () => {
    const { store } = await makeStore()
    expect(store.getState().visualizer).toEqual({ mode: 'spectrum', tintBySpeaker: true })
  })

  test('CC-107.6: setVisualizerPrefs merges partially and persists the whole blob', async () => {
    const { store, writes } = await makeStore()
    store.setVisualizerPrefs({ mode: 'waveform' })
    expect(store.getState().visualizer).toEqual({ mode: 'waveform', tintBySpeaker: true })
    store.setVisualizerPrefs({ tintBySpeaker: false })
    expect(store.getState().visualizer).toEqual({ mode: 'waveform', tintBySpeaker: false })
    const last = writes.at(-1)
    expect(last?.key).toBe(SETTINGS_STORAGE_KEY)
    expect(JSON.parse(last?.value ?? '{}').visualizer).toEqual({ mode: 'waveform', tintBySpeaker: false })
  })

  test('CC-107.6: corrupt visualizer payloads hydrate to defaults (SET.2 — never throws)', async () => {
    const corrupt = { [SETTINGS_STORAGE_KEY]: JSON.stringify({ panels: { sidebarPx: 300, timelinePx: 150 }, collapsed: { sidebar: false, timeline: false }, theme: 'dark', transcribe: { language: null, modelId: null, diarize: false }, visualizer: { mode: 'hologram', tintBySpeaker: 'yes' } }) }
    const { store } = await makeStore(corrupt)
    expect(store.getState().visualizer).toEqual({ mode: 'spectrum', tintBySpeaker: true })
    const corrupt2 = { [SETTINGS_STORAGE_KEY]: JSON.stringify({ visualizer: 42 }) }
    const store2 = (await makeStore(corrupt2)).store
    expect(store2.getState().visualizer).toEqual({ mode: 'spectrum', tintBySpeaker: true })
  })

  test('CC-107.6: a saved visualizer slice hydrates back', async () => {
    const saved = { [SETTINGS_STORAGE_KEY]: JSON.stringify({ visualizer: { mode: 'waveform', tintBySpeaker: false } }) }
    const { store } = await makeStore(saved)
    expect(store.getState().visualizer).toEqual({ mode: 'waveform', tintBySpeaker: false })
  })

  test('CC-107.6: subscribers are notified on visualizer changes', async () => {
    const { store } = await makeStore()
    let notified = 0
    const off = store.subscribe(() => {
      notified += 1
    })
    store.setVisualizerPrefs({ mode: 'waveform' })
    expect(notified).toBe(1)
    off()
    store.setVisualizerPrefs({ mode: 'spectrum' })
    expect(notified, 'no notification after unsubscribe').toBe(1)
  })
})
