// tools/eval/pages/gpu-calibration.ts — FR-02.2: the harness's GPU-process
// memory sampler must be VALIDATED first (known-allocation calibration test).
// This page allocates a known number of bytes as WebGPU buffers (kept alive
// per token) so the harness can confirm the out-of-band sampler (macOS
// `footprint` of the Chrome GPU process — per issue #1739, plain RSS does
// not show these allocations on macOS) actually sees the growth before any
// measurement row trusts it.
//
// Minimal ambient WebGPU typing (the TS DOM lib carries no GPU types; the
// surface used here is adapter/device/buffer lifecycle only —
// https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API).
interface GpuUsageFlags {
  STORAGE: number
  UNIFORM: number
  COPY_DST: number
}

interface GpuBuffer {
  destroy(): void
}

interface GpuQueue {
  writeBuffer(buffer: GpuBuffer, bufferOffset: number, data: ArrayBufferView | ArrayBuffer): void
}

interface GpuDevice {
  createBuffer(descriptor: { size: number; usage: number; label?: string }): GpuBuffer
  queue: GpuQueue
}

interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>
  info?: { vendor?: string; description?: string; architecture?: string }
}

interface Gpu {
  requestAdapter(): Promise<GpuAdapter | null>
}

const CHUNK = 64 * 1024 * 1024
// GPUBufferUsage bits (COPY_DST=8, UNIFORM=64, STORAGE=128).
const USAGE: GpuUsageFlags = { STORAGE: 128, UNIFORM: 64, COPY_DST: 8 }

const buffers = new Map<number, GpuBuffer[]>()
let nextToken = 1
let devicePromise: Promise<GpuDevice> | null = null

async function device(): Promise<GpuDevice> {
  if (!devicePromise) {
    devicePromise = (async () => {
      const gpu = (navigator as unknown as { gpu?: Gpu }).gpu
      if (!gpu) throw new Error('gpu-calibration: navigator.gpu unavailable')
      const adapter = await gpu.requestAdapter()
      if (!adapter) throw new Error('gpu-calibration: no adapter')
      return adapter.requestDevice()
    })()
  }
  return devicePromise
}

;(window as unknown as Record<string, unknown>).__zipscribeGpu = {
  async adapterInfo(): Promise<{ ok: boolean; vendor?: string; description?: string }> {
    try {
      const gpu = (navigator as unknown as { gpu?: Gpu }).gpu
      const adapter = gpu ? await gpu.requestAdapter() : null
      return { ok: adapter !== null, vendor: adapter?.info?.vendor, description: adapter?.info?.description }
    } catch {
      return { ok: false }
    }
  },
  async allocate(bytes: number): Promise<{ ok: boolean; token: number; allocated: number; error?: string }> {
    try {
      const dev = await device()
      const token = nextToken
      nextToken += 1
      const held: GpuBuffer[] = []
      let remaining = bytes
      while (remaining > 0) {
        const size = Math.min(CHUNK, remaining)
        const buffer = dev.createBuffer({ size, usage: USAGE.STORAGE | USAGE.UNIFORM | USAGE.COPY_DST, label: 'zipscribe-eval-calibration' })
        // Materialize the backing pages: an untouched WebGPU buffer maps no
        // GPU-process pages, so the calibration must write through it or the
        // sampler would (correctly) observe no growth.
        dev.queue.writeBuffer(buffer, 0, new Uint8Array(size))
        held.push(buffer)
        remaining -= size
      }
      buffers.set(token, held)
      return { ok: true, token, allocated: bytes - remaining }
    } catch (error) {
      return { ok: false, token: 0, allocated: 0, error: error instanceof Error ? error.name : 'allocate-failed' }
    }
  },
  release(token: number): { ok: boolean } {
    const held = buffers.get(token)
    if (held) {
      for (const buffer of held) buffer.destroy()
      buffers.delete(token)
    }
    return { ok: true }
  },
}
