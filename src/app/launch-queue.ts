// CC-204.7 (US-204.5) — File Handling: the OS "open with" entry point.
//
// The manifest (vite-plugin-pwa `file_handlers`, CC-204.1's leg) registers
// the media types with the OS; Chromium delivers the chosen file(s) through
// the `launchQueue` LaunchParams consumer (MDN:
// https://developer.mozilla.org/en-US/docs/Web/API/LaunchQueue). We route
// each `getFile()` through the EXACT drop-zone path (`intake.handleFiles` →
// the FR-106.6 project route) so a launched file becomes a named project
// like any dropped one, then flush a manual save so the ProjectList row is
// durable — the same clean-on-attach the drop path gets from autosave,
// made immediate because a launch is a deliberate one-shot action.
//
// Boot tolerance (spec): engines without launchQueue must never throw —
// the guard reads the VALUE (not `in window`): Chromium's property can read
// undefined when unsupported, and any failure inside registration is
// swallowed (a broken consumer must not take the app down).
//
// SECURITY-03: the filename becomes the project name (user-visible by
// design) but is never logged.

import type { AppContext } from './context'

interface LaunchParamsLike {
  files?: { getFile(): Promise<File> }[]
}

let registered = false

export function registerLaunchQueue(context: AppContext): void {
  if (registered) return
  const queue = (globalThis as unknown as { launchQueue?: { setConsumer(consumer: (params: LaunchParamsLike) => void): void } }).launchQueue
  if (queue === undefined || typeof queue.setConsumer !== 'function') return
  registered = true
  try {
    queue.setConsumer((params) => {
      void consume(context, params).catch(() => {
        // A failed launch is announced by the intake path itself (reason
        // codes); here it must stay silent and harmless.
      })
    })
  } catch {
    // Registration raced something hostile — boot continues.
  }
}

async function consume(context: AppContext, params: LaunchParamsLike): Promise<void> {
  const entries = params.files ?? []
  if (entries.length === 0) return
  const files: File[] = []
  for (const entry of entries) {
    try {
      files.push(await entry.getFile())
    } catch {
      // A single unreadable launch file is skipped, not fatal.
    }
  }
  if (files.length === 0) return
  const before = context.editorApp.project.getState().project?.id ?? null
  await context.intake.handleFiles(files)
  // The probe reply is what lands the project (intake posts the probe and
  // returns; `createProject` runs in its media:probed listener). Wait for
  // it, then flush a save. The setProjectName(self) is not a rename — it
  // bumps `updatedAt` so the never-saved project counts as an accepted
  // change (clean-on-attach pins the first sighting as a baseline, and a
  // launch must produce its row without waiting on a user edit).
  const deadline = Date.now() + 10_000
  for (;;) {
    const landed = context.editorApp.project.getState().project
    if (landed !== null && landed.id !== before) {
      context.editorApp.project.setProjectName(landed.name)
      await context.persistence.saveNow('manual')
      return
    }
    if (Date.now() >= deadline) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
