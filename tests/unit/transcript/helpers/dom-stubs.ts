// jsdom stubs for the virtualized transcript list (unit-104 L2). jsdom has no
// layout engine: @tanstack/react-virtual dynamic mode needs real element
// boxes (offsetHeight/getBoundingClientRect) and a working scroll surface
// (scrollTo, scrollTop, scroll events, ResizeObserver — absent in jsdom).
// Deterministic fixed row height; every programmatic scroll is RECORDED so
// follow-scroll vs. scroll-intent-pause is observable (CC-104.2).
export interface ScrollProbe {
  /** Programmatic `scrollTo` invocations on ANY element since the last reset. */
  calls: number
  reset(): void
}

export interface DomStubs {
  restore(): void
  scrollProbe: ScrollProbe
  /** Simulate a USER scroll: set scrollTop (via the recording setter) and
   *  fire a real `scroll` event — the input any scroll-intent listener sees. */
  userScroll(el: Element, top: number): void
  scrollTop(el: Element): number
}

export function installDomStubs(rowHeight = 40): DomStubs {
  const scrollProbe: ScrollProbe = { calls: 0, reset: () => (scrollProbe.calls = 0) }

  const proto = Element.prototype
  const originalRect = proto.getBoundingClientRect
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: rowHeight, width: 320, height: rowHeight, toJSON: () => ({}) })
  proto.getBoundingClientRect = rect as unknown as typeof proto.getBoundingClientRect

  const htmlProto = HTMLElement.prototype
  const offsetHeightDesc = Object.getOwnPropertyDescriptor(htmlProto, 'offsetHeight')
  const offsetWidthDesc = Object.getOwnPropertyDescriptor(htmlProto, 'offsetWidth')
  const scrollTopDesc = Object.getOwnPropertyDescriptor(proto, 'scrollTop')
  const originalScrollTo = (htmlProto as unknown as { scrollTo?: unknown }).scrollTo

  Object.defineProperty(htmlProto, 'offsetHeight', { configurable: true, get: () => rowHeight })
  Object.defineProperty(htmlProto, 'offsetWidth', { configurable: true, get: () => 320 })
  // scrollTop: store per-element, and fire `scroll` only via userScroll —
  // programmatic scrollTo goes through the probe (follow-scroll accounting).
  Object.defineProperty(proto, 'scrollTop', {
    configurable: true,
    get(this: Element & { __st?: number }) {
      return this.__st ?? 0
    },
    set(this: Element & { __st?: number }, value: number) {
      this.__st = value
    },
  })
  Object.defineProperty(htmlProto, 'scrollTo', {
    configurable: true,
    writable: true,
    value(this: Element & { __st?: number }, arg?: unknown) {
      const top = typeof arg === 'object' && arg !== null ? Number((arg as { top?: unknown }).top ?? 0) : Number((arg as number[])[1] ?? 0)
      scrollProbe.calls += 1
      this.__st = top
    },
  })

  const resizeObserverDesc = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
  if (resizeObserverDesc === undefined) {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    })
  }

  return {
    restore() {
      proto.getBoundingClientRect = originalRect
      if (offsetHeightDesc !== undefined) Object.defineProperty(htmlProto, 'offsetHeight', offsetHeightDesc)
      if (offsetWidthDesc !== undefined) Object.defineProperty(htmlProto, 'offsetWidth', offsetWidthDesc)
      if (scrollTopDesc !== undefined) Object.defineProperty(proto, 'scrollTop', scrollTopDesc)
      if (originalScrollTo !== undefined) Object.defineProperty(htmlProto, 'scrollTo', { configurable: true, writable: true, value: originalScrollTo })
      if (resizeObserverDesc === undefined) Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: undefined })
    },
    scrollProbe,
    userScroll(el, top) {
      ;(el as Element & { __st?: number }).__st = top
      el.dispatchEvent(new Event('scroll', { bubbles: false }))
    },
    scrollTop(el) {
      return (el as Element & { __st?: number }).__st ?? 0
    },
  }
}
