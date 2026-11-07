// exportService seam (FR-102.7 signatures; unit-106/Intent-3 import only).
// Shapes frozen by tests/unit/editor/unit102-api-contract.d.ts §
// '@state/services/export'. The service is a thin correlation layer over the
// export worker port: one `export` request per `start`, jobId-filtered event
// delivery (unit-101 SM.1 precedent), idempotent `cancel`. The production
// provider (unit-106) constructs the real `ExportWorkerPort` over the worker
// registry; unit-102 ships the seam + scripted fake (FR-102.8,
// tests/unit/editor/helpers/fake-export-port.ts).
//
// Snapshot rule (domain § Project snapshot): the handed `ProjectSnapshot` is
// IMMUTABLE input — the request carries a deep copy, so post-start project
// edits can never reach the export. SECURITY-03: nothing here logs content.

import type { ProjectSnapshot } from '../../engine/model'
import type { ExportEvent, ExportRequest, ExportSettings } from '../../engine/protocol'

export interface ExportWorkerPort {
  postExport(request: ExportRequest): void
  onExportEvent(listener: (event: ExportEvent) => void): () => void
  dispose(): void
}

export interface ExportHandle {
  subscribe(cb: (event: ExportEvent) => void): () => void
  /** Posts the `cancel` request for the handle's jobId (idempotent). */
  cancel(): void
  readonly jobId: string
}

export interface ExportService {
  /** The snapshot is IMMUTABLE input: post-start project edits must never
   *  reach the export (domain § Project snapshot). */
  start(snapshot: ProjectSnapshot, file: File, settings: ExportSettings): ExportHandle
}

export function createExportService(deps: { engine: ExportWorkerPort; newJobId(): string }): ExportService {
  return {
    start(snapshot: ProjectSnapshot, file: File, settings: ExportSettings): ExportHandle {
      const jobId = deps.newJobId()
      const frozenSnapshot = structuredClone(snapshot)
      const subscribers = new Set<(event: ExportEvent) => void>()
      let cancelled = false

      deps.engine.postExport({ t: 'export', jobId, snapshot: frozenSnapshot, file, settings })
      const detach = deps.engine.onExportEvent((event) => {
        if (event.jobId !== jobId) return
        for (const listener of [...subscribers]) listener(event)
      })

      return {
        jobId,
        subscribe: (cb) => {
          subscribers.add(cb)
          return () => {
            subscribers.delete(cb)
          }
        },
        cancel: () => {
          if (cancelled) return
          cancelled = true
          detach()
          deps.engine.postExport({ t: 'cancel', jobId })
        },
      }
    },
  }
}
