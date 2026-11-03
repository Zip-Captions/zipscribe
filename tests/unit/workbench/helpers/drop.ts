// Drop simulation for jsdom: it ships no constructable `DataTransfer`, so the
// drop event is assembled manually (files + items with getAsFile) — the
// contract is the `dataTransfer.files` iteration the intake service consumes.
export function dispatchDrop(target: Element, files: readonly File[]): void {
  const dataTransfer = {
    files,
    items: files.map((file) => ({ kind: 'file' as const, type: file.type, getAsFile: () => file })),
    dropEffect: 'copy' as const,
  }
  const dragover = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(dragover, 'dataTransfer', { value: dataTransfer })
  target.dispatchEvent(dragover)
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
  target.dispatchEvent(drop)
}
