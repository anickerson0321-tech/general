import type { MelodyNote, MusicalKey, TimedLine } from '../types'

export type EngineId = 'local' | 'elevenlabs' | 'fal'

export type SongStatus = 'queued' | 'generating' | 'ready' | 'error'

/** A recorded vocal take sung by the user over a song. */
export interface Take {
  id: string
  createdAt: number
  name: string
  /** 16-bit mono WAV of the raw mic recording */
  rawKey: string
  sampleRate: number
  durationSec: number
  /** song time (s) where the take's sample 0 lines up, after latency compensation */
  offsetSec: number
  /** extra manual nudge in ms (+ = later) */
  nudgeMs: number
  /** studio polish slider 0..100 */
  polish: number
  robotic: boolean
  /** processed render (mp3) for the current polish settings, if cached */
  processedKey?: string
  processedFor?: string // signature of settings that produced processedKey
  volume: number // 0..1.5
  muted: boolean
}

export interface Song {
  id: string
  createdAt: number
  title: string
  style: string
  excludeStyle?: string
  lyricsText: string
  instrumental: boolean
  engine: EngineId
  modelLabel: string
  status: SongStatus
  progress: number
  progressLabel: string
  error?: string
  durationSec: number
  tags: string[]
  coverSeed: number
  coverKey?: string // optional image blob (cloud art or user upload)
  liked: boolean
  disliked?: boolean
  plays: number
  key?: MusicalKey
  bpm?: number
  timedLyrics?: TimedLine[]
  melody?: MelodyNote[]
  /** blob keys */
  mixKey?: string
  instrumentalKey?: string
  vocalsKey?: string
  /** a cached pitch track of the guide vocal, JSON-encoded in a blob */
  guidePitchKey?: string
  batchId: string
  parentId?: string
  kind: 'generation' | 'cover' | 'extend' | 'upload' | 'remaster' | 'my version'
  workspace: string
  takes: Take[]
  /** generation params, for "Reuse prompt" */
  params: {
    weirdness: number
    styleInfluence: number
    vocalGender: 'male' | 'female' | 'any'
    seed: number
    durationHint?: number
  }
  trashed?: boolean
  /** karaoke prep for cloud songs: vocal/instrumental split + lyric timing */
  karaoke: 'none' | 'processing' | 'ready' | 'error'
  karaokeLabel?: string
  karaokeError?: string
  public?: boolean
}

export interface Playlist {
  id: string
  name: string
  createdAt: number
  songIds: string[]
}
