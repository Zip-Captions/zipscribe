// CC-106.4 (L5, chromium): the relink paths on the production build against
// the REAL IndexedDB (`zipscribe`) — exercised through the builder-owned
// `?ziptest=1` persistence bridge (src/ui/testing/persistence-bridge.ts;
// absent until the builder ships it → the waitForFunction below is the
// intended RED). The File System Access surface is STUBBED deterministically
// (Playwright has no OS-level picker): `window.showOpenFilePicker` is
// replaced by an addInitScript that counts invocations in
// `window.__zipFsaAudit`, and stored handles are seeded as handle-likes built
// IN-PAGE (functions cannot cross the evaluate boundary). Same outcome
// vocabulary as the L3 contract runner (persistence.contract.test.ts):
// 'silent' | 'picker-needed' | 'mismatch' | 'no-handle'. Network policy:
// every request must stay on the preview origin — relink is local, nothing
// is ever uploaded (SECURITY-03/FR-03.1); the audit collects and asserts.
import { expect, test } from '@playwright/test'

const CHILD = process.env.ZIPSCRIBE_CHILD === '1'
const CHILD_REASON = 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit'

const FINGERPRINT = { name: 'speech-2min.mp4', size: 627251, durationMs: 121440, sampleHashes: ['h1', 'h2', 'h3'] }

async function gotoZiptest(page: import('@playwright/test').Page, picker: 'ok' | 'cancel' = 'ok'): Promise<void> {
  await page.addInitScript((mode) => {
    const w = window as unknown as { __zipFsaAudit?: { permissionChecks: { mode?: string }[]; pickerCalls: number }; showOpenFilePicker?: unknown }
    w.__zipFsaAudit = { permissionChecks: [], pickerCalls: 0 }
    const bump = (): void => {
      const audit = (window as unknown as { __zipFsaAudit: { permissionChecks: { mode?: string }[]; pickerCalls: number } }).__zipFsaAudit
      audit.pickerCalls += 1
    }
    w.showOpenFilePicker =
      mode === 'cancel'
        ? async (): Promise<never> => {
            bump()
            throw new DOMException('cancelled by user', 'AbortError')
          }
        : async (): Promise<unknown[]> => {
            bump()
            const fingerprint = (window as unknown as { __zipStubFile?: { name: string; size: number } }).__zipStubFile ?? { name: 'speech-2min.mp4', size: 627251 }
            const file = new File([new Uint8Array(fingerprint.size)], fingerprint.name, { type: 'video/mp4' })
            return [{ getFile: async (): Promise<File> => file }]
          }
  }, picker)
  await page.goto('/?ziptest=1')
  await page.waitForFunction(() => Boolean(window.__zipPersistenceBridge), undefined, { timeout: 20_000 })
  await page.evaluate(async () => {
    const bridge = window.__zipPersistenceBridge
    if (!bridge) throw new Error('persistence bridge vanished mid-navigation')
    await bridge.ready()
  })
}

async function audit(page: import('@playwright/test').Page): Promise<string[]> {
  const external: string[] = []
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url())
  })
  return external
}

async function seedHandle(page: import('@playwright/test').Page, projectId: string, permission: 'granted' | 'denied', fingerprint: typeof FINGERPRINT): Promise<void> {
  await page.evaluate(
    async ({ projectId: id, permission: perm, fp }) => {
      const bridge = window.__zipPersistenceBridge
      if (!bridge) throw new Error('persistence bridge missing — builder has not shipped src/ui/testing/persistence-bridge.ts (CC-106.4 RED)')
      const file = new File([new Uint8Array(fp.size)], fp.name, { type: 'video/mp4' })
      await bridge.seedMediaHandle(
        id,
        {
          queryPermission: async (descriptors?: { mode?: string }): Promise<string> => {
            ;(window as unknown as { __zipFsaAudit: { permissionChecks: { mode?: string }[] } }).__zipFsaAudit.permissionChecks.push(descriptors ?? {})
            return perm
          },
          getFile: async (): Promise<File> => file,
        },
        fp,
      )
    },
    { projectId, permission, fp: fingerprint },
  )
}

async function relink(page: import('@playwright/test').Page, projectId: string): Promise<{ kind: string; file?: { name: string; size: number } | null; differs?: string[] }> {
  return page.evaluate(async (id) => {
    const bridge = window.__zipPersistenceBridge
    if (!bridge) throw new Error('persistence bridge missing (CC-106.4 RED)')
    return bridge.relinkMedia(id) as Promise<{ kind: string; file?: { name: string; size: number } | null; differs?: string[] }>
  }, projectId)
}

async function fsaAudit(page: import('@playwright/test').Page): Promise<{ permissionChecks: { mode?: string }[]; pickerCalls: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __zipFsaAudit?: { permissionChecks: { mode?: string }[]; pickerCalls: number } }
    return w.__zipFsaAudit ?? { permissionChecks: [], pickerCalls: 0 }
  })
}

