import { describe, expect, test } from 'vitest'
import { createWorker, registeredWorkerKinds } from './worker-registry'

describe('worker-registry (FR-1.0.2)', () => {
  test('registers exactly the four architecture workers', () => {
    expect(registeredWorkerKinds().sort()).toEqual(['asr', 'diarize', 'export', 'media'])
  })

  test('createWorker instantiates the worker bundle for a kind', () => {
    const created: unknown[] = []
    class FakeWorker {
      constructor() {
        created.push(this)
      }
    }
    globalThis.Worker = FakeWorker as unknown as typeof Worker
    try {
      const worker = createWorker('media')
      expect(created).toHaveLength(1)
      expect(worker).toBeInstanceOf(FakeWorker)
    } finally {
      delete (globalThis as { Worker?: typeof Worker }).Worker
    }
  })
})
