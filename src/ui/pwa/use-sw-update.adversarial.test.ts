// ADVERSARY (unit-204, category: update-flow races) — `useSwUpdate`
// (FR-204.4 / US-204.4) at its hook seam. The frozen e2e
// (e2e/pwa/update.spec.ts) pins the single-update stories (toast → click
// flushes autosave → reload; Later parks the worker). This file probes the
// sequences the contract allows that the e2e does not reach:
//
//   • a SECOND deployment's waiting worker after "Later" — US-204.4 line 32:
//     "Given a new deployment, when the new SW is waiting, then a toast …
//     appears." workbox-window fires `waiting` (isUpdate: true) per newly
//     waiting worker (https://developer.chrome.com/docs/workbox/modules/
//     workbox-window/#when-an-updated-version-of-the-service-worker-is-found),
//     so a tab open across deploy B (dismissed) and deploy C must toast again.
//   • the settle gate (design.md:95 "Update toast surfaces only after autosave
//     flush"): toast hidden while a save is in flight, shown once settled.
//   • the Reload click ORDER: saveNow('manual') must COMPLETES before the
//     unregister+reload swap (US-204.4 "flushes autosave, then … reload").
//
// Seam: `./register` is mocked so getPwaWorkbox returns a fake EventTarget —
// the same surface (addEventListener/removeEventListener + 'waiting' /
// 'controlling' events) the real Workbox class exposes.
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { act, createElement } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { PersistenceService, SaveOutcome, SaveStateName } from '../../state/services/persistence'
import { useSwUpdate, type SwUpdateState } from './use-sw-update'

let fakeWorkbox: EventTarget | undefined
vi.mock('./register', () => ({
  getPwaWorkbox: () => fakeWorkbox,
}))

function emitWaiting(isUpdate: boolean): void {
  // workbox-window's WorkboxLifecycleWaitingEvent carries isUpdate ON the
  // event object (docs, WorkboxLifecycleWaitingEvent properties).
  fakeWorkbox?.dispatchEvent(Object.assign(new Event('waiting'), { isUpdate }))
}

interface FakePersistence {
  service: PersistenceService
  calls: string[]
  setSaveState(state: SaveStateName): void
}

function makePersistence(initial: SaveStateName): FakePersistence {
  const listeners = new Set<() => void>()
  let current: SaveStateName = initial
  const calls: string[] = []
  const service = {
    getSaveState: () => ({ state: current, lastSavedAt: null, errorCode: null }),
    subscribeSaveState: (cb: () => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    saveNow: async (): Promise<SaveOutcome> => {
      calls.push('saveNow:start')
      await new Promise((resolve) => setTimeout(resolve, 20))
      calls.push('saveNow:done')
      return 'saved'
    },
  } as unknown as PersistenceService
  return {
    service,
    calls,
    setSaveState(state: SaveStateName): void {
      current = state
      listeners.forEach((cb) => cb())
    },
  }
}

function mount(persistence: PersistenceService | undefined): () => SwUpdateState {
  let latest: SwUpdateState = { visible: false, applyUpdate: () => undefined, dismiss: () => undefined }
  function Harness(): null {
    latest = useSwUpdate(persistence)
    return null
  }
  render(createElement(Harness))
  return () => latest
}

function flush(times = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, times))
}

// React 19 `act`, awaited through an async arrow (the hooks' own awaits
// settle inside the act scope).
async function actFlush(fn: () => void): Promise<void> {
  await act(async () => {
    fn()
    await flush()
  })
}

describe('FR-204.4 / US-204.4: useSwUpdate adversarial sequences', () => {
  beforeEach(() => {
    fakeWorkbox = new EventTarget()
  })

  test('ADVERSE SWU.1 (survived): a first-install waiting worker (isUpdate false) never toasts', async () => {
    const status = mount(undefined)
    emitWaiting(false)
    await flush()
    expect(status().visible, 'first install is not an update — no toast (US-204.4)').toBe(false)
  })

  test('ADVERSE SWU.2: "Later" then a NEW deployment must toast again', async () => {
    const status = mount(undefined)
    // Deploy B parks a waiting worker → toast.
    emitWaiting(true)
    await flush()
    expect(status().visible, 'the first waiting update surfaces the toast (US-204.4)').toBe(true)

    // User ignores it.
    await actFlush(() => {
      status().dismiss()
    })
    expect(status().visible, 'Later hides the toast; the worker stays parked').toBe(false)

    // Deploy C while the tab stays open: workbox-window fires `waiting`
    // (isUpdate true) again for the newer waiting worker.
    emitWaiting(true)
    await flush()
    expect(
      status().visible,
      'US-204.4 line 32: "Given a new deployment, when the new SW is waiting, then a toast … appears" — a dismissed earlier toast must not silence the NEW waiting worker forever',
    ).toBe(true)
  })

  test('ADVERSE SWU.3 (survived): the toast waits for an in-flight autosave, then appears', async () => {
    const persistence = makePersistence('saving')
    const status = mount(persistence.service)
    emitWaiting(true)
    await flush()
    expect(status().visible, 'update found while autosave pending — no toast mid-save (design.md:95)').toBe(false)

    persistence.setSaveState('saved')
    await flush()
    expect(status().visible, 'once the save settles the toast surfaces').toBe(true)
  })

  test('ADVERSE SWU.4 (survived): Reload click flushes the autosave to completion BEFORE the swap+reload', async () => {
    const calls: string[] = []
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        reload: () => calls.push('reload'),
      },
    })
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: () =>
          Promise.resolve({
            unregister: () => {
              calls.push('unregister')
              return Promise.resolve()
            },
          }),
      },
    })
    const persistence = makePersistence('idle')
    const persistenceCalls = persistence.calls
    // Share one ordered log between the persistence double and the SW stubs.
    const status = mount(persistence.service)
    emitWaiting(true)
    await flush()
    expect(status().visible).toBe(true)

    await actFlush(() => {
      status().applyUpdate()
    })
    await new Promise((resolve) => setTimeout(resolve, 600))

    // Ordered witness: saveNow must start AND complete before unregister,
    // and unregister before reload (US-204.4 "flushes autosave, then …").
    expect(persistenceCalls, 'the click flushes via saveNow').toEqual(['saveNow:start', 'saveNow:done'])
    expect(calls[0], 'unregister happens only after the flush completed').toBe('unregister')
    expect(calls[calls.length - 1], 'reload is the last step').toBe('reload')
  })
})
