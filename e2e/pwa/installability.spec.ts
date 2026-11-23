// CC-204.1 (L5, chromium): installability on the production build.
// Zero CDP installability errors + the manifest field contract (US-204.1):
// name/short_name/id/start_url/scope/display, token colors (#0d0f12 —
// knowledge/design.md tokens), 192+512 `any` icons and 512 `maskable`,
// description, wide+narrow screenshots, no prefer_related_applications;
// file_handlers for the architecture.md § Supported media set (incl. the
// audio long tail US-204.5 names), caption files, `.zipscribe.json`, and
// `launch_handler: { client_mode: "focus-existing" }`. SW scope '/'.
//
// CDP is isolated in helpers/installability.ts (unit-204 Risks); the field
// assertions run against the REAL generated /manifest.webmanifest from
// `vite preview` (never a mock — brief: CC-204.1 pins the real artifact).
import { expect, test } from '@playwright/test'
import { fetchManifest, getInstallability, iconPurposes } from './helpers/installability'
import { CHILD, CHILD_REASON, PREVIEW_BASE, warmShell } from './helpers/pwa-harness'

/** architecture.md § Supported media (video) + the US-204.5 named long tail
 *  (audio native + ffmpeg-fallback) + caption files + project files.
 *  MPEG-TS ships both spellings (.ts and .m2ts) — ASSUMPTIONS in the report. */
const REQUIRED_EXTENSIONS = [
  // video containers
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.ts', '.m2ts',
  // audio (native set)
  '.mp3', '.m4a', '.m4b', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus', '.weba', '.mka',
  // audio (ffmpeg long tail — US-204.5)
  '.aiff', '.aif', '.wma', '.amr', '.3gp', '.caf',
  // caption files (US-204.5) + project file
  '.srt', '.vtt', '.sbv', '.ttml', '.ass', '.zipscribe.json',
]

test.describe('CC-204.1: installability — zero CDP errors + manifest fields (chromium)', () => {
  test.skip(CHILD, CHILD_REASON)
  test.use({ serviceWorkers: 'allow' })

  test.beforeEach(async ({ page }) => {
    // Installability is evaluated from a loaded, manifest-bearing document.
    // The warm also installs the SW (install criteria include a registered
    // SW), so warmShell doubles as the "everything present" precondition —
    // it failing here is the honest RED (no SW until unit-204 builds land).
    await warmShell(page, PREVIEW_BASE, '/')
  })

  test('CC-204.1: Page.getInstallabilityErrors reports none and the manifest parses clean', async ({ page }) => {
    const report = await getInstallability(page)
    expect(report.manifestParseErrors, 'the generated manifest parses without CDP errors').toEqual([])
    expect(report.manifestUrl, 'the document links a manifest').not.toBeNull()
    expect(report.installErrors, `Chrome reports the app installable (CDP errors: ${JSON.stringify(report.installErrors)})`).toEqual([])
  })

  test('CC-204.1: manifest core fields (name/short_name/id/start_url/scope/display/colors/description)', async ({ page, request }) => {
    const manifest = await fetchManifest(request, PREVIEW_BASE)
    expect(typeof manifest['name'], 'name present').toBe('string')
    expect(String(manifest['name']).length).toBeGreaterThan(0)
    expect(typeof manifest['short_name'], 'short_name present').toBe('string')
    expect(manifest['id'], 'id is the root (US-204.1)').toBe('/')
    expect(manifest['start_url'], 'start_url is the root').toBe('/')
    expect(manifest['scope'], 'scope is the root').toBe('/')
    expect(manifest['display'], 'standalone shell').toBe('standalone')
    // token colors: --bg-app #0d0f12 (knowledge/design.md design tokens)
    expect(String(manifest['theme_color']).toLowerCase(), 'theme_color from the token').toBe('#0d0f12')
    expect(String(manifest['background_color']).toLowerCase(), 'background_color from the token').toBe('#0d0f12')
    expect(typeof manifest['description'], 'description present').toBe('string')
    expect(String(manifest['description']).length).toBeGreaterThan(0)
    expect(manifest['prefer_related_applications'], 'never a native-app nudge (US-204.1)').toBeUndefined()
  })

  test('CC-204.1: icons 192 any + 512 any + 512 maskable; screenshots wide and narrow', async ({ page, request }) => {
    const manifest = await fetchManifest(request, PREVIEW_BASE)
    const icons = iconPurposes(manifest)
    expect(icons.some((i) => i.sizes === '192x192' && i.purposes.includes('any')), 'a 192x192 any icon').toBe(true)
    expect(icons.some((i) => i.sizes === '512x512' && i.purposes.includes('any')), 'a 512x512 any icon').toBe(true)
    expect(icons.some((i) => i.sizes === '512x512' && i.purposes.includes('maskable')), 'a 512x512 maskable icon').toBe(true)
    for (const icon of icons) {
      expect(icon.sizes, `icon sizes entry is well-formed (${JSON.stringify(icon)})`).toMatch(/^\d+x\d+$/)
    }
    const screenshots = Array.isArray(manifest['screenshots']) ? (manifest['screenshots'] as Record<string, unknown>[]) : []
    const forms = screenshots.map((s) => String(s['form_factor'] ?? ''))
    expect(forms, `screenshots carry wide and narrow form factors (${JSON.stringify(forms)})`).toContain('wide')
    expect(forms, 'screenshots carry wide and narrow form factors').toContain('narrow')
    for (const shot of screenshots) expect(typeof shot['src'], 'every screenshot has a src').toBe('string')
  })

  test('CC-204.1: file_handlers accept every supported media + caption + project extension; launch_handler focus-existing', async ({ page, request }) => {
    const manifest = await fetchManifest(request, PREVIEW_BASE)
    const handlers = Array.isArray(manifest['file_handlers']) ? (manifest['file_handlers'] as Record<string, unknown>[]) : []
    expect(handlers.length, 'at least one file_handler (US-204.5)').toBeGreaterThan(0)
    const accepted = new Set<string>()
    for (const handler of handlers) {
      const accept = handler['accept']
      if (accept !== null && typeof accept === 'object') {
        for (const list of Object.values(accept as Record<string, unknown>)) {
          if (Array.isArray(list)) for (const entry of list) accepted.add(String(entry).toLowerCase())
        }
      }
    }
    const missing = REQUIRED_EXTENSIONS.filter((ext) => !accepted.has(ext))
    expect(missing, `file_handlers must accept the architecture § Supported media set + US-204.5 files (missing: ${missing.join(', ')})`).toEqual([])
    const launchHandler = manifest['launch_handler']
    expect(launchHandler, 'launch_handler present (US-204.5)').not.toBeUndefined()
    const clientMode = (launchHandler as Record<string, unknown>)['client_mode']
    const modes = Array.isArray(clientMode) ? clientMode.map(String) : [String(clientMode)]
    expect(modes[0], 'client_mode leads with focus-existing (MDN manifest/launch_handler)').toBe('focus-existing')
  })

  test('CC-204.1: the service worker is registered with scope /', async ({ page }) => {
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return registration?.scope ?? null
    })
    expect(scope, 'FR-204.6: SW scope is the origin root').toBe(`${PREVIEW_BASE}/`)
  })
})
