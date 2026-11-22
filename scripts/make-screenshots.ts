// FR-204.1 / US-204.1 — the committed PWA `screenshots` (wide + narrow) under
// public/screenshots/, rendered offline with the pinned Chromium from the
// unit-200 design language: the layout of knowledge/design.md § Layout on the
// design tokens (no new colors), wide = the 1280×720-min desktop workbench,
// narrow = design.md's below-minimum state ("best on a larger screen" notice,
// transcript stays usable). No network, no app data (decorative copy only).
//
// Run: `corepack pnpm exec node scripts/make-screenshots.ts`
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'public', 'screenshots')

const TOKENS = `
:root{
  --bg-app:#0d0f12; --bg-panel:#15181d; --bg-raised:#1c2027; --bg-overlay:#232830;
  --border-subtle:#2a2f38; --border-focus:#4c8dff;
  --text-primary:#e8eaed; --text-secondary:#9aa2ad; --text-disabled:#5c6470;
  --accent:#4c8dff; --accent-strong:#2f6fe0; --accent-soft:rgba(76,141,255,.14);
  --danger:#e5534b; --success:#4ab871; --warning:#d9a03f;
  --waveform:#3d4450; --waveform-active:#4c8dff; --playhead:#ff5c5c;
  --selection:rgba(76,141,255,.22);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg-app);color:var(--text-primary);font:13px/1.45 Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums}
.header{display:flex;align-items:center;gap:12px;height:44px;padding:0 12px;background:var(--bg-panel);border-bottom:1px solid var(--border-subtle)}
.brand{font-weight:700}
.proj{background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:4px;padding:4px 10px;color:var(--text-primary)}
.chip{background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 8px;color:var(--text-secondary);font-size:12px}
.spacer{flex:1}
.btn{border-radius:4px;border:1px solid var(--border-subtle);background:var(--bg-raised);color:var(--text-primary);padding:4px 12px;height:28px;display:inline-flex;align-items:center}
.btn.primary{background:var(--accent-strong);border-color:var(--accent);color:#fff}
.dots{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;color:var(--text-secondary)}
.main{display:flex;height:calc(100% - 44px)}
.sidebar{width:340px;background:var(--bg-panel);border-right:1px solid var(--border-subtle);display:flex;flex-direction:column}
.tabs{display:flex;gap:16px;padding:8px 12px;border-bottom:1px solid var(--border-subtle);color:var(--text-secondary)}
.tabs .on{color:var(--text-primary);border-bottom:2px solid var(--accent)}
.search{margin:8px 12px;background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:4px;color:var(--text-disabled);padding:5px 10px}
.rows{padding:6px 12px;display:flex;flex-direction:column;gap:10px}
.row{background:var(--bg-raised);border:1px solid var(--border-subtle);border-radius:6px;padding:8px 10px}
.row.sel{outline:1px solid var(--accent);background:var(--selection)}
.meta{display:flex;gap:8px;align-items:center;color:var(--text-secondary);font-size:11px;margin-bottom:4px}
.spk{width:10px;height:10px;border-radius:5px;background:#4c8dff;display:inline-block}
.spk.b{background:#e5534b}.spk.c{background:#4ab871}
.txt{color:var(--text-primary)}
.txt .w{border-bottom:2px solid var(--accent);font-weight:700}
.stage{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;min-width:0}
.canvas{position:relative;width:min(100%,calc((100vh - 220px) * 16 / 9));aspect-ratio:16/9;background:#000;border-radius:6px;border:1px solid var(--border-subtle);overflow:hidden}
.cap{position:absolute;left:8%;right:8%;bottom:6%;text-align:center;font-weight:700;font-size:clamp(16px,2.4vw,30px);text-shadow:0 0 4px #0d0f12,0 0 4px #0d0f12}
.transport{display:flex;gap:14px;align-items:center;color:var(--text-secondary)}
.transport b{color:var(--text-primary);font-weight:400}
.timeline{height:132px;background:var(--bg-panel);border-top:1px solid var(--border-subtle);padding:8px 12px;display:flex;flex-direction:column;gap:8px}
.ruler{height:14px;border-bottom:1px solid var(--border-subtle);color:var(--text-disabled);font-size:10px;display:flex;justify-content:space-between}
.lanes{flex:1;display:flex;flex-direction:column;gap:6px}
.lane{display:flex;gap:4px;align-items:center}
.p{width:6px;background:var(--waveform);border-radius:2px}
.blk{height:18px;border-radius:4px;background:var(--accent-soft);border:1px solid var(--accent)}
.blk.o{background:rgba(76,141,255,.07);border-color:var(--border-subtle)}
.ph{width:2px;background:var(--playhead);height:100%}
.notice{margin:10px 12px;padding:8px 12px;border:1px solid var(--warning);border-radius:6px;color:var(--warning);background:var(--bg-overlay);font-size:12px}
`

