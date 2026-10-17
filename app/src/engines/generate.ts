import type { ParsedLyrics, TimedWord } from '../types'
import type { EngineId, Song } from '../state/models'
import { getSong, useApp } from '../state/store'
import { parseLyrics } from '../lib/lyrics'
import { putBlob, getBlob } from '../lib/db'
import { uid, randomSeed } from '../lib/id'
import { audioBufferToMono, decodeBlob } from '../lib/audio'
import { composeInWorker, detectKeyInWorker, encodeMp3InWorker } from '../workers/client'
import { alignLyrics, linesFromWords } from '../lib/align'
import { falProvider } from './cloud/fal'
import { elevenLabsProvider } from './cloud/elevenlabs'
import { friendlyError } from './cloud/http'
import { plainLyrics } from './cloud/format'
import type { CloudCtx, CloudProvider, RemoteAudio } from './cloud/types'
import { generateLocalLyrics, analyzeStyle } from './local'

export const PROVIDERS: Record<'fal' | 'elevenlabs', CloudProvider> = {
  fal: falProvider,
  elevenlabs: elevenLabsProvider,
}

export interface EngineChoice {
  engine: EngineId
  model: string
}

export interface ModelOption {
  engine: EngineId
  model: string
  label: string
  badge: string
  description: string
  available: boolean
}

export function modelOptions(): ModelOption[] {
  const { settings } = useApp.getState()
  const out: ModelOption[] = []
  for (const p of [falProvider, elevenLabsProvider]) {
    for (const m of p.models)
      out.push({
        engine: p.id,
        model: m.id,
        label: m.label,
        badge: m.badge ?? '',
        description: `${p.label} · ${m.description}`,
        available: !!settings.keys[p.id],
      })
  }
  out.push({ engine: 'local', model: 'encore-local-1', label: 'Encore Local', badge: 'offline', description: 'Built-in engine · works offline, no account needed. Synth vocals.', available: true })
  return out
}

export function defaultModel(): ModelOption {
  const opts = modelOptions()
  const { settings } = useApp.getState()
  return opts.find((o) => o.engine === settings.engine && o.available) ?? opts.find((o) => o.available && o.engine !== 'local') ?? opts[opts.length - 1]
}

function ctxFor(engine: 'fal' | 'elevenlabs', onProgress?: CloudCtx['onProgress']): CloudCtx {
  const { settings } = useApp.getState()
  const key = settings.keys[engine]
  if (!key) throw new Error(`No ${PROVIDERS[engine].label} key — add one in Settings.`)
  return { key, proxy: settings.proxyUrl, onProgress }
}

export interface CreateForm {
  title: string
  style: string
  excludeStyle: string
  lyricsText: string
  instrumental: boolean
  weirdness: number
  styleInfluence: number
  vocalGender: 'male' | 'female' | 'any'
  durationHint?: number
  choice: EngineChoice
  kind?: Song['kind']
  parentId?: string
  workspace?: string
}

/** Simple mode: turn a description into title/style/lyrics. Uses the cloud LLM when available, otherwise the local writer. */
export async function writeLyricsFor(description: string, style: string, engine: EngineId, seed = randomSeed()) {
  if (engine !== 'local') {
    try {
      return await PROVIDERS[engine].writeLyrics(description, style, ctxFor(engine))
    } catch (e) {
      useApp.getState().toast(`AI lyric writer unavailable (${friendlyError(e)}). Using the built-in writer.`, 'error')
    }
  }
  const prof = analyzeStyle(style || description)
  const r = generateLocalLyrics(description, seed, { genre: prof.genre, mood: prof.moods[0] })
  return { title: r.title, lyrics: r.lyrics, style: undefined as string | undefined }
}

/** Create two songs (Suno-style pair) and start generating both. Returns the new song ids. */
export function createSongs(form: CreateForm, count = 2): string[] {
  const { upsertSong, settings } = useApp.getState()
  const batchId = uid('b')
  const ids: string[] = []
  const opt = modelOptions().find((o) => o.engine === form.choice.engine && o.model === form.choice.model)
  for (let i = 0; i < count; i++) {
    const id = uid('s')
    const seed = randomSeed()
    const song: Song = {
      id,
      createdAt: Date.now() + i,
      title: form.title.trim() || 'Untitled',
      style: form.style.trim(),
      excludeStyle: form.excludeStyle.trim() || undefined,
      lyricsText: form.instrumental ? '' : form.lyricsText,
      instrumental: form.instrumental,
      engine: form.choice.engine,
      modelLabel: opt?.badge || opt?.label || form.choice.model,
      status: 'queued',
      progress: 0,
      progressLabel: 'Queued',
      durationSec: 0,
      tags: [],
      coverSeed: seed,
      liked: false,
      plays: 0,
      batchId,
      parentId: form.parentId,
      kind: form.kind ?? 'generation',
      workspace: form.workspace ?? 'My Workspace',
      takes: [],
      params: { weirdness: form.weirdness, styleInfluence: form.styleInfluence, vocalGender: form.vocalGender, seed, durationHint: form.durationHint },
      karaoke: 'none',
    }
    upsertSong(song)
    ids.push(id)
    void runGeneration(id, form.choice.model, settings.displayName)
  }
  return ids
}

