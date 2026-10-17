// Shared data types for the whole app.
// Audio is passed around as planar Float32Array channels plus a sample rate.

export interface StereoBuffer {
  sampleRate: number
  left: Float32Array
  right: Float32Array
}

export interface MonoBuffer {
  sampleRate: number
  data: Float32Array
}

/** Musical key. tonic is a pitch class 0..11 (0 = C). */
export interface MusicalKey {
  tonic: number
  mode: 'major' | 'minor'
}

/** One sung note. Times are in seconds from the start of the song. */
export interface MelodyNote {
  start: number
  end: number
  midi: number // can be fractional for slides; normally integer
  /** index into the flattened word list of the timed lyrics, if this note carries a word/syllable */
  wordIndex?: number
}

export interface TimedWord {
  text: string
  start: number
  end: number
}

export interface TimedLine {
  text: string
  start: number
  end: number
  words: TimedWord[]
  section?: string // e.g. "Verse 1", "Chorus"
}

/** Lyrics as parsed from the Suno-style meta-tag format ([Verse], [Chorus], ...). */
export interface LyricSection {
  tag: string // "Verse", "Chorus", "Bridge", "Intro", "Outro", "Pre-Chorus", "Hook", "Instrumental", ...
  label: string // display label such as "Verse 1"
  lines: string[]
}

export interface ParsedLyrics {
  sections: LyricSection[]
}

export interface ComposeRequest {
  title: string
  /** free text style prompt, e.g. "dreamy synthwave, female vocals, 100 bpm" */
  style: string
  /** styles the user wants to avoid */
  excludeStyle?: string
  lyrics: ParsedLyrics
  instrumental: boolean
  seed: number
  /** 0..1, higher = more unusual choices */
  weirdness?: number
  /** 0..1, how strongly to follow the style text */
  styleInfluence?: number
  vocalGender?: 'male' | 'female' | 'any'
  /** target length in seconds (the engine may deviate to fit the lyrics) */
  durationHint?: number
}

export interface ComposeResult {
  /** full mix (instrumental + guide vocal) */
  mix: StereoBuffer
  /** instrumental only (karaoke backing) */
  instrumental: StereoBuffer
  /** guide vocal only, if any */
  vocals?: StereoBuffer
  melody: MelodyNote[]
  timedLyrics: TimedLine[]
  key: MusicalKey
  bpm: number
  durationSec: number
  /** style tags the engine actually used, for display */
  tags: string[]
}

/** Progress callback: fraction 0..1 and a short status label */
export type ProgressFn = (fraction: number, label: string) => void
