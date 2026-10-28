// Ambient module type for the isolated 4.x transformers.js copy bundled via
// the @hf4x vite alias (tools/eval/node-4x). The leak study only uses the
// pipeline()/env/dispose() surface, which is identical in shape to the pinned
// 3.8.1 typings — so those types are reused rather than duplicating the
// (unpublished for the web bundle) 4.x declarations.
declare module '@hf4x' {
  export function pipeline(
    task: string,
    model?: string,
    options?: Record<string, unknown>,
  ): Promise<{
    (audio: unknown, options?: Record<string, unknown>): Promise<unknown>
    dispose(): Promise<void>
  }>
  export const env: {
    useBrowserCache: boolean
    allowRemoteModels: boolean
    backends: { onnx: { wasm?: Record<string, unknown> } }
  }
}
