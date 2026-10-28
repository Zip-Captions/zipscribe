// Deterministic clock fake for engine/state tests (conventions § Principles 3).

export interface FakeClock {
  now(): number
  advance(millis: number): void
  set(millis: number): void
  install(): () => void
}

export function createFakeClock(startMillis = 0): FakeClock {
  let current = startMillis
  const clock: FakeClock = {
    now: () => current,
    advance: (millis) => {
      current += millis
    },
    set: (millis) => {
      current = millis
    },
    install: () => {
      const dateNow = Date.now
      const perfNow = performance.now.bind(performance)
      Date.now = () => current
      performance.now = () => current
      return () => {
        Date.now = dateNow
        performance.now = perfNow
      }
    },
  }
  return clock
}
