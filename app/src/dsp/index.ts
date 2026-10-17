// Encore vocal processing engine — public API.
// Pure TypeScript (no DOM / Web Audio), safe to run in a Web Worker or Node.

export type { PitchTrack, AnalyzeOptions } from './pitch'
export { analyzePitch, hzToMidi, midiToHz } from './pitch'

export type { PolishParams } from './polish'
export { polishVocal } from './polish'

export type { LevelInfo, ResolvedChain, ChainSummaryItem } from './chain'
export { describeLevel, levelParams } from './chain'

export { encodeWav, decodeWav } from './wav'
export { integratedLoudness, truePeak } from './master'

// lower-level building blocks (advanced use / tests)
export type { TunePlan, TuneParams } from './tune'
export { planCorrection, scaleSnap } from './tune'
export { prepareTrack, notesFromTrack } from './track'
export { detectMarks, psolaShift } from './psola'
