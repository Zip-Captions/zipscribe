// tools/eval/pages/engine-b.worker.js — engine B: OFFICIAL k2-fsa sherpa-onnx
// WASM, non-streaming VAD+ASR path (unit-02 Candidates table row B).
//
// Runs as a CLASSIC worker (importScripts of the official k2-fsa browser
// build — models/eval-registry.json id sherpa-wasm-vad-asr, fetched
// SHA-256-verified from the k2-fsa HF Space by scripts/models-fetch.ts and
// copied to /sherpa by scripts/copy-vendor-assets.ts — self-hosted, never a
// CDN, US-02.2). The API surface (Module factory, OfflineRecognizer
// {createStream,decode,getResult}, createVad/acceptWaveform/pop) was verified
// against the pinned Space assets themselves (sherpa-onnx-asr.js
// `new OfflineRecognizer(config, Module)`, sherpa-onnx-vad.js
// `createVad(Module, config)`, matching the official wasm/vad-asr reference
// app-vad-asr.js on the same Space; docs-mcp sherpa-onnx:
// https://k2-fsa.github.io/sherpa/onnx/wasm/). Models are fetched from the
// SHA-256-verified cache served under /hf-cache (self origin, FR-02.9) and
// written into the Emscripten MEMFS before recognizer creation.
'use strict'

