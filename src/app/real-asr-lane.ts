// FR-204.2 — the real-ASR-lane flag for the ziptest harness.
//
// FR-108 [108-ADJ] nulls the app-level ASR/diarize lanes under `?ziptest=1`
// because every scripted transcribe/align e2e drives events through the
// bridges (injection doctrine). The unit-204 offline story cannot be
// scripted: "offline-ready model transcribes with ZERO network" must exercise
// the REAL `asr.worker`. The one flow characteristic it shares with a real
// user is that its media came from the user's OWN local file via the unit-106
// silent relink (the ziptest `seedMediaHandle` + `relinkMedia` pair) —
// scripted streaming specs never touch it. This module records that fact;
// the composition root's `nullAsrDiarizeWorkers` predicate (engine-port,
// evaluated at first worker use) keeps the null lane for everything else.
//
// A module-level flag (not context state): the persistence bridge sets it
// BEFORE any transcribe click can follow the relink it performs.

let localMediaLinked = false

export function markLocalMediaLinked(): void {
  localMediaLinked = true
}

export function hasLocalMediaLinked(): boolean {
  return localMediaLinked
}
