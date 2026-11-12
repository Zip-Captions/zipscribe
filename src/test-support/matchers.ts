// Vitest setup: the jest-dom matchers the frozen UI suites use, without a
// new dependency (settings.yml approved_dependencies stays exact). Registered
// via `test.setupFiles` so every test file sees it through `import { expect }
// from 'vitest'`. Types follow the pinned 4.x contract (vitest.dev/guide/
// extending-matchers: augment Matchers<R, T>).
import 'vitest'
import { expect } from 'vitest'

declare module 'vitest' {
  // Pinned @vitest/expect 4.1.12 declares `Matchers<T = any>`; augmentation
  // must repeat the identical type parameters (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Matchers<T = any> {
    toBeInTheDocument: () => void
    toHaveAttribute: (name: string, value?: string) => void
  }
}

interface MaybeElement {
  ownerDocument?: { contains?: (node: unknown) => boolean } & Node
  getAttribute?: (name: string) => string | null
}

expect.extend({
  toBeInTheDocument(received: unknown): { pass: boolean; message: () => string } {
    const element = received as MaybeElement | null | undefined
    const document = element?.ownerDocument
    const pass = element != null && document !== undefined && typeof document.contains === 'function' && document.contains(element)
    return {
      pass,
      message: () => `expected element ${pass ? 'not ' : ''}to be present in the document`,
    }
  },
  toHaveAttribute(received: unknown, name: string, value?: string): { pass: boolean; message: () => string } {
    const element = received as MaybeElement | null | undefined
    const actual = element != null && typeof element.getAttribute === 'function' ? element.getAttribute(name) : null
    const pass = actual !== null && (value === undefined || actual === value)
    return {
      pass,
      message: () => `expected element ${pass ? 'not ' : ''}to have attribute ${name}${value === undefined ? '' : ` with value ${value}, got ${String(actual)}`}`,
    }
  },
})
