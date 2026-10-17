import type { ParsedLyrics, TimedWord } from '../../types'

export interface CloudCtx {
  key: string
  proxy: string
  onProgress?: (fraction: number, label: string) => void
  signal?: AbortSignal
}

export interface CloudModel {
  id: string
  label: string
  description: string
  badge?: string
}

export interface CloudSongRequest {
  title: string
  style: string
  excludeStyle?: string
  lyrics: ParsedLyrics
  instrumental: boolean
  seed: number
  durationHint?: number
  model: string
  vocalGender: 'male' | 'female' | 'any'
  weirdness: number
  styleInfluence: number
}

/** An audio file produced by a provider: a blob, plus the hosted URL when the provider gave one. */
export interface RemoteAudio {
  blob: Blob
  url?: string
}

export interface CloudSongResult {
  audio: RemoteAudio
  words?: TimedWord[]
  title?: string
  tags?: string[]
}

export interface CloudStems {
  vocals: RemoteAudio
  /** either one instrumental file, or several stems to be summed */
  instrumental: RemoteAudio[]
}

export interface CloudProvider {
  id: 'fal' | 'elevenlabs'
  label: string
  keyHelp: string
  keyUrl: string
  models: CloudModel[]
  generateSong(req: CloudSongRequest, ctx: CloudCtx): Promise<CloudSongResult>
  separateStems(audio: RemoteAudio, ctx: CloudCtx): Promise<CloudStems>
  alignWords(vocals: RemoteAudio, plainLyrics: string, ctx: CloudCtx): Promise<TimedWord[]>
  transcribeWords(vocals: RemoteAudio, ctx: CloudCtx): Promise<TimedWord[]>
  writeLyrics(prompt: string, style: string, ctx: CloudCtx): Promise<{ title: string; lyrics: string; style?: string }>
  /** quick authenticated call to check the key */
  testKey(ctx: CloudCtx): Promise<void>
}
