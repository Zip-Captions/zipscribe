// tools/eval/gpu-sampler.mjs — out-of-band GPU-process memory sampler.
//
// Why out-of-band (discovery.md prior-art, transformers.js issue #1739): the
// GPU-memory growth from WebGPU inference lives in the Chrome **GPU process**
// (Metal allocations), not the renderer — neither `performance.memory` nor
// page-side JS heap sampling can see it. macOS's `footprint` reports the
// kernel's phys_footprint for a process, which is what "GPU memory"
// measurements on this platform mean. The harness VALIDATES this sampler
// first with a known-allocation calibration (gpu-calibration page allocates
// N bytes of WebGPU buffers; the sampler must observe ≈ N growth) before any
// leak row trusts it (FR-02.2).
import { spawnSync } from 'node:child_process'

function parseSize(text) {
  // "1745 KB" / "512 MB" / "1.2 GB" / "8192 B"
  const match = text.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB)/i)
  if (!match) return null
  const value = Number(match[1])
  const unit = match[2].toUpperCase()
  const multiplier = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }[unit]
  return Math.round(value * multiplier)
}

export function footprintBytes(pid) {
  if (!pid) return null
  const result = spawnSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) return null
  const output = result.stdout ?? ''
  const phys = output.match(/phys_footprint:\s*([0-9.,]+\s*[KMGT]?B)/i)
  if (phys) {
    const bytes = parseSize(phys[1])
    if (bytes !== null) return bytes
  }
  const header = output.match(/Footprint:\s*([0-9.,]+\s*[KMGT]?B)/i)
  return header ? parseSize(header[1]) : null
}

/** Locate the Chrome/Chromium GPU helper among the browser process's direct
 *  children (headless new runs a real GPU process when WebGPU is enabled). */
export function findGpuHelperPid(browserPid) {
  if (!browserPid) return null
  const children = spawnSync('pgrep', ['-P', String(browserPid)], { encoding: 'utf8', timeout: 5_000 })
  const pids = (children.stdout ?? '').split(/\s+/).filter(Boolean).map(Number)
  for (const pid of pids) {
    const info = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 5_000 })
    const comm = info.stdout ?? ''
    if (comm.includes('GPU') || comm.includes('gpu-process')) return pid
  }
  return null
}

/** Alternative discovery for a launched persistent context: all processes
 *  carrying the harness's --user-data-dir, of which the one with
 *  `--type=gpu-process` is the GPU process. Headless Chrome disables the GPU
 *  by default (crbug 1416283, cited in
 *  https://developer.chrome.com/blog/supercharge-web-ai-testing); the harness
 *  launches new-headless (Playwright channel 'chromium') with the documented
 *  GPU flags and falls back to a headed window when this lookup still finds
 *  no GPU process on macOS — the mode actually used is recorded in the
 *  report (`environment.launchMode`). */
export function findGpuHelperPidByUserDataDir(userDataDir) {
  if (!userDataDir) return null
  const result = spawnSync('ps', ['-axww', '-o', 'pid,args'], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) return null
  for (const line of (result.stdout ?? '').split('\n')) {
    if (line.includes(userDataDir) && line.includes('--type=gpu-process')) {
      const pid = Number(line.trim().split(/\s+/)[0])
      if (Number.isFinite(pid)) return pid
    }
  }
  return null
}

export class GpuMemorySampler {
  constructor({ browserPid, userDataDir } = {}) {
    this.gpuPid = findGpuHelperPid(browserPid) ?? findGpuHelperPidByUserDataDir(userDataDir)
    this.missingReason = this.gpuPid ? null : 'gpu-helper-process-not-found'
  }

  sample() {
    if (!this.gpuPid) return null
    return footprintBytes(this.gpuPid)
  }
}