// The main-vad-asr build is NON-modularized Emscripten: it boots on script
// evaluation, so the loader config (self.Module) must exist BEFORE
// importScripts. getPreloadedPackage short-circuits the bundled 367 MB
// `.data` package (the Space's preloaded zh model — we serve our own models
// from the pinned cache into MEMFS instead). This is Emscripten's documented
// user hook: the generated loader calls `Module["getPreloadedPackage"](name,
// size)` before any XHR, and slices the returned ArrayBuffer into MEMFS files
// with no content check, so an empty buffer yields harmless zero-byte
// entries at the demo's paths while the runtime fetches nothing over the
// network (US-02.2: only `self` requests are made).
const runtimeReady = new Promise((resolve, reject) => {
  self.Module = {
    locateFile: (path) => '/sherpa/' + path.replace(/^\.\//, ''),
    getPreloadedPackage: () => new ArrayBuffer(0),
    onRuntimeInitialized: () => resolve(true),
    onAbort: (reason) => reject(new Error('sherpa runtime abort: ' + String(reason).slice(0, 120))),
  }
})
importScripts('/sherpa/sherpa-onnx-wasm-main-vad-asr.js', '/sherpa/sherpa-onnx-asr.js', '/sherpa/sherpa-onnx-vad.js')

let sherpaModule = null
let recognizer = null
let vad = null

function post(message) {
  if (message && message.t === 'progress') console.log('[b-worker]', message.stage)
  self.postMessage(message)
}

async function fetchToBytes(url) {
  // throws loudly on 404 — HTML error bodies silently poison MEMFS writes
  const response = await fetch(url)
  if (!response.ok) throw new Error('model fetch HTTP ' + response.status)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // SPA fallbacks answer 200 with index.html — require protobuf framing (field 1 varint).
  if (url.endsWith('.onnx') && (bytes.length < 16 || bytes[0] > 0x0f)) throw new Error('model fetch not-onnx bytes ' + bytes.length + ' from ' + url.split('/').pop())
  return bytes
}

async function handleRequest(request) {
  if (request.t === 'load') {
    const began = performance.now()
    // locateFile pins the loader's .wasm/.data resolution to /sherpa on
    // `self` (and getPreloadedPackage short-circuits the .data fetch), so the
    // boot makes no request outside the preview origin (US-02.2).
    post({ t: 'progress', stage: 'runtime-ready' })
    await Promise.race([runtimeReady, new Promise((_, reject) => setTimeout(() => reject(new Error('sherpa runtime init timeout 120s')), 120_000))])
    sherpaModule = globalThis.Module
    if (!sherpaModule || typeof sherpaModule._SherpaOnnxCreateOfflineRecognizer !== 'function') {
      throw new Error('sherpa capi exports missing after runtime init')
    }
    // main-asr is non-modularized: MEMFS lives in the script's global scope
    // (`var FS=…`), not on the Module config object — reach it there.
    const memfs = globalThis.FS || sherpaModule.FS
    if (!memfs) throw new Error('sherpa runtime has no MEMFS (FS not exported)')
    post({ t: 'progress', stage: 'fs-write' })
    memfs.mkdir('/models')
    for (const file of request.modelFiles) {
      const bytes = await fetchToBytes(file.url)
      memfs.writeFile('/models/' + file.name, bytes)
      post({
        t: 'progress',
        stage: `fs-ok ${file.name} ${bytes.length} ${JSON.stringify(memfs.analyzePath('/models/' + file.name).stats && { mode: memfs.analyzePath('/models/' + file.name).stats.mode, size: memfs.analyzePath('/models/' + file.name).stats.size })}`,
      })
    }
    const vadBytes = await fetchToBytes(request.vadUrl)
    memfs.writeFile('/models/' + request.vadFile, vadBytes)
    post({ t: 'progress', stage: `fs-ok ${request.vadFile} ${vadBytes.length} first4=${vadBytes[0]},${vadBytes[1]},${vadBytes[2]},${vadBytes[3]}` })
    post({ t: 'progress', stage: 'recognizer-init' })
    recognizer = new OfflineRecognizer(
      {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: '/models/' + request.modelFiles[0].name,
            decoder: '/models/' + request.modelFiles[1].name,
            joiner: '/models/' + request.modelFiles[2].name,
          },
          tokens: '/models/' + request.modelFiles[3].name,
          numThreads: 1,
          provider: 'cpu',
          modelType: '',
          debug: 0,
        },
        lmConfig: { model: '', scale: 1.0 },
        hr: { lexicon: '', ruleFsts: '' },
        ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
        decodingMethod: 'greedy_search',
        hotwordsFile: '',
        ruleFsts: '',
        ruleFars: '',
      },
      sherpaModule,
    )
    if (!recognizer.handle) throw new Error('recognizer creation failed (null handle)')
    post({ t: 'progress', stage: 'vad-init' })
    vad = createVad(sherpaModule, {
      sileroVad: {
        model: '/models/' + request.vadFile,
        threshold: 0.5,
        minSilenceDuration: 0.25,
        minSpeechDuration: 0.25,
        maxSpeechDuration: request.maxWindowSeconds || 28,
        windowSize: 512,
      },
      tenVad: { model: '', threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 256 },
      sampleRate: 16000,
      numThreads: 1,
      provider: 'cpu',
      debug: 1,
      bufferSizeInSeconds: 30,
    })
    post({ t: 'loaded', ms: performance.now() - began, heapBytes: sherpaModule.HEAPU8 ? sherpaModule.HEAPU8.length : 0 })
    return
  }
  if (request.t === 'run') {
    if (!recognizer || !vad) throw new Error('engine-b: run before load')
    const samples = new Float32Array(request.samples)
    const began = performance.now()
    vad.reset()
    // One-shot acceptWaveform of the whole buffer silently under-detects in
    // this build; official demos feed window-aligned chunks — 16k chunks
    // (1 s) verified to detect reliably.
    for (let i = 0; i < samples.length; i += 16000) {
      vad.acceptWaveform(samples.subarray(i, Math.min(i + 16000, samples.length)))
    }
    vad.flush()
    const segments = []
    while (!vad.isEmpty()) {
      const segment = vad.front()
      vad.pop()
      segments.push(segment)
    }
    const words = []
    let text = ''
    let resultKeys = []
    for (const segment of segments) {
      const offsetSeconds = segment.start / 16000
      const stream = recognizer.createStream()
      stream.acceptWaveform(16000, segment.samples)
      recognizer.decode(stream)
      const result = recognizer.getResult(stream)
      stream.free()
      if (result && result.text && result.text.trim().length > 0) {
        text += (text.length > 0 ? ' ' : '') + result.text.trim()
        const tokens = Array.isArray(result.tokens) ? result.tokens : []
        const timestamps = Array.isArray(result.timestamps) ? result.timestamps : []
        for (let i = 0; i < tokens.length; i += 1) {
          const token = String(tokens[i] ?? '')
            .replace(/▁/g, ' ')
            .trim()
          if (token.length === 0) continue
          const start = Number(timestamps[i] ?? 0) + offsetSeconds
          const nextStart = i + 1 < tokens.length && Number.isFinite(Number(timestamps[i + 1])) ? Number(timestamps[i + 1]) + offsetSeconds : start
          words.push({ word: token, start, end: Math.max(nextStart, start) })
        }
      }
      if (result && resultKeys.length === 0) resultKeys = Object.keys(result)
    }
    post({
      t: 'runDone',
      wallMs: performance.now() - began,
      output: { text, chunks: words.map((w) => ({ text: w.word, timestamp: [w.start, w.end] })), hasScores: false, resultKeys },
      segmentCount: segments.length,
    })
    return
  }
  if (request.t === 'dispose') {
    try {
      if (recognizer) recognizer.free()
      if (vad) vad.free()
    } finally {
      recognizer = null
      vad = null
    }
    post({ t: 'disposed' })
    return
  }
  if (request.t === 'heap') {
    post({ t: 'heap', heapBytes: sherpaModule && sherpaModule.HEAPU8 ? sherpaModule.HEAPU8.length : 0 })
  }
}

self.onmessage = (event) => {
  Promise.resolve()
    .then(() => handleRequest(event.data))
    .catch((error) => {
      // SECURITY-03: codes only — model paths may appear, transcripts never.
      const stack = String((error && error.stack) || '')
        .slice(0, 300)
        .replace(/\s+/g, ' ')
      const label = error instanceof Error ? `${error.name}:${String(error.message).slice(0, 160)}` : `raw:${String(error).slice(0, 180)}`
      let exc = ''
      if (typeof error === 'number' && sherpaModule && sherpaModule.HEAPU8) {
        exc = 'EXC:' + sherpaModule.HEAPU8.subarray(error, error + 160).reduce((a, b) => a + (b >= 32 && b < 127 ? String.fromCharCode(b) : ''), '')
      }
      post({ t: 'error', error: `${label}|${stack}|${exc}` })
    })
}

post({ t: 'boot' })
