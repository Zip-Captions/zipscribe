// Save flow (FR-202.6, unit-202): showSaveFilePicker preferred, anchor
// download fallback. Streaming: the blob's stream is piped straight into the
// handle's writable (no main-thread buffer copy; Blobs are browser-managed,
// often disk-backed — the "hold the whole MP4 in memory" risk is mitigated
// by never holding a second copy, recorded as a deviation note).
// Last-dir memory uses FilePickerOptions.id: Chromium persists the directory
// per id natively — handle-in-settings would require a persistence-schema
// change (settings are JSON) — recorded in the unit report.
// SECURITY-03: only filenames flow through here, never transcript content.

interface FilePickerLike {
  (opts: unknown): Promise<FileSystemFileHandle>
}

export interface SaveDeps {
  /** Injected for L1 determinism; defaults to globals. */
  picker?: FilePickerLike | undefined
  createObjectUrl?: (blob: Blob) => string
  revokeObjectUrl?: (url: string) => void
}

export interface SaveResult {
  saved: boolean
  fileName: string
  via: 'picker' | 'download' | 'cancelled'
}

export async function saveBlob(blob: Blob, fileName: string, mime: string, deps: SaveDeps = {}): Promise<SaveResult> {
  // File System Access API: present in Chromium; absent types in lib.dom —
  // accessed structurally.
  const globalPicker = typeof window !== 'undefined' ? (window as unknown as { showSaveFilePicker?: FilePickerLike }).showSaveFilePicker : undefined
  const picker = deps.picker ?? globalPicker
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: fileName,
        id: 'zip-export',
        types: [{ description: fileName, accept: { [mime.split(';')[0] ?? mime]: [] } }],
      })
      const writable = await handle.createWritable()
      await blob.stream().pipeTo(writable)
      return { saved: true, fileName, via: 'picker' }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { saved: false, fileName, via: 'cancelled' }
      // picker present but failed (permissions etc.) — fall through to download
    }
  }
  const createUrl = deps.createObjectUrl ?? ((b: Blob) => URL.createObjectURL(b))
  const revoke = deps.revokeObjectUrl ?? ((u: string) => URL.revokeObjectURL(u))
  const url = createUrl(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    revoke(url)
  }, 60_000)
  return { saved: true, fileName, via: 'download' }
}
