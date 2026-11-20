// @vitest-environment jsdom
// FR-202.6 (L1): picker-preferred save with streaming writable, abort is a
// cancel (not a silent download), fallback anchor-download without picker.
import { describe, expect, test, vi } from 'vitest'
import { saveBlob } from '@ui/export/save-file'

const blob = new Blob(['hello'], { type: 'text/plain;charset=utf-8' })

describe('FR-202.6 save flow', () => {
  test('picker path: streams into the writable, returns picker', async () => {
    const chunks: Uint8Array[] = []
    const writable = {
      write: async (c: Uint8Array) => { chunks.push(c) },
      close: async () => undefined,
    } as unknown as FileSystemWritableFileStream
    const createWritable = vi.fn(async () => writable)
    const picker = vi.fn(async (_opts: unknown) => ({ createWritable }) as unknown as FileSystemFileHandle)
    // jsdom's Blob.stream lacks pipeTo pairing — inject the stream contract
    // directly (the production path pipes blob.stream() into the writable).
    const streamingBlob = { stream: () => ({ pipeTo: async (w: FileSystemWritableFileStream) => { await w.write(new TextEncoder().encode('hello')); await w.close() } }) } as unknown as Blob
    const out = await saveBlob(streamingBlob, 'notes.txt', 'text/plain', { picker })
    expect(out).toEqual({ saved: true, fileName: 'notes.txt', via: 'picker' })
    expect(createWritable).toHaveBeenCalled()
    const body = new TextDecoder().decode(chunks[0])
    expect(body).toBe('hello')
    const opts = picker.mock.calls[0]?.[0] as unknown as { suggestedName: string; id: string }
    expect(opts.suggestedName).toBe('notes.txt')
    expect(opts.id, 'Chromium per-id last-dir memory').toBe('zip-export')
  })

  test('picker AbortError ⇒ cancelled, never downloads', async () => {
    const picker = vi.fn(async () => { throw new Error('cancel') })
    picker.mockImplementation(async () => { const e = new Error('u'); e.name = 'AbortError'; throw e })
    const createObjectUrl = vi.fn()
    const out = await saveBlob(blob, 'x.txt', 'text/plain', { picker, createObjectUrl })
    expect(out.via).toBe('cancelled')
    expect(createObjectUrl).not.toHaveBeenCalled()
  })

  test('picker failure (non-abort) falls through to anchor download', async () => {
    const picker = vi.fn(async () => { throw new Error('SecurityError') })
    const urls: string[] = []
    const out = await saveBlob(blob, 'y.txt', 'text/plain', { picker, createObjectUrl: () => { urls.push('blob:y'); return 'blob:y' }, revokeObjectUrl: () => undefined })
    expect(out.via).toBe('download')
    expect(urls).toEqual(['blob:y'])
    expect(document.querySelector('a[download="y.txt"]')).toBeNull() // anchor removed after click
  })

  test('no picker ⇒ download path', async () => {
    const out = await saveBlob(blob, 'z.txt', 'text/plain', { picker: undefined, createObjectUrl: () => 'blob:z', revokeObjectUrl: () => undefined })
    expect(out).toEqual({ saved: true, fileName: 'z.txt', via: 'download' })
  })
})