test.describe('CC-106.4: relink paths on the production build (stubbed FSA, real IndexedDB)', () => {
  test.skip(CHILD, CHILD_REASON)

  test('CC-106.4: silent handle restore — granted + matching probe → kind "silent", file chooser NEVER opened', async ({ page }) => {
    test.setTimeout(90_000)
    const external = await audit(page)
    await gotoZiptest(page)
    await seedHandle(page, 'e2e_silent', 'granted', FINGERPRINT)
    await page.evaluate((fp) => window.__zipPersistenceBridge?.setProbeResult(fp), FINGERPRINT)

    const outcome = await relink(page, 'e2e_silent')
    expect(outcome.kind, 'the silent path restores without user interaction').toBe('silent')
    expect(outcome.file?.name).toBe(FINGERPRINT.name)

    const auditState = await fsaAudit(page)
    expect(auditState.pickerCalls, 'the file chooser is NEVER opened on the silent path').toBe(0)
    expect(auditState.permissionChecks, 'the probe used the read-mode permission descriptor').toContainEqual({ mode: 'read' })
    expect(external, 'relink is local — nothing is ever uploaded').toEqual([])
  })

  test('CC-106.4: permission-denied falls back to the file chooser; a validated picker file is restored (Firefox path)', async ({ page }) => {
    test.setTimeout(90_000)
    const external = await audit(page)
    await gotoZiptest(page)
    await seedHandle(page, 'e2e_denied', 'denied', FINGERPRINT)
    await page.evaluate(
      (state) => {
        ;(window as unknown as { __zipStubFile?: { name: string; size: number } }).__zipStubFile = { name: state.name, size: state.size }
        window.__zipPersistenceBridge?.setProbeResult(state)
      },
      FINGERPRINT,
    )

    const outcome = await relink(page, 'e2e_denied')
    const auditState = await fsaAudit(page)
    expect(auditState.pickerCalls, 'denied permission reached the picker fallback').toBe(1)
    expect(outcome.kind, 'the picked file validated against the stored fingerprint → silent restore').toBe('silent')
    expect(external, 'the picker path stays local too').toEqual([])
  })

  test('CC-106.4: fingerprint mismatch surfaces "mismatch" with the differing fields and NEVER overwrites the stored fingerprint', async ({ page }) => {
    test.setTimeout(90_000)
    const external = await audit(page)
    await gotoZiptest(page)
    await seedHandle(page, 'e2e_mismatch', 'granted', FINGERPRINT)
    const drifted = { ...FINGERPRINT, size: FINGERPRINT.size + 1 }
    await page.evaluate((fp) => window.__zipPersistenceBridge?.setProbeResult(fp), drifted)

    const outcome = await relink(page, 'e2e_mismatch')
    expect(outcome.kind).toBe('mismatch')
    expect(outcome.differs, 'field-by-field compare names the differing field(s)').toContain('size')
    const auditState = await fsaAudit(page)
    expect(auditState.pickerCalls, 'a mismatch is a decision point — no silent swap, no surprise picker').toBe(0)

    const repeat = await relink(page, 'e2e_mismatch')
    expect(repeat.kind, 'the stored handle/fingerprint is NEVER overwritten on mismatch — re-probing the drifted file mismatches AGAIN (keep-or-replace is the user\'s decision)').toBe('mismatch')
    expect(external, 'the mismatch flow stays local').toEqual([])
  })

  test('CC-106.4: cancelled picker with no usable handle → kind "picker-needed" with no file', async ({ page }) => {
    test.setTimeout(90_000)
    await gotoZiptest(page, 'cancel')
    await seedHandle(page, 'e2e_cancel', 'denied', FINGERPRINT)
    const outcome = await relink(page, 'e2e_cancel')
    expect(outcome.kind, 'cancel keeps asking instead of pretending').toBe('picker-needed')
    expect(outcome.file).toBeNull()
    const auditState = await fsaAudit(page)
    expect(auditState.pickerCalls, 'the chooser really was offered').toBe(1)
  })

  test('CC-106.1 (e2e sanity): the real database is `zipscribe` v1 with exactly the three pinned stores', async ({ page }) => {
    test.setTimeout(90_000)
    await gotoZiptest(page)
    const facts = await page.evaluate(async () => {
      const names = (await indexedDB.databases()).map((db) => db.name)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('zipscribe')
        request.onsuccess = (): void => resolve(request.result)
        request.onerror = (): void => reject(request.error)
      })
      try {
        return { names, version: db.version, stores: [...db.objectStoreNames].sort() }
      } finally {
        db.close()
      }
    })
    expect(facts.names, 'the database is named `zipscribe`').toContain('zipscribe')
    expect(facts.version, 'version 1').toBe(1)
    expect(facts.stores, 'exactly the three pinned stores').toEqual(['blobCache', 'mediaHandles', 'projects'])
  })
})
