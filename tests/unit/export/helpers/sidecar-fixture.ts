// Deterministic fixture project for the sidecar goldens (CC-202.1/202.5).
// Self-authored texts (CC0); includes the escape matrix: &, <, a raw -->
// inside text, a FULL timing-line as text, \n breaks, quotes/tabs, RTL track.
import type { Project, ProjectSnapshot } from '@engine/model'

export function sidecarProject(): Project {
  return {
    id: 'proj_sidecar', name: 'Veterans Q&A — Part 2!!', schemaVersion: 1,
    asset: {
      id: 'a1', name: 'clip.mp4', kind: 'video', container: 'mp4', audioCodec: 'aac', videoCodec: 'avc',
      duration: 40, width: 1920, height: 1080, fps: 30,
      fingerprint: { name: 'clip.mp4', size: 1, durationMs: 40000, sampleHashes: ['x', 'y', 'z'] },
    },
    blocks: [
      { id: 'b1', start: 0.5, end: 3.25, text: 'welcome & goodbye', words: [{ text: 'welcome', start: 0.5, end: 1.5 }, { text: '&', start: 1.6, end: 1.8 }, { text: 'goodbye', start: 2, end: 3.25 }], speakerId: 'SPK_1' },
      { id: 'b2', start: 4, end: 7.5, text: 'tab\there\nsecond <line>', words: [{ text: 'tab', start: 4, end: 5 }, { text: 'here', start: 5, end: 6 }, { text: 'second', start: 6, end: 6.7 }, { text: '<line>', start: 6.7, end: 7.5 }], speakerId: 'SPK_2' },
      { id: 'b3', start: 9, end: 11, text: '00:00:09,000 --> 00:00:11,000', words: [{ text: 'marker', start: 9, end: 11 }], speakerId: 'SPK_1' },
      { id: 'b4', start: 13, end: 15.125, text: 'quote "and" comma', words: [{ text: 'quote', start: 13, end: 14 }, { text: 'quoted', start: 14, end: 15.125 }], speakerId: 'SPK_3' },
    ],
    captionOrigin: 'transcribed',
    translations: [
      { language: 'fr', origin: 'machine', engine: 'chrome-translator', entries: {
        b1: { text: 'bienvenue et au revoir', status: 'translated', sourceHash: 'h1' },
        b2: { text: 'tabulation ici\nligne <deux>', status: 'edited', sourceHash: 'h2' },
        b3: { text: 'ligne de minutage', status: 'translated', sourceHash: 'h3' },
        b4: { text: 'guillemets et virgule', status: 'failed', sourceHash: 'h4' },
      } },
      { language: 'ar', origin: 'manual', engine: null, entries: {
        b1: { text: 'مرحبا', status: 'translated', sourceHash: 'h1' },
        b2: { text: 'مرحبا بالعالم & <نص>', status: 'translated', sourceHash: 'h2' },
        b3: { text: 'سطر زمني', status: 'translated', sourceHash: 'h3' },
        b4: { text: 'اقتباس', status: 'translated', sourceHash: 'h4' },
      } },
    ],
    speakers: [
      { id: 'SPK_1', label: 'Host', color: '#4c8dff' },
      { id: 'SPK_2', label: 'Guest & Co', color: '#e5534b' },
      { id: 'SPK_3', label: 'Caller', color: '#4ab871' },
    ],
    speakerSource: 'auto-beta', language: 'en', modelId: null,
    style: { fontFamily: 'Inter', fontWeight: 700, fontSizePct: 5, textTransform: 'none', color: '#ffffff', highlightColor: '#4c8dff', outlineColor: '#0d0f12', outlineWidth: 2, backgroundOpacity: 0, position: 'bottom', marginVPct: 6, alignment: 'center', maxLinesPerBlock: 2, highlightMode: 'none', showSpeakerBar: false },
    outputAspect: '16:9', transcription: 'complete', updatedAt: 1764720000000,
  }
}

export function sidecarSnapshot(): ProjectSnapshot {
  return { ...structuredClone(sidecarProject()), snapshotVersion: 7 }
}