export async function runGeneration(id: string, model: string, _artist?: string) {
  const { patchSong } = useApp.getState()
  const song = getSong(id)
  if (!song) return
  const lyrics: ParsedLyrics = parseLyrics(song.lyricsText)
  patchSong(id, { status: 'generating', progress: 0.01, progressLabel: 'Starting', error: undefined })
  try {
    if (song.engine === 'local') await runLocal(song, lyrics)
    else await runCloud(song, lyrics, model)
  } catch (e) {
    console.error(e)
    patchSong(id, { status: 'error', error: friendlyError(e), progressLabel: 'Failed' })
  }
}

async function runLocal(song: Song, lyrics: ParsedLyrics) {
  const { patchSong } = useApp.getState()
  const out = await composeInWorker(
    {
      title: song.title,
      style: song.style,
      excludeStyle: song.excludeStyle,
      lyrics,
      instrumental: song.instrumental,
      seed: song.params.seed,
      weirdness: song.params.weirdness,
      styleInfluence: song.params.styleInfluence,
      vocalGender: song.params.vocalGender,
      durationHint: song.params.durationHint,
    },
    (f, l) => patchSong(song.id, { progress: f, progressLabel: l }, false),
  )
  const mixKey = uid('a')
  const instrumentalKey = uid('a')
  await putBlob(mixKey, new Blob([out.mixMp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }))
  await putBlob(instrumentalKey, new Blob([out.instrumentalMp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }))
  let vocalsKey: string | undefined
  if (out.vocalsMp3) {
    vocalsKey = uid('a')
    await putBlob(vocalsKey, new Blob([out.vocalsMp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }))
  }
  patchSong(song.id, {
    status: 'ready',
    progress: 1,
    progressLabel: 'Ready',
    mixKey,
    instrumentalKey,
    vocalsKey,
    melody: out.melody,
    timedLyrics: out.timedLyrics,
    key: out.key,
    bpm: out.bpm,
    durationSec: out.durationSec,
    tags: out.tags,
    karaoke: 'ready',
  })
}

async function runCloud(song: Song, lyrics: ParsedLyrics, model: string) {
  const { patchSong } = useApp.getState()
  const engine = song.engine as 'fal' | 'elevenlabs'
  const provider = PROVIDERS[engine]
  const ctx = ctxFor(engine, (f, l) => patchSong(song.id, { progress: Math.min(0.97, f), progressLabel: l }, false))
  const res = await provider.generateSong(
    {
      title: song.title,
      style: song.style,
      excludeStyle: song.excludeStyle,
      lyrics,
      instrumental: song.instrumental,
      seed: song.params.seed,
      durationHint: song.params.durationHint,
      model,
      vocalGender: song.params.vocalGender,
      weirdness: song.params.weirdness,
      styleInfluence: song.params.styleInfluence,
    },
    ctx,
  )
  const mixKey = uid('a')
  await putBlob(mixKey, res.audio.blob)
  const decoded = await decodeBlob(res.audio.blob)
  patchSong(song.id, {
    status: 'ready',
    progress: 1,
    progressLabel: 'Ready',
    mixKey,
    durationSec: decoded.duration,
    tags: res.tags?.length ? res.tags : song.tags,
    title: song.title === 'Untitled' && res.title ? res.title : song.title,
    karaoke: 'processing',
    karaokeLabel: 'Preparing karaoke',
  })
  // karaoke prep runs after the song is playable
  void prepareKaraoke(song.id, res.audio, res.words, decoded)
}

