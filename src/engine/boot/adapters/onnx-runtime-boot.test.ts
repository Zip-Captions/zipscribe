import { describe, expect, test } from 'vitest'
import { bootRuntime, configureOnnxRuntime, ORT_WASM_FILE, resolveWasmUrl, warmRuntimeWasm, WASM_PATHS } from './onnx-runtime-boot'
import type { OnnxWasmTarget } from './onnx-runtime-boot'

describe('onnx runtime boot config (FR-1.0.9)', () => {
  test('points wasmPaths at /wasm/ with a single thread', () => {
    const target: OnnxWasmTarget = { backends: { onnx: { wasm: {} } } }
    configureOnnxRuntime(target)
    expect(target.backends.onnx.wasm?.wasmPaths).toBe('/wasm/')
    expect(target.backends.onnx.wasm?.numThreads).toBe(1)
  })

  test('resolves the ORT wasm URL the way ORT composes it (file under wasmPaths)', () => {
    expect(resolveWasmUrl('https://app.example')).toBe(`https://app.example/wasm/${ORT_WASM_FILE}`)
    expect(resolveWasmUrl('http://127.0.0.1:4178', '/wasm/', 'ort.wasm')).toBe('http://127.0.0.1:4178/wasm/ort.wasm')
    expect(WASM_PATHS).toBe('/wasm/')
  })

  test('warm-up fetches the wasm same-origin and succeeds', async () => {
    const seen: string[] = []
    const error = await warmRuntimeWasm({
      origin: 'http://127.0.0.1:4178',
      fetchImpl: ((input: string | URL) => {
        seen.push(String(input))
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
      }) as typeof fetch,
    })
    expect(error).toBeNull()
    expect(seen).toEqual([`http://127.0.0.1:4178/wasm/${ORT_WASM_FILE}`])
  })

  test('warm-up reports a coded error (never content) on a bad status', async () => {
    const error = await warmRuntimeWasm({
      origin: 'http://127.0.0.1:4178',
      fetchImpl: () => Promise.resolve(new Response('missing', { status: 404 })),
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('NETWORK')
    expect(error?.retryable).toBe(true)
  })

  test('warm-up reports a coded error on fetch failure', async () => {
    const error = await warmRuntimeWasm({
      origin: 'http://127.0.0.1:4178',
      fetchImpl: () => Promise.reject(new Error('offline')),
    })
    expect(error?.code).toBe('NETWORK')
  })

  test('bootRuntime configures the env and warms without throwing', async () => {
    const calls: string[] = []
    expect(() =>
      bootRuntime({
        origin: 'http://127.0.0.1:4178',
        fetchImpl: ((input: string | URL) => {
          calls.push(String(input))
          return Promise.resolve(new Response(new Uint8Array([0]), { status: 200 }))
        }) as typeof fetch,
      }),
    ).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls.some((url) => url.endsWith(ORT_WASM_FILE))).toBe(true)
  })

  test('bootRuntime falls back to a local origin and the ambient fetch when not injected', async () => {
    // Node has a global fetch; `location` is absent here, exercising the
    // non-browser fallback branch. The ambient fetch to a local port simply
    // rejects — the coded error is swallowed by design.
    expect(() => bootRuntime({ origin: undefined, fetchImpl: undefined })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  // --- unit-204 flake fix (CC-204.2): the warm must never touch the wire
  // when the entry is cached (invariant 9) or when the SW process says the
  // network is down (renderer onLine can be stale-true at boot), and a
  // concurrent boot must share one seed fetch.

  test('CC-204.2: cached entry ⇒ warm is provably zero-network', async () => {
    const seen: string[] = []
    const error = await warmRuntimeWasm({
      origin: 'http://127.0.0.1:4178',
      fetchImpl: ((input: string | URL) => {
        seen.push(String(input))
        return Promise.resolve(new Response(new Uint8Array([1]), { status: 200 }))
      }) as typeof fetch,
      isOnline: () => true,
      cacheLookup: () => Promise.resolve(true),
    })
    expect(error).toBeNull()
    expect(seen).toEqual([])
  })

  test('CC-204.2: stale-true renderer onLine is overruled by an offline SW', async () => {
    const seen: string[] = []
    const error = await warmRuntimeWasm({
      origin: 'http://127.0.0.1:4178',
      fetchImpl: ((input: string | URL) => {
        seen.push(String(input))
        return Promise.resolve(new Response(new Uint8Array([1]), { status: 200 }))
      }) as typeof fetch,
      isOnline: () => true,
      cacheLookup: () => Promise.resolve(false),
      swOnline: () => Promise.resolve(false),
    })
    expect(error).toBeNull()
    expect(seen).toEqual([])
  })

  test('CC-204.2: concurrent boots share a single seed fetch', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const options: Parameters<typeof warmRuntimeWasm>[0] = {
      origin: 'http://127.0.0.1:4178',
      fetchImpl: async () => {
        calls += 1
        await gate
        return new Response(new Uint8Array([1]), { status: 200 })
      },
      isOnline: () => true,
      cacheLookup: () => Promise.resolve(false),
      swOnline: () => Promise.resolve(true),
    }
    const first = warmRuntimeWasm(options)
    const second = warmRuntimeWasm(options)
    release()
    expect(await first).toBeNull()
    expect(await second).toBeNull()
    expect(calls).toBe(1)
  })

  test('CC-204.2: a hung seed aborts at the deadline and reports a coded retryable error', async () => {
    const error = await warmRuntimeWasm({
      origin: 'http://127.0.0.1:4178',
      fetchImpl: ((input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          const abort = () => reject(new Error('aborted'))
          if (init?.signal) {
            if (init.signal.aborted) abort()
            else init.signal.addEventListener('abort', abort, { once: true })
          }
          void String(input)
        })) as typeof fetch,
      isOnline: () => true,
      cacheLookup: () => Promise.resolve(false),
      swOnline: () => Promise.resolve(true),
      timeoutMs: 20,
    })
    expect(error?.code).toBe('NETWORK')
    expect(error?.retryable).toBe(true)
  })
})
