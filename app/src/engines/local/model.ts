// Internal song model shared by the planner, arranger and singer.
import type { MusicalKey } from '../../types'
import type { Chord } from './theory'
import type { StyleProfile } from './style'
import type { SylPhones } from './syllables'

export type MotifKey = 'intro' | 'verse' | 'pre' | 'chorus' | 'post' | 'bridge' | 'inst' | 'break' | 'outro'

export interface ChordEvent {
  chord: Chord
  /** absolute beat */
  beat: number
  beats: number
}

export interface VNote {
  start: number
  end: number
  midi: number
  /** absolute position in 16ths */
  pos16: number
  len16: number
  wordIndex?: number
  syl?: SylPhones
  /** continuation of the previous note's vowel (melisma) */
  cont?: boolean
  stress: number
  phraseStart: boolean
  phraseEnd: boolean
  vel: number
  /** harmony voice pitch (diatonic third etc.) */
  harm?: number
}

export interface LinePlan {
  text: string
  words: string[]
  /** index of the first word in the flattened word list */
  wordBase: number
  startBeat: number
  beats: number
  notes: VNote[]
}

export interface SectionPlan {
  tag: string
  label: string
  motif: MotifKey
  startBeat: number
  beats: number
  energy: number
  chords: ChordEvent[]
  lines: LinePlan[]
  beatsPerLine: number
  /** nth occurrence of this motif */
  occurrence: number
  index: number
}

export interface SongPlan {
  profile: StyleProfile
  seed: number
  weirdness: number
  styleInfluence: number
  bpm: number
  spb: number
  key: MusicalKey
  scale: number[]
  /** vocal range */
  vocalLow: number
  vocalHigh: number
  gender: 'male' | 'female'
  sections: SectionPlan[]
  totalBeats: number
  /** seconds of musical content (without reverb tail) */
  musicSec: number
  instrumental: boolean
  /** vocal melody notes (or lead melody when instrumental) */
  melody: VNote[]
  /** chorus hook (relative to section start, in 16ths) for intros/solos */
  hook: Array<{ pos16: number; len16: number; midi: number }>
  /** length of the hook in 16ths */
  hookLen16: number
  /** swing amount 0..1 and the unit it applies to */
  swing: number
  swingUnit: 8 | 16
}

/** Absolute beat (fractional) -> seconds, applying swing. */
export function beatToSec(plan: { spb: number; swing: number; swingUnit: 8 | 16 }, beat: number): number {
  const s = plan.swing
  if (s <= 0) return beat * plan.spb
  const unit = plan.swingUnit === 8 ? 1 : 0.5 // swing pair length in beats
  const pair = Math.floor(beat / unit)
  const q = beat / unit - pair // 0..1 within pair
  const mid = 0.5 + s / 6
  const w = q < 0.5 ? (q / 0.5) * mid : mid + ((q - 0.5) / 0.5) * (1 - mid)
  return (pair + w) * unit * plan.spb
}

export function chordAt(sec: SectionPlan | undefined, plan: SongPlan, beat: number): Chord {
  const s = sec ?? plan.sections.find((x) => beat >= x.startBeat && beat < x.startBeat + x.beats) ?? plan.sections[plan.sections.length - 1]
  for (let i = s.chords.length - 1; i >= 0; i--) if (s.chords[i].beat <= beat + 1e-6) return s.chords[i].chord
  return s.chords[0].chord
}
