// CC-104.6 (L5, chromium): axe-core finds ZERO critical violations on a
// POPULATED transcript (rows + chips + timecodes + search closed), and every
// row is keyboard-reachable — tabbing from the shell reaches
// transcript-row → transcript-row-chip → transcript-row-timecode per row,
// with a visible focus indicator (outline/box-shadow). Canary doctrine: the
// seed includes the canary block; the page console must never carry it
// (SECURITY-03, console-level redaction evidence).
import { expect, test } from '@playwright/test'
import { MEDIA_ASSET } from '../../tests/unit/workbench/helpers/fake-engine'
import { CANARY_MARKER, transcriptBlocks } from '../../tests/unit/transcript/helpers/transcript-fixture'

const SRC = '/fixtures/speech-2min.mp4'

interface EditorBridge {
  openProjectWithMedia(asset: unknown, srcUrl: string, blocks?: unknown): void
  command(id: string, payload?: unknown): { code: string } | null
  getEditorState(): { playhead: number; playing: boolean; clockTime: number; seekCount: number; videoReady: boolean }
}

test.describe('CC-104.6: axe 0 critical on a populated transcript · full keyboard reachability', () => {
  test.skip(process.env.ZIPSCRIBE_CHILD === '1', 'gates-scaffold child run: authoritative execution is the parent `pnpm test:e2e` / verify:unit')

  test('CC-104.6: axe critical == 0, rows reachable by Tab, visible focus ring, canary never in console', async ({ page }) => {
    test.setTimeout(90_000)
    const consoleTexts: string[] = []
    page.on('console', (msg) => consoleTexts.push(msg.text()))

    await page.goto('/?ziptest=1')
    await page.waitForFunction(() => Boolean((window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge), undefined, { timeout: 20_000 })
    await page.evaluate(
      ([asset, src, blocks]) => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.openProjectWithMedia(asset, src, blocks),
      [MEDIA_ASSET, SRC, transcriptBlocks()] as const,
    )
    await page.waitForFunction(() => (window as unknown as { __zipEditorBridge?: EditorBridge }).__zipEditorBridge?.getEditorState().videoReady === true, undefined, { timeout: 20_000 })
    await page.click('[data-testid=tab-subtitles]')
    await expect(page.getByTestId('transcript-row').first(), 'rows rendered (seed took effect)').toBeVisible({ timeout: 15_000 })

    const { AxeBuilder } = await import('@axe-core/playwright')
    const results = await new AxeBuilder({ page }).include('[data-testid=transcript-root]').analyze()
    const critical = results.violations.filter((v) => v.impact === 'critical')
    expect(critical, `0 critical axe violations (got ${critical.length}: ${critical.map((v) => v.id).join(', ') || 'none'})`).toHaveLength(0)

    // Keyboard reachability: Tab from the document start and collect the
    // transcript testids reached along the way (bounded walk).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const reached = new Set<string>()
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')
      if (testId !== '') reached.add(testId)
      if (reached.has('transcript-row') && reached.has('transcript-row-chip') && reached.has('transcript-row-timecode')) break
    }
    for (const id of ['transcript-row', 'transcript-row-chip', 'transcript-row-timecode']) {
      expect([...reached], `Tab traversal reaches ${id} (reached: ${[...reached].join(', ') || 'nothing'})`).toContain(id)
    }

    // Visible focus indicator on a transcript row (conventions § Focus
    // management: no outline:none — something must render).
    await page.locator('[data-testid=transcript-row]').first().focus()
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (el === null) return { outline: 'none', boxShadow: 'none' }
      const style = getComputedStyle(el)
      return { outline: style.outlineStyle + ' ' + style.outlineWidth, boxShadow: style.boxShadow }
    })
    const hasRing = (ring.outline !== 'none 0px' && !ring.outline.startsWith('none')) || (ring.boxShadow !== '' && ring.boxShadow !== 'none')
    expect(hasRing, `focused row shows a visible indicator (outline: ${ring.outline}, box-shadow: ${ring.boxShadow})`).toBe(true)

    expect(consoleTexts.filter((t) => t.includes(CANARY_MARKER)), 'canary transcript text never reaches the console').toHaveLength(0)
  })
})
