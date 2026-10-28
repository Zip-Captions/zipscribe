import { createRoot } from 'react-dom/client'
import { App } from './App'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('missing #root')

createRoot(rootElement).render(<App />)

// FR-1.0.9: boot-time runtime config + wasm warm-up, kept out of the initial
// chunk (lazy) so the entry stays inside the bundle budget.
void import('./engine/boot/adapters/onnx-runtime-boot').then((boot) => boot.bootRuntime())
// FR-1.0.2: the four worker entry stubs, wired through vite `?worker` imports.
void import('./state/services/worker-registry')