const header = `
<header class="header">
  <span class="brand">⌂ Zipscribe</span>
  <span class="proj">Interview — March ▾</span>
  <span class="chip">T1 · WebGPU</span>
  <span class="chip">whisper-base · cache 1.2 GB</span>
  <span class="spacer"></span>
  <span class="btn primary">● Transcribe</span>
  <span class="btn">Export</span>
  <span class="dots">⋯</span>
</header>`

function transcriptRows(): string {
  const rows = [
    ['spk', 'S1', '00:01–00:04', 'welcome back to the show', false],
    ['spk b', 'S2', '00:04–00:09', 'thanks! today we talk about offline apps', true],
    ['spk', 'S1', '00:09–00:14', 'captions, exports, and <span class="w">installing</span> the app', false],
    ['spk c', 'S3', '00:14–00:18', 'and a lot of file formats', false],
  ] as const
  return rows.map(([cls, spk, tc, text, sel]) => `<div class="row${sel ? ' sel' : ''}"><div class="meta"><span class="${cls}"></span>${spk} <span>${tc}</span></div><div class="txt">${text}</div></div>`).join('')
}

function wave(): string {
  const bars: string[] = []
  for (let i = 0; i < 96; i++) {
    // deterministic pseudo-waveform (sin mix), heights 20–100 %
    const h = Math.round(30 + 55 * Math.abs(Math.sin(i * 0.35) * Math.cos(i * 0.11)))
    bars.push(`<span class="p" style="height:${h}%"></span>`)
  }
  return bars.join('')
}

const wideBody = `
${header}
<div class="main">
  <aside class="sidebar">
    <div class="tabs"><span class="on">Subtitles</span><span>Media</span><span>Style</span></div>
    <div class="search">⌘/Ctrl+F search</div>
    <div class="rows">${transcriptRows()}</div>
  </aside>
  <section class="stage">
    <div class="canvas"><div class="cap">thanks! <span style="color:var(--accent)">today</span> we talk about offline apps</div></div>
    <div class="transport"><span>◀◀ 5s</span><span><b>▶</b></span><span>5s ▶▶</span><span>00:12.3 / 10:00</span></div>
  </section>
</div>
<footer class="timeline">
  <div class="ruler"><span>00:00</span><span>02:00</span><span>04:00</span><span>06:00</span><span>08:00</span><span>10:00</span></div>
  <div class="lanes">
    <div class="lane">${wave()}</div>
    <div class="lane" style="position:relative"><span class="blk" style="width:9%"></span><span class="blk" style="width:14%"></span><span class="blk o" style="width:11%"></span><span class="blk o" style="width:17%"></span><span class="ph" style="position:absolute;left:31%"></span></div>
  </div>
</footer>`

const narrowBody = `
${header}
<div class="notice">Zipscribe works best on a larger screen — the transcript stays usable here.</div>
<div class="main">
  <aside class="sidebar" style="width:100%;border-right:none">
    <div class="tabs"><span class="on">Subtitles</span><span>Media</span><span>Style</span></div>
    <div class="search">⌘/Ctrl+F search</div>
    <div class="rows">${transcriptRows()}</div>
  </aside>
</div>`

async function shoot(name: string, viewport: { width: number; height: number }, dsf: number, body: string, sizes: string): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: dsf })
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${TOKENS}</style></head><body>${body}</body></html>`)
    await page.screenshot({ path: join(outDir, name) })
    console.log(`[screenshots] wrote ${name} (${sizes})`)
  } finally {
    await browser.close()
  }
}

mkdirSync(outDir, { recursive: true })
await shoot('wide-1920x1080.png', { width: 1920, height: 1080 }, 1, wideBody, '1920x1080')
await shoot('narrow-780x1688.png', { width: 390, height: 844 }, 2, narrowBody, '780x1688')
