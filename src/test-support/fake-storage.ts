// Storage doubles: in-memory stand-ins for IndexedDB-backed project storage
// and the Cache API (model/wasm caching) — never the real stores in tests.

export interface FakeKvStore {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  keys(): string[]
}

export function createFakeKvStore(initial: Record<string, string> = {}): FakeKvStore {
  const backing = new Map(Object.entries(initial))
  return {
    get: (key) => backing.get(key),
    set: (key, value) => {
      backing.set(key, value)
    },
    delete: (key) => {
      backing.delete(key)
    },
    keys: () => [...backing.keys()],
  }
}

export interface FakeCache {
  match(key: string): Promise<Response | undefined>
  put(key: string, body: Uint8Array): Promise<void>
  delete(key: string): Promise<boolean>
}

export function createFakeCache(): FakeCache {
  const backing = new Map<string, Uint8Array>()
  return {
    match: (key) => {
      const hit = backing.get(key)
      return Promise.resolve(hit === undefined ? undefined : new Response(hit as BodyInit))
    },
    put: (key, body) => {
      backing.set(key, body)
      return Promise.resolve()
    },
    delete: (key) => Promise.resolve(backing.delete(key)),
  }
}