/** Split vocals/instrumental and time the lyrics for a cloud song. Safe to re-run. */
export async function prepareKaraoke(id: string, audio?: RemoteAudio, words?: TimedWord[], decoded?: AudioBuffer) {
  const { patchSong } = useApp.getState()
  const song = getSong(id)
  if (!song || song.engine === 'local' || !song.mixKey) return
  if (song.kind === 'my version') return
  const engine = song.engine as 'fal' | 'elevenlabs'
  const provider = PROVIDERS[engine]
  const set = (label: string) => patchSong(id, { karaoke: 'processing', karaokeLabel: label }, false)
  try {
    if (!audio) {
      const blob = await getBlob(song.mixKey)
      if (!blob) throw new Error('Song audio missing')
      audio = { blob }
    }
    if (!decoded) decoded = await decodeBlob(audio.blob)
    const ctx = ctxFor(engine, (_f, l) => set(l))
    // key detection (for scale-based tuning)
    set('Finding the key')
    const mono = audioBufferToMono(decoded)
    const key = await detectKeyInWorker(mono)
    patchSong(id, { key })
    // stems
    set('Separating vocals')
    const stems = await provider.separateStems(audio, ctx)
    const vocalsKey = uid('a')
    await putBlob(vocalsKey, stems.vocals.blob)
    set('Building backing track')
    let instBlob: Blob
    if (stems.instrumental.length === 1) instBlob = stems.instrumental[0].blob
    else {
      const bufs = await Promise.all(stems.instrumental.map((s) => decodeBlob(s.blob)))
      const n = Math.max(...bufs.map((b) => b.length))
      const L = new Float32Array(n)
      const R = new Float32Array(n)
      for (const b of bufs) {
        const l = b.getChannelData(0)
        const r = b.numberOfChannels > 1 ? b.getChannelData(1) : l
        for (let i = 0; i < b.length; i++) {
          L[i] += l[i]
          R[i] += r[i]
        }
      }
      const mp3 = await encodeMp3InWorker({ sampleRate: bufs[0].sampleRate, left: L, right: R }, 192)
      instBlob = new Blob([mp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' })
    }
    const instrumentalKey = uid('a')
    await putBlob(instrumentalKey, instBlob)
    patchSong(id, { vocalsKey, instrumentalKey })
    // lyric timing
    const parsed = parseLyrics(song.lyricsText)
    const hasLyrics = parsed.sections.some((s) => s.lines.length)
    let timed
    if (!song.instrumental) {
      if (hasLyrics) {
        let heard = words
        if (!heard?.length) {
          set('Timing lyrics')
          try {
            heard = await provider.alignWords(stems.vocals, plainLyrics(parsed), ctx)
          } catch (e) {
            console.warn('alignment failed, falling back to transcription', e)
            heard = await provider.transcribeWords(stems.vocals, ctx)
          }
        }
        timed = alignLyrics(parsed, heard ?? [], decoded.duration)
      } else {
        set('Listening for lyrics')
        const heard = words?.length ? words : await provider.transcribeWords(stems.vocals, ctx)
        timed = linesFromWords(heard)
        patchSong(id, { lyricsText: timed.map((l) => l.text).join('\n') })
      }
    }
    patchSong(id, { timedLyrics: timed ?? [], karaoke: 'ready', karaokeLabel: undefined, karaokeError: undefined })
  } catch (e) {
    console.error(e)
    patchSong(id, { karaoke: 'error', karaokeError: friendlyError(e) })
  }
}

export { friendlyError }

/** Import the user's own audio file as a song and prepare it for karaoke. */
export async function uploadSong(file: File, opts: { title: string; lyricsText: string }): Promise<string> {
  const { upsertSong, settings, patchSong } = useApp.getState()
  const engine: EngineId = settings.keys.fal ? 'fal' : settings.keys.elevenlabs ? 'elevenlabs' : 'local'
  const decodedBuf = await decodeBlob(file)
  const id = uid('s')
  const mixKey = uid('a')
  await putBlob(mixKey, file)
  const song: Song = {
    id,
    createdAt: Date.now(),
    title: opts.title || file.name.replace(/\.[^.]+$/, ''),
    style: 'Uploaded audio',
    lyricsText: opts.lyricsText,
    instrumental: false,
    engine,
    modelLabel: 'upload',
    status: 'ready',
    progress: 1,
    progressLabel: 'Ready',
    durationSec: decodedBuf.duration,
    tags: [],
    coverSeed: randomSeed(),
    liked: false,
    plays: 0,
    batchId: uid('b'),
    kind: 'upload',
    workspace: 'My Workspace',
    takes: [],
    params: { weirdness: 0.5, styleInfluence: 0.5, vocalGender: 'any', seed: 0 },
    mixKey,
    karaoke: 'processing',
    karaokeLabel: 'Preparing karaoke',
  }
  upsertSong(song)
  if (engine !== 'local') {
    void prepareKaraoke(id, { blob: file }, undefined, decodedBuf)
  } else {
    // Offline: classic center-channel vocal reduction (vocals are usually panned center).
    try {
      const l = decodedBuf.getChannelData(0)
      const r = decodedBuf.numberOfChannels > 1 ? decodedBuf.getChannelData(1) : l
      const L = new Float32Array(l.length)
      const R = new Float32Array(l.length)
      // keep the low end (bass/kick are also centered) with a simple one-pole split
      let lowL = 0
      let lowR = 0
      const a = Math.exp((-2 * Math.PI * 160) / decodedBuf.sampleRate)
      for (let i = 0; i < l.length; i++) {
        lowL = a * lowL + (1 - a) * l[i]
        lowR = a * lowR + (1 - a) * r[i]
        const side = (l[i] - lowL - (r[i] - lowR)) * 0.5
        L[i] = lowL + side
        R[i] = lowR - side
      }
      const mp3 = await encodeMp3InWorker({ sampleRate: decodedBuf.sampleRate, left: L, right: R }, 192)
      const instrumentalKey = uid('a')
      await putBlob(instrumentalKey, new Blob([mp3 as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' }))
      const key = await detectKeyInWorker(audioBufferToMono(decodedBuf))
      patchSong(id, { instrumentalKey, key, karaoke: 'ready', karaokeLabel: undefined, timedLyrics: [] })
    } catch (e) {
      patchSong(id, { karaoke: 'error', karaokeError: friendlyError(e) })
    }
  }
  return id
}
