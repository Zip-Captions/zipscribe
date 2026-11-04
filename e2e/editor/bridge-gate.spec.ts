// SECURITY gate (slice C, FR-2.0.6): the test bridges exist ONLY under the
// strict `?ziptest=1` query value. `?ziptest=0`, `?ziptest=true` and the bare
// app must expose NEITHER __zipEditorBridge NOR __zipWorkbenchBridge — a
// truthiness-gated implementation (or a self-installing module import) fails
// this spec. Positive half: `?ziptest=1` installs both.
import { expect, test } from '@playwright/test'

async function waitForShell(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => Boolean(document.querySelector('[data-testid=workbench-shell]')), undefined, { timeout: 20_000 })
}

async function bridges(page: import('@playwright/test').Page): Promise<{ editor: unknown; workbench: unknown }> {
  return page.evaluate(() => ({
    editor: (window as unknown as Record<string, unknown>).__zipEditorBridge,
    workbench: (window as unknown as Record<string, unknown>).__zipWorkbenchBridge,
  }))
}

test.describe('FR-2.0.6: bridges are gated on STRICT ?ziptest=1', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('FR-2.0.6: no bridge without the flag, and never for truthy-but-not-"1" values', async ({ page }) => {
    test.setTimeout(90_000)
    for (const url of ['/', '/?ziptest=', '/?ziptest=0', '/?ziptest=true', '/?ziptest=1x']) {
      await page.goto(url)
      await waitForShell(page)
      const installed = await bridges(page)
      expect(installed.editor, `${url} must NOT expose the editor bridge`).toBeUndefined()
      expect(installed.workbench, `${url} must NOT expose the workbench bridge`).toBeUndefined()
    }
  })

  test('FR-2.0.6: the strict flag installs BOTH bridges', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/?ziptest=1')
    await waitForShell(page)
    await page.waitForFunction(
      () => {
        const w = window as unknown as Record<string, unknown>
        return w.__zipEditorBridge !== undefined && w.__zipWorkbenchBridge !== undefined
      },
      undefined,
      { timeout: 20_000 },
    )
    // Functions do not survive evaluate serialization — probe `typeof` IN
    // the page and return the strings.
    const shapes = await page.evaluate(() => {
      const w = window as unknown as Record<string, Record<string, unknown> | undefined>
      const editor = w.__zipEditorBridge
      const workbench = w.__zipWorkbenchBridge
      return {
        editorOpen: typeof editor?.openProjectWithMedia,
        editorState: typeof editor?.getEditorState,
        editorCommand: typeof editor?.command,
        editorScrub: typeof editor?.scrubTo,
        editorRelease: typeof editor?.releaseScrub,
        workbenchType: typeof workbench,
      }
    })
    expect(shapes.editorOpen).toBe('function')
    expect(shapes.editorState).toBe('function')
    expect(shapes.editorCommand).toBe('function')
    expect(shapes.editorScrub).toBe('function')
    expect(shapes.editorRelease).toBe('function')
    expect(shapes.workbenchType).toBe('object')
  })
})
